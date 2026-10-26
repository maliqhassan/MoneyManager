import { create } from 'zustand';

import type { SyncStatusSnapshot } from '@/sync/types';

/** Mirror of the SyncEngine status for UI (sync badge, settings screen). */
interface SyncState extends SyncStatusSnapshot {
  isOnline: boolean;
  /**
   * At least one sync run has FINISHED this session (success, error or
   * offline). Latched: a later run starting does not reset it, so screens
   * gated on "first sync done" don't flicker back to a loading state (and
   * unmount) every time a sync starts.
   */
  hasSettled: boolean;
  /** No account: nothing syncs, so 'will sync later' messages do not apply. */
  localOnly: boolean;
  apply: (snapshot: SyncStatusSnapshot) => void;
  setOnline: (online: boolean) => void;
  setLocalOnly: (localOnly: boolean) => void;
  reset: () => void;
}

const INITIAL: SyncStatusSnapshot = {
  phase: 'idle',
  pendingCount: 0,
  failedCount: 0,
  conflictCount: 0,
  lastSyncedAt: null,
  lastErrorCode: null,
};

/** A run has finished when the engine reports success time, an error or offline. */
export function runHasSettled(snapshot: SyncStatusSnapshot): boolean {
  return (
    snapshot.lastSyncedAt !== null ||
    snapshot.lastErrorCode !== null ||
    snapshot.phase === 'error' ||
    snapshot.phase === 'offline'
  );
}

export const useSyncStore = create<SyncState>()((set) => ({
  ...INITIAL,
  isOnline: true,
  hasSettled: false,
  localOnly: false,
  apply: (snapshot) =>
    set((state) => ({ ...snapshot, hasSettled: state.hasSettled || runHasSettled(snapshot) })),
  setOnline: (isOnline) => set({ isOnline }),
  setLocalOnly: (localOnly) => set({ localOnly }),
  reset: () => set({ ...INITIAL, hasSettled: false }),
}));

/** A write was saved but cannot reach the server yet (offline, with an account). */
export const selectSavedOffline = (s: { isOnline: boolean; localOnly: boolean }) =>
  !s.isOnline && !s.localOnly;
