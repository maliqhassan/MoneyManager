import { compareDates, type CalendarDate, isWithin } from '../dates/calendar';
import type { CurrencyCode } from '../currency/currencies';
import type { BudgetPeriodResult } from '../planning/budgets';
import { savingsRateBasisPoints } from '../finance/cashflow';
import { divideAndRound } from '../money/decimal';
import { money } from '../money/money';
import type { DateRange, MonthBucket } from './periods';

/**
 * Report aggregation. Pure, exact (integer minor units; BigInt for ratios),
 * independent of any chart component.
 *
 * ACCOUNTING CONVENTIONS — identical in every report:
 * - Income: `income` entries.
 * - Spending: expenses MINUS refunds (a refund reduces the spending of its
 *   own category / merchant; it is never income).
 * - Transfers (including credit-card payments and goal transfers) are never
 *   income or spending. Goal contributions are planning records, not entries.
 * - Split transactions: category reports use the split lines; totals and
 *   merchant reports use the parent once. Nothing is counted twice.
 * - Amounts are reported in the user's base currency: the base snapshot
 *   recorded with each entry, or a KNOWN rate on the entry date. When no
 *   rate is known the amount is left out, listed in `excluded` in its own
 *   currency, and the result is marked incomplete — never guessed.
 *
 * Input amounts are signed from the account's point of view (expenses < 0,
 * income and refunds > 0), exactly as stored.
 */

export type FlowType = 'income' | 'expense' | 'refund';

export interface ReportAmount {
  currency: CurrencyCode;
  /** Signed, in `currency`. */
  amountMinor: number;
  /** Signed, in the base currency; null when no rate is known. */
  baseMinor: number | null;
}

export interface Excluded {
  currency: CurrencyCode;
  /** Absolute amount left out, in its own currency. */
  amountMinor: number;
}

function addExcluded(map: Map<CurrencyCode, number>, currency: CurrencyCode, amountMinor: number) {
  map.set(currency, (map.get(currency) ?? 0) + Math.abs(amountMinor));
}

function excludedList(map: Map<CurrencyCode, number>): Excluded[] {
  return [...map.entries()]
    .map(([currency, amountMinor]) => ({ currency, amountMinor }))
    .filter((e) => e.amountMinor !== 0)
    .sort((a, b) => a.currency.localeCompare(b.currency));
}

/** Part of `whole` in basis points (10 000 = 100%); null when not meaningful. */
export function shareBasisPoints(part: number, whole: number): number | null {
  if (whole <= 0 || part < 0) return null;
  return Number(divideAndRound(BigInt(part) * 10_000n, BigInt(whole), 'half-away-from-zero'));
}

// ------------------------------------------------------------ cash flow ----

export interface FlowRow extends ReportAmount {
  localDate: CalendarDate;
  type: FlowType;
  count: number;
}

export interface FlowSummary {
  incomeMinor: number;
  /** Expenses minus refunds (may be negative if refunds exceed expenses). */
  spendingMinor: number;
  /** Refunds received (positive), already deducted from spending. */
  refundsMinor: number;
  netMinor: number;
  transactionCount: number;
  /** (income − spending) ÷ income; null when income ≤ 0 or totals are incomplete. */
  savingsRateBasisPoints: number | null;
  complete: boolean;
  excludedIncome: Excluded[];
  excludedSpending: Excluded[];
}

export function summarizeFlows(rows: readonly FlowRow[], base: CurrencyCode): FlowSummary {
  let incomeMinor = 0;
  let spendingMinor = 0;
  let refundsMinor = 0;
  let transactionCount = 0;
  const excludedIncome = new Map<CurrencyCode, number>();
  const excludedSpending = new Map<CurrencyCode, number>();
  for (const r of rows) {
    transactionCount += r.count;
    if (r.baseMinor === null) {
      if (r.type === 'income') addExcluded(excludedIncome, r.currency, r.amountMinor);
      else addExcluded(excludedSpending, r.currency, r.amountMinor);
      continue;
    }
    if (r.type === 'income') incomeMinor += r.baseMinor;
    else {
      spendingMinor -= r.baseMinor; // expense −500 → +500; refund +200 → −200
      if (r.type === 'refund') refundsMinor += r.baseMinor;
    }
  }
  const complete = excludedIncome.size === 0 && excludedSpending.size === 0;
  const netMinor = incomeMinor - spendingMinor;
  return {
    incomeMinor,
    spendingMinor,
    refundsMinor,
    netMinor,
    transactionCount,
    savingsRateBasisPoints: complete
      ? savingsRateBasisPoints({
          income: money(incomeMinor, base),
          expenses: money(spendingMinor, base),
          net: money(netMinor, base),
        })
      : null,
    complete,
    excludedIncome: excludedList(excludedIncome),
    excludedSpending: excludedList(excludedSpending),
  };
}

export interface TrendPoint extends MonthBucket {
  /** 'unavailable' = before the first recorded data (not the same as zero activity). */
  status: 'ok' | 'unavailable';
  summary: FlowSummary;
}

/** Monthly income / spending / net. Months before `dataStart` are unavailable. */
export function monthlyTrend(
  rows: readonly FlowRow[],
  buckets: readonly MonthBucket[],
  dataStart: CalendarDate | null,
  base: CurrencyCode,
): TrendPoint[] {
  return buckets.map((bucket) => {
    const inBucket = rows.filter((r) => isWithin(r.localDate, bucket.start, bucket.end));
    const unavailable = dataStart === null || compareDates(bucket.end, dataStart) < 0;
    return {
      ...bucket,
      status: unavailable ? 'unavailable' : 'ok',
      summary: summarizeFlows(inBucket, base),
    };
  });
}

// ------------------------------------------------------------- category ----

export interface CategorySpendRow extends ReportAmount {
  /** The split line's category, or the entry's; null = uncategorised. */
  categoryId: string | null;
}

export interface CategoryChild {
  /** Equal to the parent id for spending recorded on the parent itself. */
  categoryId: string;
  spendingMinor: number;
  shareBasisPoints: number | null;
}

export interface CategoryTotal {
  /** Top-level category; null = uncategorised. */
  categoryId: string | null;
  spendingMinor: number;
  shareBasisPoints: number | null;
  /** Subcategory breakdown (empty when only the category itself was used). */
  children: CategoryChild[];
}

export interface CategoryReport {
  totalMinor: number;
  items: CategoryTotal[];
  complete: boolean;
  excluded: Excluded[];
}

/**
 * Spending per top-level category with subcategory breakdown. Shares are of
 * total spending and only shown when both are positive (no misleading
 * percentages on a zero or negative total).
 */
export function categorySpending(
  rows: readonly CategorySpendRow[],
  parentOf: ReadonlyMap<string, string | null>,
): CategoryReport {
  const byLeaf = new Map<string | null, number>();
  const excluded = new Map<CurrencyCode, number>();
  for (const r of rows) {
    if (r.baseMinor === null) {
      addExcluded(excluded, r.currency, r.amountMinor);
      continue;
    }
    byLeaf.set(r.categoryId, (byLeaf.get(r.categoryId) ?? 0) - r.baseMinor);
  }
  const top = new Map<string | null, { total: number; children: Map<string, number> }>();
  for (const [leaf, spent] of byLeaf) {
    const parent = leaf ? (parentOf.get(leaf) ?? null) : null;
    const key = leaf ? (parent ?? leaf) : null;
    const entry = top.get(key) ?? { total: 0, children: new Map<string, number>() };
    entry.total += spent;
    if (leaf) entry.children.set(leaf, (entry.children.get(leaf) ?? 0) + spent);
    top.set(key, entry);
  }
  const totalMinor = [...top.values()].reduce((s, e) => s + e.total, 0);
  const items: CategoryTotal[] = [...top.entries()]
    .filter(([, e]) => e.total !== 0)
    .map(([categoryId, e]) => {
      const hasSubcategories = [...e.children.keys()].some((id) => id !== categoryId);
      return {
        categoryId,
        spendingMinor: e.total,
        shareBasisPoints: shareBasisPoints(e.total, totalMinor),
        children: hasSubcategories
          ? [...e.children.entries()]
              .filter(([, v]) => v !== 0)
              .map(([id, v]) => ({
                categoryId: id,
                spendingMinor: v,
                shareBasisPoints: shareBasisPoints(v, totalMinor),
              }))
              .sort((a, b) => b.spendingMinor - a.spendingMinor)
          : [],
      };
    })
    .sort((a, b) => b.spendingMinor - a.spendingMinor);
  return { totalMinor, items, complete: excluded.size === 0, excluded: excludedList(excluded) };
}

// ------------------------------------------------------------- merchant ----

export interface MerchantSpendRow extends ReportAmount {
  /** Normalised merchant key; null = no merchant recorded. */
  merchantKey: string | null;
  count: number;
}

export interface MerchantTotal {
  merchantKey: string | null;
  spendingMinor: number;
  transactionCount: number;
  shareBasisPoints: number | null;
}

export interface MerchantReport {
  totalMinor: number;
  items: MerchantTotal[];
  complete: boolean;
  excluded: Excluded[];
}

/** Spending per normalised merchant (existing normalisation; no fuzzy merging). */
export function merchantSpending(rows: readonly MerchantSpendRow[]): MerchantReport {
  const totals = new Map<string | null, { spent: number; count: number }>();
  const excluded = new Map<CurrencyCode, number>();
  for (const r of rows) {
    const entry = totals.get(r.merchantKey) ?? { spent: 0, count: 0 };
    entry.count += r.count;
    if (r.baseMinor === null) addExcluded(excluded, r.currency, r.amountMinor);
    else entry.spent -= r.baseMinor;
    totals.set(r.merchantKey, entry);
  }
  const totalMinor = [...totals.values()].reduce((s, e) => s + e.spent, 0);
  const items = [...totals.entries()]
    .map(([merchantKey, e]) => ({
      merchantKey,
      spendingMinor: e.spent,
      transactionCount: e.count,
      shareBasisPoints: shareBasisPoints(e.spent, totalMinor),
    }))
    .filter((m) => m.spendingMinor !== 0)
    .sort((a, b) => b.spendingMinor - a.spendingMinor);
  return { totalMinor, items, complete: excluded.size === 0, excluded: excludedList(excluded) };
}

// ----------------------------------------------------------- comparison ----

export interface Change {
  deltaMinor: number;
  /** Relative change in basis points; null when the previous value is zero. */
  changeBasisPoints: number | null;
}

/**
 * Change from `previous` to `current`, or null when the two are not
 * comparable (either side incomplete because of a missing exchange rate).
 */
export function compareAmounts(
  current: number,
  previous: number,
  comparable: boolean,
): Change | null {
  if (!comparable) return null;
  const deltaMinor = current - previous;
  const changeBasisPoints =
    previous === 0
      ? null
      : Number(
          divideAndRound(
            BigInt(deltaMinor) * 10_000n,
            BigInt(Math.abs(previous)),
            'half-away-from-zero',
          ),
        );
  return { deltaMinor, changeBasisPoints };
}

// -------------------------------------------------------------- balances ----

export interface BalanceInput {
  openingMinor: number;
  openingDate: CalendarDate;
  /** Sum of the account's postings dated before the range start. */
  priorDeltaMinor: number;
  /** Net postings per day within the range (any order). */
  daily: readonly { localDate: CalendarDate; deltaMinor: number }[];
}

export interface BalancePoint {
  date: CalendarDate;
  /** End-of-day balance; null before the account's opening-balance date. */
  balanceMinor: number | null;
}

export interface BalanceSeries {
  points: BalancePoint[];
  startMinor: number | null;
  endMinor: number | null;
  changeMinor: number | null;
  lowMinor: number | null;
  highMinor: number | null;
}

/**
 * End-of-day balances at the sample dates, derived from the opening balance
 * and the recorded postings — the same ledger the current balance comes from
 * (no estimates). Dates before the opening-balance date have no balance.
 */
export function balanceSeries(
  input: BalanceInput,
  range: DateRange,
  sampleDates: readonly CalendarDate[],
): BalanceSeries {
  const daily = [...input.daily].sort((a, b) => compareDates(a.localDate, b.localDate));
  const at = (date: CalendarDate): number | null => {
    if (compareDates(date, input.openingDate) < 0) return null;
    let balance = input.openingMinor + input.priorDeltaMinor;
    for (const d of daily) {
      if (compareDates(d.localDate, date) > 0) break;
      balance += d.deltaMinor;
    }
    return balance;
  };
  const points = sampleDates.map((date) => ({ date, balanceMinor: at(date) }));
  const known = points.map((p) => p.balanceMinor).filter((v): v is number => v !== null);
  // The opening balance is the balance at the START of its date, so the
  // balance at the start of the range is known from the opening date on.
  const startMinor =
    compareDates(range.start, input.openingDate) < 0
      ? null
      : input.openingMinor + input.priorDeltaMinor;
  const endMinor = at(range.end);
  return {
    points,
    startMinor,
    endMinor,
    changeMinor: startMinor !== null && endMinor !== null ? endMinor - startMinor : null,
    lowMinor: known.length ? Math.min(...known) : null,
    highMinor: known.length ? Math.max(...known) : null,
  };
}

// --------------------------------------------------------------- budgets ----

export interface BudgetPeriodInRange {
  period: BudgetPeriodResult;
  /** 'inside' = the budget period lies within the report range; 'partial' = it only overlaps. */
  coverage: 'inside' | 'partial';
}

/**
 * Budget periods (as evaluated by the budget engine) overlapping a report
 * range. Budget amounts are never prorated: a period that only overlaps is
 * shown whole and labelled as such.
 */
export function budgetPeriodsInRange(
  periods: readonly BudgetPeriodResult[],
  range: DateRange,
): BudgetPeriodInRange[] {
  return periods
    .filter((p) => compareDates(p.end, range.start) >= 0 && compareDates(p.start, range.end) <= 0)
    .map((period) => ({
      period,
      coverage:
        compareDates(period.start, range.start) >= 0 && compareDates(period.end, range.end) <= 0
          ? 'inside'
          : 'partial',
    }));
}
