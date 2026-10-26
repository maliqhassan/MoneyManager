import { act, screen } from '@testing-library/react-native';

import type { ErrorCode } from '@/lib/errors';
import { useSyncStore } from '@/stores/syncStore';
import { renderWithProviders } from '@/test/render';

import { SyncServerUpdateNote } from '../components/SyncServerUpdateNote';

const MESSAGE =
  'The server needs an update before this version can sync. Your changes are saved on this device. Try again after the server update.';

const setLastError = (lastErrorCode: ErrorCode | null) =>
  useSyncStore.getState().apply({
    phase: lastErrorCode ? 'error' : 'idle',
    pendingCount: 2,
    failedCount: 0,
    conflictCount: 0,
    lastSyncedAt: null,
    lastErrorCode,
  });

describe('SyncServerUpdateNote', () => {
  afterEach(() => useSyncStore.getState().reset());

  it('explains a sync stopped by an older server schema, without technical details', async () => {
    setLastError('server_not_ready');
    await renderWithProviders(<SyncServerUpdateNote />);
    expect(screen.getByText(MESSAGE)).toBeOnTheScreen();
    expect(screen.getByRole('alert')).toBeOnTheScreen();
    expect(screen.queryByText(/PGRST|schema cache|recurrence_date|server_not_ready/)).toBeNull();
  });

  it.each<ErrorCode | null>([
    null,
    'network',
    'offline',
    'unauthorized',
    'timeout',
    'conflict',
    'unknown',
  ])('is not shown for %s', async (code) => {
    setLastError(code);
    await renderWithProviders(<SyncServerUpdateNote />);
    expect(screen.queryByText(MESSAGE)).toBeNull();
  });

  it('disappears once a later sync succeeds', async () => {
    setLastError('server_not_ready');
    await renderWithProviders(<SyncServerUpdateNote />);
    expect(screen.getByText(MESSAGE)).toBeOnTheScreen();
    await act(async () => setLastError(null));
    expect(screen.queryByText(MESSAGE)).toBeNull();
  });
});
