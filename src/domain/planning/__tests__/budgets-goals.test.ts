import type { PeriodSettings } from '../../finance/budget';
import {
  type BudgetRevision,
  evaluateBudget,
  evaluatePeriod,
  listBudgetPeriods,
  normalizeBudgetStart,
  revisionFor,
  spendingPerPeriod,
  statusFor,
} from '../budgets';
import { evaluateGoal, wholeMonthsBetween } from '../goals';

const monday: PeriodSettings = { firstDayOfWeek: 1, monthStartDay: 1 };
const sunday: PeriodSettings = { firstDayOfWeek: 0, monthStartDay: 1 };

const rev = (
  effectiveFrom: string,
  amountMinor: number,
  rolloverEnabled = false,
  createdAt = '2026-01-01T00:00:00Z',
  id = effectiveFrom,
): BudgetRevision => ({ id, effectiveFrom, amountMinor, rolloverEnabled, createdAt });

describe('budget periods', () => {
  it('weekly periods follow the first-day-of-week preference', () => {
    // 2026-10-07 is a Wednesday.
    expect(
      normalizeBudgetStart(
        { periodType: 'weekly', startDate: '2026-10-07', endDate: null },
        monday,
      ),
    ).toBe('2026-10-05');
    expect(
      normalizeBudgetStart(
        { periodType: 'weekly', startDate: '2026-10-07', endDate: null },
        sunday,
      ),
    ).toBe('2026-10-04');
    const weeks = listBudgetPeriods(
      { periodType: 'weekly', startDate: '2026-10-04', endDate: null },
      sunday,
      '2026-10-17',
    );
    expect(weeks).toEqual([
      { start: '2026-10-04', end: '2026-10-10' },
      { start: '2026-10-11', end: '2026-10-17' },
    ]);
  });

  it('monthly periods cover 28/29/30/31-day months and year boundaries', () => {
    const months = listBudgetPeriods(
      { periodType: 'monthly', startDate: '2027-11-01', endDate: null },
      monday,
      '2028-03-15',
    );
    expect(months).toEqual([
      { start: '2027-11-01', end: '2027-11-30' },
      { start: '2027-12-01', end: '2027-12-31' },
      { start: '2028-01-01', end: '2028-01-31' },
      { start: '2028-02-01', end: '2028-02-29' },
      { start: '2028-03-01', end: '2028-03-31' },
    ]);
    expect(
      normalizeBudgetStart(
        { periodType: 'monthly', startDate: '2026-02-17', endDate: null },
        monday,
      ),
    ).toBe('2026-02-01');
  });

  it('custom budgets are a single period and keep their exact start', () => {
    const def = { periodType: 'custom', startDate: '2026-11-01', endDate: '2026-12-15' } as const;
    expect(normalizeBudgetStart(def, monday)).toBe('2026-11-01');
    expect(listBudgetPeriods(def, monday, '2027-06-01')).toEqual([
      { start: '2026-11-01', end: '2026-12-15' },
    ]);
  });

  it('buckets daily spending into periods', () => {
    const periods = [
      { start: '2026-10-01', end: '2026-10-31' },
      { start: '2026-11-01', end: '2026-11-30' },
    ];
    expect(
      spendingPerPeriod(periods, [
        { localDate: '2026-11-02', spentMinor: 500 },
        { localDate: '2026-09-30', spentMinor: 999 },
        { localDate: '2026-10-31', spentMinor: 100 },
        { localDate: '2026-10-01', spentMinor: 200 },
        { localDate: '2026-12-01', spentMinor: 999 },
      ]),
    ).toEqual([300, 500]);
  });
});

describe('revisions', () => {
  it('uses the latest revision effective on or before the period start', () => {
    const revisions = [rev('2026-10-01', 50_000), rev('2026-12-01', 60_000)];
    expect(revisionFor(revisions, '2026-11-01').amountMinor).toBe(50_000);
    expect(revisionFor(revisions, '2026-12-01').amountMinor).toBe(60_000);
    expect(revisionFor(revisions, '2026-09-01').amountMinor).toBe(50_000);
  });

  it('breaks ties deterministically by creation time, then id', () => {
    const revisions = [
      rev('2026-10-01', 1, false, '2026-10-02T00:00:00Z', 'b'),
      rev('2026-10-01', 2, false, '2026-10-03T00:00:00Z', 'a'),
      rev('2026-10-01', 3, false, '2026-10-03T00:00:00Z', 'c'),
    ];
    expect(revisionFor(revisions, '2026-10-01').amountMinor).toBe(3);
  });

  it('requires at least one revision', () => {
    expect(() => revisionFor([], '2026-10-01')).toThrow(/no amount/);
  });
});

describe('period evaluation and pace', () => {
  const october = { start: '2026-10-01', end: '2026-10-30' }; // 30 days for round numbers

  it('$1,000 budget, day 10 of 30, $600 spent → ahead of pace (warning)', () => {
    const r = evaluatePeriod({
      period: october,
      today: '2026-10-10',
      limitMinor: 100_000,
      rolloverEnabled: false,
      carryInMinor: 0,
      spentMinor: 60_000,
    });
    expect(r).toMatchObject({
      phase: 'current',
      daysTotal: 30,
      daysElapsed: 10,
      daysRemaining: 20,
      expectedSpentMinor: 33_333,
      remainingMinor: 40_000,
      usedBasisPoints: 6_000,
      aheadOfPace: true,
      status: 'warning',
      averageDailySpentMinor: 6_000,
      dailyAllowanceMinor: 1_904, // 400.00 over today + 20 days
    });
  });

  it('within pace is on track; ≥ 80% used is a warning; > budget is over', () => {
    expect(statusFor(100_000, 30_000, 33_333)).toEqual({ status: 'on_track', aheadOfPace: false });
    expect(statusFor(100_000, 43_000, 33_333).status).toBe('on_track'); // within 10% tolerance
    expect(statusFor(100_000, 43_334, 33_333)).toEqual({ status: 'warning', aheadOfPace: true });
    expect(statusFor(100_000, 80_000, 100_000).status).toBe('warning');
    expect(statusFor(100_000, 100_000, 100_000).status).toBe('warning');
    expect(statusFor(100_000, 100_001, 100_000).status).toBe('over');
  });

  it('upcoming and past periods', () => {
    const upcoming = evaluatePeriod({
      period: october,
      today: '2026-09-20',
      limitMinor: 3_000,
      rolloverEnabled: true,
      carryInMinor: 0,
      spentMinor: 0,
    });
    expect(upcoming).toMatchObject({
      phase: 'upcoming',
      daysElapsed: 0,
      daysRemaining: 30,
      averageDailySpentMinor: null,
      dailyAllowanceMinor: 100,
      status: 'on_track',
    });
    const past = evaluatePeriod({
      period: october,
      today: '2026-11-03',
      limitMinor: 3_000,
      rolloverEnabled: true,
      carryInMinor: 0,
      spentMinor: 3_500,
    });
    expect(past).toMatchObject({
      phase: 'past',
      daysElapsed: 30,
      daysRemaining: 0,
      dailyAllowanceMinor: null,
      status: 'over',
      remainingMinor: -500,
      carryOutMinor: 0,
    });
  });

  it('refund-heavy periods never report negative usage', () => {
    const r = evaluatePeriod({
      period: october,
      today: '2026-10-15',
      limitMinor: 10_000,
      rolloverEnabled: false,
      carryInMinor: 0,
      spentMinor: -2_000,
    });
    expect(r.usedBasisPoints).toBe(0);
    expect(r.remainingMinor).toBe(12_000);
    expect(r.status).toBe('on_track');
  });

  it('a zero amount has no pace expectation', () => {
    const r = evaluatePeriod({
      period: october,
      today: '2026-10-15',
      limitMinor: 0,
      rolloverEnabled: false,
      carryInMinor: 0,
      spentMinor: 1,
    });
    expect(r).toMatchObject({ expectedSpentMinor: 0, usedBasisPoints: 0, status: 'over' });
  });

  it('an exhausted current period allows nothing more per day', () => {
    const r = evaluatePeriod({
      period: october,
      today: '2026-10-15',
      limitMinor: 10_000,
      rolloverEnabled: false,
      carryInMinor: 0,
      spentMinor: 10_000,
    });
    expect(r.dailyAllowanceMinor).toBe(0);
  });
});

describe('rollover', () => {
  const base = {
    periodType: 'monthly' as const,
    startDate: '2026-01-01',
    endDate: null,
    settings: monday,
  };

  it('no rollover: each month starts fresh', () => {
    const { periods, current } = evaluateBudget({
      ...base,
      revisions: [rev('2026-01-01', 50_000, false)],
      spending: [{ localDate: '2026-01-15', spentMinor: 40_000 }],
      today: '2026-02-10',
    });
    expect(periods).toHaveLength(2);
    expect(current.availableMinor).toBe(50_000);
    expect(current.carryInMinor).toBe(0);
  });

  it('positive remainder rolls forward ($500 − $400 → February has $600)', () => {
    const { current } = evaluateBudget({
      ...base,
      revisions: [rev('2026-01-01', 50_000, true)],
      spending: [{ localDate: '2026-01-15', spentMinor: 40_000 }],
      today: '2026-02-10',
    });
    expect(current).toMatchObject({ carryInMinor: 10_000, availableMinor: 60_000 });
  });

  it('zero remaining carries nothing; overspending is absorbed, not carried', () => {
    const zero = evaluateBudget({
      ...base,
      revisions: [rev('2026-01-01', 50_000, true)],
      spending: [{ localDate: '2026-01-15', spentMinor: 50_000 }],
      today: '2026-02-10',
    });
    expect(zero.current.carryInMinor).toBe(0);
    const over = evaluateBudget({
      ...base,
      revisions: [rev('2026-01-01', 50_000, true)],
      spending: [{ localDate: '2026-01-15', spentMinor: 70_000 }],
      today: '2026-02-10',
    });
    expect(over.periods[0]!.status).toBe('over');
    expect(over.current).toMatchObject({ carryInMinor: 0, availableMinor: 50_000 });
  });

  it('accumulates across the year boundary and leap February', () => {
    const { periods, current } = evaluateBudget({
      ...base,
      startDate: '2027-12-01',
      revisions: [rev('2027-12-01', 10_000, true)],
      spending: [
        { localDate: '2027-12-31', spentMinor: 6_000 }, // carry 4,000
        { localDate: '2028-01-01', spentMinor: 12_000 }, // 14,000 − 12,000 → carry 2,000
        { localDate: '2028-02-29', spentMinor: 1_000 }, // 12,000 − 1,000 → carry 11,000
      ],
      today: '2028-03-02',
    });
    expect(periods.map((p) => p.carryInMinor)).toEqual([0, 4_000, 2_000, 11_000]);
    expect(current).toMatchObject({ start: '2028-03-01', availableMinor: 21_000 });
  });

  it('rollover follows the revision in force for each period', () => {
    const { periods } = evaluateBudget({
      ...base,
      revisions: [rev('2026-01-01', 10_000, false), rev('2026-02-01', 20_000, true)],
      spending: [{ localDate: '2026-02-03', spentMinor: 5_000 }],
      today: '2026-03-05',
    });
    // January had rollover off → nothing carried into February.
    expect(periods.map((p) => [p.limitMinor, p.carryInMinor, p.availableMinor])).toEqual([
      [10_000, 0, 10_000],
      [20_000, 0, 20_000],
      [20_000, 15_000, 35_000],
    ]);
  });

  it('editing the amount from a later period keeps earlier periods unchanged', () => {
    const revisions = [rev('2026-01-01', 30_000, true)];
    const spending = [{ localDate: '2026-01-10', spentMinor: 10_000 }];
    const before = evaluateBudget({ ...base, revisions, spending, today: '2026-02-15' });
    const after = evaluateBudget({
      ...base,
      revisions: [...revisions, rev('2026-02-01', 40_000, true, '2026-02-15T00:00:00Z', 'x')],
      spending,
      today: '2026-02-15',
    });
    expect(after.periods[0]).toEqual(before.periods[0]);
    expect(after.current.availableMinor).toBe(60_000);
  });

  it('weekly rollover respects the first day of week', () => {
    const { periods } = evaluateBudget({
      periodType: 'weekly',
      startDate: '2026-10-04',
      endDate: null,
      settings: sunday,
      revisions: [rev('2026-10-04', 15_000, true)],
      spending: [
        { localDate: '2026-10-10', spentMinor: 10_000 }, // Saturday: still week 1
        { localDate: '2026-10-11', spentMinor: 1_000 }, // Sunday: week 2
      ],
      today: '2026-10-12',
    });
    expect(periods.map((p) => [p.start, p.spentMinor, p.carryInMinor])).toEqual([
      ['2026-10-04', 10_000, 0],
      ['2026-10-11', 1_000, 5_000],
    ]);
  });

  it('custom budgets: days remaining and completion', () => {
    const def = {
      periodType: 'custom' as const,
      startDate: '2026-11-01',
      endDate: '2026-12-15',
      settings: monday,
      revisions: [rev('2026-11-01', 200_000)],
      spending: [{ localDate: '2026-11-20', spentMinor: 50_000 }],
    };
    expect(evaluateBudget({ ...def, today: '2026-11-30' }).current).toMatchObject({
      daysTotal: 45,
      daysElapsed: 30,
      daysRemaining: 15,
      phase: 'current',
    });
    expect(evaluateBudget({ ...def, today: '2027-01-02' }).current.phase).toBe('past');
    expect(evaluateBudget({ ...def, today: '2026-10-02' }).current.phase).toBe('upcoming');
  });
});

describe('savings goals', () => {
  it('suggests $150/month for $900 over 6 months', () => {
    expect(
      evaluateGoal({
        targetMinor: 120_000,
        savedMinor: 30_000,
        targetDate: '2027-04-07',
        today: '2026-10-07',
      }),
    ).toMatchObject({
      remainingMinor: 90_000,
      progressBasisPoints: 2_500,
      completed: false,
      daysRemaining: 182,
      suggestion: { kind: 'monthly', months: 6, amountMinor: 15_000 },
    });
  });

  it('rounds the suggestion up so following it reaches the target', () => {
    const g = evaluateGoal({
      targetMinor: 100_000,
      savedMinor: 0,
      targetDate: '2027-01-07',
      today: '2026-10-07',
    });
    expect(g.suggestion).toEqual({ kind: 'monthly', months: 3, amountMinor: 33_334 });
  });

  it('a target less than a month away asks for the full remainder', () => {
    const g = evaluateGoal({
      targetMinor: 10_000,
      savedMinor: 4_000,
      targetDate: '2026-10-20',
      today: '2026-10-07',
    });
    expect(g.suggestion).toEqual({ kind: 'monthly', months: 1, amountMinor: 6_000 });
  });

  it('exact target and overfunding are completed, never capped', () => {
    expect(
      evaluateGoal({
        targetMinor: 300_000,
        savedMinor: 300_000,
        targetDate: null,
        today: '2026-10-07',
      }),
    ).toMatchObject({
      completed: true,
      remainingMinor: 0,
      progressBasisPoints: 10_000,
      suggestion: { kind: 'completed' },
    });
    expect(
      evaluateGoal({
        targetMinor: 300_000,
        savedMinor: 320_000,
        targetDate: null,
        today: '2026-10-07',
      }),
    ).toMatchObject({ completed: true, overMinor: 20_000, progressBasisPoints: 10_666 });
  });

  it('target date passed and no target date give no schedule', () => {
    expect(
      evaluateGoal({
        targetMinor: 1_000,
        savedMinor: 100,
        targetDate: '2026-10-01',
        today: '2026-10-07',
      }).suggestion,
    ).toEqual({ kind: 'target_passed' });
    const none = evaluateGoal({
      targetMinor: 1_000,
      savedMinor: 0,
      targetDate: null,
      today: '2026-10-07',
    });
    expect(none.suggestion).toEqual({ kind: 'no_target_date' });
    expect(none.daysRemaining).toBeNull();
    expect(none.progressBasisPoints).toBe(0);
  });

  it('due today is not passed', () => {
    expect(
      evaluateGoal({
        targetMinor: 1_000,
        savedMinor: 0,
        targetDate: '2026-10-07',
        today: '2026-10-07',
      }).suggestion,
    ).toEqual({ kind: 'monthly', months: 1, amountMinor: 1_000 });
  });

  it('counts whole calendar months (month-end safe)', () => {
    expect(wholeMonthsBetween('2026-10-07', '2027-04-06')).toBe(5);
    expect(wholeMonthsBetween('2026-10-07', '2027-04-07')).toBe(6);
    expect(wholeMonthsBetween('2026-01-31', '2026-02-28')).toBe(1);
    expect(wholeMonthsBetween('2026-10-07', '2026-10-01')).toBe(0);
  });
});
