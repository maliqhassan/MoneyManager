import type { SqlValue } from '@/database/types';

import { getSyncTable, LOCAL_SYNC_COLUMNS, type SyncTableName } from './registry';
import type { RemoteRow } from './types';

export type LocalRow = Record<string, SqlValue>;

/**
 * Local SQLite row → Postgres payload.
 * - drops local bookkeeping columns (the server owns version/updated_at);
 * - converts 0/1 to booleans and JSON text to objects;
 * - stamps the mutation id for idempotent retries.
 */
export function toRemotePayload(
  table: SyncTableName,
  row: LocalRow,
  mutationId: string,
): Record<string, unknown> {
  const config = getSyncTable(table);
  const skip = new Set<string>([...LOCAL_SYNC_COLUMNS, ...(config.localOnlyColumns ?? [])]);
  const payload: Record<string, unknown> = {};

  for (const [column, value] of Object.entries(row)) {
    if (skip.has(column)) continue;
    if (config.booleanColumns.includes(column)) {
      payload[column] = value === null ? null : value === 1;
    } else if (config.jsonColumns.includes(column)) {
      payload[column] = typeof value === 'string' ? (JSON.parse(value) as unknown) : null;
    } else {
      payload[column] = value;
    }
  }
  payload.last_mutation_id = mutationId;
  return payload;
}

/**
 * Postgres row → local SQLite values, restricted to columns that exist
 * locally (`localColumns`). Booleans become 0/1, objects become JSON text.
 */
export function toLocalValues(
  remote: RemoteRow,
  localColumns: ReadonlySet<string>,
  table?: SyncTableName,
): LocalRow {
  const values: LocalRow = {};
  for (const [column, value] of Object.entries(remote)) {
    if (!localColumns.has(column) || column === 'sync_status') continue;
    if (value === null || value === undefined) values[column] = null;
    else if (typeof value === 'boolean') values[column] = value ? 1 : 0;
    else if (typeof value === 'number' || typeof value === 'string') values[column] = value;
    else values[column] = JSON.stringify(value);
  }
  const derived = table ? getSyncTable(table).derive?.(remote) : undefined;
  if (derived) {
    for (const [column, value] of Object.entries(derived)) {
      if (localColumns.has(column)) values[column] = value;
    }
  }
  return values;
}
