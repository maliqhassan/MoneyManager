import { CurrencyMismatchError } from '../../money/money';
import { computeAccountBalance, totalInBaseCurrency } from '../balance';
import { savingsRateBasisPoints, summarizeCashFlow, type CashFlowPosting } from '../cashflow';

const p = (amountMinor: number, deletedAt: string | null = null) => ({
  amountMinor,
  currency: 'USD' as const,
  deletedAt,
});

describe('computeAccountBalance', () => {
  const account = { currency: 'USD' as const, openingBalanceMinor: 100_000 };

  it('starts from the opening balance', () => {
    expect(computeAccountBalance(account, []).amountMinor).toBe(100_000);
  });

  it('applies expenses, income, refunds and transfer legs as signed postings', () => {
    const postings = [
      p(-4_599), // expense
      p(250_000), // income
      p(1_500), // refund
      p(-20_000), // transfer out
      p(5_000), // transfer in
    ];
    expect(computeAccountBalance(account, postings).amountMinor).toBe(331_901);
  });

  it('ignores deleted postings', () => {
    expect(
      computeAccountBalance(account, [p(-500), p(-999, '2026-10-01T00:00:00Z')]).amountMinor,
    ).toBe(99_500);
  });

  it('supports credit card balances going negative', () => {
    const card = { currency: 'USD' as const, openingBalanceMinor: 0 };
    expect(computeAccountBalance(card, [p(-12_000), p(5_000)]).amountMinor).toBe(-7_000);
  });

  it('rejects postings in a different currency', () => {
    expect(() =>
      computeAccountBalance(account, [{ amountMinor: 1, currency: 'EUR', deletedAt: null }]),
    ).toThrow(CurrencyMismatchError);
  });
});

describe('totalInBaseCurrency', () => {
  it('converts foreign balances and reports missing rates', () => {
    const result = totalInBaseCurrency(
      [
        { amountMinor: 10_000, currency: 'USD' },
        { amountMinor: 10_000, currency: 'EUR' },
        { amountMinor: 5_000, currency: 'GBP' },
        { amountMinor: 1_000, currency: 'JPY' },
      ],
      'USD',
      (c) => ({ EUR: '1.08', GBP: '1.27' })[c as 'EUR' | 'GBP'] ?? null,
    );
    expect(result.total).toEqual({ amountMinor: 10_000 + 10_800 + 6_350, currency: 'USD' });
    expect(result.missingRates).toEqual(['JPY']);
  });
});

describe('summarizeCashFlow', () => {
  const post = (
    type: CashFlowPosting['type'],
    amountMinor: number,
    deletedAt: string | null = null,
  ): CashFlowPosting => ({ type, amountMinor, currency: 'USD', deletedAt });

  it('nets refunds against expenses and excludes transfers', () => {
    const summary = summarizeCashFlow(
      [
        post('income', 500_000),
        post('expense', -120_000),
        post('expense', -30_000),
        post('refund', 10_000),
        post('transfer', -50_000),
        post('transfer', 50_000),
        post('expense', -99_999, '2026-10-01T00:00:00Z'),
      ],
      'USD',
    );
    expect(summary.income.amountMinor).toBe(500_000);
    expect(summary.expenses.amountMinor).toBe(140_000);
    expect(summary.net.amountMinor).toBe(360_000);
    expect(savingsRateBasisPoints(summary)).toBe(7_200);
  });

  it('has an undefined savings rate without income', () => {
    const summary = summarizeCashFlow([post('expense', -100)], 'USD');
    expect(summary.net.amountMinor).toBe(-100);
    expect(savingsRateBasisPoints(summary)).toBeNull();
  });

  it('allows negative savings rates', () => {
    const summary = summarizeCashFlow([post('income', 1_000), post('expense', -1_500)], 'USD');
    expect(savingsRateBasisPoints(summary)).toBe(-5_000);
  });
});
