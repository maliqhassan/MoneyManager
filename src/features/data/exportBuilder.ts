import type { CurrencyCode } from '@/domain/currency/currencies';
import { localTimeInZone } from '@/domain/dates/zoned';
import {
  ACCOUNT_COLUMNS,
  BILL_COLUMNS,
  BILL_PAYMENT_COLUMNS,
  BUDGET_COLUMNS,
  BUDGET_REVISION_COLUMNS,
  CATEGORY_COLUMNS,
  decimalAmount,
  type ExportTable,
  GOAL_COLUMNS,
  EXCHANGE_RATE_COLUMNS,
  GOAL_CONTRIBUTION_COLUMNS,
  type ManifestInput,
  SPLIT_COLUMNS,
  TRANSACTION_COLUMNS,
} from '@/domain/exports/export';
import type { ExportFilter, Repositories } from '@/repositories/types';

export interface ExportOptions {
  scope: 'transactions' | 'all';
  filter: ExportFilter;
  /** Display name of a category (translated system names). */
  categoryName: (c: { name: string | null; systemKey: string | null }) => string;
  /** Date in the user's display format. */
  dateDisplay: (date: string) => string;
  baseCurrency: CurrencyCode;
  timeZone: string;
  appVersion: string;
  now: string;
}

export interface BuiltExport {
  tables: ExportTable[];
  manifest: ManifestInput;
}

const bool = (v: number) => v === 1;

/**
 * Builds the export tables from the user's local data. Transactions honour
 * the filters; with scope 'all', accounts, categories, budgets, bills and
 * goals are exported in full (current state). Relationships are kept as id
 * columns (transfer_id, refund_of_transaction_id, transaction_id, …).
 */
export async function buildExport(
  repos: Pick<Repositories, 'exports' | 'exchangeRates'>,
  o: ExportOptions,
): Promise<BuiltExport> {
  const r = repos.exports;
  const nameOf = (name: string | null, systemKey: string | null) =>
    name ? o.categoryName({ name, systemKey }) : null;

  const transactions = await r.transactions(o.filter);
  const tables: ExportTable[] = [
    {
      file: 'transactions.csv',
      columns: TRANSACTION_COLUMNS,
      rows: transactions.map((t) => {
        const hasParent = t.parent_name !== null;
        return {
          transaction_id: t.id,
          date: t.local_date,
          date_display: o.dateDisplay(t.local_date),
          time: localTimeInZone(new Date(t.occurred_at), t.time_zone),
          time_zone: t.time_zone,
          occurred_at_utc: t.occurred_at,
          type: t.type,
          amount: decimalAmount(t.amount_minor, t.currency),
          amount_minor: t.amount_minor,
          currency: t.currency,
          base_amount:
            t.base_fx_source === 'unconverted'
              ? null
              : decimalAmount(t.base_amount_minor, t.base_currency),
          base_currency: t.base_fx_source === 'unconverted' ? null : t.base_currency,
          base_fx_rate: t.base_fx_source === 'unconverted' ? null : t.base_fx_rate,
          base_fx_rate_date: t.base_fx_source === 'unconverted' ? null : t.base_fx_rate_date,
          base_conversion: t.base_fx_source,
          account: t.account_name,
          account_id: t.account_id,
          category: hasParent
            ? nameOf(t.parent_name, t.parent_system_key)
            : nameOf(t.category_name, t.category_system_key),
          subcategory: hasParent ? nameOf(t.category_name, t.category_system_key) : null,
          category_id: t.category_id,
          merchant: t.payee,
          notes: t.notes,
          tags: t.tags,
          transfer_id: t.transfer_id,
          transfer_other_account: t.other_account_name,
          refund_of_transaction_id: t.refund_of_transaction_id,
          split_count: t.split_count,
          sync_status: t.sync_status,
        };
      }),
    },
  ];

  const splits = await r.splits(o.filter);
  if (o.scope === 'all' || splits.length > 0) {
    tables.push({
      file: 'transaction_splits.csv',
      columns: SPLIT_COLUMNS,
      rows: splits.map((s) => {
        const hasParent = s.parent_name !== null;
        return {
          transaction_id: s.transaction_id,
          split_index: s.sort_order + 1,
          amount: decimalAmount(s.amount_minor, s.currency),
          amount_minor: s.amount_minor,
          currency: s.currency,
          category: hasParent
            ? nameOf(s.parent_name, s.parent_system_key)
            : nameOf(s.category_name, s.category_system_key),
          subcategory: hasParent ? nameOf(s.category_name, s.category_system_key) : null,
          category_id: s.category_id,
          notes: s.notes,
        };
      }),
    });
  }

  if (o.scope === 'all') {
    const [
      accounts,
      categories,
      budgets,
      revisions,
      bills,
      payments,
      goals,
      contributions,
      manualRates,
    ] = await Promise.all([
      r.accounts(),
      r.categories(),
      r.budgets(),
      r.budgetRevisions(),
      r.bills(),
      r.billPayments(),
      r.goals(),
      r.goalContributions(),
      repos.exchangeRates.listManualRates(),
    ]);
    tables.push(
      {
        file: 'accounts.csv',
        columns: ACCOUNT_COLUMNS,
        rows: accounts.map((a) => ({
          account_id: a.id,
          name: a.name,
          type: a.type,
          currency: a.currency,
          opening_balance: decimalAmount(a.opening_balance_minor, a.currency),
          opening_balance_date: a.opening_balance_date,
          current_balance: decimalAmount(a.opening_balance_minor + a.postings, a.currency),
          credit_limit:
            a.credit_limit_minor === null ? null : decimalAmount(a.credit_limit_minor, a.currency),
          include_in_totals: bool(a.include_in_totals),
          archived: bool(a.is_archived),
          notes: a.notes,
        })),
      },
      {
        file: 'categories.csv',
        columns: CATEGORY_COLUMNS,
        rows: categories.map((c) => ({
          category_id: c.id,
          name: nameOf(c.name, c.system_key),
          kind: c.kind,
          parent_category: nameOf(c.parent_name, c.parent_system_key),
          parent_id: c.parent_id,
          archived: bool(c.is_archived),
          system_key: c.system_key,
        })),
      },
      {
        file: 'budgets.csv',
        columns: BUDGET_COLUMNS,
        rows: budgets.map((b) => ({
          budget_id: b.id,
          name: b.name,
          category: b.category_id ? nameOf(b.category_name, b.category_system_key) : null,
          category_id: b.category_id,
          period_type: b.period_type,
          start_date: b.start_date,
          end_date: b.end_date,
          currency: b.currency,
          current_amount:
            b.amount_minor === null ? null : decimalAmount(b.amount_minor, b.currency),
          rollover: bool(b.rollover_enabled),
          archived: bool(b.is_archived),
        })),
      },
      {
        file: 'budget_revisions.csv',
        columns: BUDGET_REVISION_COLUMNS,
        rows: revisions.map((v) => ({
          budget_id: v.budget_id,
          effective_from: v.effective_from,
          amount: decimalAmount(v.amount_minor, v.currency),
          currency: v.currency,
          rollover: bool(v.rollover_enabled),
        })),
      },
      {
        file: 'bills.csv',
        columns: BILL_COLUMNS,
        rows: bills.map((b) => ({
          bill_id: b.id,
          name: b.name,
          kind: b.is_subscription === 1 ? 'subscription' : 'bill',
          amount: decimalAmount(b.amount_minor, b.currency),
          currency: b.currency,
          amount_varies: bool(b.is_variable_amount),
          account: b.account_name,
          category: nameOf(b.category_name, b.category_system_key),
          frequency: b.frequency,
          interval: b.interval,
          first_due_date: b.anchor_date ?? b.next_due_date,
          next_due_date: b.next_due_date,
          end_date: b.end_date,
          reminder_days_before: b.reminder_days_before,
          autopay: bool(b.autopay),
          active: bool(b.is_active),
          notes: b.notes,
        })),
      },
      {
        file: 'bill_payments.csv',
        columns: BILL_PAYMENT_COLUMNS,
        rows: payments.map((p) => ({
          payment_id: p.id,
          bill_id: p.bill_id,
          due_date: p.due_date,
          status: p.status,
          paid_at_utc: p.paid_at,
          amount: p.amount_minor === null ? null : decimalAmount(p.amount_minor, p.currency),
          currency: p.currency,
          transaction_id: p.transaction_id,
        })),
      },
      {
        file: 'savings_goals.csv',
        columns: GOAL_COLUMNS,
        rows: goals.map((g) => ({
          goal_id: g.id,
          name: g.name,
          target_amount: decimalAmount(g.target_amount_minor, g.currency),
          currency: g.currency,
          target_date: g.target_date,
          account: g.account_name,
          status: g.status,
        })),
      },
      {
        file: 'goal_contributions.csv',
        columns: GOAL_CONTRIBUTION_COLUMNS,
        rows: contributions.map((c) => {
          const currency = c.currency ?? c.goal_currency;
          return {
            contribution_id: c.id,
            goal_id: c.goal_id,
            date: c.contributed_on,
            amount: decimalAmount(c.amount_minor, currency),
            currency,
            account: c.account_name,
            transfer_id: c.transfer_id,
            notes: c.notes,
          };
        }),
      },
      {
        file: 'exchange_rates.csv',
        columns: EXCHANGE_RATE_COLUMNS,
        rows: manualRates.map((m) => ({
          from_currency: m.base,
          to_currency: m.quote,
          rate: m.rate,
          effective_date: m.rateDate,
          source: 'manual',
          entered_at_utc: m.enteredAt,
        })),
      },
    );
  }

  const manifest: ManifestInput = {
    exportedAt: o.now,
    appVersion: o.appVersion,
    baseCurrency: o.baseCurrency,
    timeZone: o.timeZone,
    range: o.filter.from && o.filter.to ? { start: o.filter.from, end: o.filter.to } : null,
    accountFilter: o.filter.accountIds,
    typeFilter: o.filter.types,
    files: tables.map((t) => ({ file: t.file, rows: t.rows.length })),
    pendingLocalChanges: await r.pendingChanges(),
  };
  return { tables, manifest };
}
