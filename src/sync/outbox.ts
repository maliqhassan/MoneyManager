import type { SqlExecutor } from '@/database/types';

import type { SyncTableName } from './registry';
import type { OutboxEntry, OutboxStatus } from './types';

interface OutboxRow {
  id: string;
  entity: string;
  entity_id: string;
  operation: 'upsert' | 'delete';
  status: OutboxStatus;
  attempts: number;
  last_error: string | null;
  next_attempt_at: string | null;
  created_at: string;
  updated_at: string;
}

function toEntry(row: OutboxRow): OutboxEntry {
  return {
    id: row.id,
    entity: row.entity as SyncTableName,
    entityId: row.entity_id,
    operation: row.operation,
    status: row.status,
    attempts: row.attempts,
    lastError: row.last_error,
    nextAttemptAt: row.next_attempt_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Records that a local row changed and must be pushed. MUST be called inside
 * the same transaction as the row write, so data and outbox never diverge.
 *
 * Coalescing: if a not-yet-sent entry exists for the same row it is reused —
 * the engine always pushes the row's latest state, so one entry per row is
 * enough. If the only entry is already in flight, a new entry is added so the
 * later change is not lost.
 */
export async function enqueueChange(
  tx: SqlExecutor,
  params: {
    mutationId: string;
    entity: SyncTableName;
    entityId: string;
    operation: 'upsert' | 'delete';
    now: string;
  },
): Promise<void> {
  const existing = await tx.getFirst<{ id: string }>(
    `SELECT id FROM sync_outbox
     WHERE entity = ? AND entity_id = ? AND status IN ('pending', 'failed')
     ORDER BY created_at LIMIT 1`,
    [params.entity, params.entityId],
  );

  if (existing) {
    // A delete supersedes an upsert; failed entries get a fresh chance.
    await tx.run(
      `UPDATE sync_outbox
       SET operation = CASE WHEN ? = 'delete' THEN 'delete' ELSE operation END,
           status = 'pending', attempts = 0, last_error = NULL, next_attempt_at = NULL,
           updated_at = ?
       WHERE id = ?`,
      [params.operation, params.now, existing.id],
    );
    return;
  }

  await tx.run(
    `INSERT INTO sync_outbox (id, entity, entity_id, operation, status, attempts, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'pending', 0, ?, ?)`,
    [params.mutationId, params.entity, params.entityId, params.operation, params.now, params.now],
  );
}

/**
 * Entries ready to push in exact insertion order (SQLite rowid). Several rows
 * written in one local transaction share a timestamp, and parents (a transfer,
 * a transaction) must reach the server before their children (legs, splits,
 * tags, attachments) or foreign keys would reject them.
 */
export async function getDueEntries(
  db: SqlExecutor,
  now: string,
  limit: number,
): Promise<OutboxEntry[]> {
  const rows = await db.getAll<OutboxRow>(
    `SELECT * FROM sync_outbox
     WHERE status = 'pending' AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
     ORDER BY rowid
     LIMIT ?`,
    [now, limit],
  );
  return rows.map(toEntry);
}

export async function hasPendingChanges(
  db: SqlExecutor,
  entity: SyncTableName,
  entityId: string,
  excludingMutationId?: string,
): Promise<boolean> {
  const row = await db.getFirst<{ n: number }>(
    `SELECT COUNT(*) AS n FROM sync_outbox
     WHERE entity = ? AND entity_id = ? AND status IN ('pending', 'in_flight', 'failed')
       AND id <> ?`,
    [entity, entityId, excludingMutationId ?? ''],
  );
  return (row?.n ?? 0) > 0;
}

export async function countByStatus(db: SqlExecutor): Promise<Record<OutboxStatus, number>> {
  const rows = await db.getAll<{ status: OutboxStatus; n: number }>(
    `SELECT status, COUNT(*) AS n FROM sync_outbox GROUP BY status`,
  );
  const counts: Record<OutboxStatus, number> = { pending: 0, in_flight: 0, failed: 0, conflict: 0 };
  for (const r of rows) counts[r.status] = r.n;
  return counts;
}

/**
 * After a crash mid-push, entries can be stuck in 'in_flight'. Pushes are
 * idempotent (mutation ids), so they are simply retried.
 */
export async function resetInFlight(db: SqlExecutor, now: string): Promise<void> {
  await db.run(
    `UPDATE sync_outbox SET status = 'pending', updated_at = ? WHERE status = 'in_flight'`,
    [now],
  );
}

/**
 * Entries parked as 'failed' because the SERVER was not ready (schema not
 * deployed: table/column missing) were never the record's fault. They get a
 * fresh chance on every run; while the server is still not ready the run
 * halts on the first one without consuming attempts. ('not_found' is how a
 * push to a missing table was classified before 'server_not_ready' existed;
 * inserts and version-checked updates never produce it otherwise.)
 */
export async function requeueBlockedByServer(db: SqlExecutor, now: string): Promise<number> {
  const result = await db.run(
    `UPDATE sync_outbox
     SET status = 'pending', attempts = 0, next_attempt_at = NULL, updated_at = ?
     WHERE status = 'failed' AND last_error IN ('server_not_ready', 'not_found')`,
    [now],
  );
  return result.changes;
}

/** Exponential backoff with full jitter: 5s · 2^attempts, capped at 30 minutes. */
export function nextBackoffMs(attempts: number, random: () => number = Math.random): number {
  const base = 5_000 * 2 ** Math.min(attempts, 12);
  return Math.floor(Math.min(base, 30 * 60_000) * (0.5 + random() / 2));
}
