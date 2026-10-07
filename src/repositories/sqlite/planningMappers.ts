import type { CurrencyCode } from '@/domain/currency/currencies';
import type {
  BillPaymentStatus,
  BudgetPeriodType,
  GoalStatus,
  RecurrenceFrequency,
} from '@/domain/enums';
import type {
  Bill,
  BillPayment,
  Budget,
  BudgetRevision,
  GoalContribution,
  SavingsGoal,
} from '@/domain/models';

import { synced, type SyncedRow } from './mappers';
import { toBool } from './shared';

/** Row → model mappers for Phase 3 planning tables. */

export interface BudgetRow extends SyncedRow {
  name: string;
  category_id: string | null;
  period_type: BudgetPeriodType;
  start_date: string;
  end_date: string | null;
  currency: CurrencyCode;
  amount_minor: number | null;
  rollover_enabled: number;
  is_archived: number;
}

export const toBudget = (r: BudgetRow): Budget => ({
  ...synced(r),
  name: r.name,
  categoryId: r.category_id,
  periodType: r.period_type,
  startDate: r.start_date,
  endDate: r.end_date,
  currency: r.currency,
  amountMinor: r.amount_minor,
  rolloverEnabled: toBool(r.rollover_enabled),
  isArchived: toBool(r.is_archived),
});

export interface BudgetRevisionRow extends SyncedRow {
  budget_id: string;
  effective_from: string;
  amount_minor: number;
  rollover_enabled: number;
}

export const toBudgetRevision = (r: BudgetRevisionRow): BudgetRevision => ({
  ...synced(r),
  budgetId: r.budget_id,
  effectiveFrom: r.effective_from,
  amountMinor: r.amount_minor,
  rolloverEnabled: toBool(r.rollover_enabled),
});

export interface BillRow extends SyncedRow {
  name: string;
  account_id: string | null;
  category_id: string | null;
  amount_minor: number;
  currency: CurrencyCode;
  is_variable_amount: number;
  is_subscription: number;
  frequency: RecurrenceFrequency;
  interval: number;
  anchor_date: string | null;
  next_due_date: string;
  end_date: string | null;
  autopay: number;
  reminder_days_before: number | null;
  recurring_transaction_id: string | null;
  notes: string | null;
  is_active: number;
}

export const toBill = (r: BillRow): Bill => ({
  ...synced(r),
  name: r.name,
  accountId: r.account_id,
  categoryId: r.category_id,
  amountMinor: r.amount_minor,
  currency: r.currency,
  isVariableAmount: toBool(r.is_variable_amount),
  isSubscription: toBool(r.is_subscription),
  frequency: r.frequency,
  interval: r.interval,
  anchorDate: r.anchor_date ?? r.next_due_date,
  nextDueDate: r.next_due_date,
  endDate: r.end_date,
  autopay: toBool(r.autopay),
  reminderDaysBefore: r.reminder_days_before,
  recurringTransactionId: r.recurring_transaction_id,
  notes: r.notes,
  isActive: toBool(r.is_active),
});

export interface BillPaymentRow extends SyncedRow {
  bill_id: string;
  due_date: string;
  status: BillPaymentStatus;
  paid_at: string | null;
  amount_minor: number | null;
  transaction_id: string | null;
}

export const toBillPayment = (r: BillPaymentRow): BillPayment => ({
  ...synced(r),
  billId: r.bill_id,
  dueDate: r.due_date,
  status: r.status,
  paidAt: r.paid_at,
  amountMinor: r.amount_minor,
  transactionId: r.transaction_id,
});

export interface GoalRow extends SyncedRow {
  name: string;
  target_amount_minor: number;
  currency: CurrencyCode;
  target_date: string | null;
  account_id: string | null;
  icon: string | null;
  color: string | null;
  status: GoalStatus;
}

export const toGoal = (r: GoalRow): SavingsGoal => ({
  ...synced(r),
  name: r.name,
  targetAmountMinor: r.target_amount_minor,
  currency: r.currency,
  targetDate: r.target_date,
  accountId: r.account_id,
  icon: r.icon,
  color: r.color,
  status: r.status,
});

export interface ContributionRow extends SyncedRow {
  goal_id: string;
  amount_minor: number;
  currency: CurrencyCode | null;
  contributed_on: string;
  account_id: string | null;
  transfer_id: string | null;
  transaction_id: string | null;
  notes: string | null;
}

export const toContribution = (
  r: ContributionRow,
  goalCurrency: CurrencyCode,
): GoalContribution => ({
  ...synced(r),
  goalId: r.goal_id,
  amountMinor: r.amount_minor,
  currency: r.currency ?? goalCurrency,
  contributedOn: r.contributed_on,
  accountId: r.account_id,
  transferId: r.transfer_id,
  transactionId: r.transaction_id,
  notes: r.notes,
});
