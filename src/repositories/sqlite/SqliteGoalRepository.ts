import type { CurrencyCode } from '@/domain/currency/currencies';
import type { SavingsGoal } from '@/domain/models';
import { evaluateGoal } from '@/domain/planning/goals';
import type { SqlDatabase, SqlExecutor } from '@/database/types';
import { AppError } from '@/lib/errors';
import {
  type ContributionInput,
  contributionInputSchema,
  type GoalInput,
  goalInputSchema,
  type ValidContributionInput,
} from '@/validation/planning';

import type {
  ContributionDetail,
  GoalFilter,
  GoalListItem,
  GoalRepository,
  TransferCandidate,
} from '../types';
import { Converter } from './fx';
import { type ContributionRow, type GoalRow, toContribution, toGoal } from './planningMappers';
import { insertSynced, type RepositoryContext, updateSynced, validate } from './shared';
import type { SqliteTransactionRepository } from './SqliteTransactionRepository';

const fieldError = (field: string, key: string) =>
  new AppError('validation', key, { fieldErrors: { [field]: key } });

const placeholders = (n: number) => Array.from({ length: n }, () => '?').join(', ');

/**
 * Savings goals are planning targets: a contribution records money set aside
 * for a goal and never changes an account balance. When money actually
 * moves, that is a normal transfer (created here in the same local write, or
 * linked afterwards) — balances change only through the transfer, progress
 * only through the contribution, so nothing is counted twice.
 */
export class SqliteGoalRepository implements GoalRepository {
  constructor(
    private readonly db: SqlDatabase,
    private readonly ctx: RepositoryContext,
    private readonly transactions: SqliteTransactionRepository,
  ) {}

  // ------------------------------------------------------------------ reads

  async list(filter: GoalFilter, today: string): Promise<GoalListItem[]> {
    const rows = await this.db.getAll<GoalRow>(
      `SELECT * FROM savings_goals WHERE user_id = ? AND deleted_at IS NULL
         AND status ${filter === 'archived' ? "= 'archived'" : "<> 'archived'"}
       ORDER BY target_date IS NULL, target_date, name COLLATE NOCASE`,
      [this.ctx.userId],
    );
    const goals = rows.map(toGoal);
    const items = await this.withProgress(goals, today);
    if (filter === 'archived') return items;
    return items.filter((i) => i.progress.completed === (filter === 'completed'));
  }

  async getById(id: string, today: string) {
    const row = await this.readGoal(this.db, id);
    if (!row) return null;
    const goal = toGoal(row);
    const [item] = await this.withProgress([goal], today);
    const account = goal.accountId
      ? await this.db.getFirst<{ name: string }>(`SELECT name FROM accounts WHERE id = ?`, [
          goal.accountId,
        ])
      : null;
    const rows = await this.db.getAll<
      ContributionRow & {
        account_name: string | null;
        tr_id: string | null;
        tr_from: string | null;
        tr_to: string | null;
        tr_amount: number | null;
        tr_currency: CurrencyCode | null;
        tr_date: string | null;
      }
    >(
      `SELECT gc.*, a.name AS account_name, tr.id AS tr_id, fa.name AS tr_from, ta.name AS tr_to,
              tr.from_amount_minor AS tr_amount, tr.from_currency AS tr_currency,
              tr.local_date AS tr_date
       FROM goal_contributions gc
       LEFT JOIN accounts a ON a.id = gc.account_id
       LEFT JOIN transfers tr ON tr.id = gc.transfer_id AND tr.deleted_at IS NULL
       LEFT JOIN accounts fa ON fa.id = tr.from_account_id
       LEFT JOIN accounts ta ON ta.id = tr.to_account_id
       WHERE gc.goal_id = ? AND gc.user_id = ? AND gc.deleted_at IS NULL
       ORDER BY gc.contributed_on DESC, gc.created_at DESC`,
      [id, this.ctx.userId],
    );
    const contributions: ContributionDetail[] = rows.map((r) => ({
      ...toContribution(r, goal.currency),
      accountName: r.account_name,
      transfer:
        r.tr_id && r.tr_amount !== null && r.tr_currency && r.tr_date
          ? {
              id: r.tr_id,
              fromAccountName: r.tr_from ?? '',
              toAccountName: r.tr_to ?? '',
              amountMinor: r.tr_amount,
              currency: r.tr_currency,
              localDate: r.tr_date,
            }
          : null,
    }));
    return { ...item!, accountName: account?.name ?? null, contributions };
  }

  async transferCandidates(limit: number): Promise<TransferCandidate[]> {
    const rows = await this.db.getAll<{
      id: string;
      local_date: string;
      from_name: string;
      to_name: string;
      from_amount_minor: number;
      from_currency: CurrencyCode;
    }>(
      `SELECT tr.id, tr.local_date, fa.name AS from_name, ta.name AS to_name,
              tr.from_amount_minor, tr.from_currency
       FROM transfers tr
       JOIN accounts fa ON fa.id = tr.from_account_id
       JOIN accounts ta ON ta.id = tr.to_account_id
       WHERE tr.user_id = ? AND tr.deleted_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM goal_contributions gc
                         WHERE gc.transfer_id = tr.id AND gc.deleted_at IS NULL)
       ORDER BY tr.local_date DESC, tr.occurred_at DESC LIMIT ?`,
      [this.ctx.userId, limit],
    );
    return rows.map((r) => ({
      id: r.id,
      localDate: r.local_date,
      fromAccountName: r.from_name,
      toAccountName: r.to_name,
      amountMinor: r.from_amount_minor,
      currency: r.from_currency,
    }));
  }

  // ----------------------------------------------------------------- writes

  async create(input: GoalInput): Promise<SavingsGoal> {
    const valid = validate(goalInputSchema, input);
    const id = this.ctx.newId();
    await this.db.transaction(async (tx) => {
      await this.checkAccount(tx, valid.accountId, 'accountId', true);
      await insertSynced(tx, this.ctx, 'savings_goals', id, {
        name: valid.name,
        target_amount_minor: valid.targetAmountMinor,
        currency: valid.currency,
        target_date: valid.targetDate,
        account_id: valid.accountId,
        icon: valid.icon,
        color: valid.color,
        status: 'active',
      });
    });
    this.ctx.onChange('savings_goals');
    return toGoal((await this.readGoal(this.db, id))!);
  }

  async update(id: string, input: GoalInput): Promise<void> {
    const valid = validate(goalInputSchema, input);
    await this.db.transaction(async (tx) => {
      const row = await this.readGoal(tx, id);
      if (!row) throw new AppError('not_found', `Goal ${id} not found`);
      if (valid.accountId !== row.account_id) {
        await this.checkAccount(tx, valid.accountId, 'accountId', true);
      }
      if (valid.currency !== row.currency) {
        const used = await tx.getFirst(
          `SELECT id FROM goal_contributions WHERE goal_id = ? AND deleted_at IS NULL`,
          [id],
        );
        if (used) throw fieldError('currency', 'goals.errors.currencyLocked');
      }
      await updateSynced(tx, this.ctx, 'savings_goals', id, {
        name: valid.name,
        target_amount_minor: valid.targetAmountMinor,
        currency: valid.currency,
        target_date: valid.targetDate,
        account_id: valid.accountId,
        icon: valid.icon,
        color: valid.color,
      });
    });
    this.ctx.onChange('savings_goals');
  }

  async setArchived(id: string, archived: boolean): Promise<void> {
    await this.db.transaction(async (tx) => {
      if (!(await this.readGoal(tx, id))) throw new AppError('not_found', `Goal ${id} not found`);
      await updateSynced(tx, this.ctx, 'savings_goals', id, {
        status: archived ? 'archived' : 'active',
      });
    });
    this.ctx.onChange('savings_goals');
  }

  async addContribution(goalId: string, input: ContributionInput): Promise<string> {
    const valid = validate(contributionInputSchema, input);
    const id = this.ctx.newId();
    let movedMoney = false;
    await this.db.transaction(async (tx) => {
      const goal = await this.readGoal(tx, goalId);
      if (!goal) throw new AppError('not_found', `Goal ${goalId} not found`);
      if (goal.status === 'archived') throw fieldError('goalId', 'goals.errors.archived');
      let transferId = valid.transferId;
      let accountId = valid.accountId;
      if (valid.newTransfer) {
        // The transfer is queued first; the contribution references it.
        transferId = await this.recordTransfer(tx, valid);
        accountId = valid.newTransfer.toAccountId;
        movedMoney = true;
      } else if (transferId) {
        await this.checkTransferLink(tx, transferId, null);
      }
      await this.checkAccount(tx, accountId, 'accountId', !valid.newTransfer);
      await insertSynced(tx, this.ctx, 'goal_contributions', id, {
        goal_id: goalId,
        amount_minor: valid.amountMinor,
        currency: valid.currency,
        contributed_on: valid.contributedOn,
        account_id: accountId,
        transfer_id: transferId,
        transaction_id: null,
        notes: valid.notes,
      });
    });
    this.ctx.onChange('savings_goals');
    if (movedMoney) {
      this.ctx.onChange('transactions');
      this.ctx.onChange('accounts');
    }
    return id;
  }

  async updateContribution(id: string, input: ContributionInput): Promise<void> {
    const valid = validate(contributionInputSchema, input);
    if (valid.newTransfer) throw fieldError('newTransfer', 'goals.errors.transferOnCreateOnly');
    await this.db.transaction(async (tx) => {
      const existing = await tx.getFirst<{ account_id: string | null; transfer_id: string | null }>(
        `SELECT account_id, transfer_id FROM goal_contributions
         WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
        [id, this.ctx.userId],
      );
      if (!existing) throw new AppError('not_found', `Contribution ${id} not found`);
      if (valid.transferId && valid.transferId !== existing.transfer_id) {
        await this.checkTransferLink(tx, valid.transferId, id);
      }
      await this.checkAccount(
        tx,
        valid.accountId,
        'accountId',
        valid.accountId !== existing.account_id,
      );
      await updateSynced(tx, this.ctx, 'goal_contributions', id, {
        amount_minor: valid.amountMinor,
        currency: valid.currency,
        contributed_on: valid.contributedOn,
        account_id: valid.accountId,
        transfer_id: valid.transferId,
        notes: valid.notes,
      });
    });
    this.ctx.onChange('savings_goals');
  }

  async removeContribution(id: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await updateSynced(
        tx,
        this.ctx,
        'goal_contributions',
        id,
        { deleted_at: this.ctx.now() },
        'delete',
      );
    });
    this.ctx.onChange('savings_goals');
  }

  // ---------------------------------------------------------------- helpers

  private readGoal(db: SqlExecutor, id: string) {
    return db.getFirst<GoalRow>(
      `SELECT * FROM savings_goals WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
      [id, this.ctx.userId],
    );
  }

  /** Saved amount per goal in the goal currency, converting with known rates only. */
  private async withProgress(goals: SavingsGoal[], today: string): Promise<GoalListItem[]> {
    if (goals.length === 0) return [];
    const rows = await this.db.getAll<{
      goal_id: string;
      currency: CurrencyCode | null;
      contributed_on: string;
      total: number;
    }>(
      `SELECT goal_id, currency, contributed_on, SUM(amount_minor) AS total
       FROM goal_contributions
       WHERE user_id = ? AND deleted_at IS NULL AND goal_id IN (${placeholders(goals.length)})
       GROUP BY goal_id, currency, contributed_on`,
      [this.ctx.userId, ...goals.map((g) => g.id)],
    );
    return Promise.all(
      goals.map(async (goal) => {
        const converter = new Converter(this.db);
        let saved = 0;
        for (const r of rows.filter((x) => x.goal_id === goal.id)) {
          const amount = await converter.convert(
            r.total,
            r.currency ?? goal.currency,
            goal.currency,
            r.contributed_on,
          );
          if (amount !== null) saved += amount;
        }
        return {
          goal,
          progress: evaluateGoal({
            targetMinor: goal.targetAmountMinor,
            savedMinor: saved,
            targetDate: goal.targetDate,
            today,
          }),
          missingRates: converter.missingList(),
        };
      }),
    );
  }

  private async recordTransfer(tx: SqlExecutor, v: ValidContributionInput): Promise<string> {
    const t = v.newTransfer!;
    const accounts = await tx.getAll<{ id: string; currency: CurrencyCode }>(
      `SELECT id, currency FROM accounts WHERE id IN (?, ?) AND user_id = ? AND deleted_at IS NULL`,
      [t.fromAccountId, t.toAccountId, this.ctx.userId],
    );
    if (accounts.some((a) => a.currency !== v.currency)) {
      throw fieldError('newTransfer', 'goals.errors.transferCurrency');
    }
    const { transferId } = await this.transactions.createTransferInTransaction(tx, {
      fromAccountId: t.fromAccountId,
      toAccountId: t.toAccountId,
      amountMinor: v.amountMinor,
      receivedAmountMinor: null,
      localDate: v.contributedOn,
      localTime: t.localTime,
      timeZone: t.timeZone,
      notes: v.notes,
    });
    return transferId;
  }

  private async checkTransferLink(tx: SqlExecutor, transferId: string, selfId: string | null) {
    const transfer = await tx.getFirst(
      `SELECT id FROM transfers WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
      [transferId, this.ctx.userId],
    );
    if (!transfer) throw fieldError('transferId', 'goals.errors.transferNotFound');
    const linked = await tx.getFirst(
      `SELECT id FROM goal_contributions WHERE transfer_id = ? AND deleted_at IS NULL
         AND id <> ?`,
      [transferId, selfId ?? ''],
    );
    if (linked) throw fieldError('transferId', 'goals.errors.transferLinked');
  }

  private async checkAccount(
    db: SqlExecutor,
    accountId: string | null,
    field: string,
    mustBeActive: boolean,
  ) {
    if (!accountId) return;
    const account = await db.getFirst<{ is_archived: number }>(
      `SELECT is_archived FROM accounts WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
      [accountId, this.ctx.userId],
    );
    if (!account) throw fieldError(field, 'goals.errors.accountNotFound');
    if (mustBeActive && account.is_archived === 1) {
      throw fieldError(field, 'goals.errors.accountArchived');
    }
  }
}
