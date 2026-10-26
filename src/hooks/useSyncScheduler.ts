import { useQueryClient } from '@tanstack/react-query';
import * as Network from 'expo-network';
import { useEffect } from 'react';
import { AppState } from 'react-native';

import { refreshAuthSession, restoreSession } from '@/features/auth/services/authService';
import { useData } from '@/providers/DataProvider';
import { uploadPendingReceipts } from '@/services/receipts/uploader';
import { getSupabase } from '@/services/supabase/client';
import { useAuthStore } from '@/stores/authStore';
import { useSyncStore } from '@/stores/syncStore';
import { AutoSyncController } from '@/sync/autoSync';

const PERIODIC_SYNC_MS = 5 * 60_000;

/**
 * Decides WHEN to sync; the SyncEngine decides HOW and AutoSyncController
 * whether an automatic attempt is worth making (see sync/autoSync.ts).
 * Triggers:
 * - app start (database ready)
 * - connectivity regained
 * - app returns to the foreground
 * - local writes (debounced)
 * - every 5 minutes while in the foreground
 * - retry timers after a transient failure or a server that is not ready
 *
 * Sync only runs with a live session. In 'offline' auth mode (token could not
 * be refreshed at launch) reconnecting first restores the session.
 */
export function useSyncScheduler(): void {
  const { syncEngine, onLocalChange, repositories } = useData();
  const queryClient = useQueryClient();
  const authStatus = useAuthStore((s) => s.status);

  useEffect(() => {
    let disposed = false;
    let isOnline = true;

    const runSync = async () => {
      if (disposed) return;
      if (!isOnline) {
        syncEngine.setOffline();
        controller.markOffline();
        return;
      }
      if (useAuthStore.getState().status === 'offline') {
        await restoreSession(); // re-renders with 'signed_in' if refresh succeeds
        return;
      }
      if (useAuthStore.getState().status !== 'signed_in') return;
      await syncEngine.sync();
    };

    const controller = new AutoSyncController({
      run: () => void runSync(),
      refreshSession: refreshAuthSession,
    });

    // Every finished run, including "Sync now" and pull-to-refresh.
    const unsubscribeRuns = syncEngine.onRunFinished((result) => {
      if (disposed) return;
      controller.record(result.errorCode);
      // Pulled rows change what local queries return.
      if (result.pulled > 0) void queryClient.invalidateQueries();
      // Receipt files upload after their rows have synced; failures retry next run.
      if (result.errorCode === null) {
        void uploadPendingReceipts(repositories.attachments, getSupabase());
      }
    });

    void Network.getNetworkStateAsync().then((state) => {
      if (disposed) return;
      isOnline = Boolean(state.isConnected) && state.isInternetReachable !== false;
      useSyncStore.getState().setOnline(isOnline);
      controller.request('start');
    });

    const networkSub = Network.addNetworkStateListener((state) => {
      const next = Boolean(state.isConnected) && state.isInternetReachable !== false;
      const regained = next && !isOnline;
      isOnline = next;
      useSyncStore.getState().setOnline(next);
      if (regained) controller.request('reconnect');
      if (!next) {
        syncEngine.setOffline();
        controller.markOffline();
      }
    });

    const appStateSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') controller.request('foreground');
    });

    const unsubscribeLocal = onLocalChange(() => {
      void syncEngine.refreshCounts();
      controller.request('local_change');
    });

    const interval = setInterval(() => {
      if (AppState.currentState === 'active') controller.request('interval');
    }, PERIODIC_SYNC_MS);

    return () => {
      disposed = true;
      controller.dispose();
      unsubscribeRuns();
      networkSub.remove();
      appStateSub.remove();
      unsubscribeLocal();
      clearInterval(interval);
    };
  }, [syncEngine, onLocalChange, queryClient, authStatus, repositories]);
}
