import {
  addMonths,
  type CalendarDate,
  compareDates,
  daysBetween,
  parseCalendarDate,
} from '../dates/calendar';
import { divideAndRound } from '../money/decimal';

/**
 * Savings goals are PLANNING targets. A contribution records money set aside
 * for a goal; it does not move money. Moving money between accounts is a
 * normal transfer, which a contribution may reference — balances change only
 * because of the transfer, progress changes only because of the contribution.
 */

export type ContributionSuggestion =
  | { kind: 'monthly'; amountMinor: number; months: number }
  | { kind: 'completed' }
  | { kind: 'no_target_date' }
  | { kind: 'target_passed' };

export interface GoalProgress {
  targetMinor: number;
  savedMinor: number;
  /** Still needed (0 once reached). */
  remainingMinor: number;
  /** Saved beyond the target (overfunding is allowed and shown, never capped). */
  overMinor: number;
  /** Saved ÷ target in basis points; may exceed 10 000. Never negative. */
  progressBasisPoints: number;
  completed: boolean;
  /** Days until the target date (negative when passed); null without a date. */
  daysRemaining: number | null;
  suggestion: ContributionSuggestion;
}

/** Whole calendar months from `from` to `to` (0 when `to` is less than a month away). */
export function wholeMonthsBetween(from: CalendarDate, to: CalendarDate): number {
  if (compareDates(to, from) <= 0) return 0;
  const a = parseCalendarDate(from);
  const b = parseCalendarDate(to);
  let months = (b.year - a.year) * 12 + (b.month - a.month);
  if (compareDates(addMonths(from, months), to) > 0) months -= 1;
  return months;
}

/**
 * Progress and a deterministic suggestion. The suggested monthly amount is
 * the remaining amount spread over the whole months left until the target
 * date (at least one), rounded UP so following it reaches the target.
 */
export function evaluateGoal(input: {
  targetMinor: number;
  savedMinor: number;
  targetDate: CalendarDate | null;
  today: CalendarDate;
}): GoalProgress {
  const { targetMinor, savedMinor, targetDate, today } = input;
  const remainingMinor = Math.max(0, targetMinor - savedMinor);
  const completed = savedMinor >= targetMinor;
  const progressBasisPoints =
    savedMinor > 0
      ? Number(divideAndRound(BigInt(savedMinor) * 10_000n, BigInt(targetMinor), 'floor'))
      : 0;

  let suggestion: ContributionSuggestion;
  if (completed) suggestion = { kind: 'completed' };
  else if (!targetDate) suggestion = { kind: 'no_target_date' };
  else if (compareDates(targetDate, today) < 0) suggestion = { kind: 'target_passed' };
  else {
    const months = Math.max(1, wholeMonthsBetween(today, targetDate));
    suggestion = {
      kind: 'monthly',
      months,
      amountMinor: Number(divideAndRound(BigInt(remainingMinor), BigInt(months), 'ceil')),
    };
  }

  return {
    targetMinor,
    savedMinor,
    remainingMinor,
    overMinor: Math.max(0, savedMinor - targetMinor),
    progressBasisPoints,
    completed,
    daysRemaining: targetDate ? daysBetween(today, targetDate) : null,
    suggestion,
  };
}
