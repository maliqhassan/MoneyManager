import { useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import { ErrorState, LoadingState, Screen } from '@/components/ui';
import { deleteUserDatabase, type OpenedDatabase, openUserDatabase } from '@/database/openDatabase';
import type { SqlDatabase } from '@/database/types';
import { newId, nowIso } from '@/lib/ids';
import { createRepositories, type Repositories } from '@/repositories';
import { logger } from '@/services/monitoring/logger';
import { getSupabase } from '@/services/supabase/client';
import { useSyncStore } from '@/stores/syncStore';
import { createSupabaseRemote } from '@/sync/supabaseRemote';
import { queryRootsFor } from './queryDependencies';
import { SyncEngine } from '@/sync/SyncEngine';

export interface DataContextValue {
  db: SqlDatabase;
  repositories: Repositories;
  syncEngine: SyncEngine;
  /** Closes and deletes this user's local database (used on sign-out). */
  destroyLocalData: () => Promise<void>;
  /** Debounced "something changed locally" signal for the sync scheduler. */
  onLocalChange: (listener: () => void) => () => void;
}

type OpenState =
  | { status: 'loading' }
  | { status: 'ready'; opened: OpenedDatabase }
  | { status: 'error'; error: unknown };

/** Exported for tests (renderWithProviders); app code uses DataProvider. */
export const DataContext = createContext<DataContextValue | null>(null);

export function useData(): DataContextValue {
  const value = useContext(DataContext);
  if (!value) throw new Error('useData must be used inside <DataProvider>');
  return value;
}

export function useRepositories(): Repositories {
  return useData().repositories;
}

/**
 * Composition root for a signed-in user: opens their local database, runs
 * migrations, builds repositories and the sync engine. Children render only
 * once the database is ready, so screens can always query locally.
 */
export function DataProvider({ userId, children }: PropsWithChildren<{ userId: string }>) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<OpenState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  // Stable for the provider's lifetime (the provider is keyed by user id).
  const [changeListeners] = useState(() => new Set<() => void>());

  useEffect(() => {
    let cancelled = false;
    let handle: OpenedDatabase | null = null;
    openUserDatabase(userId)
      .then((result) => {
        handle = result;
        if (cancelled) void result.close();
        else setState({ status: 'ready', opened: result });
      })
      .catch((e: unknown) => {
        logger.error('Opening local database failed', e);
        if (!cancelled) setState({ status: 'error', error: e });
      });
    return () => {
      cancelled = true;
      void handle?.close().catch(() => undefined);
    };
  }, [userId, attempt]);

  const retry = () => {
    setState({ status: 'loading' });
    setAttempt((n) => n + 1);
  };

  const notifyChange = useCallback(
    (table: string) => {
      for (const root of queryRootsFor(table)) {
        void queryClient.invalidateQueries({ queryKey: [root] });
      }
      for (const listener of changeListeners) listener();
    },
    [queryClient, changeListeners],
  );

  const opened = state.status === 'ready' ? state.opened : null;

  const value = useMemo<DataContextValue | null>(() => {
    if (!opened) return null;
    const { db } = opened;
    const repositories = createRepositories(db, {
      userId,
      newId,
      now: nowIso,
      onChange: notifyChange,
    });
    const syncEngine = new SyncEngine({
      db,
      remote: createSupabaseRemote(getSupabase(), () => userId),
      newId,
      onError: (message, e) => logger.error(message, e),
    });
    return {
      db,
      repositories,
      syncEngine,
      destroyLocalData: async () => {
        await opened.close();
        await deleteUserDatabase(userId);
        queryClient.clear();
        useSyncStore.getState().reset();
      },
      onLocalChange: (listener) => {
        changeListeners.add(listener);
        return () => changeListeners.delete(listener);
      },
    };
  }, [opened, userId, notifyChange, queryClient, changeListeners]);

  useEffect(() => {
    if (!value) return undefined;
    const unsubscribe = value.syncEngine.subscribe((status) =>
      useSyncStore.getState().apply(status),
    );
    void value.syncEngine.refreshCounts();
    return unsubscribe;
  }, [value]);

  if (state.status === 'error') {
    return (
      <Screen scroll={false} edges={['top', 'bottom']}>
        <ErrorState error={state.error} onRetry={retry} />
      </Screen>
    );
  }
  if (!value) {
    return (
      <Screen scroll={false} edges={['top', 'bottom']}>
        <LoadingState />
      </Screen>
    );
  }
  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}
