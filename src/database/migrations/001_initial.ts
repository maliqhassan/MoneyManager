import type { Migration } from './index';

/**
 * Local schema v1 — mirrors supabase/migrations/*_initial_schema.sql.
 *
 * Storage conventions (SQLite):
 * - ids: TEXT UUIDs generated on the client.
 * - money: INTEGER minor units (64-bit). Rates: TEXT exact decimals.
 * - timestamps: TEXT ISO-8601 UTC; calendar dates: TEXT "YYYY-MM-DD".
 * - booleans: INTEGER 0/1.
 *
 * Every synced table carries:
 *   version      — last server version seen (0 = never synced)
 *   deleted_at   — soft-delete tombstone, required for sync
 *   sync_status  — 'synced' | 'pending' | 'conflict'
 *
 * Foreign keys are NOT declared on synced tables: rows arrive from the server
 * in pages and in table order, so a child can briefly precede its parent.
 * Referential integrity is enforced by Postgres and by repositories on write.
 */

const SYNC_COLUMNS = `
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  version INTEGER NOT NULL DEFAULT 0,
  sync_status TEXT NOT NULL DEFAULT 'pending' CHECK (sync_status IN ('synced', 'pending', 'conflict'))`;

const syncedTable = (name: string, columns: string) =>
  `CREATE TABLE ${name} (${SYNC_COLUMNS},${columns}\n);`;

const BOOL = (column: string, defaultValue: 0 | 1) =>
  `${column} INTEGER NOT NULL DEFAULT ${defaultValue} CHECK (${column} IN (0, 1))`;

export const migration001Initial: Migration = {
  version: 1,
  name: 'initial',
  statements: [
    syncedTable(
      'user_preferences',
      `
  base_currency TEXT NOT NULL,
  locale TEXT NOT NULL,
  time_zone TEXT NOT NULL,
  first_day_of_week INTEGER NOT NULL DEFAULT 1 CHECK (first_day_of_week BETWEEN 0 AND 6),
  month_start_day INTEGER NOT NULL DEFAULT 1 CHECK (month_start_day BETWEEN 1 AND 28)`,
    ),
    `CREATE UNIQUE INDEX idx_user_preferences_user ON user_preferences(user_id);`,

    syncedTable(
      'accounts',
      `
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('cash','checking','savings','credit_card','debit_card','digital_wallet','loan','other')),
  currency TEXT NOT NULL,
  opening_balance_minor INTEGER NOT NULL DEFAULT 0,
  opening_balance_date TEXT NOT NULL,
  credit_limit_minor INTEGER,
  institution TEXT,
  color TEXT,
  icon TEXT,
  notes TEXT,
  ${BOOL('include_in_totals', 1)},
  ${BOOL('is_archived', 0)},
  sort_order INTEGER NOT NULL DEFAULT 0`,
    ),
    `CREATE INDEX idx_accounts_user ON accounts(user_id, is_archived, sort_order);`,

    syncedTable(
      'categories',
      `
  parent_id TEXT,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('expense', 'income')),
  icon TEXT,
  color TEXT,
  system_key TEXT,
  ${BOOL('is_archived', 0)},
  sort_order INTEGER NOT NULL DEFAULT 0`,
    ),
    `CREATE INDEX idx_categories_parent ON categories(parent_id);`,

    syncedTable(
      'merchants',
      `
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  default_category_id TEXT`,
    ),
    `CREATE INDEX idx_merchants_normalized ON merchants(normalized_name);`,

    syncedTable(
      'tags',
      `
  name TEXT NOT NULL,
  color TEXT`,
    ),

    syncedTable(
      'transactions',
      `
  account_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('expense', 'income', 'transfer', 'refund')),
  amount_minor INTEGER NOT NULL CHECK (amount_minor <> 0),
  currency TEXT NOT NULL,
  original_amount_minor INTEGER NOT NULL,
  original_currency TEXT NOT NULL,
  fx_rate TEXT NOT NULL DEFAULT '1',
  base_currency TEXT NOT NULL,
  base_amount_minor INTEGER NOT NULL,
  base_fx_rate TEXT NOT NULL DEFAULT '1',
  base_fx_rate_date TEXT NOT NULL,
  base_fx_source TEXT NOT NULL,
  category_id TEXT,
  merchant_id TEXT,
  payee TEXT,
  notes TEXT,
  occurred_at TEXT NOT NULL,
  local_date TEXT NOT NULL,
  time_zone TEXT NOT NULL,
  ${BOOL('is_split', 0)},
  transfer_id TEXT,
  refund_of_transaction_id TEXT,
  recurring_transaction_id TEXT,
  import_batch_id TEXT,
  import_hash TEXT`,
    ),
    `CREATE INDEX idx_transactions_account_date ON transactions(account_id, local_date);`,
    `CREATE INDEX idx_transactions_date ON transactions(local_date);`,
    `CREATE INDEX idx_transactions_category ON transactions(category_id);`,
    `CREATE INDEX idx_transactions_transfer ON transactions(transfer_id);`,
    `CREATE INDEX idx_transactions_import_hash ON transactions(import_hash);`,

    syncedTable(
      'transaction_splits',
      `
  transaction_id TEXT NOT NULL,
  category_id TEXT,
  amount_minor INTEGER NOT NULL CHECK (amount_minor <> 0),
  base_amount_minor INTEGER NOT NULL,
  notes TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0`,
    ),
    `CREATE INDEX idx_transaction_splits_transaction ON transaction_splits(transaction_id);`,

    syncedTable(
      'transaction_tags',
      `
  transaction_id TEXT NOT NULL,
  tag_id TEXT NOT NULL`,
    ),
    `CREATE INDEX idx_transaction_tags_transaction ON transaction_tags(transaction_id);`,

    syncedTable(
      'transfers',
      `
  from_account_id TEXT NOT NULL,
  to_account_id TEXT NOT NULL,
  from_amount_minor INTEGER NOT NULL CHECK (from_amount_minor > 0),
  from_currency TEXT NOT NULL,
  to_amount_minor INTEGER NOT NULL CHECK (to_amount_minor > 0),
  to_currency TEXT NOT NULL,
  fx_rate TEXT NOT NULL DEFAULT '1',
  occurred_at TEXT NOT NULL,
  local_date TEXT NOT NULL,
  notes TEXT`,
    ),

    syncedTable(
      'category_rules',
      `
  name TEXT,
  match_field TEXT NOT NULL CHECK (match_field IN ('payee', 'notes')),
  match_type TEXT NOT NULL CHECK (match_type IN ('contains', 'equals', 'starts_with')),
  pattern TEXT NOT NULL,
  category_id TEXT NOT NULL,
  merchant_id TEXT,
  priority INTEGER NOT NULL DEFAULT 0,
  ${BOOL('is_enabled', 1)}`,
    ),

    syncedTable(
      'budgets',
      `
  name TEXT NOT NULL,
  period_type TEXT NOT NULL CHECK (period_type IN ('weekly', 'monthly', 'custom')),
  start_date TEXT NOT NULL,
  end_date TEXT,
  currency TEXT NOT NULL,
  amount_minor INTEGER CHECK (amount_minor IS NULL OR amount_minor >= 0),
  ${BOOL('rollover_enabled', 0)},
  ${BOOL('is_archived', 0)}`,
    ),

    syncedTable(
      'budget_allocations',
      `
  budget_id TEXT NOT NULL,
  category_id TEXT NOT NULL,
  amount_minor INTEGER NOT NULL CHECK (amount_minor >= 0),
  ${BOOL('rollover_enabled', 0)}`,
    ),
    `CREATE INDEX idx_budget_allocations_budget ON budget_allocations(budget_id);`,

    syncedTable(
      'recurring_transactions',
      `
  account_id TEXT NOT NULL,
  category_id TEXT,
  type TEXT NOT NULL CHECK (type IN ('expense', 'income', 'refund')),
  amount_minor INTEGER NOT NULL CHECK (amount_minor <> 0),
  currency TEXT NOT NULL,
  payee TEXT,
  notes TEXT,
  frequency TEXT NOT NULL CHECK (frequency IN ('daily', 'weekly', 'monthly', 'yearly')),
  interval INTEGER NOT NULL DEFAULT 1 CHECK (interval >= 1),
  start_date TEXT NOT NULL,
  end_date TEXT,
  next_occurrence_date TEXT,
  ${BOOL('auto_post', 0)},
  time_zone TEXT NOT NULL,
  ${BOOL('is_active', 1)}`,
    ),

    syncedTable(
      'bills',
      `
  name TEXT NOT NULL,
  account_id TEXT,
  category_id TEXT,
  amount_minor INTEGER NOT NULL CHECK (amount_minor >= 0),
  currency TEXT NOT NULL,
  ${BOOL('is_variable_amount', 0)},
  ${BOOL('is_subscription', 0)},
  frequency TEXT NOT NULL CHECK (frequency IN ('daily', 'weekly', 'monthly', 'yearly')),
  interval INTEGER NOT NULL DEFAULT 1 CHECK (interval >= 1),
  next_due_date TEXT NOT NULL,
  reminder_days_before INTEGER CHECK (reminder_days_before IS NULL OR reminder_days_before BETWEEN 0 AND 60),
  recurring_transaction_id TEXT,
  notes TEXT,
  ${BOOL('is_active', 1)}`,
    ),
    `CREATE INDEX idx_bills_due ON bills(is_active, next_due_date);`,

    syncedTable(
      'bill_payments',
      `
  bill_id TEXT NOT NULL,
  due_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'unpaid' CHECK (status IN ('unpaid', 'paid', 'skipped')),
  paid_at TEXT,
  amount_minor INTEGER,
  transaction_id TEXT`,
    ),
    `CREATE INDEX idx_bill_payments_bill ON bill_payments(bill_id, due_date);`,

    syncedTable(
      'savings_goals',
      `
  name TEXT NOT NULL,
  target_amount_minor INTEGER NOT NULL CHECK (target_amount_minor > 0),
  currency TEXT NOT NULL,
  target_date TEXT,
  account_id TEXT,
  icon TEXT,
  color TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'achieved', 'archived'))`,
    ),

    syncedTable(
      'goal_contributions',
      `
  goal_id TEXT NOT NULL,
  amount_minor INTEGER NOT NULL CHECK (amount_minor <> 0),
  contributed_on TEXT NOT NULL,
  transaction_id TEXT,
  notes TEXT`,
    ),
    `CREATE INDEX idx_goal_contributions_goal ON goal_contributions(goal_id);`,

    syncedTable(
      'attachments',
      `
  transaction_id TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
  file_name TEXT NOT NULL,
  local_uri TEXT,
  upload_status TEXT NOT NULL DEFAULT 'pending' CHECK (upload_status IN ('pending', 'uploaded', 'failed'))`,
    ),
    `CREATE INDEX idx_attachments_transaction ON attachments(transaction_id);`,

    syncedTable(
      'import_batches',
      `
  source TEXT NOT NULL DEFAULT 'csv' CHECK (source IN ('csv')),
  file_name TEXT NOT NULL,
  account_id TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','mapped','previewed','committed','failed','reverted')),
  column_mapping TEXT,
  row_count INTEGER NOT NULL DEFAULT 0,
  imported_count INTEGER NOT NULL DEFAULT 0,
  duplicate_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  committed_at TEXT`,
    ),

    syncedTable(
      'import_rows',
      `
  batch_id TEXT NOT NULL,
  row_index INTEGER NOT NULL,
  raw TEXT NOT NULL,
  local_date TEXT,
  amount_minor INTEGER,
  currency TEXT,
  payee TEXT,
  notes TEXT,
  category_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','duplicate','imported','skipped','error')),
  error TEXT,
  import_hash TEXT,
  transaction_id TEXT,
  duplicate_of_transaction_id TEXT`,
    ),
    `CREATE INDEX idx_import_rows_batch ON import_rows(batch_id, row_index);`,

    syncedTable(
      'notifications',
      `
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  entity_type TEXT,
  entity_id TEXT,
  scheduled_for TEXT,
  read_at TEXT`,
    ),

    // Reference data cache (not user-owned, pull-only).
    `CREATE TABLE exchange_rates (
  id TEXT PRIMARY KEY NOT NULL,
  base_currency TEXT NOT NULL,
  quote_currency TEXT NOT NULL,
  rate TEXT NOT NULL,
  rate_date TEXT NOT NULL,
  source TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (base_currency, quote_currency, rate_date, source)
);`,

    // ---- Sync engine bookkeeping (local only) ------------------------------
    `CREATE TABLE sync_outbox (
  id TEXT PRIMARY KEY NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('upsert', 'delete')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_flight', 'failed', 'conflict')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  next_attempt_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);`,
    `CREATE INDEX idx_sync_outbox_status ON sync_outbox(status, created_at);`,
    `CREATE INDEX idx_sync_outbox_entity ON sync_outbox(entity, entity_id);`,

    `CREATE TABLE sync_cursors (
  entity TEXT PRIMARY KEY NOT NULL,
  last_updated_at TEXT,
  last_id TEXT,
  last_pulled_at TEXT
);`,

    `CREATE TABLE sync_conflicts (
  id TEXT PRIMARY KEY NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  local_payload TEXT NOT NULL,
  remote_payload TEXT,
  reason TEXT NOT NULL,
  detected_at TEXT NOT NULL,
  resolved_at TEXT
);`,
  ],
};
