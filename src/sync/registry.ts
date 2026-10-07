import { buildTransactionSearchText } from '@/domain/text/search';

const asText = (v: unknown): string | null => (typeof v === 'string' ? v : null);

/**
 * Synced tables in dependency order (parents before children). Push follows
 * outbox FIFO order; pull walks this list so parents normally land first.
 *
 * `booleanColumns` / `jsonColumns` describe local SQLite encodings that must
 * be converted when sending rows to Postgres (INTEGER 0/1 → boolean,
 * TEXT JSON → object). `localOnlyColumns` never leave the device.
 */
export const SYNC_TABLES = [
  { name: 'user_preferences', booleanColumns: [], jsonColumns: [] },
  {
    name: 'accounts',
    booleanColumns: ['include_in_totals', 'is_archived'],
    jsonColumns: [],
  },
  { name: 'categories', booleanColumns: ['is_archived'], jsonColumns: [] },
  { name: 'merchants', booleanColumns: [], jsonColumns: [] },
  { name: 'tags', booleanColumns: [], jsonColumns: [] },
  { name: 'transfers', booleanColumns: [], jsonColumns: [] },
  { name: 'recurring_transactions', booleanColumns: ['auto_post', 'is_active'], jsonColumns: [] },
  { name: 'import_batches', booleanColumns: [], jsonColumns: ['column_mapping'] },
  {
    name: 'transactions',
    booleanColumns: ['is_split'],
    jsonColumns: [],
    localOnlyColumns: ['search_text'],
    derive: (row) => ({
      search_text: buildTransactionSearchText(asText(row.payee), asText(row.notes)),
    }),
  },
  { name: 'transaction_splits', booleanColumns: [], jsonColumns: [] },
  { name: 'transaction_tags', booleanColumns: [], jsonColumns: [] },
  { name: 'category_rules', booleanColumns: ['is_enabled'], jsonColumns: [] },
  { name: 'budgets', booleanColumns: ['rollover_enabled', 'is_archived'], jsonColumns: [] },
  { name: 'budget_allocations', booleanColumns: ['rollover_enabled'], jsonColumns: [] },
  {
    name: 'bills',
    booleanColumns: ['is_variable_amount', 'is_subscription', 'is_active'],
    jsonColumns: [],
  },
  { name: 'bill_payments', booleanColumns: [], jsonColumns: [] },
  { name: 'savings_goals', booleanColumns: [], jsonColumns: [] },
  { name: 'goal_contributions', booleanColumns: [], jsonColumns: [] },
  {
    name: 'attachments',
    booleanColumns: [],
    jsonColumns: [],
    localOnlyColumns: ['local_uri', 'upload_status'],
  },
  { name: 'import_rows', booleanColumns: [], jsonColumns: ['raw'] },
  { name: 'notifications', booleanColumns: [], jsonColumns: [] },
] as const satisfies readonly SyncTableConfig[];

export interface SyncTableConfig {
  name: string;
  booleanColumns: readonly string[];
  jsonColumns: readonly string[];
  localOnlyColumns?: readonly string[];
  /** Computes local-only columns from a pulled server row. */
  derive?: (remote: Readonly<Record<string, unknown>>) => Record<string, string | number | null>;
}

export type SyncTableName = (typeof SYNC_TABLES)[number]['name'];

const BY_NAME = new Map<string, SyncTableConfig>(SYNC_TABLES.map((t) => [t.name, t]));

export function getSyncTable(name: string): SyncTableConfig {
  const config = BY_NAME.get(name);
  if (!config) throw new Error(`Unknown sync table: ${name}`);
  return config;
}

export function isSyncTableName(name: string): name is SyncTableName {
  return BY_NAME.has(name);
}

/** Columns maintained locally for sync bookkeeping; never pushed. */
export const LOCAL_SYNC_COLUMNS = ['sync_status', 'version', 'updated_at'] as const;
