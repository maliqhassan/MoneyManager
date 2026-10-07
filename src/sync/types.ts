import type { ErrorCode } from '@/lib/errors';

import type { SyncTableName } from './registry';

/**
 * Offline-first synchronisation contracts.
 *
 *   UI → Repository → SQLite (+ outbox, same transaction)
 *                         ↓ push            ↑ pull
 *                       SyncEngine ⇄ RemoteDataSource (Supabase)
 *
 * The local database is always the source the UI reads from. The server is
 * the authority for row versions; conflicts are detected with optimistic
 * concurrency on the `version` column.
 */

export type RowSyncStatus = 'synced' | 'pending' | 'conflict';

export type OutboxStatus = 'pending' | 'in_flight' | 'failed' | 'conflict';

export interface OutboxEntry {
  /** Mutation id, sent to the server as `last_mutation_id` for idempotency. */
  id: string;
  entity: SyncTableName;
  entityId: string;
  operation: 'upsert' | 'delete';
  status: OutboxStatus;
  attempts: number;
  lastError: string | null;
  nextAttemptAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** A row as stored in Postgres (snake_case, JSON-typed values). */
export type RemoteRow = Record<string, unknown> & {
  id: string;
  version: number;
  updated_at: string;
  last_mutation_id?: string | null;
};

export interface RemoteWriteAck {
  version: number;
  updatedAt: string;
}

export interface ChangeCursor {
  updatedAt: string;
  id: string;
}

/**
 * Server operations the sync engine needs. Implemented for Supabase in
 * supabaseRemote.ts and by in-memory fakes in tests. Implementations throw
 * on transport/server errors; the engine classifies them with toAppError.
 */
export interface RemoteDataSource {
  /** Inserts if absent. Returns null when a row with this id already exists. */
  insert(table: SyncTableName, row: Record<string, unknown>): Promise<RemoteWriteAck | null>;
  /** Updates only if the server version equals `expectedVersion`; null otherwise. */
  updateIfVersion(
    table: SyncTableName,
    id: string,
    row: Record<string, unknown>,
    expectedVersion: number,
  ): Promise<RemoteWriteAck | null>;
  fetchById(table: SyncTableName, id: string): Promise<RemoteRow | null>;
  /** Rows changed strictly after `since`, ordered by (updated_at, id). */
  fetchChanges(
    table: SyncTableName,
    since: ChangeCursor | null,
    limit: number,
  ): Promise<RemoteRow[]>;
}

export type ConflictResolution = 'keep_remote' | 'keep_local';

export type ConflictResolver = (input: {
  table: SyncTableName;
  local: Record<string, unknown>;
  remote: RemoteRow | null;
}) => ConflictResolution;

export type SyncPhase = 'idle' | 'syncing' | 'offline' | 'error';

export interface SyncStatusSnapshot {
  phase: SyncPhase;
  pendingCount: number;
  failedCount: number;
  conflictCount: number;
  lastSyncedAt: string | null;
  lastErrorCode: ErrorCode | null;
}

export interface SyncRunResult {
  pushed: number;
  pulled: number;
  conflicts: number;
  failed: number;
  errorCode: ErrorCode | null;
}
