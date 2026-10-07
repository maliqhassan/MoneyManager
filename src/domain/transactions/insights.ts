import type { CurrencyCode } from '../currency/currencies';
import type { TransactionType } from '../enums';
import { type CashFlowSummary, summarizeCashFlow } from '../finance/cashflow';
import { convert } from '../money/conversion';
import type { DecimalString } from '../money/decimal';
import { add, type Money, money, subtract, zero } from '../money/money';

type GetRate = (from: CurrencyCode) => DecimalString | null;

/**
 * Income / expenses / net for a period in the user's base currency.
 * Rows are grouped per stored base-currency snapshot; snapshots in another
 * currency (made before a base-currency change, or with no rate at entry) are
 * converted with a known rate or reported in `missingRates`. The summary is
 * null when anything is missing — a partial total would be misleading.
 */
export function cashFlowInBase(
  rows: readonly { type: TransactionType; currency: CurrencyCode; totalMinor: number }[],
  base: CurrencyCode,
  getRate: GetRate,
): { summary: CashFlowSummary | null; missingRates: CurrencyCode[] } {
  const byCurrency = new Map<CurrencyCode, typeof rows>();
  for (const row of rows)
    byCurrency.set(row.currency, [...(byCurrency.get(row.currency) ?? []), row]);

  let income = zero(base);
  let expenses = zero(base);
  const missing = new Set<CurrencyCode>();
  for (const [currency, group] of byCurrency) {
    const s = summarizeCashFlow(
      group.map((r) => ({ type: r.type, amountMinor: r.totalMinor, currency, deletedAt: null })),
      currency,
    );
    if (currency === base) {
      income = add(income, s.income);
      expenses = add(expenses, s.expenses);
      continue;
    }
    const rate = getRate(currency);
    if (rate === null) {
      missing.add(currency);
      continue;
    }
    income = add(income, convert(s.income, rate, base));
    expenses = add(expenses, convert(s.expenses, rate, base));
  }
  if (missing.size > 0) return { summary: null, missingRates: [...missing].sort() };
  return { summary: { income, expenses, net: subtract(income, expenses) }, missingRates: [] };
}

export interface CategorySpend {
  /** Top-level category id (subcategories roll up); null = uncategorised. */
  categoryId: string | null;
  spent: Money;
}

/**
 * Net spending (expenses minus refunds) per top-level category, largest
 * first, in the base currency. Categories with no net spending are omitted.
 */
export function topSpendingCategories(
  rows: readonly { categoryId: string | null; currency: CurrencyCode; totalMinor: number }[],
  parentOf: ReadonlyMap<string, string | null>,
  base: CurrencyCode,
  getRate: GetRate,
  limit: number,
): { items: CategorySpend[]; missingRates: CurrencyCode[] } {
  const totals = new Map<string | null, Money>();
  const missing = new Set<CurrencyCode>();
  for (const row of rows) {
    let spent = money(-row.totalMinor, row.currency);
    if (row.currency !== base) {
      const rate = getRate(row.currency);
      if (rate === null) {
        missing.add(row.currency);
        continue;
      }
      spent = convert(spent, rate, base);
    }
    const key = row.categoryId ? (parentOf.get(row.categoryId) ?? row.categoryId) : null;
    totals.set(key, add(totals.get(key) ?? zero(base), spent));
  }
  const items = [...totals.entries()]
    .map(([categoryId, spent]) => ({ categoryId, spent }))
    .filter((i) => i.spent.amountMinor > 0)
    .sort((a, b) => b.spent.amountMinor - a.spent.amountMinor)
    .slice(0, limit);
  return { items, missingRates: [...missing].sort() };
}
