import type { CurrencyCode } from '@/domain/currency/currencies';
import { addDays, compareDates } from '@/domain/dates/calendar';
import type { RecurringTransaction } from '@/domain/models';
import {
  dueOccurrences,
  isFinished,
  MAX_BACKLOG_DAYS,
  nextUnhandled,
  pendingOccurrences,
  previewOccurrences,
  type RuleSchedulePlan,
  type RuleStatus,
  scheduledBetween,
} from '@/domain/planning/recurring';
import type { SqlDatabase, SqlExecutor, SqlValue } from '@/database/types';
import { AppError } from '@/lib/errors';
import {
  type RecurringRuleInput,
  recurringRuleInputSchema,
  type ValidRecurringRuleInput,
} from '@/validation/recurring';

import type {
  AutoPostResult,
  OccurrenceHistoryItem,
  PostOccurrenceResult,
  RecurringRepository,
  RecurringRuleDetail,
  RecurringRuleItem,
  RuleProblem,
} from '../types';
import { type RecurringRow, toRecurring } from './planningMappers';
import { fromBool, insertSynced, type RepositoryContext, updateSynced, validate } from './shared';
import type { SqliteTransactionRepository } from './SqliteTransactionRepository';

const fieldError = (field: string, key: string) =>
  new AppError('validation', key, { fieldErrors: { [field]: key } });

interface ListRow extends RecurringRow {
  account_name: string | null;
  account_currency: CurrencyCode | null;
  account_archived: number | null;
  category_name: string | null;
  category_system_key: string | null;
  category_archived: number | null;
}

const LIST_SELECT = `SELECT r.*, a.name AS account_name, a.currency AS account_currency,
         a.is_archived AS account_archived, c.name AS category_name,
         c.system_key AS category_system_key, c.is_archived AS category_archived
  FROM recurring_transactions r
  LEFT JOIN accounts a ON a.id = r.account_id AND a.deleted_at IS NULL
  LEFT JOIN categories c ON c.id = r.category_id AND c.deleted_at IS NULL`;

const planOf = (rule: RecurringTransaction): RuleSchedulePlan => ({
  frequency: rule.frequency,
  interval: rule.interval,
  startDate: rule.startDate,
  endDate: rule.endDate,
  activeFrom: rule.activeFrom,
  status: rule.status,
});

const isUniqueViolation = (e: unknown) =>
  /UNIQUE constraint failed|SQLITE_CONSTRAINT/i.test((e as Error)?.message ?? '');

/** The user's local calendar date of an ISO instant. */
function localDateOf(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date(iso));
}

/**
 * Recurring income/expense rules and their occurrences (docs/recurring.md).
 * Posting goes through the transaction repository (same validation, balances
 * and outbox as a typed entry) together with the occurrence row, in ONE
 * SQLite transaction; the unique (rule, date) indexes make it idempotent.
 */
export class SqliteRecurringRepository implements RecurringRepository {
  constructor(
    private readonly db: SqlDatabase,
    private readonly ctx: RepositoryContext,
    private readonly transactions: SqliteTransactionRepository,
  ) {}

  // ------------------------------------------------------------------ reads

  private async handledDates(db: SqlExecutor, ruleId: string): Promise<Set<string>> {
    const rows = await db.getAll<{ d: string }>(
      `SELECT occurrence_date AS d FROM recurring_occurrences
       WHERE recurring_transaction_id = ? AND deleted_at IS NULL`,
      [ruleId],
    );
    return new Set(rows.map((r) => r.d));
  }

  private problemOf(row: ListRow): RuleProblem | null {
    if (row.account_name === null || row.account_archived === 1) return 'account_archived';
    if (row.account_currency !== row.currency) return 'currency_changed';
    if (row.category_id && (row.category_name === null || row.category_archived === 1)) {
      return 'category_archived';
    }
    return null;
  }

  private async toItem(row: ListRow, today: string): Promise<RecurringRuleItem> {
    const rule = toRecurring(row);
    const handled = await this.handledDates(this.db, rule.id);
    const plan = planOf(rule);
    return {
      rule,
      accountName: row.account_name,
      categoryName: row.category_name,
      categorySystemKey: row.category_system_key,
      next: nextUnhandled(plan, handled, today),
      due: pendingOccurrences(plan, handled, today, today),
      finished: isFinished(plan, handled, today),
      problem: this.problemOf(row),
    };
  }

  async list(today: string, options: { status?: RuleStatus | 'all' } = {}) {
    const status = options.status ?? 'all';
    const rows = await this.db.getAll<ListRow>(
      `${LIST_SELECT}
       WHERE r.user_id = ? AND r.deleted_at IS NULL ${status === 'all' ? '' : 'AND r.status = ?'}
       ORDER BY CASE r.status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 ELSE 2 END,
                r.next_occurrence_date IS NULL, r.next_occurrence_date, r.payee COLLATE NOCASE`,
      status === 'all' ? [this.ctx.userId] : [this.ctx.userId, status],
    );
    const items: RecurringRuleItem[] = [];
    for (const row of rows) items.push(await this.toItem(row, today));
    return items;
  }

  async getById(id: string, today: string): Promise<RecurringRuleDetail | null> {
    const row = await this.db.getFirst<ListRow>(
      `${LIST_SELECT} WHERE r.id = ? AND r.user_id = ? AND r.deleted_at IS NULL`,
      [id, this.ctx.userId],
    );
    if (!row) return null;
    const item = await this.toItem(row, today);
    const history = await this.db.getAll<{
      occurrence_date: string;
      status: 'posted' | 'skipped';
      transaction_id: string | null;
      t_deleted: string | null;
      t_exists: number | null;
      amount_minor: number | null;
      currency: CurrencyCode | null;
    }>(
      `SELECT o.occurrence_date, o.status, o.transaction_id, t.deleted_at AS t_deleted,
              CASE WHEN t.id IS NULL THEN 0 ELSE 1 END AS t_exists,
              t.amount_minor, t.currency
       FROM recurring_occurrences o
       LEFT JOIN transactions t ON t.id = o.transaction_id
       WHERE o.recurring_transaction_id = ? AND o.deleted_at IS NULL
       ORDER BY o.occurrence_date DESC LIMIT 60`,
      [id],
    );
    const handled = await this.handledDates(this.db, id);
    const plan = planOf(item.rule);
    const upcoming =
      item.rule.status === 'active'
        ? previewOccurrences(
            plan,
            compareDates(today, plan.activeFrom) > 0 ? today : plan.activeFrom,
            12,
          )
            .filter((d) => !handled.has(d) && compareDates(d, today) > 0)
            .slice(0, 6)
        : [];
    return {
      ...item,
      upcoming,
      history: history.map((h): OccurrenceHistoryItem => ({
        date: h.occurrence_date,
        status: h.status,
        transactionId: h.transaction_id,
        transactionDeleted: h.status === 'posted' && (h.t_exists === 0 || h.t_deleted !== null),
        amountMinor: h.t_deleted === null ? h.amount_minor : null,
        currency: h.currency,
      })),
    };
  }

  // ----------------------------------------------------------------- writes

  private async requireRule(db: SqlExecutor, id: string): Promise<RecurringTransaction> {
    const row = await db.getFirst<RecurringRow>(
      `SELECT * FROM recurring_transactions WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
      [id, this.ctx.userId],
    );
    if (!row) throw new AppError('not_found', `Recurring rule ${id} not found`);
    return toRecurring(row);
  }

  /** Account must exist and be active; the rule uses its currency. */
  private async accountCurrency(db: SqlExecutor, accountId: string): Promise<CurrencyCode> {
    const a = await db.getFirst<{ currency: CurrencyCode; is_archived: number }>(
      `SELECT currency, is_archived FROM accounts WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
      [accountId, this.ctx.userId],
    );
    if (!a) throw fieldError('accountId', 'recurring.errors.accountNotFound');
    if (a.is_archived === 1) throw fieldError('accountId', 'recurring.errors.accountArchived');
    return a.currency;
  }

  private async checkCategory(db: SqlExecutor, v: ValidRecurringRuleInput) {
    const c = await db.getFirst<{ kind: string; is_archived: number }>(
      `SELECT kind, is_archived FROM categories WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
      [v.categoryId, this.ctx.userId],
    );
    if (!c) throw fieldError('categoryId', 'recurring.errors.categoryNotFound');
    if (c.kind !== v.type) throw fieldError('categoryId', 'recurring.errors.categoryKind');
    if (c.is_archived === 1) throw fieldError('categoryId', 'recurring.errors.categoryArchived');
  }

  private values(v: ValidRecurringRuleInput, currency: CurrencyCode): Record<string, SqlValue> {
    return {
      account_id: v.accountId,
      category_id: v.categoryId,
      type: v.type,
      amount_minor: v.amountMinor,
      currency,
      payee: v.payee,
      notes: v.notes,
      tag_names: JSON.stringify(v.tagNames),
      frequency: v.frequency,
      interval: v.interval,
      start_date: v.startDate,
      end_date: v.endDate,
      auto_post: fromBool(v.autoPost),
      reminder_days_before: v.reminderDaysBefore,
      time_zone: v.timeZone,
    };
  }

  /** Recomputes the cached first unhandled occurrence. */
  private async refreshNext(tx: SqlExecutor, id: string, today?: string) {
    const rule = await this.requireRule(tx, id);
    const handled = await this.handledDates(tx, id);
    const day = today ?? localDateOf(this.ctx.now(), rule.timeZone);
    const next = nextUnhandled(planOf(rule), handled, day);
    if (next !== rule.nextOccurrenceDate) {
      await updateSynced(tx, this.ctx, 'recurring_transactions', id, {
        next_occurrence_date: next,
      });
    }
  }

  private notify(postedTransactions = false) {
    this.ctx.onChange('recurring_transactions');
    if (postedTransactions) {
      this.ctx.onChange('transactions');
      this.ctx.onChange('accounts');
    }
  }

  async create(input: RecurringRuleInput): Promise<RecurringTransaction> {
    const v = validate(recurringRuleInputSchema, input);
    const id = this.ctx.newId();
    await this.db.transaction(async (tx) => {
      const currency = await this.accountCurrency(tx, v.accountId);
      await this.checkCategory(tx, v);
      await insertSynced(tx, this.ctx, 'recurring_transactions', id, {
        ...this.values(v, currency),
        status: 'active',
        is_active: 1,
        active_from: v.startDate,
        next_occurrence_date: v.startDate,
      });
      await this.refreshNext(tx, id);
    });
    this.notify();
    return this.requireRule(this.db, id);
  }

  async update(id: string, input: RecurringRuleInput): Promise<void> {
    const v = validate(recurringRuleInputSchema, input);
    await this.db.transaction(async (tx) => {
      const rule = await this.requireRule(tx, id);
      if (rule.status === 'ended') throw fieldError('status', 'recurring.errors.ended');
      const currency = await this.accountCurrency(tx, v.accountId);
      await this.checkCategory(tx, v);
      // Never make past occurrences due retroactively: the effective start
      // only moves forward with the new start date.
      const activeFrom =
        compareDates(v.startDate, rule.activeFrom) > 0 ? v.startDate : rule.activeFrom;
      await updateSynced(tx, this.ctx, 'recurring_transactions', id, {
        ...this.values(v, currency),
        active_from: compareDates(activeFrom, v.startDate) < 0 ? v.startDate : activeFrom,
      });
      await this.refreshNext(tx, id);
    });
    this.notify();
  }

  async pause(id: string): Promise<void> {
    await this.setStatus(id, 'paused');
  }

  async resume(id: string, today: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const rule = await this.requireRule(tx, id);
      if (rule.status !== 'paused') return;
      const activeFrom = compareDates(today, rule.startDate) > 0 ? today : rule.startDate;
      await updateSynced(tx, this.ctx, 'recurring_transactions', id, {
        status: 'active',
        is_active: 1,
        active_from: compareDates(activeFrom, rule.activeFrom) > 0 ? activeFrom : rule.activeFrom,
      });
      await this.refreshNext(tx, id, today);
    });
    this.notify();
  }

  async end(id: string): Promise<void> {
    await this.setStatus(id, 'ended');
  }

  private async setStatus(id: string, status: 'paused' | 'ended') {
    await this.db.transaction(async (tx) => {
      const rule = await this.requireRule(tx, id);
      if (rule.status === status || rule.status === 'ended') return;
      await updateSynced(tx, this.ctx, 'recurring_transactions', id, {
        status,
        is_active: 0,
        ...(status === 'ended' ? { next_occurrence_date: null } : {}),
      });
    });
    this.notify();
  }

  /** The date must be one of the rule's scheduled occurrences (on or after its effective start). */
  private assertOccurrence(rule: RecurringTransaction, date: string) {
    const plan = planOf(rule);
    if (!scheduledBetween(plan, date, date).includes(date)) {
      throw fieldError('date', 'recurring.errors.notAnOccurrence');
    }
  }

  private inputFor(rule: RecurringTransaction, date: string) {
    return {
      type: rule.type as 'expense' | 'income',
      accountId: rule.accountId,
      amountMinor: rule.amountMinor,
      localDate: date,
      localTime: '12:00',
      timeZone: rule.timeZone,
      categoryId: rule.categoryId,
      payee: rule.payee,
      notes: rule.notes,
      tagNames: rule.tagNames,
    };
  }

  async post(id: string, date: string, today: string): Promise<PostOccurrenceResult> {
    let result = { status: 'already_handled' } as PostOccurrenceResult;
    try {
      await this.db.transaction(async (tx) => {
        const rule = await this.requireRule(tx, id);
        if (rule.status !== 'active') throw fieldError('status', 'recurring.errors.notActive');
        this.assertOccurrence(rule, date);
        if (compareDates(date, today) > 0) throw fieldError('date', 'recurring.errors.future');
        if ((await this.handledDates(tx, id)).has(date)) return;
        // A normal entry: validated (account active, category, currency) and queued.
        const transactionId = await this.transactions.createInTransaction(
          tx,
          this.inputFor(rule, date),
          { ruleId: id, occurrenceDate: date },
        );
        await insertSynced(tx, this.ctx, 'recurring_occurrences', this.ctx.newId(), {
          recurring_transaction_id: id,
          occurrence_date: date,
          status: 'posted',
          transaction_id: transactionId,
        });
        await this.refreshNext(tx, id, today);
        result = { status: 'posted', transactionId };
      });
    } catch (e) {
      // Another attempt handled the same occurrence first: nothing was written.
      if (isUniqueViolation(e)) return { status: 'already_handled' };
      throw e;
    }
    if (result.status === 'posted') this.notify(true);
    return result;
  }

  async skip(id: string, date: string): Promise<void> {
    try {
      await this.db.transaction(async (tx) => {
        const rule = await this.requireRule(tx, id);
        if (rule.status === 'ended') throw fieldError('status', 'recurring.errors.ended');
        this.assertOccurrence(rule, date);
        if ((await this.handledDates(tx, id)).has(date)) return;
        await insertSynced(tx, this.ctx, 'recurring_occurrences', this.ctx.newId(), {
          recurring_transaction_id: id,
          occurrence_date: date,
          status: 'skipped',
          transaction_id: null,
        });
        await this.refreshNext(tx, id);
      });
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
    }
    this.notify();
  }

  async unskip(id: string, date: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await this.requireRule(tx, id);
      const row = await tx.getFirst<{ id: string }>(
        `SELECT id FROM recurring_occurrences
         WHERE recurring_transaction_id = ? AND occurrence_date = ? AND status = 'skipped'
           AND deleted_at IS NULL`,
        [id, date],
      );
      if (!row) return;
      await updateSynced(
        tx,
        this.ctx,
        'recurring_occurrences',
        row.id,
        { deleted_at: this.ctx.now() },
        'delete',
      );
      await this.refreshNext(tx, id);
    });
    this.notify();
  }

  async postAgain(id: string, date: string, today: string): Promise<string> {
    let transactionId = '';
    await this.db.transaction(async (tx) => {
      const rule = await this.requireRule(tx, id);
      if (compareDates(date, today) > 0) throw fieldError('date', 'recurring.errors.future');
      const occ = await tx.getFirst<{ id: string; transaction_id: string | null }>(
        `SELECT o.id, o.transaction_id FROM recurring_occurrences o
         WHERE o.recurring_transaction_id = ? AND o.occurrence_date = ? AND o.status = 'posted'
           AND o.deleted_at IS NULL`,
        [id, date],
      );
      if (!occ) throw fieldError('date', 'recurring.errors.notPosted');
      const live = occ.transaction_id
        ? await tx.getFirst(`SELECT 1 FROM transactions WHERE id = ? AND deleted_at IS NULL`, [
            occ.transaction_id,
          ])
        : null;
      if (live) throw fieldError('date', 'recurring.errors.stillPosted');
      transactionId = await this.transactions.createInTransaction(tx, this.inputFor(rule, date), {
        ruleId: id,
        occurrenceDate: date,
      });
      await updateSynced(tx, this.ctx, 'recurring_occurrences', occ.id, {
        transaction_id: transactionId,
      });
    });
    this.notify(true);
    return transactionId;
  }

  async autoPostDue(today: string): Promise<AutoPostResult> {
    const rules = (
      await this.db.getAll<RecurringRow>(
        `SELECT * FROM recurring_transactions
         WHERE user_id = ? AND deleted_at IS NULL AND status = 'active' AND auto_post = 1`,
        [this.ctx.userId],
      )
    ).map(toRecurring);
    const result: AutoPostResult = { posted: 0, blocked: [] };
    for (const rule of rules) {
      const handled = await this.handledDates(this.db, rule.id);
      // Never post occurrences dated before the rule existed (a start date in
      // the past is offered for confirmation instead) or older than the backlog.
      const created = localDateOf(rule.createdAt, rule.timeZone);
      const floor = addDays(today, -MAX_BACKLOG_DAYS);
      const due = dueOccurrences(planOf(rule), handled, today).filter(
        (d) => compareDates(d, created) >= 0 && compareDates(d, floor) >= 0,
      );
      for (const date of due) {
        try {
          const r = await this.post(rule.id, date, today);
          if (r.status === 'posted') result.posted += 1;
        } catch (e) {
          // Left due (nothing created); the rule shows what to fix.
          const reason =
            e instanceof AppError ? (Object.values(e.fieldErrors ?? {})[0] ?? e.code) : 'unknown';
          result.blocked.push({ ruleId: rule.id, date, reason: String(reason) });
          break;
        }
      }
    }
    return result;
  }
}
