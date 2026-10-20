import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

/**
 * The few notification operations reminders need. The app uses the Expo
 * implementation below; tests use an in-memory one. Local notifications only
 * — no push token, no server.
 */
export interface ScheduledReminder {
  identifier: string;
  /** Fingerprint stored in the notification data (detects changed content). */
  fingerprint: string | null;
  fireAt: number | null;
}

export type PermissionState = 'granted' | 'denied' | 'undetermined';

export interface NotificationsPort {
  permission(): Promise<PermissionState>;
  /** Shows the OS prompt (only call after explaining why). */
  requestPermission(): Promise<PermissionState>;
  scheduled(): Promise<ScheduledReminder[]>;
  schedule(input: {
    identifier: string;
    title: string;
    body: string;
    fireAt: Date;
    data: Record<string, string>;
  }): Promise<void>;
  cancel(identifier: string): Promise<void>;
}

export const REMINDER_CHANNEL_ID = 'reminders';

function toState(p: Notifications.NotificationPermissionsStatus): PermissionState {
  // iOS: provisional / ephemeral delivery counts as allowed.
  const ios = p.ios?.status;
  if (
    p.granted ||
    ios === Notifications.IosAuthorizationStatus.PROVISIONAL ||
    ios === Notifications.IosAuthorizationStatus.EPHEMERAL
  ) {
    return 'granted';
  }
  return p.status === Notifications.PermissionStatus.UNDETERMINED ? 'undetermined' : 'denied';
}

let channelReady: Promise<void> | null = null;
/** Android 8+: a channel must exist (and on Android 13 before the prompt). */
function ensureChannel(name: string): Promise<void> {
  if (Platform.OS !== 'android') return Promise.resolve();
  channelReady ??= Notifications.setNotificationChannelAsync(REMINDER_CHANNEL_ID, {
    name,
    importance: Notifications.AndroidImportance.DEFAULT,
  }).then(() => undefined);
  return channelReady;
}

export function createExpoNotificationsPort(channelName: string): NotificationsPort {
  return {
    permission: async () => toState(await Notifications.getPermissionsAsync()),
    requestPermission: async () => {
      await ensureChannel(channelName);
      return toState(await Notifications.requestPermissionsAsync());
    },
    scheduled: async () =>
      (await Notifications.getAllScheduledNotificationsAsync()).map((n) => {
        const data = (n.content.data ?? {}) as Record<string, unknown>;
        return {
          identifier: n.identifier,
          fingerprint: typeof data.fp === 'string' ? data.fp : null,
          fireAt: typeof data.at === 'string' ? Number(data.at) : null,
        };
      }),
    schedule: async ({ identifier, title, body, fireAt, data }) => {
      await ensureChannel(channelName);
      await Notifications.scheduleNotificationAsync({
        identifier,
        content: { title, body, data },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: fireAt,
          channelId: REMINDER_CHANNEL_ID,
        },
      });
    },
    cancel: (identifier) => Notifications.cancelScheduledNotificationAsync(identifier),
  };
}
