import { act, screen } from '@testing-library/react-native';

import type { ErrorCode } from '@/lib/errors';
import { useAuthStore } from '@/stores/authStore';
import { useSyncStore } from '@/stores/syncStore';
import { renderWithProviders } from '@/test/render';

import { SyncServerUpdateNote } from '../components/SyncServerUpdateNote';
import { SyncStatusBanner } from '../components/SyncStatusBanner';
import { SyncStatusLine } from '../components/SyncStatusLine';
import { type SyncDisplayInput, syncDisplayStatus } from '../syncDisplay';

const base: SyncDisplayInput = {
  phase: 'idle',
  pendingCount: 0,
  failedCount: 0,
  lastSyncedAt: '2026-10-25T08:00:00.000Z',
  lastErrorCode: null,
  isOnline: true,
  authStatus: 'signed_in',
};

describe('syncDisplayStatus', () => {
  it.each<[string, Partial<SyncDisplayInput>, ReturnType<typeof syncDisplayStatus>]>([
    ['synced', {}, 'synced'],
    ['syncing', { phase: 'syncing' }, 'syncing'],
    ['pending changes', { pendingCount: 2 }, 'pending'],
    ['never synced yet', { lastSyncedAt: null }, 'pending'],
    ['transient error, retrying', { phase: 'error', lastErrorCode: 'timeout' }, 'pending'],
    ['device offline', { isOnline: false, pendingCount: 3 }, 'offline'],
    ['session offline at launch', { authStatus: 'offline' }, 'offline'],
    ['server unreachable', { phase: 'offline', lastErrorCode: 'network' }, 'offline'],
    ['session rejected', { phase: 'error', lastErrorCode: 'unauthorized' }, 'authRequired'],
    [
      'server schema behind',
      { phase: 'error', lastErrorCode: 'server_not_ready' },
      'serverNotReady',
    ],
    // A retry in progress shows "Syncing…"; the explanation note stays (see below).
    ['probe running', { phase: 'syncing', lastErrorCode: 'server_not_ready' }, 'syncing'],
  ])('%s', (_name, patch, expected) => {
    expect(syncDisplayStatus({ ...base, ...patch })).toBe(expected);
  });
});

describe('SyncStatusLine', () => {
  // Reset before (not after) each test: components are still mounted in afterEach.
  beforeEach(() => {
    useSyncStore.getState().reset();
    useSyncStore.getState().setOnline(true);
  });

  const apply = (patch: Partial<SyncDisplayInput>) =>
    useSyncStore.getState().apply({
      phase: patch.phase ?? 'idle',
      pendingCount: patch.pendingCount ?? 0,
      failedCount: 0,
      conflictCount: 0,
      lastSyncedAt: patch.lastSyncedAt ?? base.lastSyncedAt,
      lastErrorCode: patch.lastErrorCode ?? null,
    });

  it('names each state in plain words', async () => {
    useAuthStore.setState({ status: 'signed_in' });
    apply({});
    await renderWithProviders(<SyncStatusLine />);
    expect(screen.getByText('Up to date')).toBeOnTheScreen();

    await act(async () => apply({ pendingCount: 1 }));
    expect(screen.getByText('Waiting to sync')).toBeOnTheScreen();

    await act(async () => apply({ phase: 'error', lastErrorCode: 'server_not_ready' }));
    expect(screen.getByText('Server update needed')).toBeOnTheScreen();

    await act(async () => apply({ phase: 'error', lastErrorCode: 'unauthorized' }));
    expect(screen.getByText('Sign-in needs renewing')).toBeOnTheScreen();
    expect(screen.getByText(/Your changes are saved on this device/)).toBeOnTheScreen();

    await act(async () => useSyncStore.getState().setOnline(false));
    expect(screen.getByText('Offline — changes are saved on this device')).toBeOnTheScreen();
  });

  it('keeps the server-update explanation visible while a retry runs', async () => {
    useAuthStore.setState({ status: 'signed_in' });
    apply({ phase: 'error', lastErrorCode: 'server_not_ready' });
    await renderWithProviders(
      <>
        <SyncStatusLine />
        <SyncServerUpdateNote />
      </>,
    );
    await act(async () => apply({ phase: 'syncing', lastErrorCode: 'server_not_ready' }));
    expect(screen.getByText('Syncing…')).toBeOnTheScreen();
    expect(
      screen.getByText(/The server needs an update before this version can sync/),
    ).toBeOnTheScreen();
  });
});

describe('SyncStatusBanner', () => {
  beforeEach(() => {
    useSyncStore.getState().reset();
    useSyncStore.getState().setOnline(true);
  });

  const snapshot = (phase: 'idle' | 'syncing' | 'error', lastErrorCode: ErrorCode | null) =>
    useSyncStore.getState().apply({
      phase,
      pendingCount: 1,
      failedCount: 0,
      conflictCount: 0,
      lastSyncedAt: null,
      lastErrorCode,
    });

  it('is hidden while sync works normally', async () => {
    useAuthStore.setState({ status: 'signed_in' });
    snapshot('idle', null);
    await renderWithProviders(<SyncStatusBanner />);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('explains offline, server-update and session states, also during a retry', async () => {
    useAuthStore.setState({ status: 'signed_in' });
    snapshot('error', 'server_not_ready');
    await renderWithProviders(<SyncStatusBanner />);
    expect(screen.getByText(/waiting for a server update/)).toBeOnTheScreen();
    await act(async () => snapshot('syncing', 'server_not_ready'));
    expect(screen.getByText(/waiting for a server update/)).toBeOnTheScreen();
    await act(async () => snapshot('error', 'unauthorized'));
    expect(screen.getByText(/session needs renewing/)).toBeOnTheScreen();
    await act(async () => useSyncStore.getState().setOnline(false));
    expect(screen.getByText(/You’re offline/)).toBeOnTheScreen();
  });
});
