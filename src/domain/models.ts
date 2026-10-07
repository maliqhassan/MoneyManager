import type { CurrencyCode } from './currency/currencies';
import type {
  AccountType,
  BillPaymentStatus,
  BudgetPeriodType,
  CategoryKind,
  GoalStatus,
  ImportBatchStatus,
  ImportRowStatus,
  NotificationType,
  RecurrenceFrequency,
  RuleMatchField,
  RuleMatchType,
  TransactionType,
  Weekday,
} from './enums';
import type { DecimalString } from './money/decimal';

/**
 * Domain models (camelCase). These are what repositories return and features
 * consume. Database rows (snake_case) are mapped to these in the repository
 * layer; UI code never sees raw rows.
 *
 * Conventions:
 * - ids are client-generated UUID v4 strings (enables offline creation and
 *   idempotent sync).
 * - `*Minor` fields are integer minor units of the stated currency.
 * - `*At` fields are ISO-8601 UTC timestamps; `*Date` fields are calendar
 *   dates "YYYY-MM-DD" in the user's local time zone at the time of entry.
 */

export type Uuid = string;
export type IsoTimestamp = string;
export type IsoDate = string;

/** Fields shared by every user-owned, synchronised record. */
export interface SyncedEntity {
  id: Uuid;
  userId: Uuid;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
  /** Soft-delete tombstone; deleted records are kept until sync confirms. */
  deletedAt: IsoTimestamp | null;
  /** Server row version used for optimistic concurrency / conflict detection. */
  version: number;
}

export interface Profile {
  id: Uuid;
  displayName: string | null;
  avatarPath: string | null;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}

export interface UserPreferences extends SyncedEntity {
  baseCurrency: CurrencyCode;
  /** BCP-47 locale tag used for number/date formatting, e.g. "en-GB". */
  locale: string;
  /** IANA time zone, e.g. "Asia/Dubai". */
  timeZone: string;
  firstDayOfWeek: Weekday;
  /** Day of month (1–28) on which monthly budgets start, e.g. payday. */
  monthStartDay: number;
}

export interface Account extends SyncedEntity {
  name: string;
  type: AccountType;
  currency: CurrencyCode;
  openingBalanceMinor: number;
  openingBalanceDate: IsoDate;
  creditLimitMinor: number | null;
  institution: string | null;
  color: string | null;
  icon: string | null;
  notes: string | null;
  includeInTotals: boolean;
  isArchived: boolean;
  sortOrder: number;
}

export interface Category extends SyncedEntity {
  parentId: Uuid | null;
  name: string;
  kind: CategoryKind;
  icon: string | null;
  color: string | null;
  /** Stable key for seeded default categories (null for user-created). */
  systemKey: string | null;
  isArchived: boolean;
  sortOrder: number;
}

export interface Merchant extends SyncedEntity {
  name: string;
  normalizedName: string;
  defaultCategoryId: Uuid | null;
}

export interface Tag extends SyncedEntity {
  name: string;
  color: string | null;
}

/**
 * A single posting against one account.
 *
 * `amountMinor` is SIGNED in the account's currency from the account's point
 * of view: negative = money leaves the account, positive = money enters.
 * Balances are therefore a plain sum. The `type` carries the semantics
 * (expense < 0, income > 0, refund > 0, transfer legs either sign).
 */
export interface Transaction extends SyncedEntity {
  accountId: Uuid;
  type: TransactionType;
  amountMinor: number;
  currency: CurrencyCode;
  /** As entered by the user, e.g. a EUR purchase on a USD card. Never overwritten. */
  originalAmountMinor: number;
  originalCurrency: CurrencyCode;
  /** original → account currency rate ("1" when identical). */
  fxRate: DecimalString;
  /** Conversion snapshot into the user's base currency at entry time. */
  baseCurrency: CurrencyCode;
  baseAmountMinor: number;
  baseFxRate: DecimalString;
  baseFxRateDate: IsoDate;
  baseFxSource: string;
  categoryId: Uuid | null;
  merchantId: Uuid | null;
  payee: string | null;
  notes: string | null;
  occurredAt: IsoTimestamp;
  localDate: IsoDate;
  timeZone: string;
  isSplit: boolean;
  transferId: Uuid | null;
  refundOfTransactionId: Uuid | null;
  recurringTransactionId: Uuid | null;
  importBatchId: Uuid | null;
  /** Deterministic fingerprint used for import duplicate detection. */
  importHash: string | null;
}

export interface TransactionSplit extends SyncedEntity {
  transactionId: Uuid;
  categoryId: Uuid | null;
  /** Same sign and currency as the parent; splits sum exactly to the parent. */
  amountMinor: number;
  baseAmountMinor: number;
  notes: string | null;
  sortOrder: number;
}

export interface TransactionTag extends SyncedEntity {
  transactionId: Uuid;
  tagId: Uuid;
}

/**
 * Groups the two legs of a transfer. Each leg is a Transaction with
 * `type = 'transfer'` and `transferId` pointing here.
 */
export interface Transfer extends SyncedEntity {
  fromAccountId: Uuid;
  toAccountId: Uuid;
  /** Positive amount leaving the source account, in its currency. */
  fromAmountMinor: number;
  fromCurrency: CurrencyCode;
  /** Positive amount arriving in the destination account, in its currency. */
  toAmountMinor: number;
  toCurrency: CurrencyCode;
  fxRate: DecimalString;
  occurredAt: IsoTimestamp;
  localDate: IsoDate;
  notes: string | null;
}

export interface CategoryRule extends SyncedEntity {
  name: string | null;
  matchField: RuleMatchField;
  matchType: RuleMatchType;
  pattern: string;
  categoryId: Uuid;
  merchantId: Uuid | null;
  priority: number;
  isEnabled: boolean;
}

export interface Budget extends SyncedEntity {
  name: string;
  periodType: BudgetPeriodType;
  /** Anchor date; for custom budgets the first day of the only period. */
  startDate: IsoDate;
  /** Only for custom budgets. */
  endDate: IsoDate | null;
  currency: CurrencyCode;
  /** Overall limit per period; null when the budget is allocation-only. */
  amountMinor: number | null;
  rolloverEnabled: boolean;
  isArchived: boolean;
}

export interface BudgetAllocation extends SyncedEntity {
  budgetId: Uuid;
  categoryId: Uuid;
  amountMinor: number;
  rolloverEnabled: boolean;
}

export interface RecurringTransaction extends SyncedEntity {
  accountId: Uuid;
  categoryId: Uuid | null;
  type: Exclude<TransactionType, 'transfer'>;
  amountMinor: number;
  currency: CurrencyCode;
  payee: string | null;
  notes: string | null;
  frequency: RecurrenceFrequency;
  interval: number;
  startDate: IsoDate;
  endDate: IsoDate | null;
  nextOccurrenceDate: IsoDate | null;
  autoPost: boolean;
  timeZone: string;
  isActive: boolean;
}

export interface Bill extends SyncedEntity {
  name: string;
  accountId: Uuid | null;
  categoryId: Uuid | null;
  amountMinor: number;
  currency: CurrencyCode;
  isVariableAmount: boolean;
  isSubscription: boolean;
  frequency: RecurrenceFrequency;
  interval: number;
  nextDueDate: IsoDate;
  reminderDaysBefore: number | null;
  recurringTransactionId: Uuid | null;
  notes: string | null;
  isActive: boolean;
}

export interface BillPayment extends SyncedEntity {
  billId: Uuid;
  dueDate: IsoDate;
  status: BillPaymentStatus;
  paidAt: IsoTimestamp | null;
  amountMinor: number | null;
  transactionId: Uuid | null;
}

export interface SavingsGoal extends SyncedEntity {
  name: string;
  targetAmountMinor: number;
  currency: CurrencyCode;
  targetDate: IsoDate | null;
  accountId: Uuid | null;
  icon: string | null;
  color: string | null;
  status: GoalStatus;
}

export interface GoalContribution extends SyncedEntity {
  goalId: Uuid;
  /** Positive = contribution, negative = withdrawal, in the goal currency. */
  amountMinor: number;
  contributedOn: IsoDate;
  transactionId: Uuid | null;
  notes: string | null;
}

export interface Attachment extends SyncedEntity {
  transactionId: Uuid;
  /** Object path in the private `attachments` storage bucket. */
  storagePath: string;
  mimeType: string;
  sizeBytes: number;
  fileName: string;
}

export interface ImportBatch extends SyncedEntity {
  source: 'csv';
  fileName: string;
  accountId: Uuid | null;
  status: ImportBatchStatus;
  /** Column mapping chosen by the user, keyed by target field. */
  columnMapping: Record<string, string> | null;
  rowCount: number;
  importedCount: number;
  duplicateCount: number;
  errorCount: number;
  committedAt: IsoTimestamp | null;
}

export interface ImportRow extends SyncedEntity {
  batchId: Uuid;
  rowIndex: number;
  raw: Record<string, string>;
  localDate: IsoDate | null;
  amountMinor: number | null;
  currency: CurrencyCode | null;
  payee: string | null;
  notes: string | null;
  categoryId: Uuid | null;
  status: ImportRowStatus;
  error: string | null;
  importHash: string | null;
  transactionId: Uuid | null;
  duplicateOfTransactionId: Uuid | null;
}

/** Reference data (not user-owned). Rates are exact decimal strings. */
export interface ExchangeRateRecord {
  id: Uuid;
  baseCurrency: CurrencyCode;
  quoteCurrency: CurrencyCode;
  rate: DecimalString;
  rateDate: IsoDate;
  source: string;
  createdAt: IsoTimestamp;
}

export interface AppNotification extends SyncedEntity {
  type: NotificationType;
  title: string;
  body: string | null;
  entityType: string | null;
  entityId: Uuid | null;
  scheduledFor: IsoTimestamp | null;
  readAt: IsoTimestamp | null;
}
