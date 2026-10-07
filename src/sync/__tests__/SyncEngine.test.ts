import { SqliteAccountRepository } from '@/repositories/sqlite/SqliteAccountRepository';
import { FakeRemote } from '@/test/fakeRemote';
import { createTestContext, sequentialIds, TEST_USER_ID } from '@/test/factories';
import { createMigratedTestDatabase, type TestDatabase } from '@/test/nodeSqliteDatabase';

import { nextBackoffMs } from '../outbox';
import { SyncEngine } from '../SyncEngine';

const account = {
  name: 'Wallet',
  type: 'cash',
  currency: 'GBP',
  openingBalanceMinor: 2_000,
  openingBalanceDate: '2026-10-01',
} as const;

describe('SyncEngine', () => {
  let db: TestDatabase;
  let remote: FakeRemote;
  let repo: SqliteAccountRepository;
  let engine: SyncEngine;
  let clock: number;

  const outboxCount = async () =>
    (await db.getFirst<{ n: number }>('SELECT COUNT(*) AS n FROM sync_outbox'))?.n ?? 0;
  const localRow = (id: string) =>
    db.getFirst<{ version: number; sync_status: string; name: string; is_archived: number }>(
      'SELECT version, sync_status, name, is_archived FROM accounts WHERE id = ?',
      [id],
    );

  beforeEach(async () => {
    db = await createMigratedTestDatabase();
    remote = new FakeRemote();
    repo = new SqliteAccountRepository(db, createTestContext());
    clock = Date.parse('2026-10-07T12:00:00.000Z');
    engine = new SyncEngine({
      db,
      remote,
      newId: sequentialIds(),
      now: () => new Date(clock),
    });
  });

  afterEach(() => db.close());

  it('pushes new rows with converted types and marks them synced', async () => {
    const a = await repo.create(account);
    const result = await engine.sync();

    expect(result).toMatchObject({ pushed: 1, conflicts: 0, failed: 0, errorCode: null });
    const server = remote.tables.get('accounts')?.get(a.id);
    expect(server).toMatchObject({
      user_id: TEST_USER_ID,
      name: 'Wallet',
      is_archived: false,
      include_in_totals: true,
      version: 1,
    });
    expect(server).not.toHaveProperty('sync_status');
    expect(await localRow(a.id)).toMatchObject({ version: 1, sync_status: 'synced' });
    expect(await outboxCount()).toBe(0);
    expect(engine.getStatus()).toMatchObject({ phase: 'idle', pendingCount: 0 });
  });

  it('pushes updates using optimistic concurrency', async () => {
    const a = await repo.create(account);
    await engine.sync();
    await repo.update(a.id, { name: 'Pocket cash' });
    await engine.sync();
    expect(remote.tables.get('accounts')?.get(a.id)).toMatchObject({
      name: 'Pocket cash',
      version: 2,
    });
    expect(await localRow(a.id)).toMatchObject({ version: 2, sync_status: 'synced' });
  });

  it('is idempotent when a write lands but the response is lost', async () => {
    const a = await repo.create(account);
    remote.loseNextResponse = true;

    const first = await engine.sync();
    expect(first.errorCode).toBe('network');
    expect(engine.getStatus().phase).toBe('offline');
    expect(await outboxCount()).toBe(1);

    const second = await engine.sync();
    expect(second).toMatchObject({ pushed: 1, conflicts: 0 });
    expect(remote.tables.get('accounts')?.size).toBe(1);
    expect(await localRow(a.id)).toMatchObject({ sync_status: 'synced' });
  });

  it('records a conflict when another device changed the row, keeping the server copy', async () => {
    const a = await repo.create(account);
    await engine.sync();
    remote.serverWrite('accounts', {
      ...remote.tables.get('accounts')!.get(a.id)!,
      name: 'Remote',
    });
    await repo.update(a.id, { name: 'Local' });

    const result = await engine.sync();
    expect(result.conflicts).toBe(1);
    expect(await localRow(a.id)).toMatchObject({ name: 'Remote', sync_status: 'conflict' });
    const conflicts = await db.getAll<{ local_payload: string; reason: string }>(
      'SELECT local_payload, reason FROM sync_conflicts',
    );
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.reason).toBe('version_mismatch');
    expect(JSON.parse(conflicts[0]!.local_payload)).toMatchObject({ name: 'Local' });
    expect(engine.getStatus().conflictCount).toBe(1);
  });

  it('can be configured to keep the local copy on conflict', async () => {
    engine = new SyncEngine({
      db,
      remote,
      newId: sequentialIds(),
      now: () => new Date(clock),
      resolveConflict: () => 'keep_local',
    });
    const a = await repo.create(account);
    await engine.sync();
    remote.serverWrite('accounts', {
      ...remote.tables.get('accounts')!.get(a.id)!,
      name: 'Remote',
    });
    await repo.update(a.id, { name: 'Local' });
    await engine.sync();
    expect(remote.tables.get('accounts')?.get(a.id)?.name).toBe('Local');
    expect(await localRow(a.id)).toMatchObject({ name: 'Local', sync_status: 'synced' });
  });

  it('pulls remote changes and advances the cursor', async () => {
    remote.serverWrite('accounts', {
      id: 'remote-1',
      user_id: TEST_USER_ID,
      created_at: '2026-10-01T00:00:00Z',
      deleted_at: null,
      name: 'From phone',
      type: 'savings',
      currency: 'EUR',
      opening_balance_minor: 100,
      opening_balance_date: '2026-10-01',
      include_in_totals: true,
      is_archived: true,
      sort_order: 0,
      server_only_column: 'ignored',
    });
    const result = await engine.sync();
    expect(result.pulled).toBe(1);
    expect(await localRow('remote-1')).toMatchObject({
      name: 'From phone',
      is_archived: 1,
      sync_status: 'synced',
      version: 1,
    });

    // Second sync re-reads the overlap window but applies nothing new.
    expect((await engine.sync()).pulled).toBe(0);
    const cursor = await db.getFirst<{ last_id: string }>(
      `SELECT last_id FROM sync_cursors WHERE entity = 'accounts'`,
    );
    expect(cursor?.last_id).toBe('remote-1');
  });

  it('never overwrites a row with unsent local edits during pull', async () => {
    const a = await repo.create(account);
    await engine.sync();
    await repo.update(a.id, { name: 'Unsent local edit' });
    remote.serverWrite('accounts', {
      ...remote.tables.get('accounts')!.get(a.id)!,
      name: 'Remote',
    });
    remote.failNextWrites = { count: 1, error: { status: 503, message: 'down' } };

    await engine.sync(); // push fails (retryable) → row still pending → pull must skip it
    expect(await localRow(a.id)).toMatchObject({
      name: 'Unsent local edit',
      sync_status: 'pending',
    });
  });

  it('backs off retryable errors and parks permanent failures', async () => {
    await repo.create(account);
    remote.failNextWrites = { count: 10, error: { code: '23514', message: 'check violation' } };

    for (let i = 0; i < 5; i += 1) {
      await engine.sync();
      clock += 60 * 60_000; // jump past any backoff
    }
    const entry = await db.getFirst<{ status: string; attempts: number; last_error: string }>(
      'SELECT status, attempts, last_error FROM sync_outbox',
    );
    expect(entry).toMatchObject({ status: 'failed', attempts: 5, last_error: 'validation' });
    expect(engine.getStatus().failedCount).toBe(1);
  });

  it('halts on network errors without consuming attempts', async () => {
    await repo.create(account);
    remote.failNextWrites = {
      count: 1,
      error: Object.assign(new Error('fetch failed'), { name: 'AuthRetryableFetchError' }),
    };
    const result = await engine.sync();
    expect(result.errorCode).toBe('network');
    const entry = await db.getFirst<{ status: string; attempts: number }>(
      'SELECT status, attempts FROM sync_outbox',
    );
    expect(entry).toEqual({ status: 'pending', attempts: 0 });
  });

  it('merges concurrent sync calls into a single run', async () => {
    await repo.create(account);
    const [r1, r2] = await Promise.all([engine.sync(), engine.sync()]);
    expect(r1).toBe(r2);
    expect(remote.calls.filter((c) => c.startsWith('insert'))).toHaveLength(1);
  });

  it('computes bounded exponential backoff', () => {
    expect(nextBackoffMs(0, () => 1)).toBe(5_000);
    expect(nextBackoffMs(3, () => 1)).toBe(40_000);
    expect(nextBackoffMs(20, () => 1)).toBe(30 * 60_000);
    expect(nextBackoffMs(3, () => 0)).toBe(20_000);
  });
});
