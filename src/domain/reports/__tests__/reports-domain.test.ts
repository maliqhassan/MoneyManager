import { evaluateBudget } from '../../planning/budgets';
import {
  balanceSeries,
  budgetPeriodsInRange,
  categorySpending,
  compareAmounts,
  dailySpending,
  type FlowRow,
  merchantSpending,
  monthlyTrend,
  shareBasisPoints,
  summarizeFlows,
} from '../aggregate';
import {
  balanceSampleDates,
  normalizeRange,
  rangeLengthDays,
  resolveReportPeriod,
  trailingMonths,
} from '../periods';

const MON = 1 as const;
const SUN = 0 as const;

describe('report periods', () => {
  // 2026-10-07 is a Wednesday.
  it('this week / last week follow the first day of week', () => {
    expect(resolveReportPeriod('this_week', '2026-10-07', MON)).toMatchObject({
      range: { start: '2026-10-05', end: '2026-10-07' },
      previous: { start: '2026-09-28', end: '2026-09-30' },
      toDate: true,
    });
    expect(resolveReportPeriod('this_week', '2026-10-07', SUN).range.start).toBe('2026-10-04');
    expect(resolveReportPeriod('last_week', '2026-10-07', SUN)).toMatchObject({
      range: { start: '2026-09-27', end: '2026-10-03' },
      previous: { start: '2026-09-20', end: '2026-09-26' },
      toDate: false,
    });
  });

  it('this month runs to today and compares with the same days of last month', () => {
    expect(resolveReportPeriod('this_month', '2026-10-11', MON)).toMatchObject({
      range: { start: '2026-10-01', end: '2026-10-11' },
      previous: { start: '2026-09-01', end: '2026-09-11' },
    });
    // Month-end clamps: 31 March compares with 1–28 February (29 in a leap year).
    expect(resolveReportPeriod('this_month', '2027-03-31', MON).previous).toEqual({
      start: '2027-02-01',
      end: '2027-02-28',
    });
    expect(resolveReportPeriod('this_month', '2028-03-31', MON).previous.end).toBe('2028-02-29');
  });

  it('last month / last 3 months / years cross year boundaries correctly', () => {
    expect(resolveReportPeriod('last_month', '2026-01-15', MON)).toMatchObject({
      range: { start: '2025-12-01', end: '2025-12-31' },
      previous: { start: '2025-11-01', end: '2025-11-30' },
    });
    expect(resolveReportPeriod('last_3_months', '2026-02-10', MON)).toMatchObject({
      range: { start: '2025-11-01', end: '2026-01-31' },
      previous: { start: '2025-08-01', end: '2025-10-31' },
    });
    expect(resolveReportPeriod('this_year', '2028-02-29', MON)).toMatchObject({
      range: { start: '2028-01-01', end: '2028-02-29' },
      previous: { start: '2027-01-01', end: '2027-02-28' },
    });
    expect(resolveReportPeriod('last_year', '2026-10-07', MON)).toMatchObject({
      range: { start: '2025-01-01', end: '2025-12-31' },
      previous: { start: '2024-01-01', end: '2024-12-31' },
    });
  });

  it('custom ranges can never be reversed and compare with an equal-length range before', () => {
    expect(normalizeRange('2026-10-20', '2026-10-01')).toEqual({
      start: '2026-10-01',
      end: '2026-10-20',
    });
    const p = resolveReportPeriod('custom', '2026-10-25', MON, {
      start: '2026-10-20',
      end: '2026-10-11',
    });
    expect(p.range).toEqual({ start: '2026-10-11', end: '2026-10-20' });
    expect(p.previous).toEqual({ start: '2026-10-01', end: '2026-10-10' });
    expect(rangeLengthDays(p.range)).toBe(10);
    expect(p.toDate).toBe(false);
    expect(resolveReportPeriod('custom', '2026-10-25', MON).range).toEqual({
      start: '2026-10-01',
      end: '2026-10-25',
    });
  });

  it('builds trailing month buckets across years and leap Februaries', () => {
    expect(trailingMonths('2028-03-15', 3)).toEqual([
      { month: '2028-01', start: '2028-01-01', end: '2028-01-31' },
      { month: '2028-02', start: '2028-02-01', end: '2028-02-29' },
      { month: '2028-03', start: '2028-03-01', end: '2028-03-31' },
    ]);
    expect(trailingMonths('2026-01-05', 2).map((b) => b.month)).toEqual(['2025-12', '2026-01']);
  });

  it('samples balances daily, weekly or monthly, always ending on the range end', () => {
    expect(balanceSampleDates({ start: '2026-10-01', end: '2026-10-03' })).toEqual([
      '2026-10-01',
      '2026-10-02',
      '2026-10-03',
    ]);
    const weekly = balanceSampleDates({ start: '2026-08-01', end: '2026-09-30' });
    expect(weekly[weekly.length - 1]).toBe('2026-09-30');
    expect(weekly[1]).toBe('2026-08-12');
    expect(balanceSampleDates({ start: '2026-01-10', end: '2026-06-15' })).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
      '2026-05-31',
      '2026-06-15',
    ]);
  });
});

const row = (patch: Partial<FlowRow>): FlowRow => ({
  localDate: '2026-10-05',
  type: 'expense',
  currency: 'USD',
  amountMinor: -1_000,
  baseMinor: -1_000,
  count: 1,
  ...patch,
});

describe('daily spending', () => {
  it('lists every day of the range with expenses minus refunds; income is ignored', () => {
    const result = dailySpending(
      [
        row({ localDate: '2026-10-02', baseMinor: -1_250 }),
        row({ localDate: '2026-10-02', type: 'refund', amountMinor: 250, baseMinor: 250 }),
        row({ localDate: '2026-10-03', type: 'income', amountMinor: 9_000, baseMinor: 9_000 }),
        row({ localDate: '2026-10-04', type: 'refund', amountMinor: 500, baseMinor: 500 }),
      ],
      '2026-10-01',
      '2026-10-04',
    );
    expect(result).toEqual({
      complete: true,
      days: [
        { date: '2026-10-01', spendingMinor: 0 },
        { date: '2026-10-02', spendingMinor: 1_000 },
        { date: '2026-10-03', spendingMinor: 0 },
        { date: '2026-10-04', spendingMinor: 0 }, // refunds alone never show as negative
      ],
    });
  });

  it('reports amounts left out for a missing rate', () => {
    const result = dailySpending(
      [row({ localDate: '2026-10-01', currency: 'EUR', baseMinor: null })],
      '2026-10-01',
      '2026-10-01',
    );
    expect(result).toEqual({ complete: false, days: [{ date: '2026-10-01', spendingMinor: 0 }] });
  });
});

describe('cash flow', () => {
  it('nets refunds against spending and computes the savings rate exactly', () => {
    const s = summarizeFlows(
      [
        row({ type: 'income', amountMinor: 300_000, baseMinor: 300_000 }),
        row({ amountMinor: -80_000, baseMinor: -80_000, count: 3 }),
        row({ type: 'refund', amountMinor: 10_000, baseMinor: 10_000 }),
      ],
      'USD',
    );
    expect(s).toMatchObject({
      incomeMinor: 300_000,
      spendingMinor: 70_000,
      refundsMinor: 10_000,
      netMinor: 230_000,
      transactionCount: 5,
      savingsRateBasisPoints: 7_666,
      complete: true,
    });
  });

  it('allows negative savings rates and refuses to divide by zero income', () => {
    expect(
      summarizeFlows(
        [
          row({ type: 'income', amountMinor: 1_000, baseMinor: 1_000 }),
          row({ amountMinor: -1_500, baseMinor: -1_500 }),
        ],
        'USD',
      ).savingsRateBasisPoints,
    ).toBe(-5_000);
    expect(summarizeFlows([row({})], 'USD').savingsRateBasisPoints).toBeNull();
    expect(summarizeFlows([], 'USD')).toMatchObject({
      incomeMinor: 0,
      spendingMinor: 0,
      savingsRateBasisPoints: null,
    });
  });

  it('never guesses a rate: unconvertible amounts are excluded, listed and mark the result incomplete', () => {
    const s = summarizeFlows(
      [
        row({ type: 'income', amountMinor: 100_000, baseMinor: 100_000 }),
        row({ currency: 'JPY', amountMinor: -5_000, baseMinor: null }),
        row({ type: 'income', currency: 'EUR', amountMinor: 2_000, baseMinor: null }),
      ],
      'USD',
    );
    expect(s).toMatchObject({
      incomeMinor: 100_000,
      spendingMinor: 0,
      complete: false,
      savingsRateBasisPoints: null,
      excludedIncome: [{ currency: 'EUR', amountMinor: 2_000 }],
      excludedSpending: [{ currency: 'JPY', amountMinor: 5_000 }],
    });
  });

  it('builds monthly trends distinguishing no activity from no data', () => {
    const buckets = trailingMonths('2026-10-15', 3);
    const trend = monthlyTrend(
      [
        row({ localDate: '2026-10-02', amountMinor: -500, baseMinor: -500 }),
        row({ localDate: '2026-09-30', type: 'income', amountMinor: 900, baseMinor: 900 }),
      ],
      buckets,
      '2026-09-15',
      'USD',
    );
    expect(
      trend.map((p) => [p.month, p.status, p.summary.incomeMinor, p.summary.spendingMinor]),
    ).toEqual([
      ['2026-08', 'unavailable', 0, 0],
      ['2026-09', 'ok', 900, 0],
      ['2026-10', 'ok', 0, 500],
    ]);
    expect(monthlyTrend([], buckets, null, 'USD').every((p) => p.status === 'unavailable')).toBe(
      true,
    );
  });
});

describe('category and merchant spending', () => {
  const parentOf = new Map<string, string | null>([
    ['food', null],
    ['groceries', 'food'],
    ['dining', 'food'],
    ['home', null],
  ]);

  it('rolls subcategories up, keeps the breakdown and nets refunds', () => {
    const r = categorySpending(
      [
        { categoryId: 'groceries', currency: 'USD', amountMinor: -6_000, baseMinor: -6_000 },
        { categoryId: 'dining', currency: 'USD', amountMinor: -3_000, baseMinor: -3_000 },
        { categoryId: 'food', currency: 'USD', amountMinor: -1_000, baseMinor: -1_000 },
        { categoryId: 'groceries', currency: 'USD', amountMinor: 1_000, baseMinor: 1_000 }, // refund
        { categoryId: 'home', currency: 'USD', amountMinor: -4_000, baseMinor: -4_000 },
        { categoryId: null, currency: 'USD', amountMinor: -1_000, baseMinor: -1_000 },
      ],
      parentOf,
    );
    expect(r.totalMinor).toBe(14_000);
    expect(r.items.map((i) => [i.categoryId, i.spendingMinor, i.shareBasisPoints])).toEqual([
      ['food', 9_000, 6_429],
      ['home', 4_000, 2_857],
      [null, 1_000, 714],
    ]);
    expect(r.items[0]!.children.map((c) => [c.categoryId, c.spendingMinor])).toEqual([
      ['groceries', 5_000],
      ['dining', 3_000],
      ['food', 1_000],
    ]);
    expect(r.items[1]!.children).toEqual([]);
    expect(r.complete).toBe(true);
  });

  it('shows no share when the total is not positive and reports exclusions', () => {
    const r = categorySpending(
      [
        { categoryId: 'home', currency: 'USD', amountMinor: 2_000, baseMinor: 2_000 },
        { categoryId: 'home', currency: 'GBP', amountMinor: -700, baseMinor: null },
      ],
      parentOf,
    );
    expect(r.items).toEqual([
      { categoryId: 'home', spendingMinor: -2_000, shareBasisPoints: null, children: [] },
    ]);
    expect(r).toMatchObject({ complete: false, excluded: [{ currency: 'GBP', amountMinor: 700 }] });
  });

  it('groups merchants by normalised key with transaction counts', () => {
    const r = merchantSpending([
      { merchantKey: 'walmart', currency: 'USD', amountMinor: -5_000, baseMinor: -5_000, count: 2 },
      { merchantKey: 'walmart', currency: 'USD', amountMinor: 1_000, baseMinor: 1_000, count: 1 },
      { merchantKey: null, currency: 'USD', amountMinor: -2_000, baseMinor: -2_000, count: 1 },
      { merchantKey: 'cafe', currency: 'EUR', amountMinor: -900, baseMinor: null, count: 1 },
    ]);
    expect(r.items).toEqual([
      {
        merchantKey: 'walmart',
        spendingMinor: 4_000,
        transactionCount: 3,
        shareBasisPoints: 6_667,
      },
      { merchantKey: null, spendingMinor: 2_000, transactionCount: 1, shareBasisPoints: 3_333 },
    ]);
    expect(r).toMatchObject({
      totalMinor: 6_000,
      complete: false,
      excluded: [{ currency: 'EUR', amountMinor: 900 }],
    });
  });

  it('lists several excluded currencies in order and ignores zero amounts', () => {
    const r = merchantSpending([
      { merchantKey: 'a', currency: 'JPY', amountMinor: -100, baseMinor: null, count: 1 },
      { merchantKey: 'b', currency: 'EUR', amountMinor: -200, baseMinor: null, count: 1 },
      { merchantKey: 'c', currency: 'GBP', amountMinor: 0, baseMinor: null, count: 1 },
    ]);
    expect(r.excluded).toEqual([
      { currency: 'EUR', amountMinor: 200 },
      { currency: 'JPY', amountMinor: 100 },
    ]);
    expect(normalizeRange('2026-10-01', '2026-10-01')).toEqual({
      start: '2026-10-01',
      end: '2026-10-01',
    });
  });

  it('computes shares safely', () => {
    expect(shareBasisPoints(1, 3)).toBe(3_333);
    expect(shareBasisPoints(5, 0)).toBeNull();
    expect(shareBasisPoints(-1, 10)).toBeNull();
  });
});

describe('period comparison', () => {
  it('reports change only when both periods are complete and the base is non-zero', () => {
    expect(compareAmounts(12_000, 10_000, true)).toEqual({
      deltaMinor: 2_000,
      changeBasisPoints: 2_000,
    });
    expect(compareAmounts(-500, -1_000, true)).toEqual({
      deltaMinor: 500,
      changeBasisPoints: 5_000,
    });
    expect(compareAmounts(5_000, 0, true)).toEqual({ deltaMinor: 5_000, changeBasisPoints: null });
    expect(compareAmounts(5_000, 4_000, false)).toBeNull();
  });
});

describe('balance history', () => {
  it('derives end-of-day balances from the opening balance and postings', () => {
    const s = balanceSeries(
      {
        openingMinor: 100_000,
        openingDate: '2026-09-01',
        priorDeltaMinor: -20_000,
        daily: [
          { localDate: '2026-10-03', deltaMinor: 5_000 },
          { localDate: '2026-10-01', deltaMinor: -1_000 },
        ],
      },
      { start: '2026-10-01', end: '2026-10-03' },
      ['2026-10-01', '2026-10-02', '2026-10-03'],
    );
    expect(s.points.map((p) => p.balanceMinor)).toEqual([79_000, 79_000, 84_000]);
    expect(s).toMatchObject({
      startMinor: 80_000,
      endMinor: 84_000,
      changeMinor: 4_000,
      lowMinor: 79_000,
      highMinor: 84_000,
    });
  });

  it('has no balance before the opening-balance date (nothing is invented)', () => {
    const s = balanceSeries(
      { openingMinor: 5_000, openingDate: '2026-10-02', priorDeltaMinor: 0, daily: [] },
      { start: '2026-10-01', end: '2026-10-03' },
      ['2026-10-01', '2026-10-02', '2026-10-03'],
    );
    expect(s.points.map((p) => p.balanceMinor)).toEqual([null, 5_000, 5_000]);
    expect(s).toMatchObject({
      startMinor: null,
      endMinor: 5_000,
      changeMinor: null,
      lowMinor: 5_000,
    });
    const none = balanceSeries(
      { openingMinor: 5_000, openingDate: '2026-11-01', priorDeltaMinor: 0, daily: [] },
      { start: '2026-10-01', end: '2026-10-03' },
      ['2026-10-03'],
    );
    expect(none).toMatchObject({ endMinor: null, lowMinor: null, highMinor: null });
  });
});

describe('budget vs actual uses the budget engine periods', () => {
  it('lists overlapping periods whole and labels partial overlap (no proration)', () => {
    const { periods } = evaluateBudget({
      periodType: 'monthly',
      startDate: '2026-08-01',
      endDate: null,
      revisions: [
        {
          id: 'r',
          effectiveFrom: '2026-08-01',
          amountMinor: 50_000,
          rolloverEnabled: false,
          createdAt: 'x',
        },
      ],
      spending: [{ localDate: '2026-09-10', spentMinor: 20_000 }],
      today: '2026-10-11',
      settings: { firstDayOfWeek: 1, monthStartDay: 1 },
    });
    const inSep = budgetPeriodsInRange(periods, { start: '2026-09-01', end: '2026-09-30' });
    expect(inSep).toEqual([
      {
        period: expect.objectContaining({ start: '2026-09-01', spentMinor: 20_000 }),
        coverage: 'inside',
      },
    ]);
    const thisWeek = budgetPeriodsInRange(periods, { start: '2026-10-05', end: '2026-10-11' });
    expect(thisWeek.map((p) => [p.period.start, p.coverage])).toEqual([['2026-10-01', 'partial']]);
    expect(budgetPeriodsInRange(periods, { start: '2026-07-01', end: '2026-07-31' })).toEqual([]);
  });
});
