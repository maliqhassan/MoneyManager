import { createRepositories, type Repositories } from '@/repositories';
import { AppError, toAppError } from '@/lib/errors';
import { runHasSettled, useSyncStore } from '@/stores/syncStore';
import { SyncEngine } from '@/sync/SyncEngine';
import { FakeRemote } from '@/test/fakeRemote';
import { createTestContext, sequentialIds, TEST_USER_ID } from '@/test/factories';
import { createMigratedTestDatabase, type TestDatabase } from '@/test/nodeSqliteDatabase';

import { completeOnboarding } from '../completeOnboarding';
import { type OnboardingDraft, resolveAppGate } from '../model';

/**
 * Onboarding completion against the REAL sync engine and local database.
 * The remote fails exactly the way Supabase does in each situation (missing
 * tables → PostgREST PGRST205/404, expired session → 401, no network →
 * fetch TypeError); success only happens when the server really has the row.
 */

const draft: OnboardingDraft = {
  currency: 'PKR',
  region: 'PK',
  language: 'en',
  timeZone: 'Asia/Karachi',
  firstDayOfWeek: 1,
  dateFormat: 'locale',
  numberFormat: 'locale',
};
const NOW = '2026-10-09T08:00:00.000Z';

/** The preferences row exactly as the server's sign-up initialization creates it. */
function serverCreatesPreferences(remote: FakeRemote) {
  remote.serverWrite('user_preferences', {
    id: TEST_USER_ID,
    user_id: TEST_USER_ID,
    created_at: '2026-10-08T10:00:00Z',
    deleted_at: null,
    base_currency: 'USD',
    locale: 'en-US',
    time_zone: 'UTC',
    first_day_of_week: 1,
    month_start_day: 1,
    onboarding_completed_at: null,
    date_format: 'locale',
    number_format: 'locale',
    language: 'en',
    region: null,
  });
}

describe('onboarding completion with sync', () => {
  let db: TestDatabase;
  let remote: FakeRemote;
  let engine: SyncEngine;
  let repos: Repositories;

  const complete = (timeoutMs?: number) =>
    completeOnboarding(
      { preferences: repos.preferences, sync: () => engine.sync(), timeoutMs },
      draft,
      NOW,
    );
  const outbox = () =>
    db.getAll<{ entity: string; status: string; attempts: number }>(
      `SELECT entity, status, attempts FROM sync_outbox ORDER BY rowid`,
    );
  const createFirstAccount = () =>
    repos.accounts.create({
      name: 'Malik',
      type: 'cash',
      currency: 'PKR',
      openingBalanceMinor: 500_000,
      openingBalanceDate: '2026-10-08',
    });

  beforeEach(async () => {
    db = await createMigratedTestDatabase();
    repos = createRepositories(db, createTestContext());
    remote = new FakeRemote();
    engine = new SyncEngine({ db, remote, newId: sequentialIds() });
  });
  afterEach(() => db.close());

  it('completes, keeps the first account and lets the gate open Home', async () => {
    serverCreatesPreferences(remote);
    const account = await createFirstAccount();
    await complete();
    const prefs = await repos.preferences.get();
    expect(prefs).toMatchObject({ baseCurrency: 'PKR', region: 'PK', onboardingCompletedAt: NOW });
    expect(
      resolveAppGate({
        preferencesLoading: false,
        preferences: prefs,
        canSyncNow: true,
        firstSyncSettled: true,
      }),
    ).toBe('ready');
    // The account was pushed by the same sync and the completion is queued.
    expect(remote.tables.get('accounts')?.get(account.id)).toMatchObject({ name: 'Malik' });
    expect(await engine.sync()).toMatchObject({ errorCode: null, conflicts: 0 });
    expect(remote.tables.get('user_preferences')?.get(TEST_USER_ID)).toMatchObject({
      base_currency: 'PKR',
      onboarding_completed_at: NOW,
    });
  });

  it('reports a not-ready server (missing tables) without losing or parking local data', async () => {
    remote.outage = 'schema_missing';
    const account = await createFirstAccount();
    await expect(complete()).rejects.toMatchObject({ code: 'server_not_ready' });
    // Many more attempts must not park the account as permanently failed.
    for (let i = 0; i < 6; i += 1) {
      expect((await engine.sync()).errorCode).toBe('server_not_ready');
    }
    expect(await outbox()).toEqual([{ entity: 'accounts', status: 'pending', attempts: 0 }]);
    expect(await repos.accounts.getById(account.id)).toMatchObject({ name: 'Malik' });
    expect(await repos.preferences.get()).toBeNull(); // nothing pretends to be synced
  });

  it('retries successfully once the server is set up, without duplicates', async () => {
    remote.outage = 'schema_missing';
    const account = await createFirstAccount();
    await expect(complete()).rejects.toMatchObject({ code: 'server_not_ready' });
    await expect(complete()).rejects.toMatchObject({ code: 'server_not_ready' });

    remote.outage = null;
    serverCreatesPreferences(remote);
    await complete();
    await complete(); // repeated tap after success: idempotent
    expect(await engine.sync()).toMatchObject({ errorCode: null });
    expect([...(remote.tables.get('accounts')?.keys() ?? [])]).toEqual([account.id]);
    expect(remote.tables.get('user_preferences')?.size).toBe(1);
    expect(await outbox()).toEqual([]);
  });

  it('requeues records parked as failed by the old missing-table handling', async () => {
    const account = await createFirstAccount();
    await db.run(
      `UPDATE sync_outbox SET status = 'failed', attempts = 5, last_error = 'not_found'`,
    );
    serverCreatesPreferences(remote);
    await complete();
    expect(remote.tables.get('accounts')?.has(account.id)).toBe(true);
  });

  it('keeps the draft and data when the network is unavailable', async () => {
    remote.outage = 'offline';
    await createFirstAccount();
    await expect(complete()).rejects.toMatchObject({ code: 'offline' });
    expect(await outbox()).toEqual([{ entity: 'accounts', status: 'pending', attempts: 0 }]);
  });

  it('asks to sign in again when the session has expired', async () => {
    remote.outage = 'unauthorized';
    await expect(complete()).rejects.toMatchObject({ code: 'unauthorized' });
  });

  it('never waits forever: a stalled sync times out and can be retried', async () => {
    const stalled = { sync: () => new Promise<{ errorCode: null }>(() => undefined) };
    await expect(
      completeOnboarding({ preferences: repos.preferences, ...stalled, timeoutMs: 20 }, draft, NOW),
    ).rejects.toMatchObject({ code: 'timeout' });
  });

  it('survives an app restart after completion', async () => {
    serverCreatesPreferences(remote);
    await complete();
    // New repository/engine instances on the same database = app relaunch.
    const relaunched = createRepositories(db, createTestContext());
    const prefs = await relaunched.preferences.get();
    expect(prefs?.onboardingCompletedAt).toBe(NOW);
    expect(
      resolveAppGate({
        preferencesLoading: false,
        preferences: prefs,
        canSyncNow: false,
        firstSyncSettled: false,
      }),
    ).toBe('ready'); // works offline after restart
  });
});

describe('sync status latch (no loading-screen flip during onboarding)', () => {
  beforeEach(() => useSyncStore.getState().reset());

  const snapshot = (patch: Partial<ReturnType<typeof useSyncStore.getState>>) => ({
    phase: 'idle' as const,
    pendingCount: 0,
    failedCount: 0,
    conflictCount: 0,
    lastSyncedAt: null,
    lastErrorCode: null,
    ...patch,
  });

  it('stays settled when a new sync starts after a failed one', () => {
    const store = useSyncStore.getState();
    expect(useSyncStore.getState().hasSettled).toBe(false);
    store.apply(snapshot({ phase: 'syncing' }));
    expect(useSyncStore.getState().hasSettled).toBe(false);
    store.apply(snapshot({ phase: 'error', lastErrorCode: 'server_not_ready' }));
    expect(useSyncStore.getState().hasSettled).toBe(true);
    // Tapping "Start" begins another sync: the gate must keep showing onboarding.
    store.apply(snapshot({ phase: 'syncing' }));
    const { hasSettled } = useSyncStore.getState();
    expect(hasSettled).toBe(true);
    expect(
      resolveAppGate({
        preferencesLoading: false,
        preferences: null,
        canSyncNow: true,
        firstSyncSettled: hasSettled,
      }),
    ).toBe('onboarding');
    useSyncStore.getState().reset();
    expect(useSyncStore.getState().hasSettled).toBe(false);
  });

  it('recognises every way a run can finish', () => {
    expect(runHasSettled(snapshot({ lastSyncedAt: NOW }))).toBe(true);
    expect(runHasSettled(snapshot({ phase: 'offline' }))).toBe(true);
    expect(runHasSettled(snapshot({ lastErrorCode: 'network' }))).toBe(true);
    expect(runHasSettled(snapshot({ phase: 'syncing' }))).toBe(false);
  });
});

describe('server-not-ready error classification', () => {
  it.each([
    ['PGRST205', 404],
    ['PGRST204', 400],
    ['PGRST202', 404],
    ['42P01', undefined],
    ['42703', undefined],
  ])('maps %s to server_not_ready (retryable, not a record failure)', (code, status) => {
    const error = toAppError({ code, status, message: 'schema' });
    expect(error).toMatchObject({ code: 'server_not_ready', retryable: true });
  });

  it('leaves genuine not-found and permission errors alone', () => {
    expect(toAppError({ code: 'PGRST116', status: 406, message: 'x' }).code).toBe('not_found');
    expect(toAppError({ code: '42501', status: 403, message: 'x' }).code).toBe('forbidden');
    expect(toAppError(new AppError('server_not_ready', 'x')).code).toBe('server_not_ready');
  });
});
