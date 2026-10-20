import { addDays, type CalendarDate } from '../dates/calendar';
import { zonedDateTimeToInstant } from '../dates/zoned';

/**
 * Local reminder planning — pure. The device scheduler (services/reminders)
 * reconciles the OS's pending notifications with this list, so planning the
 * same data twice gives the same identifiers and nothing is duplicated.
 */

/** iOS keeps 64 pending local notifications per app; we stay well below. */
export const MAX_SCHEDULED_REMINDERS = 50;
/** Reminders are planned this far ahead; the rest follow on later runs. */
export const REMINDER_WINDOW_DAYS = 45;
export const REMINDER_LEAD_DAYS = [0, 1, 2, 3, 7] as const;

export interface ReminderCandidate {
  source: 'recurring' | 'bill';
  sourceId: string;
  /** Occurrence / due date (calendar date in the user's time zone). */
  date: CalendarDate;
  /** Days before `date`; null = no reminder for this item. */
  leadDays: number | null;
  name: string;
  type: 'income' | 'expense';
  amountMinor: number;
  currency: string;
}

export interface PlannedReminder extends ReminderCandidate {
  /** Deterministic: the same occurrence always has the same identifier. */
  identifier: string;
  fireAt: Date;
  remindOn: CalendarDate;
}

export const reminderIdentifier = (c: Pick<ReminderCandidate, 'source' | 'sourceId' | 'date'>) =>
  `mm:${c.source === 'bill' ? 'bill' : 'rule'}:${c.sourceId}:${c.date}`;

export const isOwnReminder = (identifier: string) => identifier.startsWith('mm:');

/**
 * Reminders to have scheduled: one per candidate with a lead time, at
 * `time` (HH:mm) on (date − lead) in the user's time zone, only if that
 * moment is still in the future; nearest first, at most MAX_SCHEDULED_REMINDERS.
 */
export function planReminders(
  candidates: readonly ReminderCandidate[],
  options: { timeZone: string; time: string; now: Date },
): PlannedReminder[] {
  const seen = new Set<string>();
  const out: PlannedReminder[] = [];
  for (const c of candidates) {
    if (c.leadDays === null) continue;
    const identifier = reminderIdentifier(c);
    if (seen.has(identifier)) continue;
    seen.add(identifier);
    const remindOn = addDays(c.date, -c.leadDays);
    const fireAt = zonedDateTimeToInstant(remindOn, options.time, options.timeZone);
    if (fireAt.getTime() <= options.now.getTime()) continue;
    out.push({ ...c, identifier, fireAt, remindOn });
  }
  return out
    .sort(
      (a, b) => a.fireAt.getTime() - b.fireAt.getTime() || a.identifier.localeCompare(b.identifier),
    )
    .slice(0, MAX_SCHEDULED_REMINDERS);
}

/** What to cancel and what to (re)schedule to reach `planned`. */
export function reconcileReminders(
  planned: readonly PlannedReminder[],
  scheduled: readonly { identifier: string; fireAt: number | null; fingerprint: string | null }[],
  fingerprint: (p: PlannedReminder) => string,
): { cancel: string[]; schedule: PlannedReminder[] } {
  const wanted = new Map(planned.map((p) => [p.identifier, p]));
  const current = new Map(
    scheduled.filter((s) => isOwnReminder(s.identifier)).map((s) => [s.identifier, s]),
  );
  const cancel = [...current.keys()].filter((id) => {
    const p = wanted.get(id);
    return !p || current.get(id)!.fingerprint !== fingerprint(p);
  });
  const schedule = planned.filter((p) => {
    const s = current.get(p.identifier);
    return !s || s.fingerprint !== fingerprint(p);
  });
  return { cancel: cancel.sort(), schedule };
}
