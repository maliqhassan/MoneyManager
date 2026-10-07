import type { SqlDatabase } from '@/database/types';
import { toAppError, type ErrorCode } from '@/lib/errors';

import { type LocalRow, toLocalValues, toRemotePayload } from './mapping';
import {
  countByStatus,
  getDueEntries,
  hasPendingChanges,
  nextBackoffMs,
  resetInFlight,
} from './outbox';
import { SYNC_TABLES, type SyncTableName } from './registry';
import type {
  ChangeCursor,
  ConflictResolver,
  OutboxEntry,
  RemoteDataSource,
  RemoteRow,
  RemoteWriteAck,
  SyncRunResult,
  SyncStatusSnapshot,
} from './types';

export interface SyncEngineOptions {
  db: SqlDatabase;
  remote: RemoteDataSource;
  /** Generates ids for conflict records. */
  newId: () => string;
  now?: () => Date;
  /** Default: the server copy wins; the local copy is preserved in sync_conflicts. */
  resolveConflict?: ConflictResolver;
  pushBatchSize?: number;
  pullPageSize?: number;
  /** Re-read this much history on each pull to catch late-committing server transactions. */
  pullOverlapMs?: number;
  /** Attempts before a non-retryable failure is parked as 'failed'. */
  maxAttempts?: number;
  onError?: (message: string, error: unknown) => void;
}

const keepRemote: ConflictResolver = () => 'keep_remote';

/** Errors that mean "stop syncing now" rather than "this record failed". */
const HALTING_ERRORS: ReadonlySet<ErrorCode> = new Set([
  'network',
  'offline',
  'timeout',
  'unauthorized',
]);

class HaltSyncError extends Error {
  constructor(readonly code: ErrorCode) {
    super(`Sync halted: ${code}`);
  }
}

/**
 * Bidirectional sync between local SQLite and the remote store.
 *
 * Guarantees:
 * - single flight: concurrent `sync()` calls share one run;
 * - idempotent push: each outbox entry has a mutation id stored server-side,
 *   so a retried write that already landed is recognised, not duplicated;
 * - optimistic concurrency: updates apply only if the server version matches
 *   the version the local edit was based on; otherwise a conflict is recorded;
 * - local edits are never overwritten by pull while they are unsent.
 */
export class SyncEngine {
  private readonly db: SqlDatabase;
  private readonly remote: RemoteDataSource;
  private readonly newId: () => string;
  private readonly now: () => Date;
  private readonly resolveConflict: ConflictResolver;
  private readonly pushBatchSize: number;
  private readonly pullPageSize: number;
  private readonly pullOverlapMs: number;
  private readonly maxAttempts: number;
  private readonly onError: (message: string, error: unknown) => void;

  private running: Promise<SyncRunResult> | null = null;
  private columnCache = new Map<string, ReadonlySet<string>>();
  private listeners = new Set<(status: SyncStatusSnapshot) => void>();
  private status: SyncStatusSnapshot = {
    phase: 'idle',
    pendingCount: 0,
    failedCount: 0,
    conflictCount: 0,
    lastSyncedAt: null,
    lastErrorCode: null,
  };

  constructor(options: SyncEngineOptions) {
    this.db = options.db;
    this.remote = options.remote;
    this.newId = options.newId;
    this.now = options.now ?? (() => new Date());
    this.resolveConflict = options.resolveConflict ?? keepRemote;
    this.pushBatchSize = options.pushBatchSize ?? 50;
    this.pullPageSize = options.pullPageSize ?? 500;
    this.pullOverlapMs = options.pullOverlapMs ?? 2 * 60_000;
    this.maxAttempts = options.maxAttempts ?? 5;
    this.onError = options.onError ?? (() => undefined);
  }

  getStatus(): SyncStatusSnapshot {
    return this.status;
  }

  subscribe(listener: (status: SyncStatusSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Marks the engine offline without attempting network calls. */
  setOffline(): void {
    this.updateStatus({ phase: 'offline' });
  }

  /** Runs push then pull. Safe to call often; overlapping calls are merged. */
  sync(): Promise<SyncRunResult> {
    if (!this.running) {
      this.running = this.run().finally(() => {
        this.running = null;
      });
    }
    return this.running;
  }

  /** Recomputes queue counters (e.g. after a local write). */
  async refreshCounts(): Promise<void> {
    const counts = await countByStatus(this.db);
    const conflicts = await this.db.getFirst<{ n: number }>(
      `SELECT COUNT(*) AS n FROM sync_conflicts WHERE resolved_at IS NULL`,
    );
    this.updateStatus({
      pendingCount: counts.pending + counts.in_flight,
      failedCount: counts.failed,
      conflictCount: conflicts?.n ?? 0,
    });
  }

  private async run(): Promise<SyncRunResult> {
    const result: SyncRunResult = {
      pushed: 0,
      pulled: 0,
      conflicts: 0,
      failed: 0,
      errorCode: null,
    };
    this.updateStatus({ phase: 'syncing', lastErrorCode: null });
    try {
      await resetInFlight(this.db, this.nowIso());
      await this.push(result);
      result.pulled = await this.pull();
      this.updateStatus({ phase: 'idle', lastSyncedAt: this.nowIso() });
    } catch (error) {
      const code = error instanceof HaltSyncError ? error.code : toAppError(error).code;
      result.errorCode = code;
      if (!(error instanceof HaltSyncError)) this.onError('Sync run failed', error);
      this.updateStatus({
        phase: code === 'network' || code === 'offline' ? 'offline' : 'error',
        lastErrorCode: code,
      });
    } finally {
      await this.refreshCounts().catch((e: unknown) => this.onError('Sync count failed', e));
    }
    return result;
  }

  // ---------------------------------------------------------------- push ----

  private async push(result: SyncRunResult): Promise<void> {
    for (;;) {
      const entries = await getDueEntries(this.db, this.nowIso(), this.pushBatchSize);
      if (entries.length === 0) return;
      for (const entry of entries) {
        const outcome = await this.pushEntry(entry);
        if (outcome === 'pushed') result.pushed += 1;
        else if (outcome === 'conflict') result.conflicts += 1;
        else if (outcome === 'failed') result.failed += 1;
      }
      if (entries.length < this.pushBatchSize) return;
    }
  }

  private async pushEntry(entry: OutboxEntry): Promise<'pushed' | 'conflict' | 'failed' | 'retry'> {
    const row = await this.db.transaction(async (tx) => {
      const local = await tx.getFirst<LocalRow>(`SELECT * FROM ${entry.entity} WHERE id = ?`, [
        entry.entityId,
      ]);
      if (!local) {
        await tx.run(`DELETE FROM sync_outbox WHERE id = ?`, [entry.id]);
        return null;
      }
      await tx.run(
        `UPDATE sync_outbox SET status = 'in_flight', attempts = attempts + 1, updated_at = ? WHERE id = ?`,
        [this.nowIso(), entry.id],
      );
      return local;
    });
    if (!row) return 'pushed';

    try {
      const ack = await this.sendRow(entry, row);
      if (ack === 'conflict') return 'conflict';
      await this.completeEntry(entry, ack);
      return 'pushed';
    } catch (error) {
      return this.handlePushError(entry, error);
    }
  }

  /** Sends one row; returns the server ack or 'conflict' once a conflict was recorded. */
  private async sendRow(entry: OutboxEntry, row: LocalRow): Promise<RemoteWriteAck | 'conflict'> {
    const payload = toRemotePayload(entry.entity, row, entry.id);
    const localVersion = Number(row.version ?? 0);

    const ack =
      localVersion === 0
        ? await this.remote.insert(entry.entity, payload)
        : await this.remote.updateIfVersion(entry.entity, entry.entityId, payload, localVersion);
    if (ack) return ack;

    // Not applied: either our own earlier attempt already landed, or someone
    // else changed the row (or it never existed / was removed remotely).
    const server = await this.remote.fetchById(entry.entity, entry.entityId);
    if (server && server.last_mutation_id === entry.id) {
      // Our previous attempt succeeded but the response was lost. Re-apply the
      // latest local state on top of the server version we now know about.
      const retry = await this.remote.updateIfVersion(
        entry.entity,
        entry.entityId,
        payload,
        server.version,
      );
      if (retry) return retry;
    }
    await this.recordConflict(entry, row, server);
    return 'conflict';
  }

  private async completeEntry(entry: OutboxEntry, ack: RemoteWriteAck): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.run(`DELETE FROM sync_outbox WHERE id = ?`, [entry.id]);
      const stillPending = await hasPendingChanges(tx, entry.entity, entry.entityId, entry.id);
      // Only bookkeeping columns are touched: the user may have edited the row
      // again while this push was in flight.
      await tx.run(`UPDATE ${entry.entity} SET version = ?, sync_status = ? WHERE id = ?`, [
        ack.version,
        stillPending ? 'pending' : 'synced',
        entry.entityId,
      ]);
    });
  }

  private async handlePushError(entry: OutboxEntry, error: unknown): Promise<'failed' | 'retry'> {
    const appError = toAppError(error);
    const attempts = entry.attempts + 1;
    const now = this.now();

    if (HALTING_ERRORS.has(appError.code)) {
      // Not this record's fault: put it back untouched and stop the run.
      await this.db.run(
        `UPDATE sync_outbox SET status = 'pending', attempts = ?, updated_at = ? WHERE id = ?`,
        [entry.attempts, now.toISOString(), entry.id],
      );
      throw new HaltSyncError(appError.code);
    }

    const permanent = !appError.retryable && attempts >= this.maxAttempts;
    const nextAttemptAt = new Date(now.getTime() + nextBackoffMs(attempts)).toISOString();
    await this.db.run(
      `UPDATE sync_outbox
       SET status = ?, last_error = ?, next_attempt_at = ?, updated_at = ?
       WHERE id = ?`,
      [permanent ? 'failed' : 'pending', appError.code, nextAttemptAt, now.toISOString(), entry.id],
    );
    if (permanent) {
      this.onError('Sync entry failed permanently', { entity: entry.entity, code: appError.code });
      return 'failed';
    }
    return 'retry';
  }

  private async recordConflict(
    entry: OutboxEntry,
    local: LocalRow,
    remote: RemoteRow | null,
  ): Promise<void> {
    const resolution = this.resolveConflict({ table: entry.entity, local, remote });
    const now = this.nowIso();

    if (resolution === 'keep_local' && remote) {
      // Overwrite the server, based on the version we just observed.
      const ack = await this.remote.updateIfVersion(
        entry.entity,
        entry.entityId,
        toRemotePayload(entry.entity, local, entry.id),
        remote.version,
      );
      if (ack) {
        await this.completeEntry(entry, ack);
        return;
      }
    }

    const columns = await this.getLocalColumns(entry.entity);
    await this.db.transaction(async (tx) => {
      await tx.run(
        `INSERT INTO sync_conflicts (id, entity, entity_id, local_payload, remote_payload, reason, detected_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          this.newId(),
          entry.entity,
          entry.entityId,
          JSON.stringify(local),
          remote ? JSON.stringify(remote) : null,
          remote ? 'version_mismatch' : 'remote_missing',
          now,
        ],
      );
      await tx.run(`DELETE FROM sync_outbox WHERE id = ?`, [entry.id]);
      if (remote) {
        await this.upsertLocal(tx, entry.entity, remote, columns, 'conflict');
      } else {
        await tx.run(`UPDATE ${entry.entity} SET sync_status = 'conflict' WHERE id = ?`, [
          entry.entityId,
        ]);
      }
    });
  }

  // ---------------------------------------------------------------- pull ----

  private async pull(): Promise<number> {
    let applied = 0;
    for (const table of SYNC_TABLES) {
      applied += await this.pullTable(table.name);
    }
    return applied;
  }

  private async pullTable(table: SyncTableName): Promise<number> {
    const columns = await this.getLocalColumns(table);
    const stored = await this.db.getFirst<{
      last_updated_at: string | null;
      last_id: string | null;
    }>(`SELECT last_updated_at, last_id FROM sync_cursors WHERE entity = ?`, [table]);

    let since: ChangeCursor | null = null;
    if (stored?.last_updated_at) {
      const rewound = new Date(Date.parse(stored.last_updated_at) - this.pullOverlapMs);
      since = { updatedAt: rewound.toISOString(), id: '' };
    }

    let applied = 0;
    let newest: ChangeCursor | null =
      stored?.last_updated_at && stored.last_id
        ? { updatedAt: stored.last_updated_at, id: stored.last_id }
        : null;

    for (;;) {
      const rows = await this.remote.fetchChanges(table, since, this.pullPageSize);
      if (rows.length === 0) break;

      await this.db.transaction(async (tx) => {
        for (const remote of rows) {
          if (await hasPendingChanges(tx, table, remote.id)) continue; // local edit wins until pushed
          const local = await tx.getFirst<{ version: number }>(
            `SELECT version FROM ${table} WHERE id = ?`,
            [remote.id],
          );
          if (local && local.version >= remote.version) continue;
          await this.upsertLocal(tx, table, remote, columns, 'synced');
          applied += 1;
        }
      });

      const last = rows[rows.length - 1]!;
      since = { updatedAt: last.updated_at, id: last.id };
      if (!newest || Date.parse(last.updated_at) >= Date.parse(newest.updatedAt)) newest = since;
      if (rows.length < this.pullPageSize) break;
    }

    if (newest) {
      await this.db.run(
        `INSERT INTO sync_cursors (entity, last_updated_at, last_id, last_pulled_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(entity) DO UPDATE SET
           last_updated_at = excluded.last_updated_at,
           last_id = excluded.last_id,
           last_pulled_at = excluded.last_pulled_at`,
        [table, newest.updatedAt, newest.id, this.nowIso()],
      );
    }
    return applied;
  }

  private async upsertLocal(
    tx: Pick<SqlDatabase, 'run'>,
    table: SyncTableName,
    remote: RemoteRow,
    columns: ReadonlySet<string>,
    syncStatus: 'synced' | 'conflict',
  ): Promise<void> {
    const values: LocalRow = { ...toLocalValues(remote, columns, table), sync_status: syncStatus };
    const names = Object.keys(values);
    const placeholders = names.map(() => '?').join(', ');
    const updates = names
      .filter((n) => n !== 'id')
      .map((n) => `${n} = excluded.${n}`)
      .join(', ');
    // Column names come from PRAGMA table_info, never from remote input.
    await tx.run(
      `INSERT INTO ${table} (${names.join(', ')}) VALUES (${placeholders})
       ON CONFLICT(id) DO UPDATE SET ${updates}`,
      names.map((n) => values[n] ?? null),
    );
  }

  private async getLocalColumns(table: SyncTableName): Promise<ReadonlySet<string>> {
    const cached = this.columnCache.get(table);
    if (cached) return cached;
    const info = await this.db.getAll<{ name: string }>(`PRAGMA table_info(${table})`);
    const set = new Set(info.map((c) => c.name));
    this.columnCache.set(table, set);
    return set;
  }

  // -------------------------------------------------------------- status ----

  private nowIso(): string {
    return this.now().toISOString();
  }

  private updateStatus(patch: Partial<SyncStatusSnapshot>): void {
    this.status = { ...this.status, ...patch };
    for (const listener of this.listeners) listener(this.status);
  }
}
