import type { IconName } from '@/components/ui';
import type { AuthStatus } from '@/stores/authStore';
import type { SyncStatusSnapshot } from '@/sync/types';

/** What the user is told about sync. */
export type SyncDisplayStatus =
  'syncing' | 'pending' | 'synced' | 'offline' | 'authRequired' | 'serverNotReady';

export interface SyncDisplayInput extends Pick<
  SyncStatusSnapshot,
  'phase' | 'pendingCount' | 'failedCount' | 'lastSyncedAt' | 'lastErrorCode'
> {
  isOnline: boolean;
  authStatus: AuthStatus;
}

export function syncDisplayStatus(s: SyncDisplayInput): SyncDisplayStatus {
  if (!s.isOnline || s.authStatus === 'offline') return 'offline';
  if (s.phase === 'syncing') return 'syncing';
  if (s.lastErrorCode === 'unauthorized') return 'authRequired';
  if (s.lastErrorCode === 'server_not_ready') return 'serverNotReady';
  if (s.phase === 'offline') return 'offline';
  if (s.pendingCount > 0 || s.failedCount > 0 || s.lastErrorCode !== null) return 'pending';
  return s.lastSyncedAt ? 'synced' : 'pending';
}

export const SYNC_STATUS_ICON: Record<SyncDisplayStatus, IconName> = {
  syncing: 'sync-outline',
  pending: 'time-outline',
  synced: 'checkmark-circle-outline',
  offline: 'cloud-offline-outline',
  authRequired: 'lock-closed-outline',
  serverNotReady: 'cloud-upload-outline',
};

export const SYNC_STATUS_TONE: Record<SyncDisplayStatus, 'positive' | 'warning' | 'textSecondary'> =
  {
    syncing: 'textSecondary',
    pending: 'textSecondary',
    synced: 'positive',
    offline: 'warning',
    authRequired: 'warning',
    serverNotReady: 'warning',
  };
