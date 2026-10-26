import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import type { ErrorCode } from '@/lib/errors';
import { useAuthStore } from '@/stores/authStore';
import type { SyncRunResult } from '@/sync/types';
import { createTestQueryClient } from '@/test/render';

import { useSyncScheduler } from '../useSyncScheduler';

type NetState = { isConnected: boolean; isInternetReachable: boolean };
let mockNetListener: ((s: NetState) => void) | null = null;
jest.mock('expo-network', () => ({
  getNetworkStateAsync: async () => ({ isConnected: true, isInternetReachable: true }),
  addNetworkStateListener: (l: (s: NetState) => void) => {
    mockNetListener = l;
    return { remove: () => (mockNetListener = null) };
  },
}));
const mockRefresh = jest.fn(async () => false);
jest.mock('@/features/auth/services/authService', () => ({
  restoreSession: jest.fn(async () => undefined),
  refreshAuthSession: () => mockRefresh(),
}));
jest.mock('@/services/receipts/uploader', () => ({ uploadPendingReceipts: jest.fn() }));
jest.mock('@/services/supabase/client', () => ({ getSupabase: () => ({}) }));

/** Engine stand-in: each sync() finishes with the next scripted error code. */
const mockEngine = {
  results: [] as (ErrorCode | null)[],
  runListeners: new Set<(r: SyncRunResult) => void>(),
  sync: jest.fn(async () => {
    const result: SyncRunResult = {
      pushed: 0,
      pulled: 0,
      conflicts: 0,
      failed: 0,
      errorCode: mockEngine.results.shift() ?? null,
    };
    for (const l of mockEngine.runListeners) l(result);
    return result;
  }),
  onRunFinished: (l: (r: SyncRunResult) => void) => {
    mockEngine.runListeners.add(l);
    return () => mockEngine.runListeners.delete(l);
  },
  setOffline: jest.fn(),
  refreshCounts: jest.fn(async () => undefined),
};
let mockLocalChange: (() => void) | null = null;
jest.mock('@/providers/DataProvider', () => ({
  useData: () => ({
    syncEngine: mockEngine,
    repositories: { attachments: {} },
    onLocalChange: (l: () => void) => {
      mockLocalChange = l;
      return () => (mockLocalChange = null);
    },
  }),
}));

describe('useSyncScheduler', () => {
  let appStateListener: ((s: AppStateStatus) => void) | null = null;

  beforeEach(() => {
    jest.useFakeTimers({ now: 1_000_000 });
    jest.spyOn(Math, 'random').mockReturnValue(0.5);
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, l) => {
      appStateListener = l as (s: AppStateStatus) => void;
      return { remove: () => (appStateListener = null) } as ReturnType<
        typeof AppState.addEventListener
      >;
    });
    mockEngine.sync.mockClear();
    mockEngine.setOffline.mockClear();
    mockEngine.results = [];
    mockEngine.runListeners.clear();
    mockRefresh.mockClear();
    useAuthStore.setState({ status: 'signed_in' });
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  const mount = async () => {
    const client = createTestQueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const view = await renderHook(() => useSyncScheduler(), { wrapper });
    await act(async () => undefined); // initial network check
    return view;
  };
  const tick = (ms: number) => act(() => jest.advanceTimersByTimeAsync(ms));

  it('syncs at start, after a local save (debounced), on foreground and on reconnect', async () => {
    await mount();
    expect(mockEngine.sync).toHaveBeenCalledTimes(1);

    await act(async () => {
      mockLocalChange?.();
      mockLocalChange?.();
    });
    await tick(2_000);
    expect(mockEngine.sync).toHaveBeenCalledTimes(2);

    await act(async () => appStateListener?.('active'));
    expect(mockEngine.sync).toHaveBeenCalledTimes(3);

    await act(async () => mockNetListener?.({ isConnected: false, isInternetReachable: false }));
    expect(mockEngine.setOffline).toHaveBeenCalled();
    await act(async () => mockLocalChange?.());
    await tick(5_000);
    expect(mockEngine.sync).toHaveBeenCalledTimes(3); // offline: nothing sent
    await act(async () => mockNetListener?.({ isConnected: true, isInternetReachable: true }));
    expect(mockEngine.sync).toHaveBeenCalledTimes(4);
  });

  it('server not ready: no automatic requests during the cooldown, then probes and resumes', async () => {
    mockEngine.results = ['server_not_ready', 'server_not_ready', null];
    await mount();
    expect(mockEngine.sync).toHaveBeenCalledTimes(1);

    await act(async () => {
      mockLocalChange?.();
      appStateListener?.('active');
      mockNetListener?.({ isConnected: false, isInternetReachable: false });
      mockNetListener?.({ isConnected: true, isInternetReachable: true });
    });
    await tick(2_000);
    expect(mockEngine.sync).toHaveBeenCalledTimes(1);

    await tick(43_000); // first cooldown: 45 s
    expect(mockEngine.sync).toHaveBeenCalledTimes(2);
    await tick(89_999); // second: 90 s
    expect(mockEngine.sync).toHaveBeenCalledTimes(2);
    await tick(1);
    expect(mockEngine.sync).toHaveBeenCalledTimes(3); // server updated → succeeds

    await act(async () => mockLocalChange?.());
    await tick(2_000);
    expect(mockEngine.sync).toHaveBeenCalledTimes(4); // normal sync again
  });

  it('an expired session is refreshed once, then waits instead of retrying in a loop', async () => {
    mockEngine.results = ['unauthorized'];
    await mount();
    expect(mockRefresh).toHaveBeenCalledTimes(1);
    await act(async () => mockLocalChange?.());
    await tick(60 * 60_000);
    expect(mockEngine.sync).toHaveBeenCalledTimes(1);
  });
});
