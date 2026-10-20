import type { Migration } from './index';

/**
 * Local schema v6 — Phase 7 (recurring rules, occurrences, reminders).
 * Mirrors supabase/migrations/20261019090000_recurring_rules.sql. Additive;
 * existing rows are kept and backfilled (no version bumps).
 *
 * - recurring_transactions: status (active / paused / ended), active_from
 *   (occurrences before it are never due), reminder_days_before, tag_names.
 * - transactions.recurrence_date: the occurrence a generated transaction
 *   belongs to; at most one live transaction per (rule, occurrence).
 * - recurring_occurrences: the decision for one scheduled date ('posted' with
 *   its transaction, or 'skipped'); unique per (rule, date).
 */
export const migration006Recurring: Migration = {
  version: 6,
  name: 'recurring',
  statements: [
    `ALTER TABLE recurring_transactions ADD COLUMN status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'ended'))`,
    `ALTER TABLE recurring_transactions ADD COLUMN active_from TEXT`,
    `ALTER TABLE recurring_transactions ADD COLUMN reminder_days_before INTEGER CHECK (reminder_days_before IS NULL OR reminder_days_before BETWEEN 0 AND 30)`,
    `ALTER TABLE recurring_transactions ADD COLUMN tag_names TEXT NOT NULL DEFAULT '[]'`,
    `UPDATE recurring_transactions
       SET status = CASE WHEN is_active = 1 THEN 'active' ELSE 'paused' END,
           active_from = start_date
     WHERE active_from IS NULL`,
    `CREATE INDEX idx_recurring_status ON recurring_transactions(status, next_occurrence_date)`,

    `ALTER TABLE transactions ADD COLUMN recurrence_date TEXT`,
    `CREATE UNIQUE INDEX idx_transactions_recurrence ON transactions(recurring_transaction_id, recurrence_date)
       WHERE deleted_at IS NULL AND recurring_transaction_id IS NOT NULL AND recurrence_date IS NOT NULL`,

    `CREATE TABLE recurring_occurrences (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  version INTEGER NOT NULL DEFAULT 0,
  sync_status TEXT NOT NULL DEFAULT 'pending' CHECK (sync_status IN ('synced', 'pending', 'conflict')),
  recurring_transaction_id TEXT NOT NULL,
  occurrence_date TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('posted', 'skipped')),
  transaction_id TEXT,
  CHECK (status = 'posted' OR transaction_id IS NULL)
)`,
    `CREATE UNIQUE INDEX idx_recurring_occurrences_unique ON recurring_occurrences(recurring_transaction_id, occurrence_date)
       WHERE deleted_at IS NULL`,
    `CREATE INDEX idx_recurring_occurrences_transaction ON recurring_occurrences(transaction_id)`,
  ],
};
