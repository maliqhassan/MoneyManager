import type { CurrencyCode } from '@/domain/currency/currencies';
import { compareDates } from '@/domain/dates/calendar';
import type { Bill } from '@/domain/models';
import { monthlyCost, type PeriodicCost, yearlyCost } from '@/domain/planning/recurrence';
import type { SqlDatabase, SqlExecutor, SqlValue } from '@/database/types';
import { AppError } from '@/lib/errors';
import {
  type BillInput,
  billInputSchema,
  type BillLinkInput,
  billLinkInputSchema,
  type BillPaymentInput,
  billPaymentInputSchema,
  type ValidBillInput,
} from '@/validation/planning';

import type {
  BillKind,
  BillListItem,
  BillPaymentDetail,
  BillRepository,
  PaidBillItem,
  SubscriptionSummary,
} from '../types';
import { advanceBill, reopenDueDate } from './billSchedule';
import { Converter } from './fx';
import { type BillPaymentRow, type BillRow, toBill, toBillPayment } from './planningMappers';
import { fromBool, insertSynced, type RepositoryContext, updateSynced, validate } from './shared';
import type { SqliteTransactionRepository } from './SqliteTransactionRepository';

const fieldError = (field: string, key: string) =>
  new AppError('validation', key, { fieldErrors: { [field]: key } });

interface ListRow extends BillRow {
  account_name: string | null;
  category_name: string | null;
  category_system_key: string | null;
  category_icon: string | null;
  category_color: string | null;
}

const LIST_SELECT = `
  SELECT b.*, a.name AS account_name, c.name AS category_name,
    c.system_key AS category_system_key, c.icon AS category_icon, c.color AS category_color
  FROM bills b
  LEFT JOIN accounts a ON a.id = b.account_id
  LEFT JOIN categories c ON c.id = b.category_id`;

const toItem = (r: ListRow): BillListItem => ({
  bill: toBill(r),
  accountName: r.account_name,
  categoryName: r.category_name,
  categorySystemKey: r.category_system_key,
  categoryIcon: r.category_icon,
  categoryColor: r.category_color,
});

interface PaymentRow extends BillPaymentRow {
  tx_id: string | null;
  tx_amount: number | null;
  tx_currency: CurrencyCode | null;
  tx_local_date: string | null;
  tx_account_name: string | null;
}

const PAYMENT_SELECT = `
  SELECT p.*, t.id AS tx_id, t.amount_minor AS tx_amount, t.currency AS tx_currency,
    t.local_date AS tx_local_date, a.name AS tx_account_name
  FROM bill_payments p
  LEFT JOIN transactions t ON t.id = p.transaction_id AND t.deleted_at IS NULL
  LEFT JOIN accounts a ON a.id = t.account_id`;

const toPaymentDetail = (r: PaymentRow): BillPaymentDetail => ({
  ...toBillPayment(r),
  transaction:
    r.tx_id && r.tx_amount !== null && r.tx_currency && r.tx_local_date
      ? {
          id: r.tx_id,
          amountMinor: r.tx_amount,
          currency: r.tx_currency,
          localDate: r.tx_local_date,
          accountName: r.tx_account_name ?? '',
        }
      : null,
});

const kindClause = (kind: BillKind | undefined, alias = 'b') =>
  kind === undefined ? '' : `AND ${alias}.is_subscription = ${kind === 'subscription' ? 1 : 0}`;

/**
 * Bills and subscriptions are expected commitments. They never create or
 * deduct money on their own: paying one records a normal expense transaction
 * (or links an existing one) together with a bill_payments row, in one local
 * write — the transaction is queued before the payment that references it.
 */
export class SqliteBillRepository implements BillRepository {
  constructor(
    private readonly db: SqlDatabase,
    private readonly ctx: RepositoryContext,
    private readonly transactions: SqliteTransactionRepository,
  ) {}

  // ------------------------------------------------------------------ reads

  async list(options: { kind?: BillKind; archived?: boolean }): Promise<BillListItem[]> {
    const rows = await this.db.getAll<ListRow>(
      `${LIST_SELECT}
       WHERE b.user_id = ? AND b.deleted_at IS NULL AND b.is_active = ? ${kindClause(options.kind)}
       ORDER BY b.next_due_date, b.name COLLATE NOCASE`,
      [this.ctx.userId, options.archived ? 0 : 1],
    );
    return rows.map(toItem);
  }

  async upcoming(
    through: string,
    options: { kind?: BillKind; limit?: number } = {},
  ): Promise<BillListItem[]> {
    const rows = await this.db.getAll<ListRow>(
      `${LIST_SELECT}
       WHERE b.user_id = ? AND b.deleted_at IS NULL AND b.is_active = 1
         AND b.next_due_date <= ? ${kindClause(options.kind)}
       ORDER BY b.next_due_date, b.name COLLATE NOCASE
       LIMIT ?`,
      [this.ctx.userId, through, options.limit ?? 100],
    );
    return rows.map(toItem);
  }

  async getById(id: string) {
    const row = await this.db.getFirst<ListRow>(
      `${LIST_SELECT} WHERE b.id = ? AND b.user_id = ? AND b.deleted_at IS NULL`,
      [id, this.ctx.userId],
    );
    if (!row) return null;
    const payments = await this.db.getAll<PaymentRow>(
      `${PAYMENT_SELECT}
       WHERE p.bill_id = ? AND p.deleted_at IS NULL
       ORDER BY p.due_date DESC LIMIT 36`,
      [id],
    );
    return { ...toItem(row), payments: payments.map(toPaymentDetail) };
  }

  async recentPayments(options: { kind?: BillKind; limit: number }): Promise<PaidBillItem[]> {
    const rows = await this.db.getAll<PaymentRow & { bill_name: string; is_subscription: number }>(
      `SELECT x.*, b.name AS bill_name, b.is_subscription FROM (${PAYMENT_SELECT}) x
       JOIN bills b ON b.id = x.bill_id
       WHERE x.user_id = ? AND x.deleted_at IS NULL AND x.status = 'paid'
         AND b.deleted_at IS NULL ${kindClause(options.kind)}
       ORDER BY x.due_date DESC, x.paid_at DESC LIMIT ?`,
      [this.ctx.userId, options.limit],
    );
    return rows.map((r) => ({
      payment: toPaymentDetail(r),
      billName: r.bill_name,
      isSubscription: r.is_subscription === 1,
    }));
  }

  async subscriptionSummary(
    today: string,
    baseCurrency: CurrencyCode,
  ): Promise<SubscriptionSummary> {
    const subs = (await this.list({ kind: 'subscription' })).map((i) => i.bill);
    const byCurrency = new Map<CurrencyCode, { monthly: PeriodicCost; yearly: PeriodicCost }>();
    const addCost = (a: PeriodicCost, b: PeriodicCost): PeriodicCost => ({
      amountMinor: a.amountMinor + b.amountMinor,
      approximate: a.approximate || b.approximate,
    });
    for (const b of subs) {
      const m = monthlyCost(b.amountMinor, b);
      const y = yearlyCost(b.amountMinor, b);
      const prev = byCurrency.get(b.currency);
      byCurrency.set(
        b.currency,
        prev
          ? { monthly: addCost(prev.monthly, m), yearly: addCost(prev.yearly, y) }
          : { monthly: m, yearly: y },
      );
    }
    const perCurrency = [...byCurrency.entries()]
      .map(([currency, v]) => ({ currency, ...v }))
      .sort((a, b) => a.currency.localeCompare(b.currency));

    const converter = new Converter(this.db);
    let base: SubscriptionSummary['base'] = {
      currency: baseCurrency,
      monthly: { amountMinor: 0, approximate: false },
      yearly: { amountMinor: 0, approximate: false },
    };
    for (const row of perCurrency) {
      const m = await converter.convert(row.monthly.amountMinor, row.currency, baseCurrency, today);
      const y = await converter.convert(row.yearly.amountMinor, row.currency, baseCurrency, today);
      if (m === null || y === null || !base) {
        base = null;
        continue;
      }
      const converted = row.currency !== baseCurrency;
      base = {
        currency: baseCurrency,
        monthly: addCost(base.monthly, {
          amountMinor: m,
          approximate: row.monthly.approximate || converted,
        }),
        yearly: addCost(base.yearly, {
          amountMinor: y,
          approximate: row.yearly.approximate || converted,
        }),
      };
    }
    return { count: subs.length, perCurrency, base, missingRates: converter.missingList() };
  }

  // ----------------------------------------------------------------- writes

  async create(input: BillInput): Promise<Bill> {
    const valid = validate(billInputSchema, input);
    const id = this.ctx.newId();
    await this.db.transaction(async (tx) => {
      await this.checkAccount(tx, valid, true);
      await this.checkCategory(tx, valid.categoryId, true);
      await insertSynced(tx, this.ctx, 'bills', id, {
        ...this.billValues(valid),
        anchor_date: valid.nextDueDate,
        next_due_date: valid.nextDueDate,
        is_active: 1,
      });
    });
    this.ctx.onChange('bills');
    return (await this.readBill(this.db, id))!;
  }

  async update(id: string, input: BillInput): Promise<void> {
    const valid = validate(billInputSchema, input);
    await this.db.transaction(async (tx) => {
      const existing = await this.requireBill(tx, id);
      await this.checkAccount(tx, valid, valid.accountId !== existing.accountId);
      if (valid.categoryId !== existing.categoryId) {
        await this.checkCategory(tx, valid.categoryId, true);
      }
      // Changing the schedule re-anchors it on the chosen next due date;
      // payments already recorded stay as they are.
      const scheduleChanged =
        valid.frequency !== existing.frequency ||
        valid.interval !== existing.interval ||
        valid.nextDueDate !== existing.nextDueDate;
      await updateSynced(tx, this.ctx, 'bills', id, {
        ...this.billValues(valid),
        ...(scheduleChanged
          ? { anchor_date: valid.nextDueDate, next_due_date: valid.nextDueDate }
          : {}),
      });
    });
    this.ctx.onChange('bills');
  }

  async setArchived(id: string, archived: boolean): Promise<void> {
    await this.db.transaction(async (tx) => {
      await this.requireBill(tx, id);
      await updateSynced(tx, this.ctx, 'bills', id, { is_active: fromBool(!archived) });
    });
    this.ctx.onChange('bills');
  }

  async markPaid(billId: string, input: BillPaymentInput): Promise<string> {
    const valid = validate(billPaymentInputSchema, input);
    if (valid.transaction.type !== 'expense') {
      throw fieldError('type', 'bills.errors.paymentType');
    }
    let transactionId = '';
    await this.db.transaction(async (tx) => {
      const bill = await this.requireDue(tx, billId, valid.dueDate);
      // A normal Phase 2 expense: validated, balanced and queued like any other.
      transactionId = await this.transactions.createInTransaction(tx, input.transaction);
      await this.recordPayment(
        tx,
        bill,
        valid.dueDate,
        'paid',
        transactionId,
        valid.transaction.amountMinor,
      );
    });
    this.ctx.onChange('transactions');
    this.ctx.onChange('accounts');
    this.ctx.onChange('bills');
    return transactionId;
  }

  async linkPayment(billId: string, input: BillLinkInput): Promise<void> {
    const valid = validate(billLinkInputSchema, input);
    await this.db.transaction(async (tx) => {
      const bill = await this.requireDue(tx, billId, valid.dueDate);
      const t = await tx.getFirst<{ type: string; amount_minor: number }>(
        `SELECT type, amount_minor FROM transactions WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
        [valid.transactionId, this.ctx.userId],
      );
      if (!t || t.type !== 'expense') {
        throw fieldError('transactionId', 'bills.errors.linkInvalid');
      }
      const linked = await tx.getFirst(
        `SELECT id FROM bill_payments WHERE transaction_id = ? AND deleted_at IS NULL`,
        [valid.transactionId],
      );
      if (linked) throw fieldError('transactionId', 'bills.errors.alreadyLinked');
      await this.recordPayment(
        tx,
        bill,
        valid.dueDate,
        'paid',
        valid.transactionId,
        -t.amount_minor,
      );
    });
    this.ctx.onChange('bills');
  }

  async skip(billId: string, dueDate: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const bill = await this.requireDue(tx, billId, dueDate);
      await this.recordPayment(tx, bill, dueDate, 'skipped', null, null);
    });
    this.ctx.onChange('bills');
  }

  async undoPayment(paymentId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const payment = await tx.getFirst<{ bill_id: string; due_date: string }>(
        `SELECT bill_id, due_date FROM bill_payments WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
        [paymentId, this.ctx.userId],
      );
      if (!payment) throw new AppError('not_found', `Payment ${paymentId} not found`);
      await updateSynced(
        tx,
        this.ctx,
        'bill_payments',
        paymentId,
        { deleted_at: this.ctx.now() },
        'delete',
      );
      await reopenDueDate(tx, this.ctx, payment.bill_id, payment.due_date);
    });
    this.ctx.onChange('bills');
  }

  // ---------------------------------------------------------------- helpers

  private async readBill(db: SqlExecutor, id: string): Promise<Bill | null> {
    const row = await db.getFirst<BillRow>(
      `SELECT * FROM bills WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
      [id, this.ctx.userId],
    );
    return row ? toBill(row) : null;
  }

  private async requireBill(db: SqlExecutor, id: string): Promise<Bill> {
    const bill = await this.readBill(db, id);
    if (!bill) throw new AppError('not_found', `Bill ${id} not found`);
    return bill;
  }

  /** Bills are settled in order: only the current (earliest unpaid) due date. */
  private async requireDue(db: SqlExecutor, id: string, dueDate: string): Promise<Bill> {
    const bill = await this.requireBill(db, id);
    if (!bill.isActive) throw fieldError('billId', 'bills.errors.archived');
    if (compareDates(dueDate, bill.nextDueDate) !== 0) {
      throw fieldError('dueDate', 'bills.errors.notDue');
    }
    return bill;
  }

  private async recordPayment(
    tx: SqlExecutor,
    bill: Bill,
    dueDate: string,
    status: 'paid' | 'skipped',
    transactionId: string | null,
    amountMinor: number | null,
  ): Promise<void> {
    await insertSynced(tx, this.ctx, 'bill_payments', this.ctx.newId(), {
      bill_id: bill.id,
      due_date: dueDate,
      status,
      paid_at: status === 'paid' ? this.ctx.now() : null,
      amount_minor: amountMinor,
      transaction_id: transactionId,
    });
    await advanceBill(tx, this.ctx, bill.id, dueDate);
  }

  /** Account must exist, match the bill currency and (for new links) be active. */
  private async checkAccount(db: SqlExecutor, v: ValidBillInput, mustBeActive: boolean) {
    if (!v.accountId) return;
    const account = await db.getFirst<{ currency: CurrencyCode; is_archived: number }>(
      `SELECT currency, is_archived FROM accounts WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
      [v.accountId, this.ctx.userId],
    );
    if (!account) throw fieldError('accountId', 'bills.errors.accountNotFound');
    if (mustBeActive && account.is_archived === 1) {
      throw fieldError('accountId', 'bills.errors.accountArchived');
    }
    if (account.currency !== v.currency) {
      throw fieldError('currency', 'bills.errors.currencyMismatch');
    }
  }

  private async checkCategory(db: SqlExecutor, categoryId: string | null, mustBeActive: boolean) {
    if (!categoryId) return;
    const row = await db.getFirst<{ kind: string; is_archived: number }>(
      `SELECT kind, is_archived FROM categories WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
      [categoryId, this.ctx.userId],
    );
    if (!row) throw fieldError('categoryId', 'bills.errors.categoryNotFound');
    if (row.kind !== 'expense') throw fieldError('categoryId', 'bills.errors.categoryKind');
    if (mustBeActive && row.is_archived === 1) {
      throw fieldError('categoryId', 'bills.errors.categoryArchived');
    }
  }

  private billValues(v: ValidBillInput): Record<string, SqlValue> {
    return {
      name: v.name,
      account_id: v.accountId,
      category_id: v.categoryId,
      amount_minor: v.amountMinor,
      currency: v.currency,
      is_variable_amount: fromBool(v.isVariableAmount),
      is_subscription: fromBool(v.isSubscription),
      frequency: v.frequency,
      interval: v.interval,
      end_date: v.endDate,
      reminder_days_before: v.reminderDaysBefore,
      autopay: fromBool(v.autopay),
      notes: v.notes,
    };
  }
}
