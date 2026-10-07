import type { CurrencyCode } from '../currency/currencies';
import { getMinorUnits } from '../currency/currencies';
import { addDays, type CalendarDate, compareDates } from '../dates/calendar';
import type { CategoryKind, TransactionType } from '../enums';
import { parseDecimal, pow10 } from '../money/decimal';
import { allocate, type Money } from '../money/money';

/**
 * Transaction rules shared by repositories and UI. Amounts here are integer
 * minor units; the UI always enters a positive magnitude and the domain
 * applies the sign:
 *
 *   expense  → negative (money leaves the account)
 *   income   → positive
 *   refund   → positive (reduces spending; never counted as income)
 *   transfer → two legs: −from, +to (never income or expense)
 */

export type EntryType = Exclude<TransactionType, 'transfer'>;

export function signedAmount(type: EntryType, magnitudeMinor: number): number {
  if (!Number.isSafeInteger(magnitudeMinor) || magnitudeMinor <= 0) {
    throw new RangeError('Transaction amount must be a positive whole number of minor units');
  }
  return type === 'expense' ? -magnitudeMinor : magnitudeMinor;
}

/** Category kind a transaction type must use (null = no category). */
export function categoryKindFor(type: TransactionType): CategoryKind | null {
  switch (type) {
    case 'expense':
    case 'refund':
      return 'expense';
    case 'income':
      return 'income';
    case 'transfer':
      return null;
  }
}

/** Only expenses and income can be split across categories. */
export function canSplit(type: TransactionType): boolean {
  return type === 'expense' || type === 'income';
}

/**
 * Base-currency amounts for each split, allocated from the parent's base
 * amount in proportion to the split amounts, so split base amounts always sum
 * exactly to the parent's base amount (no rounding drift).
 */
export function allocateBaseAmounts(
  parentBase: Money,
  splitAmountsMinor: readonly number[],
): number[] {
  const ratios = splitAmountsMinor.map((a) => Math.abs(a));
  if (ratios.every((r) => r === 0)) return splitAmountsMinor.map(() => 0);
  return allocate(parentBase, ratios).map((m) => m.amountMinor);
}

/** Remaining amount to allocate in a split editor (positive magnitudes). */
export function splitRemaining(totalMinor: number, splitMinors: readonly number[]): number {
  return totalMinor - splitMinors.reduce((acc, a) => acc + a, 0);
}

// ---------------------------------------------------------------------------
// Date grouping
// ---------------------------------------------------------------------------

export type DayLabel =
  { kind: 'today' } | { kind: 'yesterday' } | { kind: 'date'; date: CalendarDate };

/** Label for a transaction's local date relative to the user's "today". */
export function dayLabel(localDate: CalendarDate, today: CalendarDate): DayLabel {
  if (compareDates(localDate, today) === 0) return { kind: 'today' };
  if (compareDates(localDate, addDays(today, -1)) === 0) return { kind: 'yesterday' };
  return { kind: 'date', date: localDate };
}

/**
 * Groups rows (already ordered newest first) into sections by their stored
 * local date — the calendar day in the user's time zone at entry — so a
 * transaction never jumps to another day because of UTC.
 */
export function groupByLocalDate<T extends { localDate: CalendarDate }>(
  rows: readonly T[],
): { localDate: CalendarDate; items: T[] }[] {
  const sections: { localDate: CalendarDate; items: T[] }[] = [];
  for (const row of rows) {
    const last = sections[sections.length - 1];
    if (last && last.localDate === row.localDate) last.items.push(row);
    else sections.push({ localDate: row.localDate, items: [row] });
  }
  return sections;
}

// ---------------------------------------------------------------------------
// Amount range filter (exact, across currencies with different exponents)
// ---------------------------------------------------------------------------

export interface AmountBounds {
  /** Minor-unit bounds per currency exponent (0, 2, 3). Inclusive; null = open. */
  byExponent: Record<0 | 2 | 3, { min: number | null; max: number | null }>;
}

function toMinorBound(decimal: string, exponent: number, mode: 'min' | 'max'): number {
  const { coefficient, scale } = parseDecimal(decimal);
  // value × 10^exponent, as an exact rational coefficient / 10^scale
  const numerator = coefficient * pow10(exponent);
  const denominator = pow10(scale);
  const quotient = numerator / denominator;
  const exact = quotient * denominator === numerator;
  // min rounds up (ceil), max rounds down (floor) so bounds stay inclusive and exact.
  const bound = mode === 'min' && !exact ? quotient + 1n : quotient;
  return Number(bound);
}

/**
 * Converts a major-unit amount range ("10", "12.5") into exact minor-unit
 * bounds for each currency exponent, so one filter works for USD, JPY and KWD.
 */
export function amountRangeBounds(min: string | null, max: string | null): AmountBounds {
  const make = (exponent: 0 | 2 | 3) => ({
    min: min ? toMinorBound(min, exponent, 'min') : null,
    max: max ? toMinorBound(max, exponent, 'max') : null,
  });
  return { byExponent: { 0: make(0), 2: make(2), 3: make(3) } };
}

export function exponentOf(currency: CurrencyCode): 0 | 2 | 3 {
  return getMinorUnits(currency) as 0 | 2 | 3;
}
