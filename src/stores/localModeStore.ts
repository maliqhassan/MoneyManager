import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { newId } from '@/lib/ids';

import { useAuthStore } from './authStore';
import { devicePersistStorage } from './persistStorage';

/**
 * Using the app without an account. A device-local id stands in for the user
 * id, so local data lives in its own database file exactly like an account's
 * (nothing is sent anywhere). Signing in later merges that data into the
 * account (sync/guestMerge.ts) and clears the id.
 *
 * Holds only ids and UI flags — no financial data.
 */
interface LocalModeState {
  /** Set while the user keeps their data on this device only. */
  guestId: string | null;
  /** The intro slides were shown (or skipped) on this device. */
  introSeen: boolean;
  /** First-run tips already dismissed, by tip id. */
  tipsSeen: Record<string, true>;
  startGuest: () => string;
  clearGuest: () => void;
  markIntroSeen: () => void;
  markTipSeen: (id: string) => void;
  resetTips: () => void;
}

export const useLocalModeStore = create<LocalModeState>()(
  persist(
    (set, get) => ({
      guestId: null,
      introSeen: false,
      tipsSeen: {},
      startGuest: () => {
        const existing = get().guestId;
        if (existing) return existing;
        const guestId = newId();
        set({ guestId, introSeen: true });
        return guestId;
      },
      clearGuest: () => set({ guestId: null }),
      markIntroSeen: () => set({ introSeen: true }),
      markTipSeen: (id) => set({ tipsSeen: { ...get().tipsSeen, [id]: true } }),
      resetTips: () => set({ tipsSeen: {} }),
    }),
    {
      name: 'local-mode.v1',
      version: 1,
      storage: createJSONStorage(() => devicePersistStorage),
      partialize: ({ guestId, introSeen, tipsSeen }) => ({ guestId, introSeen, tipsSeen }),
    },
  ),
);

/** Whose data is open: the signed-in account, else the local-only profile. */
export interface ActiveProfile {
  userId: string;
  mode: 'account' | 'local';
}

export function useActiveProfile(): ActiveProfile | null {
  const accountId = useAuthStore((s) => s.user?.id ?? null);
  const guestId = useLocalModeStore((s) => s.guestId);
  if (accountId) return { userId: accountId, mode: 'account' };
  if (guestId) return { userId: guestId, mode: 'local' };
  return null;
}

/** Id used for per-profile device state (onboarding progress). */
export function useActiveUserId(): string {
  return useActiveProfile()?.userId ?? '';
}
