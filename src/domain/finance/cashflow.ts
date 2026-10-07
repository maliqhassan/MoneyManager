import type { CurrencyCode } from '../currency/currencies';
import type { TransactionType } from '../enums';
import { add, type Money, money, negate, subtract, zero } from '../money/money';

export interface CashFlowPosting {
  type: TransactionType;
  /** Signed amount in the reporting (base) currency. */
  amountMinor: number;
  currency: CurrencyCode;
  deletedAt: string | null;
}

export interface CashFlowSummary {
  /** Total income (positive). */
  income: Money;
  /** Total spending net of refunds (positive = money spent). */
  expenses: Money;
  /** income - expenses. */
  net: Money;
}

/**
 * Income vs. expenses for a set of postings already expressed in one
 * reporting currency. Rules:
 * - transfers move money between the user's own accounts and are excluded;
 * - refunds reduce expenses (they are not income);
 * - deleted postings are excluded.
 */
export function summarizeCashFlow(
  postings: readonly CashFlowPosting[],
  currency: CurrencyCode,
): CashFlowSummary {
  let income = zero(currency);
  let spent = zero(currency);

  for (const p of postings) {
    if (p.deletedAt) continue;
    const amount = money(p.amountMinor, p.currency);
    switch (p.type) {
      case 'income':
        income = add(income, amount);
        break;
      case 'expense':
        spent = add(spent, negate(amount));
        break;
      case 'refund':
        spent = subtract(spent, amount);
        break;
      case 'transfer':
        break;
    }
  }

  return { income, expenses: spent, net: subtract(income, spent) };
}

/**
 * Savings rate in basis points (1% = 100): net / income. Returns null when
 * there is no income (the rate is undefined, not zero).
 */
export function savingsRateBasisPoints(summary: CashFlowSummary): number | null {
  if (summary.income.amountMinor <= 0) return null;
  const bp = (BigInt(summary.net.amountMinor) * 10_000n) / BigInt(summary.income.amountMinor);
  return Number(bp);
}
