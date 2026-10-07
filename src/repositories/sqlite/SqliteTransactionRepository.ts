import { type CurrencyCode, CURRENCY_CODES, getMinorUnits } from '@/domain/currency/currencies';
import type { CategoryKind, TransactionType } from '@/domain/enums';
import { buildTransferLegs } from '@/domain/finance/transfers';
import { normalizeMerchant } from '@/domain/merchants/normalize';
import { type BaseCurrencySnapshot, createBaseCurrencySnapshot } from '@/domain/money/conversion';
import { type Money, money } from '@/domain/money/money';
import { buildTransactionSearchText, escapeLike, normalizeSearchText } from '@/domain/text/search';
import { zonedDateTimeToInstant } from '@/domain/dates/zoned';
import {
  allocateBaseAmounts,
  amountRangeBounds,
  categoryKindFor,
  type EntryType,
  signedAmount,
} from '@/domain/transactions/transactions';
import type { SqlDatabase, SqlExecutor, SqlValue } from '@/database/types';
import { AppError } from '@/lib/errors';
import {
  type TransactionInput,
  transactionInputSchema,
  type TransferInput,
  transferInputSchema,
  type ValidTransactionInput,
  type ValidTransferInput,
} from '@/validation/transactions';

import type {
  CashFlowRow,
  CategorySpendRow,
  TransactionDetail,
  TransactionFilter,
  TransactionListItem,
  TransactionRepository,
  TransferLegSummary,
} from '../types';
import { findRate } from './SqliteExchangeRateRepository';
import { listTags, resolveTagIds } from './SqliteTagRepository';
import {
  type AttachmentRow,
  type CategoryRow,
  type SplitRow,
  type TagRow,
  toAttachment,
  toCategory,
  toSplit,
  toTag,
  toTransaction,
  type TransactionRow,
} from './mappers';
import {
  fromBool,
  insertSynced,
  type RepositoryContext,
  toBool,
  updateSynced,
  validate,
} from './shared';

const PAGE_SIZE = 50;

const fieldError = (field: string, key: string) =>
  new AppError('validation', key, { fieldErrors: { [field]: key } });

interface AccountRef {
  id: string;
  name: string;
  currency: CurrencyCode;
  is_archived: number;
}

interface ListRow extends TransactionRow {
  account_name: string;
  category_name: string | null;
  category_system_key: string | null;
  category_icon: string | null;
  category_color: string | null;
  split_count: number;
  counterpart_account_name: string | null;
  has_receipt: number;
}

function toListItem(r: ListRow): TransactionListItem {
  return {
    id: r.id,
    type: r.type,
    amountMinor: r.amount_minor,
    currency: r.currency,
    payee: r.payee,
    notes: r.notes,
    localDate: r.local_date,
    occurredAt: r.occurred_at,
    timeZone: r.time_zone,
    accountId: r.account_id,
    accountName: r.account_name,
    categoryId: r.category_id,
    categoryName: r.category_name,
    categorySystemKey: r.category_system_key,
    categoryIcon: r.category_icon,
    categoryColor: r.category_color,
    isSplit: toBool(r.is_split),
    splitCount: r.split_count,
    transferId: r.transfer_id,
    counterpartAccountName: r.counterpart_account_name,
    refundOfTransactionId: r.refund_of_transaction_id,
    hasReceipt: r.has_receipt === 1,
  };
}

const LIST_SELECT = `
  SELECT t.*, a.name AS account_name,
    c.name AS category_name, c.system_key AS category_system_key,
    c.icon AS category_icon, c.color AS category_color,
    (SELECT COUNT(*) FROM transaction_splits s
       WHERE s.transaction_id = t.id AND s.deleted_at IS NULL) AS split_count,
    ca.name AS counterpart_account_name,
    EXISTS (SELECT 1 FROM attachments at
       WHERE at.transaction_id = t.id AND at.deleted_at IS NULL) AS has_receipt
  FROM transactions t
  JOIN accounts a ON a.id = t.account_id
  LEFT JOIN categories c ON c.id = t.category_id
  LEFT JOIN transfers tr ON tr.id = t.transfer_id
  LEFT JOIN accounts ca ON ca.id =
    CASE WHEN t.amount_minor < 0 THEN tr.to_account_id ELSE tr.from_account_id END`;

const ORDER = `ORDER BY t.local_date DESC, t.occurred_at DESC, t.id DESC`;

const placeholders = (n: number) => Array.from({ length: n }, () => '?').join(', ');

const ZERO_EXP = CURRENCY_CODES.filter((c) => getMinorUnits(c) === 0);
const THREE_EXP = CURRENCY_CODES.filter((c) => getMinorUnits(c) === 3);

export class SqliteTransactionRepository implements TransactionRepository {
  constructor(
    private readonly db: SqlDatabase,
    private readonly ctx: RepositoryContext,
  ) {}

  // ------------------------------------------------------------------ reads

  async list(filter: TransactionFilter = {}): Promise<TransactionListItem[]> {
    const where: string[] = ['t.user_id = ?', 't.deleted_at IS NULL'];
    const params: SqlValue[] = [this.ctx.userId];

    if (filter.accountIds?.length) {
      where.push(`t.account_id IN (${placeholders(filter.accountIds.length)})`);
      params.push(...filter.accountIds);
    }
    if (filter.types?.length) {
      where.push(`t.type IN (${placeholders(filter.types.length)})`);
      params.push(...filter.types);
    }
    if (filter.from) {
      where.push('t.local_date >= ?');
      params.push(filter.from);
    }
    if (filter.to) {
      where.push('t.local_date <= ?');
      params.push(filter.to);
    }
    if (filter.categoryIds?.length) {
      const ids = await this.expandCategories(filter.categoryIds);
      where.push(`(t.category_id IN (${placeholders(ids.length)}) OR EXISTS (
        SELECT 1 FROM transaction_splits s WHERE s.transaction_id = t.id
          AND s.deleted_at IS NULL AND s.category_id IN (${placeholders(ids.length)})))`);
      params.push(...ids, ...ids);
    }
    if (filter.tagNames?.length) {
      const wanted = new Set(filter.tagNames.map(normalizeSearchText));
      const tagIds = (await listTags(this.db, this.ctx.userId))
        .filter((tag) => wanted.has(normalizeSearchText(tag.name)))
        .map((tag) => tag.id);
      if (tagIds.length === 0) return [];
      where.push(`EXISTS (SELECT 1 FROM transaction_tags tt WHERE tt.transaction_id = t.id
        AND tt.deleted_at IS NULL AND tt.tag_id IN (${placeholders(tagIds.length)}))`);
      params.push(...tagIds);
    }
    if (filter.minAmount || filter.maxAmount) {
      const { clause, values } = amountClause(filter.minAmount ?? null, filter.maxAmount ?? null);
      where.push(clause);
      params.push(...values);
    }
    if (filter.search?.trim()) {
      const term = normalizeSearchText(filter.search);
      const like = `%${escapeLike(term)}%`;
      const categoryIds = new Set(filter.searchCategoryIds ?? []);
      const categories = await this.db.getAll<{ id: string; name: string }>(
        `SELECT id, name FROM categories WHERE user_id = ? AND deleted_at IS NULL`,
        [this.ctx.userId],
      );
      for (const c of categories)
        if (normalizeSearchText(c.name).includes(term)) categoryIds.add(c.id);
      const tagIds = (await listTags(this.db, this.ctx.userId))
        .filter((tag) => normalizeSearchText(tag.name).includes(term))
        .map((tag) => tag.id);
      const cat = [...categoryIds];
      const parts = [`t.search_text LIKE ? ESCAPE '\\'`, `t.merchant_key LIKE ? ESCAPE '\\'`];
      const searchParams: SqlValue[] = [like, like];
      if (cat.length) {
        parts.push(`t.category_id IN (${placeholders(cat.length)})`);
        parts.push(`EXISTS (SELECT 1 FROM transaction_splits s WHERE s.transaction_id = t.id
          AND s.deleted_at IS NULL AND s.category_id IN (${placeholders(cat.length)}))`);
        searchParams.push(...cat, ...cat);
      }
      if (tagIds.length) {
        parts.push(`EXISTS (SELECT 1 FROM transaction_tags tt WHERE tt.transaction_id = t.id
          AND tt.deleted_at IS NULL AND tt.tag_id IN (${placeholders(tagIds.length)}))`);
        searchParams.push(...tagIds);
      }
      where.push(`(${parts.join(' OR ')})`);
      params.push(...searchParams);
    }
    if (filter.after) {
      const { localDate, occurredAt, id } = filter.after;
      where.push(`(t.local_date < ? OR (t.local_date = ? AND (t.occurred_at < ?
        OR (t.occurred_at = ? AND t.id < ?))))`);
      params.push(localDate, localDate, occurredAt, occurredAt, id);
    }

    const rows = await this.db.getAll<ListRow>(
      `${LIST_SELECT} WHERE ${where.join(' AND ')} ${ORDER} LIMIT ?`,
      [...params, filter.limit ?? PAGE_SIZE],
    );
    return rows.map(toListItem);
  }

  async getById(id: string): Promise<TransactionDetail | null> {
    const row = await this.db.getFirst<TransactionRow>(
      `SELECT * FROM transactions WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
      [id, this.ctx.userId],
    );
    if (!row) return null;
    const transaction = toTransaction(row);
    const account = await this.db.getFirst<AccountRef & { type: string }>(
      `SELECT id, name, currency, is_archived, type FROM accounts WHERE id = ?`,
      [transaction.accountId],
    );
    const categoryRow = transaction.categoryId
      ? await this.db.getFirst<CategoryRow>(`SELECT * FROM categories WHERE id = ?`, [
          transaction.categoryId,
        ])
      : null;
    const splitRows = await this.db.getAll<
      SplitRow & { category_name: string | null; category_system_key: string | null }
    >(
      `SELECT s.*, c.name AS category_name, c.system_key AS category_system_key
       FROM transaction_splits s LEFT JOIN categories c ON c.id = s.category_id
       WHERE s.transaction_id = ? AND s.deleted_at IS NULL ORDER BY s.sort_order`,
      [id],
    );
    const tagRows = await this.db.getAll<TagRow>(
      `SELECT tg.* FROM transaction_tags tt JOIN tags tg ON tg.id = tt.tag_id
       WHERE tt.transaction_id = ? AND tt.deleted_at IS NULL AND tg.deleted_at IS NULL
       ORDER BY tg.name COLLATE NOCASE`,
      [id],
    );
    const attachmentRows = await this.db.getAll<AttachmentRow>(
      `SELECT * FROM attachments WHERE transaction_id = ? AND deleted_at IS NULL ORDER BY created_at`,
      [id],
    );

    let transfer: TransactionDetail['transfer'] = null;
    if (transaction.transferId) {
      const legs = await this.db.getAll<{
        id: string;
        account_id: string;
        amount_minor: number;
        currency: CurrencyCode;
        account_name: string;
      }>(
        `SELECT t.id, t.account_id, t.amount_minor, t.currency, a.name AS account_name
         FROM transactions t JOIN accounts a ON a.id = t.account_id
         WHERE t.transfer_id = ? AND t.deleted_at IS NULL`,
        [transaction.transferId],
      );
      const leg = (l: (typeof legs)[number]): TransferLegSummary => ({
        transactionId: l.id,
        accountId: l.account_id,
        accountName: l.account_name,
        amountMinor: l.amount_minor,
        currency: l.currency,
      });
      const from = legs.find((l) => l.amount_minor < 0);
      const to = legs.find((l) => l.amount_minor > 0);
      if (from && to) transfer = { id: transaction.transferId, from: leg(from), to: leg(to) };
    }

    let refundOf: TransactionDetail['refundOf'] = null;
    if (transaction.refundOfTransactionId) {
      const original = await this.db.getFirst<TransactionRow>(
        `SELECT * FROM transactions WHERE id = ? AND user_id = ?`,
        [transaction.refundOfTransactionId, this.ctx.userId],
      );
      if (original) {
        const o = toTransaction(original);
        refundOf = {
          id: o.id,
          payee: o.payee,
          amountMinor: o.amountMinor,
          currency: o.currency,
          localDate: o.localDate,
        };
      }
    }

    return {
      transaction,
      account: {
        id: account?.id ?? transaction.accountId,
        name: account?.name ?? '',
        type: (account?.type ?? 'other') as TransactionDetail['account']['type'],
        currency: account?.currency ?? transaction.currency,
        isArchived: toBool(account?.is_archived ?? 0),
      },
      category: categoryRow ? toCategory(categoryRow) : null,
      splits: splitRows.map((s) => ({
        ...toSplit(s),
        categoryName: s.category_name,
        categorySystemKey: s.category_system_key,
      })),
      tags: tagRows.map(toTag),
      attachments: attachmentRows.map(toAttachment),
      transfer,
      refundOf,
    };
  }

  async cashFlow(from: string, to: string): Promise<CashFlowRow[]> {
    const rows = await this.db.getAll<{
      type: TransactionType;
      base_currency: CurrencyCode;
      total: number;
    }>(
      `SELECT type, base_currency, SUM(base_amount_minor) AS total FROM transactions
       WHERE user_id = ? AND deleted_at IS NULL AND type <> 'transfer'
         AND local_date >= ? AND local_date <= ?
       GROUP BY type, base_currency`,
      [this.ctx.userId, from, to],
    );
    return rows.map((r) => ({ type: r.type, baseCurrency: r.base_currency, totalMinor: r.total }));
  }

  async categorySpending(from: string, to: string): Promise<CategorySpendRow[]> {
    // Split parents contribute their split lines; others their own category.
    const rows = await this.db.getAll<{
      category_id: string | null;
      base_currency: CurrencyCode;
      total: number;
    }>(
      `SELECT COALESCE(s.category_id, t.category_id) AS category_id, t.base_currency,
              SUM(CASE WHEN s.id IS NOT NULL THEN s.base_amount_minor ELSE t.base_amount_minor END) AS total
       FROM transactions t
       LEFT JOIN transaction_splits s
         ON s.transaction_id = t.id AND s.deleted_at IS NULL AND t.is_split = 1
       WHERE t.user_id = ? AND t.deleted_at IS NULL AND t.type IN ('expense', 'refund')
         AND t.local_date >= ? AND t.local_date <= ?
       GROUP BY COALESCE(s.category_id, t.category_id), t.base_currency`,
      [this.ctx.userId, from, to],
    );
    return rows.map((r) => ({
      categoryId: r.category_id,
      baseCurrency: r.base_currency,
      totalMinor: r.total,
    }));
  }

  async lastCategoryForMerchant(merchantKey: string, kind: CategoryKind): Promise<string | null> {
    const types = kind === 'expense' ? ['expense', 'refund'] : ['income'];
    const row = await this.db.getFirst<{ category_id: string }>(
      `SELECT category_id FROM transactions
       WHERE user_id = ? AND deleted_at IS NULL AND merchant_key = ? AND category_id IS NOT NULL
         AND type IN (${placeholders(types.length)})
       ORDER BY local_date DESC, occurred_at DESC LIMIT 1`,
      [this.ctx.userId, merchantKey, ...types],
    );
    return row?.category_id ?? null;
  }

  async frequentCategoryIds(kind: CategoryKind, since: string, limit: number): Promise<string[]> {
    const rows = await this.db.getAll<{ category_id: string }>(
      `SELECT COALESCE(s.category_id, t.category_id) AS category_id, COUNT(*) AS n,
              MAX(t.local_date) AS last_used
       FROM transactions t
       LEFT JOIN transaction_splits s ON s.transaction_id = t.id AND s.deleted_at IS NULL
       JOIN categories c ON c.id = COALESCE(s.category_id, t.category_id)
       WHERE t.user_id = ? AND t.deleted_at IS NULL AND t.local_date >= ?
         AND c.kind = ? AND c.is_archived = 0 AND c.deleted_at IS NULL
       GROUP BY COALESCE(s.category_id, t.category_id)
       ORDER BY n DESC, last_used DESC LIMIT ?`,
      [this.ctx.userId, since, kind, limit],
    );
    return rows.map((r) => r.category_id);
  }

  refundCandidates(search: string, limit: number): Promise<TransactionListItem[]> {
    return this.list({ types: ['expense'], search: search || undefined, limit });
  }

  // ----------------------------------------------------------------- writes

  async create(input: TransactionInput): Promise<string> {
    const valid = validate(transactionInputSchema, input);
    const id = this.ctx.newId();
    await this.db.transaction(async (tx) => {
      const account = await this.requireAccount(tx, valid.accountId, 'accountId', true);
      await this.checkCategories(tx, valid, new Set());
      await this.checkRefundLink(tx, valid);
      const row = await this.buildEntryRow(tx, valid, account);
      await insertSynced(tx, this.ctx, 'transactions', id, row);
      await this.writeSplits(tx, id, valid, row);
      await this.writeTags(tx, id, valid.tagNames);
    });
    this.notify();
    return id;
  }

  async update(id: string, input: TransactionInput): Promise<void> {
    const valid = validate(transactionInputSchema, input);
    await this.db.transaction(async (tx) => {
      const existing = await this.requireTransaction(tx, id);
      if (existing.type === 'transfer')
        throw fieldError('type', 'transactions.errors.useTransferEdit');
      if (existing.type !== valid.type) throw fieldError('type', 'transactions.errors.typeLocked');
      // Unchanged references may be archived (history); changed ones must be active.
      const account = await this.requireAccount(
        tx,
        valid.accountId,
        'accountId',
        valid.accountId !== existing.account_id,
      );
      const previousCategories = new Set(
        [
          existing.category_id,
          ...(
            await tx.getAll<{ category_id: string | null }>(
              `SELECT category_id FROM transaction_splits WHERE transaction_id = ? AND deleted_at IS NULL`,
              [id],
            )
          ).map((s) => s.category_id),
        ].filter((c): c is string => !!c),
      );
      await this.checkCategories(tx, valid, previousCategories);
      await this.checkRefundLink(tx, valid, id);
      const row = await this.buildEntryRow(tx, valid, account);
      await updateSynced(tx, this.ctx, 'transactions', id, row);
      await this.softDeleteChildren(tx, id, { splits: true, tags: false, attachments: false });
      await this.writeSplits(tx, id, valid, row);
      await this.writeTags(tx, id, valid.tagNames);
    });
    this.notify();
  }

  async createTransfer(input: TransferInput): Promise<string> {
    const valid = validate(transferInputSchema, input);
    const transferId = this.ctx.newId();
    let outgoingId = '';
    await this.db.transaction(async (tx) => {
      const from = await this.requireAccount(tx, valid.fromAccountId, 'fromAccountId', true);
      const to = await this.requireAccount(tx, valid.toAccountId, 'toAccountId', true);
      outgoingId = this.ctx.newId();
      await this.writeTransfer(tx, transferId, valid, from, to, {
        outgoingId,
        incomingId: this.ctx.newId(),
        isNew: true,
      });
    });
    this.notify();
    return outgoingId;
  }

  async updateTransfer(transferId: string, input: TransferInput): Promise<void> {
    const valid = validate(transferInputSchema, input);
    await this.db.transaction(async (tx) => {
      const existing = await tx.getFirst<{ from_account_id: string; to_account_id: string }>(
        `SELECT from_account_id, to_account_id FROM transfers
         WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
        [transferId, this.ctx.userId],
      );
      if (!existing) throw new AppError('not_found', `Transfer ${transferId} not found`);
      const legs = await tx.getAll<{ id: string; amount_minor: number }>(
        `SELECT id, amount_minor FROM transactions WHERE transfer_id = ? AND deleted_at IS NULL`,
        [transferId],
      );
      const outgoing = legs.find((l) => l.amount_minor < 0);
      const incoming = legs.find((l) => l.amount_minor > 0);
      if (!outgoing || !incoming) throw new AppError('conflict', 'Transfer legs are inconsistent');
      const from = await this.requireAccount(
        tx,
        valid.fromAccountId,
        'fromAccountId',
        valid.fromAccountId !== existing.from_account_id,
      );
      const to = await this.requireAccount(
        tx,
        valid.toAccountId,
        'toAccountId',
        valid.toAccountId !== existing.to_account_id,
      );
      await this.writeTransfer(tx, transferId, valid, from, to, {
        outgoingId: outgoing.id,
        incomingId: incoming.id,
        isNew: false,
      });
    });
    this.notify();
  }

  async remove(id: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const existing = await this.requireTransaction(tx, id);
      if (existing.transfer_id) {
        const legs = await tx.getAll<{ id: string }>(
          `SELECT id FROM transactions WHERE transfer_id = ? AND deleted_at IS NULL`,
          [existing.transfer_id],
        );
        for (const leg of legs) await this.softDelete(tx, leg.id);
        await updateSynced(
          tx,
          this.ctx,
          'transfers',
          existing.transfer_id,
          { deleted_at: this.ctx.now() },
          'delete',
        );
      } else {
        await this.softDelete(tx, id);
      }
    });
    this.notify();
  }

  async duplicate(
    id: string,
    at: { localDate: string; localTime: string; timeZone: string },
  ): Promise<string> {
    const detail = await this.getById(id);
    if (!detail) throw new AppError('not_found', `Transaction ${id} not found`);
    const { transaction: t } = detail;
    if (detail.transfer) {
      const transferRow = await this.db.getFirst<{ notes: string | null }>(
        `SELECT notes FROM transfers WHERE id = ?`,
        [detail.transfer.id],
      );
      return this.createTransfer({
        fromAccountId: detail.transfer.from.accountId,
        toAccountId: detail.transfer.to.accountId,
        amountMinor: Math.abs(detail.transfer.from.amountMinor),
        receivedAmountMinor:
          detail.transfer.from.currency === detail.transfer.to.currency
            ? null
            : detail.transfer.to.amountMinor,
        ...at,
        notes: transferRow?.notes ?? null,
      });
    }
    return this.create({
      type: t.type as EntryType,
      accountId: t.accountId,
      amountMinor: Math.abs(t.amountMinor),
      ...at,
      payee: t.payee,
      notes: t.notes,
      categoryId: t.isSplit ? null : t.categoryId,
      splits: detail.splits.map((s) => ({
        categoryId: s.categoryId ?? '',
        amountMinor: Math.abs(s.amountMinor),
        notes: s.notes,
      })),
      tagNames: detail.tags.map((tag) => tag.name),
      refundOfTransactionId: t.refundOfTransactionId,
    });
  }

  // ---------------------------------------------------------------- helpers

  private notify(): void {
    // Balances are derived from transactions, so account queries refresh too.
    this.ctx.onChange('transactions');
    this.ctx.onChange('accounts');
  }

  private async requireTransaction(tx: SqlExecutor, id: string): Promise<TransactionRow> {
    const row = await tx.getFirst<TransactionRow>(
      `SELECT * FROM transactions WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
      [id, this.ctx.userId],
    );
    if (!row) throw new AppError('not_found', `Transaction ${id} not found`);
    return row;
  }

  /** Account must exist; when `mustBeActive`, it must not be archived (new postings). */
  private async requireAccount(
    tx: SqlExecutor,
    id: string,
    field: string,
    mustBeActive: boolean,
  ): Promise<AccountRef> {
    const account = await tx.getFirst<AccountRef>(
      `SELECT id, name, currency, is_archived FROM accounts
       WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
      [id, this.ctx.userId],
    );
    if (!account) throw fieldError(field, 'transactions.errors.accountNotFound');
    if (mustBeActive && account.is_archived === 1) {
      throw fieldError(field, 'transactions.errors.accountArchived');
    }
    return account;
  }

  /** Categories must exist, match the transaction kind, and (unless already used) be active. */
  private async checkCategories(
    tx: SqlExecutor,
    valid: ValidTransactionInput,
    alreadyUsed: ReadonlySet<string>,
  ): Promise<void> {
    const kind = categoryKindFor(valid.type);
    const check = async (categoryId: string, field: string) => {
      const row = await tx.getFirst<{ kind: CategoryKind; is_archived: number }>(
        `SELECT kind, is_archived FROM categories WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
        [categoryId, this.ctx.userId],
      );
      if (!row) throw fieldError(field, 'transactions.errors.categoryNotFound');
      if (row.kind !== kind) throw fieldError(field, 'transactions.errors.categoryKind');
      if (row.is_archived === 1 && !alreadyUsed.has(categoryId)) {
        throw fieldError(field, 'transactions.errors.categoryArchived');
      }
    };
    if (valid.splits.length > 0) {
      for (const [index, split] of valid.splits.entries()) {
        await check(split.categoryId, `splits.${index}.categoryId`);
      }
    } else if (valid.categoryId) {
      await check(valid.categoryId, 'categoryId');
    }
  }

  private async checkRefundLink(tx: SqlExecutor, valid: ValidTransactionInput, selfId?: string) {
    if (!valid.refundOfTransactionId) return;
    if (valid.refundOfTransactionId === selfId) {
      throw fieldError('refundOfTransactionId', 'transactions.errors.refundLinkInvalid');
    }
    const original = await tx.getFirst<{ type: TransactionType }>(
      `SELECT type FROM transactions WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
      [valid.refundOfTransactionId, this.ctx.userId],
    );
    if (!original || original.type !== 'expense') {
      throw fieldError('refundOfTransactionId', 'transactions.errors.refundLinkInvalid');
    }
  }

  /**
   * Base-currency snapshot at entry. If no rate is known, the amount is kept
   * in its own currency and marked 'unconverted' — reports then convert it
   * later or report the missing rate; nothing is guessed.
   */
  private async snapshot(
    tx: SqlExecutor,
    amount: Money,
    localDate: string,
  ): Promise<BaseCurrencySnapshot> {
    const prefs = await tx.getFirst<{ base_currency: CurrencyCode }>(
      `SELECT base_currency FROM user_preferences WHERE user_id = ? AND deleted_at IS NULL`,
      [this.ctx.userId],
    );
    const base = prefs?.base_currency ?? amount.currency;
    if (base === amount.currency) return createBaseCurrencySnapshot(amount, base, null, localDate);
    const rate = await findRate(tx, amount.currency, base, localDate);
    if (!rate) {
      return {
        baseCurrency: amount.currency,
        baseAmountMinor: amount.amountMinor,
        baseFxRate: '1',
        baseFxRateDate: localDate,
        baseFxSource: 'unconverted',
      };
    }
    return createBaseCurrencySnapshot(
      amount,
      base,
      { rate, rateDate: localDate, source: 'local_rates' },
      localDate,
    );
  }

  private async buildEntryRow(
    tx: SqlExecutor,
    valid: ValidTransactionInput,
    account: AccountRef,
  ): Promise<Record<string, SqlValue>> {
    const amountMinor = signedAmount(valid.type, valid.amountMinor);
    const snap = await this.snapshot(tx, money(amountMinor, account.currency), valid.localDate);
    const occurredAt = zonedDateTimeToInstant(valid.localDate, valid.localTime, valid.timeZone);
    const isSplit = valid.splits.length > 0;
    return {
      account_id: account.id,
      type: valid.type,
      amount_minor: amountMinor,
      currency: account.currency,
      original_amount_minor: amountMinor,
      original_currency: account.currency,
      fx_rate: '1',
      base_currency: snap.baseCurrency,
      base_amount_minor: snap.baseAmountMinor,
      base_fx_rate: snap.baseFxRate,
      base_fx_rate_date: snap.baseFxRateDate,
      base_fx_source: snap.baseFxSource,
      category_id: isSplit ? null : valid.categoryId,
      payee: valid.payee,
      notes: valid.notes,
      merchant_key: normalizeMerchant(valid.payee),
      search_text: buildTransactionSearchText(valid.payee, valid.notes),
      occurred_at: occurredAt.toISOString(),
      local_date: valid.localDate,
      time_zone: valid.timeZone,
      is_split: fromBool(isSplit),
      transfer_id: null,
      refund_of_transaction_id: valid.refundOfTransactionId,
    };
  }

  private async writeSplits(
    tx: SqlExecutor,
    transactionId: string,
    valid: ValidTransactionInput,
    row: Record<string, SqlValue>,
  ): Promise<void> {
    if (valid.splits.length === 0) return;
    const sign = valid.type === 'expense' ? -1 : 1;
    const amounts = valid.splits.map((s) => s.amountMinor * sign);
    const bases = allocateBaseAmounts(
      money(row.base_amount_minor as number, row.base_currency as CurrencyCode),
      amounts,
    );
    for (const [index, split] of valid.splits.entries()) {
      await insertSynced(tx, this.ctx, 'transaction_splits', this.ctx.newId(), {
        transaction_id: transactionId,
        category_id: split.categoryId,
        amount_minor: amounts[index]!,
        base_amount_minor: bases[index]!,
        notes: split.notes,
        sort_order: index,
      });
    }
  }

  /** Makes the transaction's tag links equal `names` (soft-deleting removed links). */
  private async writeTags(tx: SqlExecutor, transactionId: string, names: readonly string[]) {
    const wanted = await resolveTagIds(tx, this.ctx, names);
    const current = await tx.getAll<{ id: string; tag_id: string }>(
      `SELECT id, tag_id FROM transaction_tags WHERE transaction_id = ? AND deleted_at IS NULL`,
      [transactionId],
    );
    for (const link of current) {
      if (!wanted.includes(link.tag_id)) {
        await updateSynced(
          tx,
          this.ctx,
          'transaction_tags',
          link.id,
          { deleted_at: this.ctx.now() },
          'delete',
        );
      }
    }
    for (const tagId of wanted) {
      if (!current.some((l) => l.tag_id === tagId)) {
        await insertSynced(tx, this.ctx, 'transaction_tags', this.ctx.newId(), {
          transaction_id: transactionId,
          tag_id: tagId,
        });
      }
    }
  }

  private async softDeleteChildren(
    tx: SqlExecutor,
    transactionId: string,
    which: { splits: boolean; tags: boolean; attachments: boolean },
  ): Promise<void> {
    const tables = [
      which.splits ? 'transaction_splits' : null,
      which.tags ? 'transaction_tags' : null,
      which.attachments ? 'attachments' : null,
    ].filter((t): t is 'transaction_splits' | 'transaction_tags' | 'attachments' => t !== null);
    for (const table of tables) {
      const rows = await tx.getAll<{ id: string }>(
        `SELECT id FROM ${table} WHERE transaction_id = ? AND deleted_at IS NULL`,
        [transactionId],
      );
      for (const r of rows) {
        await updateSynced(tx, this.ctx, table, r.id, { deleted_at: this.ctx.now() }, 'delete');
      }
    }
  }

  private async softDelete(tx: SqlExecutor, id: string): Promise<void> {
    await this.softDeleteChildren(tx, id, { splits: true, tags: true, attachments: true });
    await updateSynced(tx, this.ctx, 'transactions', id, { deleted_at: this.ctx.now() }, 'delete');
  }

  private async writeTransfer(
    tx: SqlExecutor,
    transferId: string,
    valid: ValidTransferInput,
    from: AccountRef,
    to: AccountRef,
    ids: { outgoingId: string; incomingId: string; isNew: boolean },
  ): Promise<void> {
    if (from.currency !== to.currency && valid.receivedAmountMinor === null) {
      throw fieldError('receivedAmountMinor', 'transactions.errors.receivedAmountRequired');
    }
    const legs = buildTransferLegs({
      fromAccountId: from.id,
      toAccountId: to.id,
      fromCurrency: from.currency,
      toCurrency: to.currency,
      fromAmountMinor: valid.amountMinor,
      ...(from.currency !== to.currency && valid.receivedAmountMinor !== null
        ? { toAmountMinor: valid.receivedAmountMinor }
        : {}),
    });
    const occurredAt = zonedDateTimeToInstant(
      valid.localDate,
      valid.localTime,
      valid.timeZone,
    ).toISOString();
    const transferValues: Record<string, SqlValue> = {
      from_account_id: from.id,
      to_account_id: to.id,
      from_amount_minor: -legs.outgoing.amountMinor,
      from_currency: from.currency,
      to_amount_minor: legs.incoming.amountMinor,
      to_currency: to.currency,
      fx_rate: legs.fxRate,
      occurred_at: occurredAt,
      local_date: valid.localDate,
      notes: valid.notes,
    };
    // The transfer row is written (and queued) before its legs, so the server
    // receives the parent first (outbox is pushed in insertion order).
    if (ids.isNew) await insertSynced(tx, this.ctx, 'transfers', transferId, transferValues);
    else await updateSynced(tx, this.ctx, 'transfers', transferId, transferValues);

    const legRow = async (account: AccountRef, leg: Money): Promise<Record<string, SqlValue>> => {
      const snap = await this.snapshot(tx, leg, valid.localDate);
      return {
        account_id: account.id,
        type: 'transfer',
        amount_minor: leg.amountMinor,
        currency: leg.currency,
        original_amount_minor: leg.amountMinor,
        original_currency: leg.currency,
        fx_rate: legs.fxRate,
        base_currency: snap.baseCurrency,
        base_amount_minor: snap.baseAmountMinor,
        base_fx_rate: snap.baseFxRate,
        base_fx_rate_date: snap.baseFxRateDate,
        base_fx_source: snap.baseFxSource,
        category_id: null,
        payee: null,
        notes: valid.notes,
        merchant_key: null,
        search_text: buildTransactionSearchText(null, valid.notes),
        occurred_at: occurredAt,
        local_date: valid.localDate,
        time_zone: valid.timeZone,
        is_split: 0,
        transfer_id: transferId,
        refund_of_transaction_id: null,
      };
    };
    const outgoingRow = await legRow(from, legs.outgoing);
    const incomingRow = await legRow(to, legs.incoming);
    if (ids.isNew) {
      await insertSynced(tx, this.ctx, 'transactions', ids.outgoingId, outgoingRow);
      await insertSynced(tx, this.ctx, 'transactions', ids.incomingId, incomingRow);
    } else {
      await updateSynced(tx, this.ctx, 'transactions', ids.outgoingId, outgoingRow);
      await updateSynced(tx, this.ctx, 'transactions', ids.incomingId, incomingRow);
    }
  }

  private async expandCategories(ids: readonly string[]): Promise<string[]> {
    const children = await this.db.getAll<{ id: string }>(
      `SELECT id FROM categories WHERE parent_id IN (${placeholders(ids.length)}) AND deleted_at IS NULL`,
      [...ids],
    );
    return [...new Set([...ids, ...children.map((c) => c.id)])];
  }
}

/** Exact amount-range clause across currencies with 0, 2 or 3 decimals. */
function amountClause(
  min: string | null,
  max: string | null,
): { clause: string; values: SqlValue[] } {
  const bounds = amountRangeBounds(min, max);
  const groups: { currencies: readonly string[] | null; exp: 0 | 2 | 3 }[] = [
    { currencies: ZERO_EXP, exp: 0 },
    { currencies: THREE_EXP, exp: 3 },
    { currencies: null, exp: 2 },
  ];
  const parts: string[] = [];
  const values: SqlValue[] = [];
  for (const group of groups) {
    const b = bounds.byExponent[group.exp];
    const conditions: string[] = [];
    if (group.currencies) {
      conditions.push(`t.currency IN (${placeholders(group.currencies.length)})`);
      values.push(...group.currencies);
    } else {
      conditions.push(`t.currency NOT IN (${placeholders(ZERO_EXP.length + THREE_EXP.length)})`);
      values.push(...ZERO_EXP, ...THREE_EXP);
    }
    if (b.min !== null) {
      conditions.push('ABS(t.amount_minor) >= ?');
      values.push(b.min);
    }
    if (b.max !== null) {
      conditions.push('ABS(t.amount_minor) <= ?');
      values.push(b.max);
    }
    parts.push(`(${conditions.join(' AND ')})`);
  }
  return { clause: `(${parts.join(' OR ')})`, values };
}
