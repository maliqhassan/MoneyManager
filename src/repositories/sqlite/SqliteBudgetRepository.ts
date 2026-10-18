import type { CurrencyCode } from '@/domain/currency/currencies';
import { compareDates } from '@/domain/dates/calendar';
import type { Weekday } from '@/domain/enums';
import { getBudgetPeriod, type PeriodSettings } from '@/domain/finance/budget';
import type { Budget, BudgetRevision } from '@/domain/models';
import {
  type BudgetRevision as RevisionInput,
  type DailySpend,
  evaluateBudget,
  listBudgetPeriods,
  normalizeBudgetStart,
  revisionFor,
} from '@/domain/planning/budgets';
import type { SqlDatabase, SqlExecutor, SqlValue } from '@/database/types';
import { AppError } from '@/lib/errors';
import { type BudgetInput, budgetInputSchema, type ValidBudgetInput } from '@/validation/planning';

import type { BudgetListItem, BudgetRepository, BudgetSpendingLine } from '../types';
import { Converter, perEntryKey, resolveInCurrency } from './fx';
import { type CategoryRow, toCategory } from './mappers';
import {
  type BudgetRevisionRow,
  type BudgetRow,
  toBudget,
  toBudgetRevision,
} from './planningMappers';
import { fromBool, insertSynced, type RepositoryContext, updateSynced, validate } from './shared';

const fieldError = (field: string, key: string) =>
  new AppError('validation', key, { fieldErrors: { [field]: key } });

const placeholders = (n: number) => Array.from({ length: n }, () => '?').join(', ');

const definitionOf = (b: Pick<Budget, 'periodType' | 'startDate' | 'endDate'>) => ({
  periodType: b.periodType,
  startDate: b.startDate,
  endDate: b.endDate,
});

/**
 * Budgets: one expense category (with its subcategories) or all spending,
 * per week / month / custom range, in an explicit currency.
 *
 * Spending is derived from transactions on every read:
 *   - expenses add, refunds subtract; income and transfers (incl. card
 *     payments) are never spending;
 *   - split transactions contribute their split lines, so each line counts
 *     once toward the budget of its own category;
 *   - amounts in another currency use the transaction's recorded base
 *     snapshot when it is in the budget currency, otherwise a known rate on
 *     the transaction date; with no rate the amount is left out and the
 *     currency reported (results are marked incomplete — never guessed).
 */
export class SqliteBudgetRepository implements BudgetRepository {
  constructor(
    private readonly db: SqlDatabase,
    private readonly ctx: RepositoryContext,
  ) {}

  // ------------------------------------------------------------------ reads

  async list(options: { includeArchived?: boolean } = {}): Promise<Budget[]> {
    const rows = await this.db.getAll<BudgetRow>(
      `SELECT * FROM budgets WHERE user_id = ? AND deleted_at IS NULL
         ${options.includeArchived ? '' : 'AND is_archived = 0'}
       ORDER BY category_id IS NOT NULL, name COLLATE NOCASE`,
      [this.ctx.userId],
    );
    return rows.map(toBudget);
  }

  async getById(id: string): Promise<Budget | null> {
    const row = await this.readBudget(this.db, id);
    return row ? toBudget(row) : null;
  }

  async revisions(budgetId: string): Promise<BudgetRevision[]> {
    const budget = await this.readBudget(this.db, budgetId);
    if (!budget) return [];
    return this.revisionRows(this.db, toBudget(budget));
  }

  async overviews(today: string, options: { archived?: boolean } = {}): Promise<BudgetListItem[]> {
    const rows = await this.db.getAll<BudgetRow>(
      `SELECT * FROM budgets WHERE user_id = ? AND deleted_at IS NULL AND is_archived = ?
       ORDER BY category_id IS NOT NULL, name COLLATE NOCASE`,
      [this.ctx.userId, fromBool(options.archived ?? false)],
    );
    const settings = await this.settings(this.db);
    const items: BudgetListItem[] = [];
    for (const row of rows) items.push(await this.evaluate(toBudget(row), today, settings, false));
    return items;
  }

  async overview(id: string, today: string): Promise<BudgetListItem | null> {
    const row = await this.readBudget(this.db, id);
    if (!row) return null;
    return this.evaluate(toBudget(row), today, await this.settings(this.db), true);
  }

  async spendingLines(id: string, from: string, to: string): Promise<BudgetSpendingLine[]> {
    const row = await this.readBudget(this.db, id);
    if (!row) return [];
    const categories = await this.scopeCategories(this.db, row.category_id);
    const rows = await this.db.getAll<{
      id: string;
      type: 'expense' | 'refund';
      payee: string | null;
      local_date: string;
      account_name: string;
      category_id: string | null;
      category_name: string | null;
      category_system_key: string | null;
      amount: number;
      currency: CurrencyCode;
      split_line: number;
    }>(
      `SELECT t.id, t.type, t.payee, t.local_date, a.name AS account_name,
              COALESCE(s.category_id, t.category_id) AS category_id,
              c.name AS category_name, c.system_key AS category_system_key,
              CASE WHEN s.id IS NOT NULL THEN s.amount_minor ELSE t.amount_minor END AS amount,
              t.currency, s.id IS NOT NULL AS split_line
       FROM transactions t
       JOIN accounts a ON a.id = t.account_id
       LEFT JOIN transaction_splits s
         ON s.transaction_id = t.id AND s.deleted_at IS NULL AND t.is_split = 1
       LEFT JOIN categories c ON c.id = COALESCE(s.category_id, t.category_id)
       WHERE ${this.spendingWhere(categories)}
       ORDER BY t.local_date DESC, t.occurred_at DESC, t.id DESC
       LIMIT 500`,
      [this.ctx.userId, from, to, ...(categories ?? [])],
    );
    return rows.map((r) => ({
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
    }));
  }

  async hasHistory(id: string, today: string): Promise<boolean> {
    const row = await this.readBudget(this.db, id);
    if (!row) return false;
    return this.completedPeriods(toBudget(row), today, await this.settings(this.db));
  }

  // ----------------------------------------------------------------- writes

  async create(input: BudgetInput): Promise<Budget> {
    const valid = validate(budgetInputSchema, input);
    const id = this.ctx.newId();
    await this.db.transaction(async (tx) => {
      const settings = await this.settings(tx);
      await this.checkCategory(tx, valid.categoryId, true);
      const startDate = normalizeBudgetStart(valid, settings);
      await this.checkDuplicate(tx, valid, startDate, null);
      await insertSynced(tx, this.ctx, 'budgets', id, this.budgetValues(valid, startDate));
      await insertSynced(tx, this.ctx, 'budget_revisions', this.ctx.newId(), {
        budget_id: id,
        effective_from: startDate,
        amount_minor: valid.amountMinor,
        rollover_enabled: fromBool(valid.rolloverEnabled),
      });
    });
    this.ctx.onChange('budgets');
    const created = await this.readBudget(this.db, id);
    /* istanbul ignore next -- just written in the same database */
    if (!created) throw new AppError('not_found', `Budget ${id} not found`);
    return toBudget(created);
  }

  async update(id: string, input: BudgetInput, today: string): Promise<void> {
    const valid = validate(budgetInputSchema, input);
    await this.db.transaction(async (tx) => {
      const row = await this.readBudget(tx, id);
      if (!row) throw new AppError('not_found', `Budget ${id} not found`);
      const existing = toBudget(row);
      const settings = await this.settings(tx);
      const startDate = normalizeBudgetStart(valid, settings);
      const history = await this.completedPeriods(existing, today, settings);
      const revisions = await this.revisionRows(tx, existing);

      if (history) {
        // Completed periods keep what they were measured against.
        const locked: [keyof ValidBudgetInput, boolean][] = [
          ['categoryId', valid.categoryId !== existing.categoryId],
          ['periodType', valid.periodType !== existing.periodType],
          ['currency', valid.currency !== existing.currency],
          ['startDate', startDate !== existing.startDate],
          ['endDate', valid.endDate !== existing.endDate],
        ];
        for (const [field, changed] of locked) {
          if (changed) throw fieldError(field, 'budgets.errors.historyLocked');
        }
        const current = this.currentPeriodStart(existing, today, settings);
        const inForce = revisionFor(revisions, current);
        const amountChanged =
          inForce.amountMinor !== valid.amountMinor ||
          inForce.rolloverEnabled !== valid.rolloverEnabled;
        if (amountChanged && existing.periodType === 'custom') {
          throw fieldError('amountMinor', 'budgets.errors.ended');
        }
        if (amountChanged) {
          const values = {
            amount_minor: valid.amountMinor,
            rollover_enabled: fromBool(valid.rolloverEnabled),
          };
          const same = revisions.find((r) => r.effectiveFrom === current);
          if (same) await updateSynced(tx, this.ctx, 'budget_revisions', same.id, values);
          else {
            await insertSynced(tx, this.ctx, 'budget_revisions', this.ctx.newId(), {
              budget_id: id,
              effective_from: current,
              ...values,
            });
          }
        }
      } else {
        // Nothing has happened yet: the budget can be reshaped freely.
        if (valid.categoryId !== existing.categoryId) {
          await this.checkCategory(tx, valid.categoryId, true);
        }
        await this.checkDuplicate(tx, valid, startDate, id);
        const stored = revisions.filter((r) => r.id !== `synthetic:${id}`);
        const [first, ...rest] = stored;
        const values = {
          effective_from: startDate,
          amount_minor: valid.amountMinor,
          rollover_enabled: fromBool(valid.rolloverEnabled),
        };
        if (first) await updateSynced(tx, this.ctx, 'budget_revisions', first.id, values);
        else {
          await insertSynced(tx, this.ctx, 'budget_revisions', this.ctx.newId(), {
            budget_id: id,
            ...values,
          });
        }
        for (const r of rest) {
          await updateSynced(
            tx,
            this.ctx,
            'budget_revisions',
            r.id,
            { deleted_at: this.ctx.now() },
            'delete',
          );
        }
      }
      await updateSynced(tx, this.ctx, 'budgets', id, this.budgetValues(valid, startDate));
    });
    this.ctx.onChange('budgets');
  }

  async setArchived(id: string, archived: boolean): Promise<void> {
    await this.db.transaction(async (tx) => {
      const row = await this.readBudget(tx, id);
      if (!row) throw new AppError('not_found', `Budget ${id} not found`);
      if (!archived) {
        const budget = toBudget(row);
        await this.checkDuplicate(tx, budget, budget.startDate, id);
      }
      await updateSynced(tx, this.ctx, 'budgets', id, { is_archived: fromBool(archived) });
    });
    this.ctx.onChange('budgets');
  }

  // ---------------------------------------------------------------- helpers

  private readBudget(db: SqlExecutor, id: string) {
    return db.getFirst<BudgetRow>(
      `SELECT * FROM budgets WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
      [id, this.ctx.userId],
    );
  }

  private async settings(db: SqlExecutor): Promise<PeriodSettings> {
    const prefs = await db.getFirst<{ first_day_of_week: number; month_start_day: number }>(
      `SELECT first_day_of_week, month_start_day FROM user_preferences
       WHERE user_id = ? AND deleted_at IS NULL`,
      [this.ctx.userId],
    );
    return {
      firstDayOfWeek: (prefs?.first_day_of_week ?? 1) as Weekday,
      monthStartDay: prefs?.month_start_day ?? 1,
    };
  }

  private async revisionRows(db: SqlExecutor, budget: Budget): Promise<BudgetRevision[]> {
    const rows = await db.getAll<BudgetRevisionRow>(
      `SELECT * FROM budget_revisions WHERE budget_id = ? AND user_id = ? AND deleted_at IS NULL
       ORDER BY effective_from, created_at, id`,
      [budget.id, this.ctx.userId],
    );
    if (rows.length > 0) return rows.map(toBudgetRevision);
    // A budget pulled before its revisions arrive: its own amount applies.
    return [
      {
        id: `synthetic:${budget.id}`,
        userId: budget.userId,
        createdAt: budget.createdAt,
        updatedAt: budget.updatedAt,
        deletedAt: null,
        version: 0,
        budgetId: budget.id,
        effectiveFrom: budget.startDate,
        amountMinor: budget.amountMinor ?? 0,
        rolloverEnabled: budget.rolloverEnabled,
      },
    ];
  }

  private currentPeriodStart(budget: Budget, today: string, settings: PeriodSettings): string {
    const def = definitionOf(budget);
    if (compareDates(today, budget.startDate) < 0) return budget.startDate;
    return getBudgetPeriod(def, today, settings)?.start ?? budget.startDate;
  }

  private async completedPeriods(budget: Budget, today: string, settings: PeriodSettings) {
    const periods = listBudgetPeriods(definitionOf(budget), settings, today);
    return periods.some((p) => compareDates(p.end, today) < 0);
  }

  /** Category ids in scope (the category and its subcategories); null = all spending. */
  private async scopeCategories(db: SqlExecutor, categoryId: string | null) {
    if (!categoryId) return null;
    const children = await db.getAll<{ id: string }>(
      `SELECT id FROM categories WHERE parent_id = ? AND user_id = ?`,
      [categoryId, this.ctx.userId],
    );
    return [categoryId, ...children.map((c) => c.id)];
  }

  private spendingWhere(categories: string[] | null): string {
    const base = `t.user_id = ? AND t.deleted_at IS NULL AND t.type IN ('expense', 'refund')
      AND t.local_date >= ? AND t.local_date <= ?`;
    return categories
      ? `${base} AND COALESCE(s.category_id, t.category_id) IN (${placeholders(categories.length)})`
      : base;
  }

  private async dailySpending(
    db: SqlExecutor,
    budget: Budget,
    from: string,
    to: string,
    converter: Converter,
  ): Promise<DailySpend[]> {
    const categories = await this.scopeCategories(db, budget.categoryId);
    const rows = await db.getAll<{
      local_date: string;
      currency: CurrencyCode;
      base_currency: CurrencyCode;
      base_fx_source: string;
      amount: number;
      base: number;
    }>(
      `SELECT t.local_date, t.currency, t.base_currency, t.base_fx_source,
              SUM(CASE WHEN s.id IS NOT NULL THEN s.amount_minor ELSE t.amount_minor END) AS amount,
              SUM(CASE WHEN s.id IS NOT NULL THEN s.base_amount_minor ELSE t.base_amount_minor END) AS base
       FROM transactions t
       LEFT JOIN transaction_splits s
         ON s.transaction_id = t.id AND s.deleted_at IS NULL AND t.is_split = 1
       WHERE ${this.spendingWhere(categories)}
       GROUP BY t.local_date, t.currency, t.base_currency, t.base_fx_source,
                ${perEntryKey('COALESCE(s.id, t.id)')}`,
      [this.ctx.userId, from, to, ...(categories ?? []), budget.currency, budget.currency],
    );
    const days: DailySpend[] = [];
    for (const r of rows) {
      // Native amount, else the conversion recorded at entry, else the rate
      // on the entry's date (same policy as Reports).
      const amount = await resolveInCurrency(converter, r, budget.currency);
      // Postings are signed from the account's view: expenses < 0, refunds > 0.
      if (amount !== null) days.push({ localDate: r.local_date, spentMinor: -amount });
    }
    return days;
  }

  private async evaluate(
    budget: Budget,
    today: string,
    settings: PeriodSettings,
    fullHistory: boolean,
  ): Promise<BudgetListItem> {
    const revisions = await this.revisionRows(this.db, budget);
    const engineRevisions: RevisionInput[] = revisions.map((r) => ({
      id: r.id,
      effectiveFrom: r.effectiveFrom,
      amountMinor: r.amountMinor,
      rolloverEnabled: r.rolloverEnabled,
      createdAt: r.createdAt,
    }));
    // Without rollover only the current period matters for the current result.
    const needsHistory = fullHistory || revisions.some((r) => r.rolloverEnabled);
    const startDate = needsHistory
      ? budget.startDate
      : this.currentPeriodStart(budget, today, settings);
    const periods = listBudgetPeriods({ ...definitionOf(budget), startDate }, settings, today);
    const converter = new Converter(this.db);
    const spending = await this.dailySpending(
      this.db,
      budget,
      periods[0]!.start,
      periods[periods.length - 1]!.end,
      converter,
    );
    const evaluation = evaluateBudget({
      periodType: budget.periodType,
      startDate,
      endDate: budget.endDate,
      revisions: engineRevisions,
      spending,
      today,
      settings,
    });
    const categoryRow = budget.categoryId
      ? await this.db.getFirst<CategoryRow>(`SELECT * FROM categories WHERE id = ?`, [
          budget.categoryId,
        ])
      : null;
    return {
      budget,
      category: categoryRow ? toCategory(categoryRow) : null,
      evaluation,
      missingRates: converter.missingList(),
      fx: converter.note(budget.currency),
    };
  }

  private async checkCategory(db: SqlExecutor, categoryId: string | null, mustBeActive: boolean) {
    if (!categoryId) return;
    const row = await db.getFirst<{ kind: string; is_archived: number }>(
      `SELECT kind, is_archived FROM categories WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
      [categoryId, this.ctx.userId],
    );
    if (!row) throw fieldError('categoryId', 'budgets.errors.categoryNotFound');
    if (row.kind !== 'expense') throw fieldError('categoryId', 'budgets.errors.categoryKind');
    if (mustBeActive && row.is_archived === 1) {
      throw fieldError('categoryId', 'budgets.errors.categoryArchived');
    }
  }

  /**
   * One active budget per scope, period type and currency (custom budgets:
   * per exact date range). Overlapping budgets with different scopes are
   * fine — e.g. Food and an overall budget both count a grocery purchase,
   * each in its own budget.
   */
  private async checkDuplicate(
    db: SqlExecutor,
    v: Pick<ValidBudgetInput, 'categoryId' | 'periodType' | 'currency' | 'endDate'>,
    startDate: string,
    selfId: string | null,
  ) {
    const params: SqlValue[] = [this.ctx.userId, v.periodType, v.currency];
    let sql = `SELECT id FROM budgets WHERE user_id = ? AND deleted_at IS NULL AND is_archived = 0
      AND period_type = ? AND currency = ?`;
    if (v.categoryId) {
      sql += ' AND category_id = ?';
      params.push(v.categoryId);
    } else sql += ' AND category_id IS NULL';
    if (v.periodType === 'custom') {
      sql += ' AND start_date = ? AND end_date = ?';
      params.push(startDate, v.endDate);
    }
    if (selfId) {
      sql += ' AND id <> ?';
      params.push(selfId);
    }
    if (await db.getFirst(sql, params)) throw fieldError('categoryId', 'budgets.errors.duplicate');
  }

  private budgetValues(v: ValidBudgetInput, startDate: string): Record<string, SqlValue> {
    return {
      name: v.name,
      category_id: v.categoryId,
      period_type: v.periodType,
      start_date: startDate,
      end_date: v.endDate,
      currency: v.currency,
      amount_minor: v.amountMinor,
      rollover_enabled: fromBool(v.rolloverEnabled),
    };
  }
}
