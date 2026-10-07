import type { Migration } from './index';

/**
 * Local schema v4 — Phase 3 (budgets, bills/subscriptions, savings goals).
 * Mirrors supabase/migrations/20261010090000_budgets_bills_goals.sql.
 * Additive: existing rows are preserved and backfilled.
 *
 * - budgets.category_id: budget scope (NULL = all spending).
 * - budget_revisions: amount + rollover with an effective date, so editing a
 *   budget never rewrites periods that already happened.
 * - bills.anchor_date: first due date; occurrences are computed from it so
 *   month-end dates don't drift. end_date / autopay complete the schedule.
 * - goal_contributions: currency (contributions may differ from the goal's
 *   currency), optional account and the transfer that moved the money.
 */
export const migration004Planning: Migration = {
  version: 4,
  name: 'planning',
  statements: [
    `ALTER TABLE budgets ADD COLUMN category_id TEXT`,
    `CREATE TABLE budget_revisions (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  version INTEGER NOT NULL DEFAULT 0,
  sync_status TEXT NOT NULL DEFAULT 'pending' CHECK (sync_status IN ('synced', 'pending', 'conflict')),
  budget_id TEXT NOT NULL,
  effective_from TEXT NOT NULL,
  amount_minor INTEGER NOT NULL CHECK (amount_minor >= 0),
  rollover_enabled INTEGER NOT NULL DEFAULT 0 CHECK (rollover_enabled IN (0, 1))
)`,
    `CREATE INDEX idx_budget_revisions_budget ON budget_revisions(budget_id, effective_from)`,
    `CREATE INDEX idx_budgets_scope ON budgets(is_archived, category_id, period_type)`,

    `ALTER TABLE bills ADD COLUMN anchor_date TEXT`,
    `UPDATE bills SET anchor_date = next_due_date WHERE anchor_date IS NULL`,
    `ALTER TABLE bills ADD COLUMN end_date TEXT`,
    `ALTER TABLE bills ADD COLUMN autopay INTEGER NOT NULL DEFAULT 0 CHECK (autopay IN (0, 1))`,
    `CREATE INDEX idx_bills_account ON bills(account_id)`,
    `CREATE INDEX idx_bill_payments_transaction ON bill_payments(transaction_id)`,

    `ALTER TABLE goal_contributions ADD COLUMN currency TEXT`,
    `UPDATE goal_contributions SET currency =
       (SELECT g.currency FROM savings_goals g WHERE g.id = goal_contributions.goal_id)
     WHERE currency IS NULL`,
    `ALTER TABLE goal_contributions ADD COLUMN account_id TEXT`,
    `ALTER TABLE goal_contributions ADD COLUMN transfer_id TEXT`,
    `CREATE INDEX idx_goal_contributions_date ON goal_contributions(goal_id, contributed_on)`,
    `CREATE INDEX idx_goal_contributions_transfer ON goal_contributions(transfer_id)`,
    `CREATE INDEX idx_savings_goals_status ON savings_goals(status, target_date)`,
  ],
};
