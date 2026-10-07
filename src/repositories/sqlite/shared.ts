import { ZodError, type ZodType } from 'zod';

import type { SqlExecutor, SqlValue } from '@/database/types';
import { AppError } from '@/lib/errors';
import { enqueueChange } from '@/sync/outbox';
import type { SyncTableName } from '@/sync/registry';

export interface RepositoryContext {
  userId: string;
  newId: () => string;
  now: () => string;
  /** Called after every committed write (query invalidation + sync scheduling). */
  onChange: (table: SyncTableName) => void;
}

/** Validates input, converting Zod issues into an AppError with field errors (i18n keys). */
export function validate<T>(schema: ZodType<T>, input: unknown): T {
  try {
    return schema.parse(input);
  } catch (error) {
    if (error instanceof ZodError) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of error.issues) {
        const key = issue.path.join('.') || '_root';
        fieldErrors[key] ??= issue.message;
      }
      throw new AppError('validation', 'Invalid input', { cause: error, fieldErrors });
    }
    throw error;
  }
}

export const toBool = (value: SqlValue): boolean => value === 1;
export const fromBool = (value: boolean): number => (value ? 1 : 0);

/**
 * Inserts a new synced row (version 0 = never pushed) and queues it.
 * `values` keys are trusted column names from repository code.
 */
export async function insertSynced(
  tx: SqlExecutor,
  ctx: RepositoryContext,
  table: SyncTableName,
  id: string,
  values: Record<string, SqlValue>,
): Promise<void> {
  const now = ctx.now();
  const row: Record<string, SqlValue> = {
    id,
    user_id: ctx.userId,
    created_at: now,
    updated_at: now,
    deleted_at: null,
    version: 0,
    sync_status: 'pending',
    ...values,
  };
  const columns = Object.keys(row);
  await tx.run(
    `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
    columns.map((c) => row[c] ?? null),
  );
  await enqueueChange(tx, {
    mutationId: ctx.newId(),
    entity: table,
    entityId: id,
    operation: 'upsert',
    now,
  });
}

/** Updates columns of an existing synced row owned by the user and queues it. */
export async function updateSynced(
  tx: SqlExecutor,
  ctx: RepositoryContext,
  table: SyncTableName,
  id: string,
  values: Record<string, SqlValue>,
  operation: 'upsert' | 'delete' = 'upsert',
): Promise<void> {
  const now = ctx.now();
  const row: Record<string, SqlValue> = { ...values, updated_at: now, sync_status: 'pending' };
  const columns = Object.keys(row);
  const result = await tx.run(
    `UPDATE ${table} SET ${columns.map((c) => `${c} = ?`).join(', ')}
     WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
    [...columns.map((c) => row[c] ?? null), id, ctx.userId],
  );
  if (result.changes === 0) throw new AppError('not_found', `${table} ${id} not found`);
  await enqueueChange(tx, { mutationId: ctx.newId(), entity: table, entityId: id, operation, now });
}
