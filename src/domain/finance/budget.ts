import {
  addDays,
  addMonths,
  type CalendarDate,
  compareDates,
  daysBetween,
  formatCalendarDate,
  isWithin,
  parseCalendarDate,
  startOfWeek,
  toCalendarDateInZone,
} from '../dates/calendar';
import type { BudgetPeriodType, TransactionType, Weekday } from '../enums';
import { divideAndRound } from '../money/decimal';

export interface BudgetPeriod {
  start: CalendarDate;
  /** Inclusive. */
  end: CalendarDate;
}

export interface PeriodSettings {
  firstDayOfWeek: Weekday;
  /** 1–28: day of month on which monthly periods begin. */
  monthStartDay: number;
}

export interface BudgetDefinition {
  periodType: BudgetPeriodType;
  startDate: CalendarDate;
  endDate: CalendarDate | null;
}

export class InvalidBudgetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidBudgetError';
  }
}

function monthlyPeriodContaining(date: CalendarDate, monthStartDay: number): BudgetPeriod {
  if (!Number.isInteger(monthStartDay) || monthStartDay < 1 || monthStartDay > 28) {
    throw new InvalidBudgetError('monthStartDay must be between 1 and 28');
  }
  const { year, month, day } = parseCalendarDate(date);
  const thisMonthStart = formatCalendarDate({ year, month, day: monthStartDay });
  const start = day >= monthStartDay ? thisMonthStart : addMonths(thisMonthStart, -1);
  return { start, end: addDays(addMonths(start, 1), -1) };
}

/**
 * The budget period containing `date`, or null if a custom budget does not
 * cover it (or the date precedes the budget's start).
 */
export function getBudgetPeriod(
  budget: BudgetDefinition,
  date: CalendarDate,
  settings: PeriodSettings,
): BudgetPeriod | null {
  if (compareDates(date, budget.startDate) < 0) return null;
  switch (budget.periodType) {
    case 'weekly': {
      const start = startOfWeek(date, settings.firstDayOfWeek);
      return { start, end: addDays(start, 6) };
    }
    case 'monthly':
      return monthlyPeriodContaining(date, settings.monthStartDay);
    case 'custom': {
      if (!budget.endDate) throw new InvalidBudgetError('Custom budgets require an end date');
      if (compareDates(budget.endDate, budget.startDate) < 0) {
        throw new InvalidBudgetError('Budget end date precedes start date');
      }
      return isWithin(date, budget.startDate, budget.endDate)
        ? { start: budget.startDate, end: budget.endDate }
        : null;
    }
  }
}

/** The period immediately before `period` for recurring budgets. */
export function getPreviousPeriod(
  periodType: Exclude<BudgetPeriodType, 'custom'>,
  period: BudgetPeriod,
  settings: PeriodSettings,
): BudgetPeriod {
  return periodType === 'weekly'
    ? { start: addDays(period.start, -7), end: addDays(period.start, -1) }
    : monthlyPeriodContaining(addDays(period.start, -1), settings.monthStartDay);
}

export function periodLengthDays(period: BudgetPeriod): number {
  return daysBetween(period.start, period.end) + 1;
}

/** A posting expressed in the budget's currency, with splits already expanded. */
export interface BudgetPosting {
  categoryId: string | null;
  type: TransactionType;
  /** Signed, in the budget currency. */
  amountMinor: number;
  localDate: CalendarDate;
}

/**
 * Net spending per category within the period. Expenses add to spending,
 * refunds reduce it; income and transfers are ignored. Uncategorised spend is
 * keyed by `null`.
 */
export function spendingByCategory(
  postings: readonly BudgetPosting[],
  period: BudgetPeriod,
): Map<string | null, number> {
  const totals = new Map<string | null, number>();
  for (const p of postings) {
    if (p.type !== 'expense' && p.type !== 'refund') continue;
    if (!isWithin(p.localDate, period.start, period.end)) continue;
    const spent = -p.amountMinor; // expense -500 → spent 500; refund +200 → spent -200
    totals.set(p.categoryId, (totals.get(p.categoryId) ?? 0) + spent);
  }
  return totals;
}

export interface PeriodOutcome {
  limitMinor: number;
  spentMinor: number;
}

/**
 * Amount carried into the next period after a chronological run of periods.
 * Unspent money rolls forward. Overspending rolls forward as a negative carry
 * only when `carryOverspending` is true; otherwise each period's deficit is
 * absorbed and the carry resets to zero.
 */
export function computeRollover(
  history: readonly PeriodOutcome[],
  carryOverspending: boolean,
): number {
  let carry = 0;
  for (const { limitMinor, spentMinor } of history) {
    const leftover = limitMinor + carry - spentMinor;
    carry = leftover < 0 && !carryOverspending ? 0 : leftover;
  }
  return carry;
}

export type BudgetStatus = 'on_track' | 'warning' | 'over';

export interface BudgetProgress {
  availableMinor: number;
  spentMinor: number;
  remainingMinor: number;
  /** Spent / available in basis points (10 000 = 100%). Null when nothing is available. */
  usedBasisPoints: number | null;
  status: BudgetStatus;
}

/** Default threshold for the "approaching limit" warning: 80%. */
export const DEFAULT_WARNING_BASIS_POINTS = 8_000;

export function computeBudgetProgress(
  limitMinor: number,
  spentMinor: number,
  carryInMinor = 0,
  warningBasisPoints = DEFAULT_WARNING_BASIS_POINTS,
): BudgetProgress {
  const availableMinor = limitMinor + carryInMinor;
  const remainingMinor = availableMinor - spentMinor;
  const usedBasisPoints =
    availableMinor > 0
      ? Number(divideAndRound(BigInt(spentMinor) * 10_000n, BigInt(availableMinor), 'floor'))
      : null;

  let status: BudgetStatus;
  if (remainingMinor < 0) status = 'over';
  else if (usedBasisPoints !== null && usedBasisPoints >= warningBasisPoints) status = 'warning';
  else status = 'on_track';

  return { availableMinor, spentMinor, remainingMinor, usedBasisPoints, status };
}

/**
 * Linear end-of-period spending forecast: spent-so-far extrapolated over the
 * whole period. `today` is clamped into the period.
 */
export function forecastPeriodSpending(
  spentMinor: number,
  period: BudgetPeriod,
  today: CalendarDate,
): number {
  const total = periodLengthDays(period);
  if (compareDates(today, period.end) >= 0) return spentMinor;
  const elapsed = compareDates(today, period.start) < 0 ? 0 : daysBetween(period.start, today) + 1;
  if (elapsed === 0) return 0;
  return Number(divideAndRound(BigInt(spentMinor) * BigInt(total), BigInt(elapsed)));
}

/**
 * The budget period that is current for the user *right now*, resolved in
 * their configured time zone (not the device clock's UTC date). At 23:30 on
 * 31 Oct in New York it is still October's period even though UTC is already
 * in November.
 */
export function currentBudgetPeriod(
  budget: BudgetDefinition,
  now: Date,
  timeZone: string,
  settings: PeriodSettings,
): BudgetPeriod | null {
  return getBudgetPeriod(budget, toCalendarDateInZone(now, timeZone), settings);
}
