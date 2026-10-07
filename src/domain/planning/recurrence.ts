import {
  addDays,
  addMonths,
  type CalendarDate,
  compareDates,
  daysBetween,
  parseCalendarDate,
} from '../dates/calendar';
import type { RecurrenceFrequency } from '../enums';
import { divideAndRound } from '../money/decimal';
import { AmountOutOfRangeError, MAX_ABS_AMOUNT_MINOR } from '../money/money';

/**
 * Recurrence for bills and subscriptions: every `interval` days / weeks /
 * months / years, counted from an anchor date (the first due date).
 *
 * Occurrences are always computed FROM THE ANCHOR, never from the previous
 * occurrence, so month-end dates do not drift: an anchor of 31 Jan gives
 * 31 Jan → 28/29 Feb → 31 Mar → 30 Apr (the last valid day of shorter months),
 * and 29 Feb gives 28 Feb in non-leap years. All dates are calendar dates in
 * the user's time zone — no UTC conversion is involved.
 */
export interface Recurrence {
  frequency: RecurrenceFrequency;
  interval: number;
}

export const RECURRENCE_PRESETS = ['weekly', 'biweekly', 'monthly', 'quarterly', 'yearly'] as const;
export type RecurrencePreset = (typeof RECURRENCE_PRESETS)[number];

export const PRESET_RECURRENCE: Readonly<Record<RecurrencePreset, Recurrence>> = {
  weekly: { frequency: 'weekly', interval: 1 },
  biweekly: { frequency: 'weekly', interval: 2 },
  monthly: { frequency: 'monthly', interval: 1 },
  quarterly: { frequency: 'monthly', interval: 3 },
  yearly: { frequency: 'yearly', interval: 1 },
};

export const MAX_RECURRENCE_INTERVAL = 365;

export class InvalidRecurrenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidRecurrenceError';
  }
}

function assertValid(r: Recurrence): void {
  if (!Number.isInteger(r.interval) || r.interval < 1 || r.interval > MAX_RECURRENCE_INTERVAL) {
    throw new InvalidRecurrenceError(`Invalid recurrence interval ${r.interval}`);
  }
}

/** The preset a recurrence corresponds to, or 'custom'. */
export function presetOf(r: Recurrence): RecurrencePreset | 'custom' {
  for (const preset of RECURRENCE_PRESETS) {
    const p = PRESET_RECURRENCE[preset];
    if (p.frequency === r.frequency && p.interval === r.interval) return preset;
  }
  return 'custom';
}

/** Months per step for month-based schedules, days per step otherwise. */
function step(r: Recurrence): { unit: 'days' | 'months'; size: number } {
  switch (r.frequency) {
    case 'daily':
      return { unit: 'days', size: r.interval };
    case 'weekly':
      return { unit: 'days', size: 7 * r.interval };
    case 'monthly':
      return { unit: 'months', size: r.interval };
    case 'yearly':
      return { unit: 'months', size: 12 * r.interval };
  }
}

/** The n-th occurrence (n ≥ 0; n = 0 is the anchor). */
export function occurrenceAt(anchor: CalendarDate, r: Recurrence, n: number): CalendarDate {
  assertValid(r);
  if (!Number.isInteger(n) || n < 0) throw new InvalidRecurrenceError(`Invalid index ${n}`);
  const s = step(r);
  return s.unit === 'days' ? addDays(anchor, n * s.size) : addMonths(anchor, n * s.size);
}

/** Index of the first occurrence on or after `date` (0 when `date` ≤ anchor). */
function firstIndexOnOrAfter(anchor: CalendarDate, r: Recurrence, date: CalendarDate): number {
  if (compareDates(date, anchor) <= 0) return 0;
  const s = step(r);
  if (s.unit === 'days') return Math.ceil(daysBetween(anchor, date) / s.size);
  const a = parseCalendarDate(anchor);
  const d = parseCalendarDate(date);
  const monthsApart = (d.year - a.year) * 12 + (d.month - a.month);
  let n = Math.floor(monthsApart / s.size);
  // At most one step forward: occurrence n falls in or before date's month.
  while (compareDates(occurrenceAt(anchor, r, n), date) < 0) n += 1;
  return n;
}

/** First occurrence on or after `date`, or null if the schedule ended before it. */
export function nextOccurrenceOnOrAfter(
  anchor: CalendarDate,
  r: Recurrence,
  date: CalendarDate,
  endDate: CalendarDate | null = null,
): CalendarDate | null {
  assertValid(r);
  const next = occurrenceAt(anchor, r, firstIndexOnOrAfter(anchor, r, date));
  return endDate && compareDates(next, endDate) > 0 ? null : next;
}

/** First occurrence strictly after `date`, or null if the schedule has ended. */
export function nextOccurrenceAfter(
  anchor: CalendarDate,
  r: Recurrence,
  date: CalendarDate,
  endDate: CalendarDate | null = null,
): CalendarDate | null {
  return nextOccurrenceOnOrAfter(anchor, r, addDays(date, 1), endDate);
}

/** Occurrences within [from, to] (inclusive), capped at `limit`. */
export function occurrencesBetween(
  anchor: CalendarDate,
  r: Recurrence,
  from: CalendarDate,
  to: CalendarDate,
  endDate: CalendarDate | null = null,
  limit = 400,
): CalendarDate[] {
  assertValid(r);
  const out: CalendarDate[] = [];
  for (let n = firstIndexOnOrAfter(anchor, r, from); out.length < limit; n += 1) {
    const date = occurrenceAt(anchor, r, n);
    if (compareDates(date, to) > 0) break;
    if (endDate && compareDates(date, endDate) > 0) break;
    out.push(date);
  }
  return out;
}

/** True when `date` is one of the schedule's occurrences. */
export function isOccurrence(anchor: CalendarDate, r: Recurrence, date: CalendarDate): boolean {
  return nextOccurrenceOnOrAfter(anchor, r, date) === date;
}

/**
 * A recurring amount expressed per month or per year. `approximate` is true
 * when the conversion is not exact: week- and day-based schedules (a year is
 * not a whole number of weeks; 52 weeks / 365 days are used), or a division
 * that leaves a remainder (rounded half-even to the minor unit).
 */
export interface PeriodicCost {
  amountMinor: number;
  approximate: boolean;
}

function scaled(amountMinor: number, multiplier: bigint, divisor: bigint, inexact: boolean) {
  const numerator = BigInt(amountMinor) * multiplier;
  const result = divideAndRound(numerator, divisor, 'half-even');
  if (result > BigInt(MAX_ABS_AMOUNT_MINOR) || result < -BigInt(MAX_ABS_AMOUNT_MINOR)) {
    throw new AmountOutOfRangeError(result);
  }
  return {
    amountMinor: Number(result),
    approximate: inexact || numerator % divisor !== 0n,
  };
}

export function yearlyCost(amountMinor: number, r: Recurrence): PeriodicCost {
  assertValid(r);
  const i = BigInt(r.interval);
  switch (r.frequency) {
    case 'daily':
      return scaled(amountMinor, 365n, i, true);
    case 'weekly':
      return scaled(amountMinor, 52n, i, true);
    case 'monthly':
      return scaled(amountMinor, 12n, i, false);
    case 'yearly':
      return scaled(amountMinor, 1n, i, false);
  }
}

export function monthlyCost(amountMinor: number, r: Recurrence): PeriodicCost {
  assertValid(r);
  const i = BigInt(r.interval);
  switch (r.frequency) {
    case 'daily':
      return scaled(amountMinor, 365n, 12n * i, true);
    case 'weekly':
      return scaled(amountMinor, 52n, 12n * i, true);
    case 'monthly':
      return scaled(amountMinor, 1n, i, false);
    case 'yearly':
      return scaled(amountMinor, 1n, 12n * i, false);
  }
}
