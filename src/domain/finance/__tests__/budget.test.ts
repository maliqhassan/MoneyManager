import {
  addDays,
  addMonths,
  compareDates,
  dayOfWeek,
  daysBetween,
  InvalidDateError,
  isCalendarDate,
  startOfWeek,
  toCalendarDateInZone,
} from '../../dates/calendar';
import {
  computeBudgetProgress,
  computeRollover,
  forecastPeriodSpending,
  getBudgetPeriod,
  getPreviousPeriod,
  InvalidBudgetError,
  periodLengthDays,
  spendingByCategory,
  type BudgetPosting,
} from '../budget';

const monday = { firstDayOfWeek: 1, monthStartDay: 1 } as const;

describe('calendar', () => {
  it('adds days and months with clamping and leap years', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
    expect(addMonths('2026-01-15', -1)).toBe('2025-12-15');
    expect(addMonths('2026-11-30', 14)).toBe('2028-01-30');
  });

  it('compares and measures dates', () => {
    expect(daysBetween('2026-01-01', '2026-12-31')).toBe(364);
    expect(compareDates('2026-01-02', '2026-01-01')).toBe(1);
    expect(compareDates('2026-01-01', '2026-01-01')).toBe(0);
    expect(dayOfWeek('2026-10-07')).toBe(3); // Wednesday
    expect(startOfWeek('2026-10-07', 1)).toBe('2026-10-05');
    expect(startOfWeek('2026-10-07', 0)).toBe('2026-10-04');
    expect(startOfWeek('2026-10-07', 6)).toBe('2026-10-03');
  });

  it('validates dates strictly', () => {
    expect(isCalendarDate('2026-02-29')).toBe(false);
    expect(isCalendarDate('2028-02-29')).toBe(true);
    expect(isCalendarDate('2026-13-01')).toBe(false);
    expect(isCalendarDate('26-1-1')).toBe(false);
    expect(() => addDays('nope', 1)).toThrow(InvalidDateError);
  });

  it('resolves the local calendar date for a time zone', () => {
    const instant = new Date('2026-10-07T22:30:00Z');
    expect(toCalendarDateInZone(instant, 'UTC')).toBe('2026-10-07');
    expect(toCalendarDateInZone(instant, 'Asia/Dubai')).toBe('2026-10-08');
    expect(toCalendarDateInZone(instant, 'America/Los_Angeles')).toBe('2026-10-07');
  });
});

describe('getBudgetPeriod', () => {
  const monthly = { periodType: 'monthly', startDate: '2026-01-01', endDate: null } as const;

  it('finds calendar-month periods', () => {
    expect(getBudgetPeriod(monthly, '2026-02-14', monday)).toEqual({
      start: '2026-02-01',
      end: '2026-02-28',
    });
  });

  it('honours a custom month start day (e.g. payday on the 25th)', () => {
    const settings = { firstDayOfWeek: 1, monthStartDay: 25 } as const;
    expect(getBudgetPeriod(monthly, '2026-10-07', settings)).toEqual({
      start: '2026-09-25',
      end: '2026-10-24',
    });
    expect(getBudgetPeriod(monthly, '2026-10-25', settings)).toEqual({
      start: '2026-10-25',
      end: '2026-11-24',
    });
  });

  it('finds weekly periods using the first day of the week', () => {
    const weekly = { periodType: 'weekly', startDate: '2026-01-01', endDate: null } as const;
    expect(getBudgetPeriod(weekly, '2026-10-07', monday)).toEqual({
      start: '2026-10-05',
      end: '2026-10-11',
    });
    expect(getBudgetPeriod(weekly, '2026-10-07', { ...monday, firstDayOfWeek: 0 })).toEqual({
      start: '2026-10-04',
      end: '2026-10-10',
    });
  });

  it('handles custom periods', () => {
    const custom = {
      periodType: 'custom',
      startDate: '2026-06-01',
      endDate: '2026-08-31',
    } as const;
    expect(getBudgetPeriod(custom, '2026-07-04', monday)).toEqual({
      start: '2026-06-01',
      end: '2026-08-31',
    });
    expect(getBudgetPeriod(custom, '2026-09-01', monday)).toBeNull();
    expect(() => getBudgetPeriod({ ...custom, endDate: null }, '2026-07-04', monday)).toThrow(
      InvalidBudgetError,
    );
    expect(() =>
      getBudgetPeriod({ ...custom, endDate: '2026-05-01' }, '2026-07-04', monday),
    ).toThrow(InvalidBudgetError);
  });

  it('returns null before the budget starts and validates settings', () => {
    expect(getBudgetPeriod(monthly, '2025-12-31', monday)).toBeNull();
    expect(() => getBudgetPeriod(monthly, '2026-03-01', { ...monday, monthStartDay: 31 })).toThrow(
      InvalidBudgetError,
    );
  });

  it('steps back to previous periods', () => {
    expect(
      getPreviousPeriod('monthly', { start: '2026-03-01', end: '2026-03-31' }, monday),
    ).toEqual({ start: '2026-02-01', end: '2026-02-28' });
    expect(getPreviousPeriod('weekly', { start: '2026-10-05', end: '2026-10-11' }, monday)).toEqual(
      { start: '2026-09-28', end: '2026-10-04' },
    );
    expect(periodLengthDays({ start: '2026-02-01', end: '2026-02-28' })).toBe(28);
  });
});

describe('spendingByCategory', () => {
  const period = { start: '2026-10-01', end: '2026-10-31' };
  const posting = (
    categoryId: string | null,
    type: BudgetPosting['type'],
    amountMinor: number,
    localDate = '2026-10-10',
  ): BudgetPosting => ({ categoryId, type, amountMinor, localDate });

  it('nets refunds, ignores income/transfers and out-of-period postings', () => {
    const totals = spendingByCategory(
      [
        posting('food', 'expense', -5_000),
        posting('food', 'expense', -2_500),
        posting('food', 'refund', 1_000),
        posting('rent', 'expense', -150_000),
        posting(null, 'expense', -700),
        posting('salary', 'income', 400_000),
        posting(null, 'transfer', -10_000),
        posting('food', 'expense', -9_999, '2026-11-01'),
        posting('food', 'expense', -9_999, '2026-09-30'),
      ],
      period,
    );
    expect(totals.get('food')).toBe(6_500);
    expect(totals.get('rent')).toBe(150_000);
    expect(totals.get(null)).toBe(700);
    expect(totals.has('salary')).toBe(false);
  });
});

describe('computeRollover', () => {
  const history = [
    { limitMinor: 50_000, spentMinor: 40_000 }, // +10 000
    { limitMinor: 50_000, spentMinor: 65_000 }, // 60 000 available → -5 000
    { limitMinor: 50_000, spentMinor: 30_000 },
  ];

  it('carries surplus and absorbs overspending by default', () => {
    // p1: +10 000; p2: 60 000 - 65 000 = -5 000 → reset 0; p3: 50 000 - 30 000 = 20 000
    expect(computeRollover(history, false)).toBe(20_000);
  });

  it('carries overspending forward when enabled', () => {
    // p1: 10 000; p2: -5 000; p3: 45 000 - 30 000 = 15 000
    expect(computeRollover(history, true)).toBe(15_000);
  });

  it('is zero with no history', () => {
    expect(computeRollover([], true)).toBe(0);
  });
});

describe('computeBudgetProgress', () => {
  it('tracks remaining and status', () => {
    expect(computeBudgetProgress(100_000, 50_000)).toEqual({
      availableMinor: 100_000,
      spentMinor: 50_000,
      remainingMinor: 50_000,
      usedBasisPoints: 5_000,
      status: 'on_track',
    });
    expect(computeBudgetProgress(100_000, 80_000).status).toBe('warning');
    expect(computeBudgetProgress(100_000, 100_000).status).toBe('warning');
    expect(computeBudgetProgress(100_000, 100_001).status).toBe('over');
  });

  it('includes rollover carry-in', () => {
    const progress = computeBudgetProgress(100_000, 110_000, 20_000);
    expect(progress.availableMinor).toBe(120_000);
    expect(progress.remainingMinor).toBe(10_000);
    expect(progress.status).toBe('warning');
  });

  it('handles a zero or negative available amount', () => {
    expect(computeBudgetProgress(0, 0)).toMatchObject({
      usedBasisPoints: null,
      status: 'on_track',
    });
    expect(computeBudgetProgress(10_000, 0, -15_000)).toMatchObject({
      usedBasisPoints: null,
      status: 'over',
    });
  });

  it('counts net refunds (negative spend) as on track', () => {
    expect(computeBudgetProgress(10_000, -500)).toMatchObject({
      remainingMinor: 10_500,
      usedBasisPoints: -500,
      status: 'on_track',
    });
  });
});

describe('forecastPeriodSpending', () => {
  const period = { start: '2026-10-01', end: '2026-10-30' }; // 30 days

  it('extrapolates linearly', () => {
    expect(forecastPeriodSpending(30_000, period, '2026-10-10')).toBe(90_000);
  });

  it('returns actuals once the period has ended and 0 before it starts', () => {
    expect(forecastPeriodSpending(30_000, period, '2026-11-02')).toBe(30_000);
    expect(forecastPeriodSpending(30_000, period, '2026-09-20')).toBe(0);
  });
});
