import * as Notifications from 'expo-notifications';
import { type Href, router } from 'expo-router';
import type { TFunction } from 'i18next';
import { useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { AppState } from 'react-native';

import type { CurrencyCode } from '@/domain/currency/currencies';
import { daysBetween } from '@/domain/dates/calendar';
import type { PlannedReminder } from '@/domain/planning/reminders';
import type { Formatter } from '@/i18n/formatter';
import { useFormatter } from '@/i18n/FormatContext';
import { useData } from '@/providers/DataProvider';
import { createExpoNotificationsPort } from '@/services/reminders/notificationsPort';
import { syncReminders } from '@/services/reminders/scheduler';
import { useReminderSettings } from '@/stores/reminderSettingsStore';

const CHANGE_DEBOUNCE_MS = 3_000;

// Reminders that arrive while the app is open are shown as a banner.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

/** Title and body of one reminder, in the user's language and formats. */
export function reminderText(t: TFunction, formatter: Formatter, r: PlannedReminder) {
  const days = daysBetween(r.remindOn, r.date);
  const when =
    days === 0
      ? t('reminders.when.today')
      : days === 1
        ? t('reminders.when.tomorrow')
        : t('reminders.when.inDays', { count: days });
  const name =
    r.name ||
    (r.type === 'income' ? t('recurring.fallbackIncome') : t('recurring.fallbackExpense'));
  const key =
    r.source === 'bill'
      ? 'reminders.notification.bill'
      : r.type === 'income'
        ? 'reminders.notification.income'
        : 'reminders.notification.expense';
  return {
    title: t(key, { name, when }),
    body: t('reminders.body', {
      amount: formatter.money({ amountMinor: r.amountMinor, currency: r.currency as CurrencyCode }),
    }),
  };
}

let running: Promise<void> | null = null;

/**
 * Foreground automation for recurring rules (no background service):
 * - posts due occurrences of rules set to post automatically (idempotent);
 * - keeps local reminders in step with rules, bills and settings.
 * Each part is independent: a reminder failure never affects saved data.
 */
export function useRecurringAutomation(): void {
  const { repositories, onLocalChange } = useData();
  const formatter = useFormatter();
  const { t } = useTranslation();
  const settings = useReminderSettings();
  const port = useMemo(() => createExpoNotificationsPort(t('reminders.channel')), [t]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const today = formatter.today();
  const timeZone = formatter.settings.timeZone;
  const { enabled, time } = settings;

  useEffect(() => {
    let disposed = false;
    const sync = () =>
      syncReminders({
        upcoming: repositories.upcoming,
        port,
        settings: { enabled, time },
        today,
        timeZone,
        now: new Date(),
        text: (r) => reminderText(t, formatter, r),
      });
    const run = () => {
      if (disposed || running) return;
      running = repositories.recurring
        .autoPostDue(today)
        .catch(() => undefined)
        .then(() => (disposed ? undefined : sync()))
        .then(() => undefined)
        .finally(() => {
          running = null;
        });
    };
    run();
    const appState = AppState.addEventListener('change', (s) => {
      if (s === 'active') run();
    });
    const unsubscribe = onLocalChange(() => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void sync(), CHANGE_DEBOUNCE_MS);
    });
    return () => {
      disposed = true;
      appState.remove();
      unsubscribe();
      if (timer.current) clearTimeout(timer.current);
    };
  }, [repositories, onLocalChange, port, enabled, time, today, timeZone, t, formatter]);

  // Tapping a reminder opens the bill or rule it is about.
  useEffect(() => {
    const open = (data: unknown) => {
      const url = (data as { url?: unknown } | undefined)?.url;
      if (typeof url === 'string' && url.startsWith('/')) router.push(url as Href);
    };
    void Notifications.getLastNotificationResponseAsync().then((r) =>
      r ? open(r.notification.request.content.data) : undefined,
    );
    const sub = Notifications.addNotificationResponseReceivedListener((r) =>
      open(r.notification.request.content.data),
    );
    return () => sub.remove();
  }, []);
}
