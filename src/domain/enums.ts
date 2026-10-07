/**
 * Domain enumerations. Each is a readonly tuple so it can drive TypeScript
 * types, Zod schemas and database CHECK constraints from one definition.
 * Keep in sync with supabase/migrations and src/database/migrations.
 */

export const ACCOUNT_TYPES = [
  'cash',
  'checking',
  'savings',
  'credit_card',
  'debit_card',
  'digital_wallet',
  'loan',
  'other',
] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

/** Liability accounts carry a balance that is owed (normally ≤ 0). */
export const LIABILITY_ACCOUNT_TYPES: readonly AccountType[] = ['credit_card', 'loan'];

export const TRANSACTION_TYPES = ['expense', 'income', 'transfer', 'refund'] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];

export const CATEGORY_KINDS = ['expense', 'income'] as const;
export type CategoryKind = (typeof CATEGORY_KINDS)[number];

export const BUDGET_PERIOD_TYPES = ['weekly', 'monthly', 'custom'] as const;
export type BudgetPeriodType = (typeof BUDGET_PERIOD_TYPES)[number];

export const RECURRENCE_FREQUENCIES = ['daily', 'weekly', 'monthly', 'yearly'] as const;
export type RecurrenceFrequency = (typeof RECURRENCE_FREQUENCIES)[number];

export const BILL_PAYMENT_STATUSES = ['unpaid', 'paid', 'skipped'] as const;
export type BillPaymentStatus = (typeof BILL_PAYMENT_STATUSES)[number];

export const GOAL_STATUSES = ['active', 'achieved', 'archived'] as const;
export type GoalStatus = (typeof GOAL_STATUSES)[number];

export const RULE_MATCH_FIELDS = ['payee', 'notes'] as const;
export type RuleMatchField = (typeof RULE_MATCH_FIELDS)[number];

/** Regex matching is intentionally excluded (ReDoS risk on user patterns). */
export const RULE_MATCH_TYPES = ['contains', 'equals', 'starts_with'] as const;
export type RuleMatchType = (typeof RULE_MATCH_TYPES)[number];

export const IMPORT_BATCH_STATUSES = [
  'draft',
  'mapped',
  'previewed',
  'committed',
  'failed',
  'reverted',
] as const;
export type ImportBatchStatus = (typeof IMPORT_BATCH_STATUSES)[number];

export const IMPORT_ROW_STATUSES = [
  'pending',
  'duplicate',
  'imported',
  'skipped',
  'error',
] as const;
export type ImportRowStatus = (typeof IMPORT_ROW_STATUSES)[number];

export const THEME_MODES = ['system', 'light', 'dark'] as const;
export type ThemeMode = (typeof THEME_MODES)[number];

/** 0 = Sunday … 6 = Saturday (matches JS Date#getUTCDay). */
export const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export const NOTIFICATION_TYPES = [
  'bill_due',
  'budget_threshold',
  'budget_exceeded',
  'goal_milestone',
  'sync_issue',
  'system',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/**
 * Date display order. 'locale' follows the user's formatting locale; the
 * others force a numeric pattern. Dates are always STORED canonically
 * (YYYY-MM-DD / ISO-8601) — this only affects presentation.
 */
export const DATE_FORMATS = ['locale', 'MDY', 'DMY', 'YMD'] as const;
export type DateFormat = (typeof DATE_FORMATS)[number];

/**
 * Number separators. 'locale' follows the user's formatting locale; the
 * others map to a representative locale (see i18n/format.ts) so grouping and
 * separators still come from Intl:
 *   comma_period      1,234.56   (en-US)
 *   period_comma      1.234,56   (de-DE)
 *   space_comma       1 234,56   (fr-FR)
 *   apostrophe_period 1'234.56   (de-CH)
 */
export const NUMBER_FORMATS = [
  'locale',
  'comma_period',
  'period_comma',
  'space_comma',
  'apostrophe_period',
] as const;
export type NumberFormat = (typeof NUMBER_FORMATS)[number];
