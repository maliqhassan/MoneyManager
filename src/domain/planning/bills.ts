import { addDays, type CalendarDate, compareDates, daysBetween } from '../dates/calendar';
import { nextOccurrenceAfter, type Recurrence } from './recurrence';

/**
 * Bills and subscriptions are EXPECTED commitments, not transactions. Only
 * the transaction recorded when a bill is paid affects balances and spending;
 * a bill's due date arriving never creates or deducts anything.
 */

export type DueStatus = 'overdue' | 'due_today' | 'upcoming';

export interface DueInfo {
  status: DueStatus;
  /** Days from today to the due date (negative when overdue). */
  daysUntil: number;
}

/** Status of an unpaid due date relative to the user's local "today". */
export function dueInfo(dueDate: CalendarDate, today: CalendarDate): DueInfo {
  const daysUntil = daysBetween(today, dueDate);
  return {
    status: daysUntil < 0 ? 'overdue' : daysUntil === 0 ? 'due_today' : 'upcoming',
    daysUntil,
  };
}

export interface BillSchedule extends Recurrence {
  anchorDate: CalendarDate;
  endDate: CalendarDate | null;
}

/**
 * Next due date after the occurrence `settledDueDate` has been paid or
 * skipped; null when the schedule has no further occurrences (end date).
 */
export function dueDateAfter(schedule: BillSchedule, settledDueDate: CalendarDate) {
  return nextOccurrenceAfter(schedule.anchorDate, schedule, settledDueDate, schedule.endDate);
}

/** Reminder date for a due date (`daysBefore` days earlier), or null if none. */
export function reminderDate(
  dueDate: CalendarDate,
  daysBefore: number | null,
): CalendarDate | null {
  return daysBefore === null ? null : addDays(dueDate, -daysBefore);
}

/** Sort key: overdue first (oldest first), then by due date, then name. */
export function compareDue(
  a: { nextDueDate: CalendarDate; name: string },
  b: { nextDueDate: CalendarDate; name: string },
): number {
  return compareDates(a.nextDueDate, b.nextDueDate) || a.name.localeCompare(b.name);
}
