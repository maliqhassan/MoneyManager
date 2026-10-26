import * as Network from 'expo-network';
import { useEffect } from 'react';

import { useSyncStore } from '@/stores/syncStore';

/**
 * Keeps `isOnline` current without a sync scheduler (local-only use), for
 * features that need the network themselves, such as exchange-rate refresh.
 * With an account, useSyncScheduler tracks connectivity instead.
 */
export function useNetworkStatus(): void {
  useEffect(() => {
    let disposed = false;
    const apply = (state: Network.NetworkState) => {
      if (!disposed) {
        useSyncStore
          .getState()
          .setOnline(Boolean(state.isConnected) && state.isInternetReachable !== false);
      }
    };
    void Network.getNetworkStateAsync().then(apply);
    const sub = Network.addNetworkStateListener(apply);
    return () => {
      disposed = true;
      sub.remove();
    };
  }, []);
}
