import type { CurrencyCode } from '@/domain/currency/currencies';
import type { AccountType } from '@/domain/enums';
import type { Account } from '@/domain/models';
import { add, money } from '@/domain/money/money';
import type { SqlDatabase, SqlValue } from '@/database/types';
import { AppError } from '@/lib/errors';
import {
  type AccountInput,
  accountInputSchema,
  type AccountUpdate,
  accountUpdateSchema,
} from '@/validation/entities';

import type { AccountBalance, AccountRepository } from '../types';
import {
  fromBool,
  insertSynced,
  type RepositoryContext,
  toBool,
  updateSynced,
  validate,
} from './shared';

interface AccountRow {
  id: string;
  user_id: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  version: number;
  name: string;
  type: AccountType;
  currency: CurrencyCode;
  opening_balance_minor: number;
  opening_balance_date: string;
  credit_limit_minor: number | null;
  institution: string | null;
  color: string | null;
  icon: string | null;
  notes: string | null;
  include_in_totals: number;
  is_archived: number;
  sort_order: number;
}

function toAccount(row: AccountRow): Account {
  return {
    id: row.id,
    userId: row.user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    version: row.version,
    name: row.name,
    type: row.type,
    currency: row.currency,
    openingBalanceMinor: row.opening_balance_minor,
    openingBalanceDate: row.opening_balance_date,
    creditLimitMinor: row.credit_limit_minor,
    institution: row.institution,
    color: row.color,
    icon: row.icon,
    notes: row.notes,
    includeInTotals: toBool(row.include_in_totals),
    isArchived: toBool(row.is_archived),
    sortOrder: row.sort_order,
  };
}

/** camelCase update fields → column names. */
const COLUMN_FOR: Record<string, string> = {
  name: 'name',
  type: 'type',
  openingBalanceMinor: 'opening_balance_minor',
  openingBalanceDate: 'opening_balance_date',
  creditLimitMinor: 'credit_limit_minor',
  institution: 'institution',
  color: 'color',
  icon: 'icon',
  notes: 'notes',
  includeInTotals: 'include_in_totals',
  isArchived: 'is_archived',
  sortOrder: 'sort_order',
};

export class SqliteAccountRepository implements AccountRepository {
  constructor(
    private readonly db: SqlDatabase,
    private readonly ctx: RepositoryContext,
  ) {}

  async list(options: { includeArchived?: boolean } = {}): Promise<Account[]> {
    const rows = await this.db.getAll<AccountRow>(
      `SELECT * FROM accounts
       WHERE user_id = ? AND deleted_at IS NULL ${options.includeArchived ? '' : 'AND is_archived = 0'}
       ORDER BY sort_order, name COLLATE NOCASE`,
      [this.ctx.userId],
    );
    return rows.map(toAccount);
  }

  async getById(id: string): Promise<Account | null> {
    const row = await this.db.getFirst<AccountRow>(
      `SELECT * FROM accounts WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
      [id, this.ctx.userId],
    );
    return row ? toAccount(row) : null;
  }

  async create(input: AccountInput): Promise<Account> {
    const valid = validate(accountInputSchema, input);
    const id = this.ctx.newId();
    await this.db.transaction((tx) =>
      insertSynced(tx, this.ctx, 'accounts', id, {
        name: valid.name,
        type: valid.type,
        currency: valid.currency,
        opening_balance_minor: valid.openingBalanceMinor,
        opening_balance_date: valid.openingBalanceDate,
        credit_limit_minor: valid.creditLimitMinor,
        institution: valid.institution,
        color: valid.color,
        icon: valid.icon,
        notes: valid.notes,
        include_in_totals: fromBool(valid.includeInTotals),
        is_archived: 0,
        sort_order: valid.sortOrder,
      }),
    );
    this.ctx.onChange('accounts');
    return this.require(id);
  }

  async update(id: string, patch: AccountUpdate): Promise<Account> {
    const valid = validate(accountUpdateSchema, patch);
    const values: Record<string, SqlValue> = {};
    for (const [field, value] of Object.entries(valid)) {
      const column = COLUMN_FOR[field];
      if (!column || value === undefined) continue;
      values[column] = typeof value === 'boolean' ? fromBool(value) : (value as SqlValue);
    }
    if (Object.keys(values).length === 0) return this.require(id);

    await this.db.transaction((tx) => updateSynced(tx, this.ctx, 'accounts', id, values));
    this.ctx.onChange('accounts');
    return this.require(id);
  }

  setArchived(id: string, archived: boolean): Promise<Account> {
    return this.update(id, { isArchived: archived });
  }

  async remove(id: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const usage = await tx.getFirst<{ n: number }>(
        `SELECT COUNT(*) AS n FROM transactions WHERE account_id = ? AND deleted_at IS NULL`,
        [id],
      );
      if ((usage?.n ?? 0) > 0) {
        throw new AppError('validation', 'Account has transactions', {
          fieldErrors: { _root: 'accounts.errors.hasTransactions' },
        });
      }
      await updateSynced(tx, this.ctx, 'accounts', id, { deleted_at: this.ctx.now() }, 'delete');
    });
    this.ctx.onChange('accounts');
  }

  async getBalances(): Promise<AccountBalance[]> {
    // SQLite sums 64-bit integers exactly; the domain layer adds the opening balance.
    const rows = await this.db.getAll<{
      id: string;
      currency: CurrencyCode;
      opening_balance_minor: number;
      postings_minor: number;
    }>(
      `SELECT a.id, a.currency, a.opening_balance_minor,
              COALESCE(SUM(t.amount_minor), 0) AS postings_minor
       FROM accounts a
       LEFT JOIN transactions t ON t.account_id = a.id AND t.deleted_at IS NULL
       WHERE a.user_id = ? AND a.deleted_at IS NULL
       GROUP BY a.id`,
      [this.ctx.userId],
    );
    return rows.map((r) => ({
      accountId: r.id,
      balance: add(money(r.opening_balance_minor, r.currency), money(r.postings_minor, r.currency)),
    }));
  }

  private async require(id: string): Promise<Account> {
    const account = await this.getById(id);
    if (!account) throw new AppError('not_found', `Account ${id} not found`);
    return account;
  }
}
