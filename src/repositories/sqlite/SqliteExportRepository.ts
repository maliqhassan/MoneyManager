import type { CurrencyCode } from '@/domain/currency/currencies';
import type { TransactionType } from '@/domain/enums';
import type { SqlDatabase, SqlValue } from '@/database/types';

import type { ExportFilter } from '../types';

const placeholders = (n: number) => Array.from({ length: n }, () => '?').join(', ');

/** Rows as stored, with joined names; formatting happens in the export builder. */
export interface ExportTransactionRow {
  id: string;
  local_date: string;
  occurred_at: string;
  time_zone: string;
  type: TransactionType;
  amount_minor: number;
  currency: CurrencyCode;
  base_amount_minor: number;
  base_currency: CurrencyCode;
  base_fx_rate: string;
  base_fx_rate_date: string;
  base_fx_source: string;
  account_id: string;
  account_name: string;
  category_id: string | null;
  category_name: string | null;
  category_system_key: string | null;
  parent_name: string | null;
  parent_system_key: string | null;
  payee: string | null;
  notes: string | null;
  tags: string | null;
  transfer_id: string | null;
  other_account_name: string | null;
  refund_of_transaction_id: string | null;
  split_count: number;
  sync_status: string;
}

/**
 * Read-only export queries. Everything is scoped to the signed-in user's
 * rows in their own local database and excludes deleted records.
 */
export class SqliteExportRepository {
  constructor(
    private readonly db: SqlDatabase,
    private readonly userId: string,
  ) {}

  private transactionWhere(filter: ExportFilter, alias = 't') {
    const where = [`${alias}.user_id = ?`, `${alias}.deleted_at IS NULL`];
    const params: SqlValue[] = [this.userId];
    if (filter.from) {
      where.push(`${alias}.local_date >= ?`);
      params.push(filter.from);
    }
    if (filter.to) {
      where.push(`${alias}.local_date <= ?`);
      params.push(filter.to);
    }
    if (filter.accountIds.length) {
      where.push(`${alias}.account_id IN (${placeholders(filter.accountIds.length)})`);
      params.push(...filter.accountIds);
    }
    if (filter.types.length) {
      where.push(`${alias}.type IN (${placeholders(filter.types.length)})`);
      params.push(...filter.types);
    }
    return { where: where.join(' AND '), params };
  }

  async transactions(filter: ExportFilter): Promise<ExportTransactionRow[]> {
    const { where, params } = this.transactionWhere(filter);
    return this.db.getAll<ExportTransactionRow>(
      `SELECT t.id, t.local_date, t.occurred_at, t.time_zone, t.type, t.amount_minor, t.currency,
              t.base_amount_minor, t.base_currency, t.base_fx_rate, t.base_fx_rate_date,
              t.base_fx_source, t.account_id,
              a.name AS account_name, t.category_id, c.name AS category_name,
              c.system_key AS category_system_key, p.name AS parent_name,
              p.system_key AS parent_system_key, t.payee, t.notes,
              (SELECT GROUP_CONCAT(name, '; ') FROM (
                 SELECT g.name FROM transaction_tags tt JOIN tags g ON g.id = tt.tag_id
                 WHERE tt.transaction_id = t.id AND tt.deleted_at IS NULL AND g.deleted_at IS NULL
                 ORDER BY g.name)) AS tags,
              t.transfer_id,
              (SELECT oa.name FROM transactions o JOIN accounts oa ON oa.id = o.account_id
               WHERE o.transfer_id = t.transfer_id AND o.id <> t.id AND o.deleted_at IS NULL
               LIMIT 1) AS other_account_name,
              t.refund_of_transaction_id,
              (SELECT COUNT(*) FROM transaction_splits s
               WHERE s.transaction_id = t.id AND s.deleted_at IS NULL) AS split_count,
              t.sync_status
       FROM transactions t
       JOIN accounts a ON a.id = t.account_id
       LEFT JOIN categories c ON c.id = t.category_id
       LEFT JOIN categories p ON p.id = c.parent_id
       WHERE ${where}
       ORDER BY t.local_date, t.occurred_at, t.id`,
      params,
    );
  }

  async splits(filter: ExportFilter) {
    const { where, params } = this.transactionWhere(filter);
    return this.db.getAll<{
      transaction_id: string;
      sort_order: number;
      amount_minor: number;
      currency: CurrencyCode;
      category_id: string | null;
      category_name: string | null;
      category_system_key: string | null;
      parent_name: string | null;
      parent_system_key: string | null;
      notes: string | null;
    }>(
      `SELECT s.transaction_id, s.sort_order, s.amount_minor, t.currency, s.category_id,
              c.name AS category_name, c.system_key AS category_system_key,
              p.name AS parent_name, p.system_key AS parent_system_key, s.notes
       FROM transaction_splits s
       JOIN transactions t ON t.id = s.transaction_id
       LEFT JOIN categories c ON c.id = s.category_id
       LEFT JOIN categories p ON p.id = c.parent_id
       WHERE s.deleted_at IS NULL AND ${where}
       ORDER BY t.local_date, t.occurred_at, t.id, s.sort_order`,
      params,
    );
  }

  async accounts() {
    return this.db.getAll<{
      id: string;
      name: string;
      type: string;
      currency: CurrencyCode;
      opening_balance_minor: number;
      opening_balance_date: string;
      postings: number;
      credit_limit_minor: number | null;
      include_in_totals: number;
      is_archived: number;
      notes: string | null;
    }>(
      `SELECT a.id, a.name, a.type, a.currency, a.opening_balance_minor, a.opening_balance_date,
              COALESCE((SELECT SUM(t.amount_minor) FROM transactions t
                        WHERE t.account_id = a.id AND t.deleted_at IS NULL), 0) AS postings,
              a.credit_limit_minor, a.include_in_totals, a.is_archived, a.notes
       FROM accounts a WHERE a.user_id = ? AND a.deleted_at IS NULL
       ORDER BY a.sort_order, a.name COLLATE NOCASE`,
      [this.userId],
    );
  }

  async categories() {
    return this.db.getAll<{
      id: string;
      name: string;
      kind: string;
      system_key: string | null;
      parent_id: string | null;
      parent_name: string | null;
      parent_system_key: string | null;
      is_archived: number;
    }>(
      `SELECT c.id, c.name, c.kind, c.system_key, c.parent_id, p.name AS parent_name,
              p.system_key AS parent_system_key, c.is_archived
       FROM categories c LEFT JOIN categories p ON p.id = c.parent_id
       WHERE c.user_id = ? AND c.deleted_at IS NULL
       ORDER BY c.kind, c.parent_id IS NOT NULL, c.sort_order`,
      [this.userId],
    );
  }

  async budgets() {
    return this.db.getAll<{
      id: string;
      name: string;
      category_id: string | null;
      category_name: string | null;
      category_system_key: string | null;
      period_type: string;
      start_date: string;
      end_date: string | null;
      currency: CurrencyCode;
      amount_minor: number | null;
      rollover_enabled: number;
      is_archived: number;
    }>(
      `SELECT b.id, b.name, b.category_id, c.name AS category_name,
              c.system_key AS category_system_key, b.period_type, b.start_date, b.end_date,
              b.currency, b.amount_minor, b.rollover_enabled, b.is_archived
       FROM budgets b LEFT JOIN categories c ON c.id = b.category_id
       WHERE b.user_id = ? AND b.deleted_at IS NULL ORDER BY b.name COLLATE NOCASE`,
      [this.userId],
    );
  }

  async budgetRevisions() {
    return this.db.getAll<{
      budget_id: string;
      effective_from: string;
      amount_minor: number;
      currency: CurrencyCode;
      rollover_enabled: number;
    }>(
      `SELECT r.budget_id, r.effective_from, r.amount_minor, b.currency, r.rollover_enabled
       FROM budget_revisions r JOIN budgets b ON b.id = r.budget_id
       WHERE r.user_id = ? AND r.deleted_at IS NULL AND b.deleted_at IS NULL
       ORDER BY r.budget_id, r.effective_from, r.created_at`,
      [this.userId],
    );
  }

  async bills() {
    return this.db.getAll<{
      id: string;
      name: string;
      is_subscription: number;
      amount_minor: number;
      currency: CurrencyCode;
      is_variable_amount: number;
      account_name: string | null;
      category_name: string | null;
      category_system_key: string | null;
      frequency: string;
      interval: number;
      anchor_date: string | null;
      next_due_date: string;
      end_date: string | null;
      reminder_days_before: number | null;
      autopay: number;
      is_active: number;
      notes: string | null;
    }>(
      `SELECT b.id, b.name, b.is_subscription, b.amount_minor, b.currency, b.is_variable_amount,
              a.name AS account_name, c.name AS category_name, c.system_key AS category_system_key,
              b.frequency, b.interval, b.anchor_date, b.next_due_date, b.end_date,
              b.reminder_days_before, b.autopay, b.is_active, b.notes
       FROM bills b
       LEFT JOIN accounts a ON a.id = b.account_id
       LEFT JOIN categories c ON c.id = b.category_id
       WHERE b.user_id = ? AND b.deleted_at IS NULL ORDER BY b.name COLLATE NOCASE`,
      [this.userId],
    );
  }

  async billPayments() {
    return this.db.getAll<{
      id: string;
      bill_id: string;
      due_date: string;
      status: string;
      paid_at: string | null;
      amount_minor: number | null;
      currency: CurrencyCode;
      transaction_id: string | null;
    }>(
      `SELECT p.id, p.bill_id, p.due_date, p.status, p.paid_at, p.amount_minor, b.currency,
              p.transaction_id
       FROM bill_payments p JOIN bills b ON b.id = p.bill_id
       WHERE p.user_id = ? AND p.deleted_at IS NULL AND b.deleted_at IS NULL
       ORDER BY p.bill_id, p.due_date`,
      [this.userId],
    );
  }

  async goals() {
    return this.db.getAll<{
      id: string;
      name: string;
      target_amount_minor: number;
      currency: CurrencyCode;
      target_date: string | null;
      account_name: string | null;
      status: string;
    }>(
      `SELECT g.id, g.name, g.target_amount_minor, g.currency, g.target_date,
              a.name AS account_name, g.status
       FROM savings_goals g LEFT JOIN accounts a ON a.id = g.account_id
       WHERE g.user_id = ? AND g.deleted_at IS NULL ORDER BY g.name COLLATE NOCASE`,
      [this.userId],
    );
  }

  async goalContributions() {
    return this.db.getAll<{
      id: string;
      goal_id: string;
      contributed_on: string;
      amount_minor: number;
      currency: CurrencyCode | null;
      goal_currency: CurrencyCode;
      account_name: string | null;
      transfer_id: string | null;
      notes: string | null;
    }>(
      `SELECT gc.id, gc.goal_id, gc.contributed_on, gc.amount_minor, gc.currency,
              g.currency AS goal_currency, a.name AS account_name, gc.transfer_id, gc.notes
       FROM goal_contributions gc
       JOIN savings_goals g ON g.id = gc.goal_id
       LEFT JOIN accounts a ON a.id = gc.account_id
       WHERE gc.user_id = ? AND gc.deleted_at IS NULL AND g.deleted_at IS NULL
       ORDER BY gc.goal_id, gc.contributed_on`,
      [this.userId],
    );
  }

  /** Local changes not yet confirmed by the server (stated in the manifest). */
  async pendingChanges(): Promise<number> {
    const row = await this.db.getFirst<{ n: number }>(
      `SELECT COUNT(*) AS n FROM sync_outbox WHERE status IN ('pending', 'in_flight', 'failed')`,
    );
    return row?.n ?? 0;
  }
}
