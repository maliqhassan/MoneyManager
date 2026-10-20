import { addDays, type CalendarDate, compareDates } from '../dates/calendar';

import {
  nextOccurrenceOnOrAfter,
  occurrencesBetween,
  type Recurrence,
  type RecurrencePreset,
} from './recurrence';

/**
 * Recurring transaction rules (docs/recurring.md). Occurrences come from the
 * shared anchor-based recurrence engine: the start date is the anchor, so
 * month-end and leap-day dates never drift.
 *
 * An occurrence is identified by (rule, scheduled date). It is HANDLED once
 * the user posted or skipped it; handled occurrences are never due again.
 */

export const RULE_STATUSES = ['active', 'paused', 'ended'] as const;
export type RuleStatus = (typeof RULE_STATUSES)[number];

export const RULE_SCHEDULES = [
  'daily',
  'weekly',
  'biweekly',
  'monthly',
  'quarterly',
  'yearly',
] as const;
export type RuleSchedule = (typeof RULE_SCHEDULES)[number];

/** Daily is not a bill preset, so rule schedules are defined here. */
export const RULE_SCHEDULE_RECURRENCE: Readonly<Record<RuleSchedule, Recurrence>> = {
  daily: { frequency: 'daily', interval: 1 },
  weekly: { frequency: 'weekly', interval: 1 },
  biweekly: { frequency: 'weekly', interval: 2 },
  monthly: { frequency: 'monthly', interval: 1 },
  quarterly: { frequency: 'monthly', interval: 3 },
  yearly: { frequency: 'yearly', interval: 1 },
};

export function scheduleOf(r: Recurrence): RuleSchedule | 'custom' {
  for (const s of RULE_SCHEDULES) {
    const p = RULE_SCHEDULE_RECURRENCE[s];
    if (p.frequency === r.frequency && p.interval === r.interval) return s;
  }
  return 'custom';
}

/** Bill presets are a subset of rule schedules. */
export const isBillPreset = (s: RuleSchedule): s is RecurrencePreset => s !== 'daily';

/** How far back unhandled occurrences are still offered (and auto-posted). */
export const MAX_BACKLOG_DAYS = 90;
/** How far ahead the upcoming list and previews look by default. */
export const PREVIEW_COUNT = 6;

export interface RuleSchedulePlan extends Recurrence {
  startDate: CalendarDate;
  endDate: CalendarDate | null;
  /** Occurrences before this date are never due (start, or the last resume). */
  activeFrom: CalendarDate;
  status: RuleStatus;
}

/** Scheduled dates within [from, to] the rule can produce (ignores status). */
export function scheduledBetween(
  rule: RuleSchedulePlan,
  from: CalendarDate,
  to: CalendarDate,
  limit = 400,
): CalendarDate[] {
  const start = compareDates(from, rule.activeFrom) < 0 ? rule.activeFrom : from;
  if (compareDates(start, to) > 0) return [];
  return occurrencesBetween(rule.startDate, rule, start, to, rule.endDate, limit);
}

/** The next `count` scheduled dates on or after `from` (form preview). */
export function previewOccurrences(
  plan: Pick<RuleSchedulePlan, 'frequency' | 'interval' | 'startDate' | 'endDate'>,
  from: CalendarDate,
  count = PREVIEW_COUNT,
): CalendarDate[] {
  const out: CalendarDate[] = [];
  let next = nextOccurrenceOnOrAfter(plan.startDate, plan, from, plan.endDate);
  while (next && out.length < count) {
    out.push(next);
    next = nextOccurrenceOnOrAfter(plan.startDate, plan, addDays(next, 1), plan.endDate);
  }
  return out;
}

export type OccurrenceState = 'overdue' | 'due_today' | 'upcoming';

export interface PendingOccurrence {
  date: CalendarDate;
  state: OccurrenceState;
}

/**
 * Unhandled occurrences of an ACTIVE rule from `MAX_BACKLOG_DAYS` before
 * today through `through`. Paused and ended rules have none.
 */
export function pendingOccurrences(
  rule: RuleSchedulePlan,
  handled: ReadonlySet<CalendarDate>,
  today: CalendarDate,
  through: CalendarDate,
): PendingOccurrence[] {
  if (rule.status !== 'active') return [];
  return scheduledBetween(rule, addDays(today, -MAX_BACKLOG_DAYS), through)
    .filter((d) => !handled.has(d))
    .map((date) => {
      const c = compareDates(date, today);
      return { date, state: c < 0 ? 'overdue' : c === 0 ? 'due_today' : 'upcoming' };
    });
}

/** Occurrences that may be posted now: unhandled and not in the future. */
export function dueOccurrences(
  rule: RuleSchedulePlan,
  handled: ReadonlySet<CalendarDate>,
  today: CalendarDate,
): CalendarDate[] {
  return pendingOccurrences(rule, handled, today, today).map((o) => o.date);
}

/**
 * The first unhandled occurrence on or after `activeFrom` (may be in the
 * past), or null when the schedule has no more occurrences. Cached on the
 * rule as next_occurrence_date for sorting and reminders.
 */
export function nextUnhandled(
  rule: RuleSchedulePlan,
  handled: ReadonlySet<CalendarDate>,
  today: CalendarDate,
): CalendarDate | null {
  if (rule.status === 'ended') return null;
  const floor = addDays(today, -MAX_BACKLOG_DAYS);
  let from = compareDates(rule.activeFrom, floor) > 0 ? rule.activeFrom : floor;
  for (let guard = 0; guard < 5000; guard += 1) {
    const next = nextOccurrenceOnOrAfter(rule.startDate, rule, from, rule.endDate);
    if (!next) return null;
    if (!handled.has(next)) return next;
    from = addDays(next, 1);
  }
  return null;
}

/** "Finished": active, but the end date leaves no further occurrences. */
export function isFinished(
  rule: RuleSchedulePlan,
  handled: ReadonlySet<CalendarDate>,
  today: CalendarDate,
): boolean {
  return rule.status === 'active' && nextUnhandled(rule, handled, today) === null;
}
