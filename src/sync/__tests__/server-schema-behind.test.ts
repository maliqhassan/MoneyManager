import type { SyncTableName } from '@/sync/registry';
import { SyncEngine } from '@/sync/SyncEngine';
import { FakeRemote } from '@/test/fakeRemote';
import { sequentialIds } from '@/test/factories';
import { createAccount, createLedger, type Ledger, TZ } from '@/test/ledger';

/**
 * A Phase 7 device talking to a server that does NOT have migration
 * 20261019090000_recurring_rules yet (the live state). The remote rejects
 * requests exactly as PostgREST does: unknown columns → PGRST204, unknown
 * table → PGRST205 (both classified as `server_not_ready`).
 */
class SchemaBehindRemote extends FakeRemote {
  migrated = false;
  readonly attemptedColumns: Record<string, string[]> = {};
  private static readonly MISSING_COLUMNS: Partial<Record<SyncTableName, string[]>> = {
    transactions: ['recurrence_date'],
    recurring_transactions: ['status', 'active_from', 'reminder_days_before', 'tag_names'],
  };

  private guard(table: SyncTableName, row?: Record<string, unknown>) {
    if (this.migrated) return;
    if (table === 'recurring_occurrences') {
      throw Object.assign(
        new Error("Could not find the table 'public.recurring_occurrences' in the schema cache"),
        { code: 'PGRST205', status: 404 },
      );
    }
    const unknown = (SchemaBehindRemote.MISSING_COLUMNS[table] ?? []).find((c) => row && c in row);
    if (unknown) {
      throw Object.assign(
        new Error(`Could not find the '${unknown}' column of '${table}' in the schema cache`),
        { code: 'PGRST204', status: 400 },
      );
    }
  }

  override async insert(table: SyncTableName, row: Record<string, unknown>) {
    this.attemptedColumns[table] = Object.keys(row);
    this.guard(table, row);
    return super.insert(table, row);
  }

  override async updateIfVersion(
    table: SyncTableName,
    id: string,
    row: Record<string, unknown>,
    expectedVersion: number,
  ) {
    this.guard(table, row);
    return super.updateIfVersion(table, id, row, expectedVersion);
  }

  override async fetchChanges(...args: Parameters<FakeRemote['fetchChanges']>) {
    this.guard(args[0]);
    return super.fetchChanges(...args);
  }
}

describe('sync while the server is one migration behind (live state before Phase 7 deploy)', () => {
  let L: Ledger;
  let remote: SchemaBehindRemote;
  let engine: SyncEngine;

  beforeEach(async () => {
    L = await createLedger();
    remote = new SchemaBehindRemote();
    engine = new SyncEngine({ db: L.db, remote, newId: sequentialIds() });
  });
  afterEach(() => L.db.close());

  const outbox = () =>
    L.db.getAll<{ entity: string; status: string; last_error: string | null }>(
      `SELECT entity, status, last_error FROM sync_outbox ORDER BY rowid`,
    );

  it('an ordinary expense is sent with recurrence_date, rejected, and halts the whole run — nothing is lost', async () => {
    const chk = await createAccount(L);
    await L.repos.transactions.create({
      type: 'expense',
      accountId: chk.id,
      amountMinor: 1_250,
      localDate: '2026-10-20',
      localTime: '09:00',
      timeZone: TZ,
      categoryId: L.cat.groceries,
    });

    const first = await engine.sync(); // what "Sync now" calls
    expect(first.errorCode).toBe('server_not_ready');
    // The payload of a plain expense carries the Phase 7 column (as null).
    expect(remote.attemptedColumns.transactions).toContain('recurrence_date');
    // The account (no new columns) went through; the transaction did not.
    expect(remote.tables.get('accounts')?.size).toBe(1);
    expect(remote.tables.get('transactions')?.size ?? 0).toBe(0);
    expect(engine.getStatus()).toMatchObject({
      phase: 'error',
      lastErrorCode: 'server_not_ready',
      lastSyncedAt: null,
      failedCount: 0,
    });
    // The change is kept, pending (not parked as failed).
    expect(await outbox()).toEqual([
      expect.objectContaining({ entity: 'transactions', status: 'pending' }),
    ]);

    // Tapping again does run again, and fails the same way; still nothing lost.
    const second = await engine.sync();
    expect(second.errorCode).toBe('server_not_ready');
    expect(engine.getStatus().pendingCount).toBeGreaterThan(0);
    expect((await outbox()).map((o) => o.status)).toEqual(['pending']);
  });

  it('with nothing queued, the pull still stops at the missing recurring_occurrences table', async () => {
    remote.serverWrite('accounts', {
      id: 'acc-remote',
      user_id: L.ctx.userId,
      created_at: '2026-10-01T00:00:00Z',
      deleted_at: null,
      name: 'From another device',
      type: 'checking',
      currency: 'USD',
      opening_balance_minor: 0,
      opening_balance_date: '2026-10-01',
      include_in_totals: true,
      is_archived: false,
    });
    const result = await engine.sync();
    expect(result.errorCode).toBe('server_not_ready');
    // Tables pulled before the failing one were applied; the run never completes.
    expect(await L.db.getFirst(`SELECT name FROM accounts WHERE id = 'acc-remote'`)).toEqual({
      name: 'From another device',
    });
    expect(engine.getStatus()).toMatchObject({ phase: 'error', lastSyncedAt: null });
  });

  it('once the server has the migration, the same queue syncs normally', async () => {
    const chk = await createAccount(L);
    await L.repos.transactions.create({
      type: 'expense',
      accountId: chk.id,
      amountMinor: 1_250,
      localDate: '2026-10-20',
      localTime: '09:00',
      timeZone: TZ,
      categoryId: L.cat.groceries,
    });
    expect((await engine.sync()).errorCode).toBe('server_not_ready');

    remote.migrated = true; // migration applied on the server
    const result = await engine.sync();
    expect(result.errorCode).toBeNull();
    expect(remote.tables.get('transactions')?.size).toBe(1);
    expect(await outbox()).toEqual([]);
    expect(engine.getStatus()).toMatchObject({ phase: 'idle', pendingCount: 0 });
    expect(engine.getStatus().lastSyncedAt).not.toBeNull();
  });
});
