import { addDays } from '@/domain/dates/calendar';
import {
  isOwnReminder,
  planReminders,
  type PlannedReminder,
  reconcileReminders,
  REMINDER_WINDOW_DAYS,
} from '@/domain/planning/reminders';
import type { UpcomingRepository } from '@/repositories/types';
import { logger } from '@/services/monitoring/logger';

import type { NotificationsPort } from './notificationsPort';

export interface ReminderSyncOptions {
  upcoming: UpcomingRepository;
  port: NotificationsPort;
  settings: { enabled: boolean; time: string };
  today: string;
  timeZone: string;
  now: Date;
  /** Builds the (already translated) title and body for one reminder. */
  text: (r: PlannedReminder) => { title: string; body: string };
}

export type ReminderSyncResult =
  | { status: 'disabled'; cancelled: number }
  | { status: 'no_permission'; cancelled: number }
  | { status: 'synced'; scheduled: number; cancelled: number; planned: number }
  | { status: 'failed' };

/**
 * Makes the device's pending reminders match what should exist. Idempotent:
 * identifiers are deterministic per occurrence, unchanged reminders are left
 * alone, and anything no longer wanted (paused/ended rule, paid or handled
 * occurrence, deleted item, reminders turned off) is cancelled. Never throws:
 * reminders are separate from saving data.
 */
export async function syncReminders(o: ReminderSyncOptions): Promise<ReminderSyncResult> {
  try {
    const scheduled = await o.port.scheduled();
    const ours = scheduled.filter((s) => isOwnReminder(s.identifier));
    const cancelAll = async () => {
      for (const s of ours) await o.port.cancel(s.identifier);
      return ours.length;
    };
    if (!o.settings.enabled) return { status: 'disabled', cancelled: await cancelAll() };
    if ((await o.port.permission()) !== 'granted') {
      return { status: 'no_permission', cancelled: await cancelAll() };
    }
    const candidates = await o.upcoming.reminderCandidates(
      o.today,
      addDays(o.today, REMINDER_WINDOW_DAYS),
    );
    const planned = planReminders(candidates, {
      timeZone: o.timeZone,
      time: o.settings.time,
      now: o.now,
    });
    const fingerprint = (p: PlannedReminder) => {
      const t = o.text(p);
      return `${p.fireAt.getTime()}|${t.title}|${t.body}`;
    };
    const plan = reconcileReminders(planned, ours, fingerprint);
    for (const id of plan.cancel) await o.port.cancel(id);
    for (const p of plan.schedule) {
      const t = o.text(p);
      await o.port.schedule({
        identifier: p.identifier,
        title: t.title,
        body: t.body,
        fireAt: p.fireAt,
        data: {
          fp: fingerprint(p),
          at: String(p.fireAt.getTime()),
          url: p.source === 'bill' ? `/bills/${p.sourceId}` : `/recurring/${p.sourceId}`,
        },
      });
    }
    return {
      status: 'synced',
      scheduled: plan.schedule.length,
      cancelled: plan.cancel.length,
      planned: planned.length,
    };
  } catch (error) {
    logger.warn('Reminder scheduling failed', { name: (error as Error)?.name });
    return { status: 'failed' };
  }
}
