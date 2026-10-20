import type { CurrencyCode } from '@/domain/currency/currencies';
import { compareDates } from '@/domain/dates/calendar';
import {
  billOccurrences,
  type BillPlan,
  type CashflowHorizon,
  compareExpected,
  type ExpectedItem,
  horizonRange,
  summarizeExpected,
} from '@/domain/planning/cashflow';
import { pendingOccurrences } from '@/domain/planning/recurring';
import type { ReminderCandidate } from '@/domain/planning/reminders';
import type { SqlDatabase } from '@/database/types';

import type { UpcomingCashflow, UpcomingRepository } from '../types';
import { Converter } from './fx';
import { type BillRow, type RecurringRow, toBill, toRecurring } from './planningMappers';

interface RuleRow extends RecurringRow {
  account_name: string | null;
}
interface BillListRow extends BillRow {
  account_name: string | null;
}

/**
 * What is EXPECTED from schedules: unhandled recurring occurrences and
 * unpaid bill/subscription occurrences. Read-only and local; never a
 * balance and never counted by reports or budgets.
 */
export class SqliteUpcomingRepository implements UpcomingRepository {
  constructor(
    private readonly db: SqlDatabase,
    private readonly userId: string,
  ) {}

  private async ruleItems(from: string, to: string, today: string): Promise<ExpectedItem[]> {
    const rules = await this.db.getAll<RuleRow>(
      `SELECT r.*, a.name AS account_name FROM recurring_transactions r
       LEFT JOIN accounts a ON a.id = r.account_id
       WHERE r.user_id = ? AND r.deleted_at IS NULL AND r.status = 'active'`,
      [this.userId],
    );
    const handled = await this.db.getAll<{ rule: string; d: string }>(
      `SELECT recurring_transaction_id AS rule, occurrence_date AS d FROM recurring_occurrences
       WHERE user_id = ? AND deleted_at IS NULL`,
      [this.userId],
    );
    const byRule = new Map<string, Set<string>>();
    for (const h of handled) byRule.set(h.rule, (byRule.get(h.rule) ?? new Set()).add(h.d));
    const out: ExpectedItem[] = [];
    for (const row of rules) {
      const rule = toRecurring(row);
      if (rule.type !== 'expense' && rule.type !== 'income') continue;
      const plan = { ...rule, status: rule.status };
      for (const o of pendingOccurrences(plan, byRule.get(rule.id) ?? new Set(), today, to)) {
        if (compareDates(o.date, from) < 0) continue;
        out.push({
          key: `recurring:${rule.id}:${o.date}`,
          source: 'recurring',
          sourceId: rule.id,
          name: rule.payee ?? '',
          date: o.date,
          type: rule.type,
          amountMinor: rule.amountMinor,
          currency: rule.currency,
          accountName: row.account_name,
          state: o.state,
          approximate: false,
          isSubscription: false,
        });
      }
    }
    return out;
  }

  private async billItems(from: string, to: string, today: string): Promise<ExpectedItem[]> {
    const bills = await this.db.getAll<BillListRow>(
      `SELECT b.*, a.name AS account_name FROM bills b
       LEFT JOIN accounts a ON a.id = b.account_id
       WHERE b.user_id = ? AND b.deleted_at IS NULL AND b.is_active = 1`,
      [this.userId],
    );
    // Any payment row (paid, linked to an existing transaction, or skipped)
    // settles that due date: it is never projected again.
    const payments = await this.db.getAll<{ bill: string; d: string }>(
      `SELECT bill_id AS bill, due_date AS d FROM bill_payments
       WHERE user_id = ? AND deleted_at IS NULL`,
      [this.userId],
    );
    const settled = new Map<string, Set<string>>();
    for (const p of payments) settled.set(p.bill, (settled.get(p.bill) ?? new Set()).add(p.d));
    const out: ExpectedItem[] = [];
    for (const row of bills) {
      const b = toBill(row);
      const plan: BillPlan = {
        id: b.id,
        name: b.name,
        frequency: b.frequency,
        interval: b.interval,
        anchorDate: b.anchorDate ?? b.nextDueDate,
        endDate: b.endDate,
        nextDueDate: b.nextDueDate,
        amountMinor: b.amountMinor,
        currency: b.currency,
        accountName: row.account_name,
        isVariableAmount: b.isVariableAmount,
        isSubscription: b.isSubscription,
      };
      out.push(...billOccurrences(plan, settled.get(b.id) ?? new Set(), from, to, today));
    }
    return out;
  }

  async cashflow(
    today: string,
    horizon: CashflowHorizon,
    base: CurrencyCode,
  ): Promise<UpcomingCashflow> {
    const { from, to } = horizonRange(today, horizon);
    const items = [
      ...(await this.ruleItems(from, to, today)),
      ...(await this.billItems(from, to, today)),
    ].sort(compareExpected);
    const byCurrency = summarizeExpected(items);
    // Future amounts: today's latest cached rates (Phase 6 current policy).
    const converter = new Converter(this.db, 'current');
    let income = 0;
    let expense = 0;
    let complete = true;
    for (const f of byCurrency) {
      const i = await converter.convert(f.incomeMinor, f.currency, base, today);
      const e = await converter.convert(f.expenseMinor, f.currency, base, today);
      if (i === null || e === null) complete = false;
      else {
        income += i;
        expense += e;
      }
    }
    return {
      from,
      to,
      items,
      byCurrency,
      combined: complete
        ? { currency: base, incomeMinor: income, expenseMinor: expense, netMinor: income - expense }
        : null,
      fx: converter.note(base),
    };
  }

  async reminderCandidates(today: string, through: string): Promise<ReminderCandidate[]> {
    const leads = new Map<string, number | null>();
    for (const r of await this.db.getAll<{ id: string; lead: number | null; kind: string }>(
      `SELECT id, reminder_days_before AS lead, 'rule' AS kind FROM recurring_transactions
       WHERE user_id = ? AND deleted_at IS NULL
       UNION ALL
       SELECT id, reminder_days_before, 'bill' FROM bills WHERE user_id = ? AND deleted_at IS NULL`,
      [this.userId, this.userId],
    )) {
      leads.set(`${r.kind}:${r.id}`, r.lead);
    }
    const items = [
      ...(await this.ruleItems(today, through, today)),
      ...(await this.billItems(today, through, today)),
    ];
    return items.map((i) => ({
      source: i.source,
      sourceId: i.sourceId,
      date: i.date,
      leadDays: leads.get(`${i.source === 'bill' ? 'bill' : 'rule'}:${i.sourceId}`) ?? null,
      name: i.name,
      type: i.type,
      amountMinor: i.amountMinor,
      currency: i.currency,
    }));
  }
}
