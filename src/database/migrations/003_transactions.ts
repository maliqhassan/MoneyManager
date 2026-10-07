import type { Migration } from './index';

/**
 * Local schema v3 — Phase 2 (transactions & categories).
 * Mirrors supabase/migrations/20261009090000_transactions_categories.sql,
 * plus local-only search support. Additive: existing rows are preserved.
 *
 * - merchant_key: normalised merchant (synced) for rules and history lookups.
 * - search_text: LOCAL ONLY. Unicode-normalised payee + notes (SQLite's
 *   lower()/LIKE only fold ASCII). Maintained by the repository on write and
 *   derived on pull (sync registry). The backfill below is an ASCII
 *   approximation for rows that predate this migration.
 */
export const migration003Transactions: Migration = {
  version: 3,
  name: 'transactions',
  statements: [
    `ALTER TABLE transactions ADD COLUMN merchant_key TEXT`,
    `ALTER TABLE transactions ADD COLUMN search_text TEXT`,
    `UPDATE transactions
       SET search_text = lower(trim(coalesce(payee, '') || ' ' || coalesce(notes, '')))`,
    // Keyset pagination: newest first by local day, then time, then id.
    `CREATE INDEX idx_transactions_list
       ON transactions(local_date DESC, occurred_at DESC, id DESC) WHERE deleted_at IS NULL`,
    `CREATE INDEX idx_transactions_merchant ON transactions(merchant_key, local_date DESC)`,
    `CREATE INDEX idx_transactions_refund_of ON transactions(refund_of_transaction_id)`,
    `CREATE INDEX idx_transaction_splits_category ON transaction_splits(category_id)`,
    `CREATE INDEX idx_transaction_tags_tag ON transaction_tags(tag_id)`,
    `CREATE INDEX idx_categories_kind ON categories(kind, is_archived, sort_order)`,
    `CREATE INDEX idx_category_rules_category ON category_rules(category_id)`,
    `CREATE INDEX idx_attachments_upload ON attachments(upload_status)`,
    `CREATE INDEX idx_tags_name ON tags(name COLLATE NOCASE)`,
  ],
};
