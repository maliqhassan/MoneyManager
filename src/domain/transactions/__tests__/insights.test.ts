import { cashFlowInBase, topSpendingCategories } from '../insights';

const rate = (c: string) => (c === 'EUR' ? '1.1' : null);

describe('cashFlowInBase', () => {
  it('nets refunds, excludes transfers, and converts known currencies', () => {
    const { summary, missingRates } = cashFlowInBase(
      [
        { type: 'income', currency: 'USD', totalMinor: 500_000 },
        { type: 'expense', currency: 'USD', totalMinor: -120_000 },
        { type: 'refund', currency: 'USD', totalMinor: 20_000 },
        { type: 'transfer', currency: 'USD', totalMinor: -99_999 },
        { type: 'expense', currency: 'EUR', totalMinor: -10_000 },
      ],
      'USD',
      rate,
    );
    expect(missingRates).toEqual([]);
    expect(summary?.income.amountMinor).toBe(500_000);
    expect(summary?.expenses.amountMinor).toBe(100_000 + 11_000);
    expect(summary?.net.amountMinor).toBe(500_000 - 111_000);
  });

  it('refuses a partial total when a rate is missing', () => {
    expect(
      cashFlowInBase([{ type: 'expense', currency: 'JPY', totalMinor: -1_000 }], 'USD', rate),
    ).toEqual({ summary: null, missingRates: ['JPY'] });
  });

  it('is zero with no rows', () => {
    expect(cashFlowInBase([], 'GBP', rate).summary?.net).toEqual({
      amountMinor: 0,
      currency: 'GBP',
    });
  });
});

describe('topSpendingCategories', () => {
  const parentOf = new Map<string, string | null>([
    ['groceries', 'food'],
    ['restaurants', 'food'],
    ['food', null],
    ['rent', 'housing'],
  ]);

  it('rolls subcategories up, nets refunds, sorts and limits', () => {
    const { items } = topSpendingCategories(
      [
        { categoryId: 'groceries', currency: 'USD', totalMinor: -30_000 },
        { categoryId: 'restaurants', currency: 'USD', totalMinor: -10_000 },
        { categoryId: 'groceries', currency: 'USD', totalMinor: 5_000 }, // refund
        { categoryId: 'rent', currency: 'USD', totalMinor: -120_000 },
        { categoryId: null, currency: 'USD', totalMinor: -700 },
        { categoryId: 'gifts', currency: 'USD', totalMinor: 2_000 }, // net refund only → omitted
      ],
      parentOf,
      'USD',
      rate,
      2,
    );
    expect(items).toEqual([
      { categoryId: 'housing', spent: { amountMinor: 120_000, currency: 'USD' } },
      { categoryId: 'food', spent: { amountMinor: 35_000, currency: 'USD' } },
    ]);
  });

  it('converts or reports foreign rows', () => {
    const r = topSpendingCategories(
      [
        { categoryId: 'food', currency: 'EUR', totalMinor: -1_000 },
        { categoryId: 'food', currency: 'JPY', totalMinor: -500 },
      ],
      parentOf,
      'USD',
      rate,
      5,
    );
    expect(r.items).toEqual([
      { categoryId: 'food', spent: { amountMinor: 1_100, currency: 'USD' } },
    ]);
    expect(r.missingRates).toEqual(['JPY']);
  });
});
