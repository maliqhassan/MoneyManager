import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { devicePersistStorage } from './persistStorage';

/**
 * Reminder settings for THIS device (notification permission is per device,
 * so these are not synced). Off until the user turns them on.
 */
interface ReminderSettingsState {
  enabled: boolean;
  /** Lead time offered by default for new recurring rules and bills. */
  defaultLeadDays: number;
  /** Local time of day reminders are scheduled for ("HH:mm"). */
  time: string;
  set: (
    patch: Partial<Pick<ReminderSettingsState, 'enabled' | 'defaultLeadDays' | 'time'>>,
  ) => void;
}

export const REMINDER_TIMES = ['08:00', '09:00', '12:00', '18:00', '20:00'] as const;

export const useReminderSettings = create<ReminderSettingsState>()(
  persist(
    (set) => ({
      enabled: false,
      defaultLeadDays: 1,
      time: '09:00',
      set: (patch) => set(patch),
    }),
    {
      name: 'reminders.v1',
      version: 1,
      storage: createJSONStorage(() => devicePersistStorage),
      partialize: ({ enabled, defaultLeadDays, time }) => ({ enabled, defaultLeadDays, time }),
    },
  ),
);
