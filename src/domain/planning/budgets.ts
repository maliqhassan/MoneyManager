import { addDays, type CalendarDate, compareDates, daysBetween, isWithin } from '../dates/calendar';
import type { BudgetPeriodType } from '../enums';
import {
  type BudgetDefinition,
  type BudgetPeriod,
  type BudgetStatus,
  getBudgetPeriod,
  InvalidBudgetError,
  type PeriodSettings,
  periodLengthDays,
} from '../finance/budget';
import { divideAndRound } from '../money/decimal';

/**
 * Budget evaluation engine.
 *
 * A budget has a scope (one expense category incl. its subcategories, or all
 * spending), a currency and a period type. Amount and rollover are stored as
 * REVISIONS with an effective date, so changing a budget never rewrites the
 * limit of a period that already happened. Spending is always derived from
 * transactions (see repositories), so periods are reproducible:
 *
 *   available(P) = limit(P) + carryIn(P)
 *   carryOut(P)  = rollover(P) ? max(0, available(P) − spent(P)) : 0
 *   carryIn(P)   = carryOut(previous period), 0 for the first period
 *
 * Unspent money rolls forward when rollover is on for that period;
 * overspending never becomes a negative carry (it is absorbed).
 *
 * Status (deterministic, a mathematical comparison — not advice):
 *   over     — spent > available
 *   warning  — spent ≥ 80% of available, or spent is ahead of the linear pace
 *              by more than 10% of available
 *   on_track — otherwise
 * Linear pace: expected(today) = available × daysElapsed / daysInPeriod.
 */

export interface BudgetRevision {
  id: string;
  effectiveFrom: CalendarDate;
  amountMinor: number;
  rolloverEnabled: boolean;
  createdAt: string;
}

/** Spending (positive) or refunds (negative) on one day, in the budget currency. */
export interface DailySpend {
  localDate: CalendarDate;
  spentMinor: number;
}

export type PeriodPhase = 'past' | 'current' | 'upcoming';

export interface BudgetPeriodResult extends BudgetPeriod {
  phase: PeriodPhase;
  limitMinor: number;
  rolloverEnabled: boolean;
  carryInMinor: number;
  availableMinor: number;
  spentMinor: number;
  remainingMinor: number;
  carryOutMinor: number;
  /** Spent ÷ available in basis points (10 000 = 100%), never below 0. */
  usedBasisPoints: number;
  status: BudgetStatus;
  daysTotal: number;
  /** Days from the period start through today (0 before the period). */
  daysElapsed: number;
  /** Days after today until the period ends. */
  daysRemaining: number;
  /** Linear-pace spending expected by today. */
  expectedSpentMinor: number;
  aheadOfPace: boolean;
  /** Average spent per elapsed day; null before the period starts. */
  averageDailySpentMinor: number | null;
  /** What can be spent per day (incl. today) to stay within budget; null for past periods. */
  dailyAllowanceMinor: number | null;
}

export const WARNING_USAGE_BASIS_POINTS = 8_000;
export const PACE_TOLERANCE_BASIS_POINTS = 1_000;

const floorDiv = (a: bigint, b: bigint) => Number(divideAndRound(a, b, 'floor'));

/**
 * Start of the budget's first period. Recurring budgets begin on the start of
 * the period containing the chosen date (so a monthly budget covers whole
 * months); custom budgets start exactly on their start date.
 */
export function normalizeBudgetStart(
  definition: BudgetDefinition,
  settings: PeriodSettings,
): CalendarDate {
  if (definition.periodType === 'custom') return definition.startDate;
  const period = getBudgetPeriod(
    { ...definition, startDate: '0001-01-01' },
    definition.startDate,
    settings,
  );
  /* istanbul ignore next -- recurring periods always exist after 0001-01-01 */
  if (!period) throw new InvalidBudgetError('No period for budget start');
  return period.start;
}

/** Revision in force for a period: latest effective date ≤ period start. */
export function revisionFor(
  revisions: readonly BudgetRevision[],
  periodStart: CalendarDate,
): BudgetRevision {
  if (revisions.length === 0) throw new InvalidBudgetError('Budget has no amount');
  const ordered = [...revisions].sort(
    (a, b) =>
      compareDates(a.effectiveFrom, b.effectiveFrom) ||
      a.createdAt.localeCompare(b.createdAt) ||
      a.id.localeCompare(b.id),
  );
  let chosen = ordered[0]!;
  for (const r of ordered) if (compareDates(r.effectiveFrom, periodStart) <= 0) chosen = r;
  return chosen;
}

/**
 * Periods from the budget's first period through the one containing
 * `through` (at least the first period). Custom budgets have one period.
 */
export function listBudgetPeriods(
  definition: BudgetDefinition,
  settings: PeriodSettings,
  through: CalendarDate,
): BudgetPeriod[] {
  const first = getBudgetPeriod(definition, definition.startDate, settings);
  /* istanbul ignore next -- a budget's start date always lies in its first period */
  if (!first) throw new InvalidBudgetError('Budget start is outside its own period');
  if (definition.periodType === 'custom') return [first];
  const periods: BudgetPeriod[] = [first];
  let last = first;
  while (compareDates(last.end, through) < 0) {
    const next = getBudgetPeriod(definition, addDays(last.end, 1), settings);
    /* istanbul ignore next -- recurring budgets always have a following period */
    if (!next) break;
    periods.push(next);
    last = next;
  }
  return periods;
}

function phaseOf(period: BudgetPeriod, today: CalendarDate): PeriodPhase {
  if (compareDates(today, period.start) < 0) return 'upcoming';
  if (compareDates(today, period.end) > 0) return 'past';
  return 'current';
}

export function statusFor(
  availableMinor: number,
  spentMinor: number,
  expectedSpentMinor: number,
): { status: BudgetStatus; aheadOfPace: boolean } {
  const available = BigInt(availableMinor);
  const spent = BigInt(spentMinor);
  const tolerance = (available * BigInt(PACE_TOLERANCE_BASIS_POINTS)) / 10_000n;
  const aheadOfPace = spent > BigInt(expectedSpentMinor) + tolerance;
  if (spent > available) return { status: 'over', aheadOfPace };
  const highUsage = spent * 10_000n >= available * BigInt(WARNING_USAGE_BASIS_POINTS);
  return { status: highUsage || aheadOfPace ? 'warning' : 'on_track', aheadOfPace };
}

/** Evaluates one period given its limit, carry-in and spending. */
export function evaluatePeriod(input: {
  period: BudgetPeriod;
  today: CalendarDate;
  limitMinor: number;
  rolloverEnabled: boolean;
  carryInMinor: number;
  spentMinor: number;
}): BudgetPeriodResult {
  const { period, today, limitMinor, rolloverEnabled, carryInMinor, spentMinor } = input;
  const phase = phaseOf(period, today);
  const daysTotal = periodLengthDays(period);
  const daysElapsed =
    phase === 'upcoming' ? 0 : phase === 'past' ? daysTotal : daysBetween(period.start, today) + 1;
  const daysRemaining = daysTotal - daysElapsed;
  const availableMinor = limitMinor + carryInMinor;
  const remainingMinor = availableMinor - spentMinor;
  const expectedSpentMinor =
    availableMinor > 0
      ? floorDiv(BigInt(availableMinor) * BigInt(daysElapsed), BigInt(daysTotal))
      : 0;
  const { status, aheadOfPace } = statusFor(availableMinor, spentMinor, expectedSpentMinor);
  const usedBasisPoints =
    availableMinor > 0 && spentMinor > 0
      ? floorDiv(BigInt(spentMinor) * 10_000n, BigInt(availableMinor))
      : 0;
  const daysLeftIncludingToday = phase === 'upcoming' ? daysTotal : daysRemaining + 1;
  return {
    ...period,
    phase,
    limitMinor,
    rolloverEnabled,
    carryInMinor,
    availableMinor,
    spentMinor,
    remainingMinor,
    carryOutMinor: rolloverEnabled ? Math.max(0, remainingMinor) : 0,
    usedBasisPoints,
    status,
    daysTotal,
    daysElapsed,
    daysRemaining,
    expectedSpentMinor,
    aheadOfPace,
    averageDailySpentMinor:
      daysElapsed > 0 ? floorDiv(BigInt(spentMinor), BigInt(daysElapsed)) : null,
    dailyAllowanceMinor:
      phase === 'past'
        ? null
        : remainingMinor > 0
          ? floorDiv(BigInt(remainingMinor), BigInt(daysLeftIncludingToday))
          : 0,
  };
}

/** Sums daily spending into periods (both sorted ascending; one pass). */
export function spendingPerPeriod(
  periods: readonly BudgetPeriod[],
  days: readonly DailySpend[],
): number[] {
  const sorted = [...days].sort((a, b) => compareDates(a.localDate, b.localDate));
  const totals = periods.map(() => 0);
  let p = 0;
  for (const day of sorted) {
    while (p < periods.length && compareDates(day.localDate, periods[p]!.end) > 0) p += 1;
    if (p >= periods.length) break;
    if (isWithin(day.localDate, periods[p]!.start, periods[p]!.end)) {
      totals[p] = totals[p]! + day.spentMinor;
    }
  }
  return totals;
}

export interface BudgetEvaluation {
  /** Chronological results from the first period through the current one. */
  periods: BudgetPeriodResult[];
  /** The period containing today (or the nearest one: first if upcoming, last if ended). */
  current: BudgetPeriodResult;
}

export function evaluateBudget(input: {
  periodType: BudgetPeriodType;
  startDate: CalendarDate;
  endDate: CalendarDate | null;
  revisions: readonly BudgetRevision[];
  spending: readonly DailySpend[];
  today: CalendarDate;
  settings: PeriodSettings;
}): BudgetEvaluation {
  const definition: BudgetDefinition = {
    periodType: input.periodType,
    startDate: input.startDate,
    endDate: input.endDate,
  };
  const periods = listBudgetPeriods(definition, input.settings, input.today);
  const spent = spendingPerPeriod(periods, input.spending);
  const results: BudgetPeriodResult[] = [];
  let carry = 0;
  periods.forEach((period, index) => {
    const revision = revisionFor(input.revisions, period.start);
    const result = evaluatePeriod({
      period,
      today: input.today,
      limitMinor: revision.amountMinor,
      rolloverEnabled: revision.rolloverEnabled,
      carryInMinor: carry,
      spentMinor: spent[index]!,
    });
    results.push(result);
    carry = result.carryOutMinor;
  });
  return { periods: results, current: results[results.length - 1]! };
}
