import type { AccountType } from '@/domain/enums';
import type { CurrencyCode } from '@/domain/currency/currencies';
import type {
  BalanceInput,
  CategorySpendRow,
  FlowRow,
  FlowType,
  MerchantSpendRow,
} from '@/domain/reports/aggregate';
import type { ConversionBasis, ConversionNote } from '@/domain/fx/note';
import type { DateRange } from '@/domain/reports/periods';
import type { SqlDatabase, SqlValue } from '@/database/types';

import type { ReportLine, ReportLineQuery, ReportRepository } from '../types';
import { Converter, perEntryKey, resolveInCurrency, type StoredAmount } from './fx';

const placeholders = (n: number) => Array.from({ length: n }, () => '?').join(', ');

/** Per-entry (or per split line) grouping for amounts that need a rate. */
const LINE_KEY = perEntryKey('COALESCE(s.id, t.id)');
const ENTRY_KEY = perEntryKey('id', 'transactions');

/** Split lines (when present) instead of their parent; each entry counted once. */
const SPLIT_JOIN = `LEFT JOIN transaction_splits s
  ON s.transaction_id = t.id AND s.deleted_at IS NULL AND t.is_split = 1`;
const LINE_AMOUNT = `CASE WHEN s.id IS NOT NULL THEN s.amount_minor ELSE t.amount_minor END`;
const LINE_BASE = `CASE WHEN s.id IS NOT NULL THEN s.base_amount_minor ELSE t.base_amount_minor END`;
const LINE_CATEGORY = `COALESCE(s.category_id, t.category_id)`;

/**
 * Read-only reporting queries over the LOCAL database (works offline; every
 * unsynced local entry is included exactly once — sync never creates a
 * second copy because rows are keyed by their client-generated id).
 *
 * Aggregation is done in SQL per day and currency, filtered by the
 * `local_date` range (indexed), so a report never loads the full history.
 * Amounts are then resolved to the base currency (recorded snapshot, or a
 * known rate on the entry date; otherwise null — see domain/reports).
 */
export class SqliteReportRepository implements ReportRepository {
  constructor(
    private readonly db: SqlDatabase,
    private readonly userId: string,
  ) {}

  async flows(range: DateRange, base: CurrencyCode): Promise<FlowRow[]> {
    const rows = await this.db.getAll<StoredAmount & { type: FlowType; n: number }>(
      `SELECT local_date, type, currency, base_currency, base_fx_source,
              SUM(amount_minor) AS amount, SUM(base_amount_minor) AS base, COUNT(*) AS n
       FROM transactions
       WHERE user_id = ? AND deleted_at IS NULL AND type IN ('income', 'expense', 'refund')
         AND local_date >= ? AND local_date <= ?
       GROUP BY local_date, type, currency, base_currency, base_fx_source, ${ENTRY_KEY}`,
      [this.userId, range.start, range.end, base, base],
    );
    const converter = new Converter(this.db);
    const out: FlowRow[] = [];
    for (const r of rows) {
      out.push({
        localDate: r.local_date,
        type: r.type,
        currency: r.currency,
        amountMinor: r.amount,
        baseMinor: await resolveInCurrency(converter, r, base),
        count: r.n,
      });
    }
    return out;
  }

  async categorySpending(range: DateRange, base: CurrencyCode): Promise<CategorySpendRow[]> {
    const rows = await this.db.getAll<StoredAmount & { category_id: string | null }>(
      `SELECT t.local_date, ${LINE_CATEGORY} AS category_id, t.currency, t.base_currency,
              t.base_fx_source, SUM(${LINE_AMOUNT}) AS amount, SUM(${LINE_BASE}) AS base
       FROM transactions t ${SPLIT_JOIN}
       WHERE t.user_id = ? AND t.deleted_at IS NULL AND t.type IN ('expense', 'refund')
         AND t.local_date >= ? AND t.local_date <= ?
       GROUP BY t.local_date, ${LINE_CATEGORY}, t.currency, t.base_currency, t.base_fx_source,
                ${LINE_KEY}`,
      [this.userId, range.start, range.end, base, base],
    );
    const converter = new Converter(this.db);
    const out: CategorySpendRow[] = [];
    for (const r of rows) {
      out.push({
        categoryId: r.category_id,
        currency: r.currency,
        amountMinor: r.amount,
        baseMinor: await resolveInCurrency(converter, r, base),
      });
    }
    return out;
  }

  async merchantSpending(range: DateRange, base: CurrencyCode): Promise<MerchantSpendRow[]> {
    // Merchants are per transaction: the parent amount is used once (no split join).
    const rows = await this.db.getAll<StoredAmount & { merchant_key: string | null; n: number }>(
      `SELECT local_date, NULLIF(merchant_key, '') AS merchant_key, currency, base_currency,
              base_fx_source, SUM(amount_minor) AS amount, SUM(base_amount_minor) AS base,
              COUNT(*) AS n
       FROM transactions
       WHERE user_id = ? AND deleted_at IS NULL AND type IN ('expense', 'refund')
         AND local_date >= ? AND local_date <= ?
       GROUP BY local_date, NULLIF(merchant_key, ''), currency, base_currency, base_fx_source,
                ${ENTRY_KEY}`,
      [this.userId, range.start, range.end, base, base],
    );
    const converter = new Converter(this.db);
    const out: MerchantSpendRow[] = [];
    for (const r of rows) {
      out.push({
        merchantKey: r.merchant_key,
        currency: r.currency,
        amountMinor: r.amount,
        baseMinor: await resolveInCurrency(converter, r, base),
        count: r.n,
      });
    }
    return out;
  }

  async conversionNote(range: DateRange, base: CurrencyCode): Promise<ConversionNote> {
    // The same rows and policy as flows(), so the note describes exactly
    // what the totals summed.
    const rows = await this.db.getAll<StoredAmount>(
      `SELECT local_date, currency, base_currency, base_fx_source,
              SUM(amount_minor) AS amount, SUM(base_amount_minor) AS base
       FROM transactions
       WHERE user_id = ? AND deleted_at IS NULL AND type IN ('income', 'expense', 'refund')
         AND local_date >= ? AND local_date <= ?
       GROUP BY local_date, currency, base_currency, base_fx_source, ${ENTRY_KEY}`,
      [this.userId, range.start, range.end, base, base],
    );
    const converter = new Converter(this.db);
    for (const r of rows) await resolveInCurrency(converter, r, base);
    return converter.note(base);
  }

  async merchantNames(keys: readonly string[]): Promise<Record<string, string>> {
    if (keys.length === 0) return {};
    // The most recently used spelling of each merchant (what the user typed).
    const rows = await this.db.getAll<{ merchant_key: string; payee: string }>(
      `SELECT merchant_key, payee FROM (
         SELECT merchant_key, payee,
                ROW_NUMBER() OVER (PARTITION BY merchant_key
                                   ORDER BY local_date DESC, occurred_at DESC) AS rn
         FROM transactions
         WHERE user_id = ? AND deleted_at IS NULL AND payee IS NOT NULL
           AND merchant_key IN (${placeholders(keys.length)})
       ) WHERE rn = 1`,
      [this.userId, ...keys],
    );
    return Object.fromEntries(rows.map((r) => [r.merchant_key, r.payee]));
  }

  async dataStart(): Promise<string | null> {
    const row = await this.db.getFirst<{ first: string | null }>(
      `SELECT MIN(d) AS first FROM (
         SELECT MIN(local_date) AS d FROM transactions WHERE user_id = ? AND deleted_at IS NULL
         UNION ALL
         SELECT MIN(opening_balance_date) FROM accounts WHERE user_id = ? AND deleted_at IS NULL
       )`,
      [this.userId, this.userId],
    );
    return row?.first ?? null;
  }

  async balanceInputs(range: DateRange) {
    const accounts = await this.db.getAll<{
      id: string;
      name: string;
      type: AccountType;
      currency: CurrencyCode;
      opening_balance_minor: number;
      opening_balance_date: string;
      prior: number;
    }>(
      `SELECT a.id, a.name, a.type, a.currency, a.opening_balance_minor, a.opening_balance_date,
              COALESCE((SELECT SUM(t.amount_minor) FROM transactions t
                        WHERE t.account_id = a.id AND t.deleted_at IS NULL
                          AND t.local_date < ?), 0) AS prior
       FROM accounts a
       WHERE a.user_id = ? AND a.deleted_at IS NULL AND a.is_archived = 0
       ORDER BY a.sort_order, a.name COLLATE NOCASE`,
      [range.start, this.userId],
    );
    const daily = await this.db.getAll<{ account_id: string; local_date: string; delta: number }>(
      `SELECT account_id, local_date, SUM(amount_minor) AS delta FROM transactions
       WHERE user_id = ? AND deleted_at IS NULL AND local_date >= ? AND local_date <= ?
       GROUP BY account_id, local_date`,
      [this.userId, range.start, range.end],
    );
    return accounts.map((a) => ({
      accountId: a.id,
      name: a.name,
      type: a.type,
      currency: a.currency,
      input: {
        openingMinor: a.opening_balance_minor,
        openingDate: a.opening_balance_date,
        priorDeltaMinor: a.prior,
        daily: daily
          .filter((d) => d.account_id === a.id)
          .map((d) => ({ localDate: d.local_date, deltaMinor: d.delta })),
      } satisfies BalanceInput,
    }));
  }

  async lines(query: ReportLineQuery): Promise<ReportLine[]> {
    const where: string[] = [
      't.user_id = ?',
      't.deleted_at IS NULL',
      't.local_date >= ?',
      't.local_date <= ?',
    ];
    const params: SqlValue[] = [this.userId, query.range.start, query.range.end];
    let useSplits = false;
    switch (query.kind) {
      case 'income':
        where.push(`t.type = 'income'`);
        break;
      case 'spending':
        where.push(`t.type IN ('expense', 'refund')`);
        break;
      case 'merchant':
        where.push(`t.type IN ('expense', 'refund')`);
        if (query.merchantKey) {
          where.push('t.merchant_key = ?');
          params.push(query.merchantKey);
        } else where.push(`(t.merchant_key IS NULL OR t.merchant_key = '')`);
        break;
      case 'category': {
        useSplits = true;
        where.push(`t.type IN ('expense', 'refund')`);
        if (query.categoryId) {
          const ids = await this.withSubcategories(
            query.categoryId,
            query.includeSubcategories ?? false,
          );
          where.push(`${LINE_CATEGORY} IN (${placeholders(ids.length)})`);
          params.push(...ids);
        } else where.push(`${LINE_CATEGORY} IS NULL`);
        break;
      }
    }
    const rows = await this.db.getAll<{
      id: string;
      type: 'income' | 'expense' | 'refund';
      payee: string | null;
      local_date: string;
      account_name: string;
      category_id: string | null;
      category_name: string | null;
      category_system_key: string | null;
      amount: number;
      currency: CurrencyCode;
      base: number;
      base_currency: CurrencyCode;
      base_fx_source: string;
      split_line: number;
    }>(
      `SELECT t.id, t.type, t.payee, t.local_date, a.name AS account_name,
              ${useSplits ? LINE_CATEGORY : 't.category_id'} AS category_id,
              c.name AS category_name, c.system_key AS category_system_key,
              ${useSplits ? LINE_AMOUNT : 't.amount_minor'} AS amount, t.currency,
              ${useSplits ? LINE_BASE : 't.base_amount_minor'} AS base, t.base_currency,
              t.base_fx_source,
              ${useSplits ? 's.id IS NOT NULL' : '0'} AS split_line
       FROM transactions t
       JOIN accounts a ON a.id = t.account_id
       ${useSplits ? SPLIT_JOIN : ''}
       LEFT JOIN categories c ON c.id = ${useSplits ? LINE_CATEGORY : 't.category_id'}
       WHERE ${where.join(' AND ')}
       ORDER BY t.local_date DESC, t.occurred_at DESC, t.id DESC
       LIMIT 1000`,
      params,
    );
    const converter = new Converter(this.db);
    const out: ReportLine[] = [];
    for (const r of rows) {
      let baseMinor: number | null | undefined;
      let basis: ConversionBasis | undefined;
      if (query.base) {
        if (r.currency === query.base) basis = 'native';
        else if (r.base_currency === query.base && r.base_fx_source !== 'unconverted') {
          basis = 'snapshot';
        }
        baseMinor = await resolveInCurrency(converter, r, query.base);
        basis ??= baseMinor === null ? 'missing' : 'rate';
      }
      out.push({
        ...this.line(r),
        ...(query.base ? { baseMinor, basis } : {}),
      });
    }
    return out;
  }

  private line(r: {
    id: string;
    type: 'income' | 'expense' | 'refund';
    payee: string | null;
    local_date: string;
    account_name: string;
    category_id: string | null;
    category_name: string | null;
    category_system_key: string | null;
    amount: number;
    currency: CurrencyCode;
    split_line: number;
  }): ReportLine {
    return {
      transactionId: r.id,
      type: r.type,
      payee: r.payee,
      localDate: r.local_date,
      accountName: r.account_name,
      categoryId: r.category_id,
      categoryName: r.category_name,
      categorySystemKey: r.category_system_key,
      amountMinor: r.amount,
      currency: r.currency,
      isSplitLine: r.split_line === 1,
    };
  }

  private async withSubcategories(id: string, include: boolean): Promise<string[]> {
    if (!include) return [id];
    const children = await this.db.getAll<{ id: string }>(
      `SELECT id FROM categories WHERE parent_id = ? AND user_id = ?`,
      [id, this.userId],
    );
    return [id, ...children.map((c) => c.id)];
  }
}
