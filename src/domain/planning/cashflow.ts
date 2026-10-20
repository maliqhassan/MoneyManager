import type { CurrencyCode } from '../currency/currencies';
import { addDays, type CalendarDate, compareDates } from '../dates/calendar';

import { occurrencesBetween, type Recurrence } from './recurrence';
import type { OccurrenceState } from './recurring';

/**
 * Upcoming cash flow: what is EXPECTED from schedules (recurring rules and
 * bills) over a horizon. Never posted transactions, never a balance.
 * Transfers are never part of it (rules are income/expense, bills expenses).
 */

export const CASHFLOW_HORIZONS = [7, 14, 30] as const;
export type CashflowHorizon = (typeof CASHFLOW_HORIZONS)[number];
/** Overdue items older than this are no longer projected. */
export const OVERDUE_WINDOW_DAYS = 30;

export interface ExpectedItem {
  /** Stable key: `${source}:${sourceId}:${date}` (also the reminder identity). */
  key: string;
  source: 'recurring' | 'bill';
  sourceId: string;
  name: string;
  date: CalendarDate;
  type: 'income' | 'expense';
  /** Positive amount in minor units of `currency`. */
  amountMinor: number;
  currency: CurrencyCode;
  accountName: string | null;
  state: OccurrenceState;
  /** Variable-amount bills: the amount is an estimate. */
  approximate: boolean;
  isSubscription: boolean;
}

export interface CurrencyFlow {
  currency: CurrencyCode;
  incomeMinor: number;
  expenseMinor: number;
  netMinor: number;
  approximate: boolean;
}

export function horizonRange(today: CalendarDate, days: number) {
  return { from: addDays(today, -OVERDUE_WINDOW_DAYS), to: addDays(today, days - 1) };
}

export function stateOf(date: CalendarDate, today: CalendarDate): OccurrenceState {
  const c = compareDates(date, today);
  return c < 0 ? 'overdue' : c === 0 ? 'due_today' : 'upcoming';
}

export interface BillPlan extends Recurrence {
  id: string;
  name: string;
  anchorDate: CalendarDate;
  endDate: CalendarDate | null;
  /** First unpaid due date (bills advance it when paid or skipped). */
  nextDueDate: CalendarDate;
  amountMinor: number;
  currency: CurrencyCode;
  accountName: string | null;
  isVariableAmount: boolean;
  isSubscription: boolean;
}

/**
 * Unpaid bill occurrences in [from, to]: from the bill's next unpaid due date
 * on, minus any date that already has a payment (paid, linked or skipped).
 */
export function billOccurrences(
  bill: BillPlan,
  settled: ReadonlySet<CalendarDate>,
  from: CalendarDate,
  to: CalendarDate,
  today: CalendarDate,
): ExpectedItem[] {
  const start = compareDates(bill.nextDueDate, from) > 0 ? bill.nextDueDate : from;
  return occurrencesBetween(bill.anchorDate, bill, start, to, bill.endDate, 60)
    .filter((d) => compareDates(d, bill.nextDueDate) >= 0 && !settled.has(d))
    .map((date) => ({
      key: `bill:${bill.id}:${date}`,
      source: 'bill' as const,
      sourceId: bill.id,
      name: bill.name,
      date,
      type: 'expense' as const,
      amountMinor: bill.amountMinor,
      currency: bill.currency,
      accountName: bill.accountName,
      state: stateOf(date, today),
      approximate: bill.isVariableAmount,
      isSubscription: bill.isSubscription,
    }));
}

/** Expected income, expenses and net per currency (exact integer sums). */
export function summarizeExpected(items: readonly ExpectedItem[]): CurrencyFlow[] {
  const by = new Map<CurrencyCode, CurrencyFlow>();
  for (const i of items) {
    const f = by.get(i.currency) ?? {
      currency: i.currency,
      incomeMinor: 0,
      expenseMinor: 0,
      netMinor: 0,
      approximate: false,
    };
    if (i.type === 'income') f.incomeMinor += i.amountMinor;
    else f.expenseMinor += i.amountMinor;
    f.netMinor = f.incomeMinor - f.expenseMinor;
    f.approximate ||= i.approximate;
    by.set(i.currency, f);
  }
  return [...by.values()].sort((a, b) => a.currency.localeCompare(b.currency));
}

/** Overdue first, then by date, then name. */
export function compareExpected(a: ExpectedItem, b: ExpectedItem): number {
  return compareDates(a.date, b.date) || a.name.localeCompare(b.name) || a.key.localeCompare(b.key);
}
