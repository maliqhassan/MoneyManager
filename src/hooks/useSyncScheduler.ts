import { useQueryClient } from '@tanstack/react-query';
import * as Network from 'expo-network';
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import { restoreSession } from '@/features/auth/services/authService';
import { useData } from '@/providers/DataProvider';
import { uploadPendingReceipts } from '@/services/receipts/uploader';
import { getSupabase } from '@/services/supabase/client';
import { useAuthStore } from '@/stores/authStore';
import { useSyncStore } from '@/stores/syncStore';

const LOCAL_CHANGE_DEBOUNCE_MS = 2_000;
const PERIODIC_SYNC_MS = 5 * 60_000;

/**
 * Decides WHEN to sync; the SyncEngine decides HOW. Triggers:
 * - app start (database ready)
 * - connectivity regained
 * - app returns to the foreground
 * - local writes (debounced)
 * - every 5 minutes while in the foreground
 *
 * Sync only runs with a live session. In 'offline' auth mode (token could not
 * be refreshed at launch) reconnecting first restores the session.
 */
export function useSyncScheduler(): void {
  const { syncEngine, onLocalChange, repositories } = useData();
  const queryClient = useQueryClient();
  const authStatus = useAuthStore((s) => s.status);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let disposed = false;
    let isOnline = true;

    const runSync = async () => {
      if (disposed) return;
      if (!isOnline) {
        syncEngine.setOffline();
        return;
      }
      if (useAuthStore.getState().status === 'offline') {
        await restoreSession(); // re-renders with 'signed_in' if refresh succeeds
        return;
      }
      if (useAuthStore.getState().status !== 'signed_in') return;
      const result = await syncEngine.sync();
      // Pulled rows change what local queries return.
      if (result.pulled > 0 && !disposed) void queryClient.invalidateQueries();
      // Receipt files upload after their rows have synced; failures retry next run.
      if (result.errorCode === null && !disposed) {
        void uploadPendingReceipts(repositories.attachments, getSupabase());
      }
    };

    const scheduleSoon = () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      debounceTimer.current = setTimeout(() => void runSync(), LOCAL_CHANGE_DEBOUNCE_MS);
    };

    void Network.getNetworkStateAsync().then((state) => {
      isOnline = Boolean(state.isConnected) && state.isInternetReachable !== false;
      useSyncStore.getState().setOnline(isOnline);
      void runSync();
    });

    const networkSub = Network.addNetworkStateListener((state) => {
      const next = Boolean(state.isConnected) && state.isInternetReachable !== false;
      const regained = next && !isOnline;
      isOnline = next;
      useSyncStore.getState().setOnline(next);
      if (regained) void runSync();
      if (!next) syncEngine.setOffline();
    });

    const appStateSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void runSync();
    });

    const unsubscribeLocal = onLocalChange(() => {
      void syncEngine.refreshCounts();
      scheduleSoon();
    });

    const interval = setInterval(() => {
      if (AppState.currentState === 'active') void runSync();
    }, PERIODIC_SYNC_MS);

    return () => {
      disposed = true;
      networkSub.remove();
      appStateSub.remove();
      unsubscribeLocal();
      clearInterval(interval);
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [syncEngine, onLocalChange, queryClient, authStatus, repositories]);
}
