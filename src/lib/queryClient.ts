import { focusManager, onlineManager, QueryClient } from '@tanstack/react-query';
import * as Network from 'expo-network';
import { AppState } from 'react-native';

import { toAppError } from './errors';

/**
 * TanStack Query manages async state for both local (SQLite) and remote
 * (Supabase) reads.
 *
 * networkMode 'always' is the default because most queries read the local
 * database and must keep working offline. Queries that need the network opt
 * into `networkMode: 'online'` explicitly.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        networkMode: 'always',
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        retry: (failureCount, error) => failureCount < 2 && toAppError(error).retryable,
        refetchOnWindowFocus: false,
      },
      mutations: {
        networkMode: 'always',
        retry: false,
      },
    },
  });
}

let wired = false;

/** Connects TanStack Query's online/focus managers to React Native. */
export function wireQueryManagers(): void {
  if (wired) return;
  wired = true;

  onlineManager.setEventListener((setOnline) => {
    const sub = Network.addNetworkStateListener((state) => {
      setOnline(Boolean(state.isConnected) && state.isInternetReachable !== false);
    });
    return () => sub.remove();
  });

  focusManager.setEventListener((setFocused) => {
    const sub = AppState.addEventListener('change', (status) => setFocused(status === 'active'));
    return () => sub.remove();
  });
}

/** Query-key roots. Keys start with the table name so writes can invalidate by table. */
export const queryKeys = {
  accounts: {
    all: ['accounts'] as const,
    list: (includeArchived: boolean) => ['accounts', 'list', { includeArchived }] as const,
    balances: () => ['accounts', 'balances'] as const,
  },
  preferences: {
    current: () => ['user_preferences'] as const,
  },
} as const;
