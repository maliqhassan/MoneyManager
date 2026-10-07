import { create } from 'zustand';

import type { SyncStatusSnapshot } from '@/sync/types';

/** Mirror of the SyncEngine status for UI (sync badge, settings screen). */
interface SyncState extends SyncStatusSnapshot {
  isOnline: boolean;
  apply: (snapshot: SyncStatusSnapshot) => void;
  setOnline: (online: boolean) => void;
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

export const useSyncStore = create<SyncState>()((set) => ({
  ...INITIAL,
  isOnline: true,
  apply: (snapshot) => set(snapshot),
  setOnline: (isOnline) => set({ isOnline }),
  reset: () => set({ ...INITIAL }),
}));
