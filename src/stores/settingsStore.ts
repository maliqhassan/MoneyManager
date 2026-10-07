import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import type { ThemeMode } from '@/domain/enums';

import { devicePersistStorage } from './persistStorage';

/**
 * Device-level UI settings (per device, not synced). Financial preferences
 * that must follow the user across devices (base currency, locale, first day
 * of week) live in the synced `user_preferences` table instead.
 */
interface SettingsState {
  themeMode: ThemeMode;
  setThemeMode: (mode: ThemeMode) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      themeMode: 'system',
      setThemeMode: (themeMode) => set({ themeMode }),
    }),
    {
      name: 'settings.v1',
      version: 1,
      storage: createJSONStorage(() => devicePersistStorage),
      partialize: ({ themeMode }) => ({ themeMode }),
    },
  ),
);
