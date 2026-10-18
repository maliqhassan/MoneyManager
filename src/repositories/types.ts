import type { CurrencyCode } from '@/domain/currency/currencies';
import type { ProviderRate } from '@/domain/fx/frankfurter';
import type { ConversionBasis, ConversionNote } from '@/domain/fx/note';
import type { RateMode, ResolvedRate } from '@/domain/fx/policy';
import type { ManualRateInput } from '@/validation/exchangeRates';
import type { CategoryKind, TransactionType } from '@/domain/enums';
import type { Money } from '@/domain/money/money';
import type {
  Account,
  Attachment,
  Bill,
  BillPayment,
  Budget,
  BudgetRevision,
  Category,
  CategoryRule,
  IsoDate,
  GoalContribution,
  SavingsGoal,
  Tag,
  Transaction,
  TransactionSplit,
  UserPreferences,
  Uuid,
} from '@/domain/models';
import type { BudgetEvaluation } from '@/domain/planning/budgets';
import type { GoalProgress } from '@/domain/planning/goals';
import type { PeriodicCost } from '@/domain/planning/recurrence';
import type {
  BalanceInput,
  CategorySpendRow as ReportCategoryRow,
  FlowRow,
  MerchantSpendRow,
} from '@/domain/reports/aggregate';
import type { DateRange } from '@/domain/reports/periods';

import type { SqliteExportRepository } from './sqlite/SqliteExportRepository';
import type {
  BillInput,
  BillLinkInput,
  BillPaymentInput,
  BudgetInput,
  ContributionInput,
  GoalInput,
} from '@/validation/planning';
import type {
  AccountInput,
  AccountUpdate,
  CategoryInput,
  CategoryUpdate,
} from '@/validation/entities';
import type { PreferencesUpdate } from '@/validation/preferences';
import type { ReceiptFile, TransactionInput, TransferInput } from '@/validation/transactions';
import type { DecimalString } from '@/domain/money/decimal';

/**
 * Repository contracts. Features depend on these interfaces only; the SQLite
 * implementations live in ./sqlite. Every write:
 *   1. validates input with Zod (throws AppError 'validation'),
 *   2. writes the row and its outbox entry in ONE local transaction,
 *   3. notifies listeners so queries refresh and sync is scheduled.
 */

export interface AccountBalance {
  accountId: Uuid;
  balance: Money;
}

export interface AccountRepository {
  list(options?: { includeArchived?: boolean }): Promise<Account[]>;
  getById(id: Uuid): Promise<Account | null>;
  create(input: AccountInput): Promise<Account>;
  update(id: Uuid, patch: AccountUpdate): Promise<Account>;
  setArchived(id: Uuid, archived: boolean): Promise<Account>;
  /** Soft-deletes. Refuses when the account still has transactions (archive instead). */
  remove(id: Uuid): Promise<void>;
  /** Current balance of every non-deleted account, in each account's currency. */
  getBalances(): Promise<AccountBalance[]>;
  /** How much history references the account (drives what may be edited/deleted). */
  getUsage(id: Uuid): Promise<AccountUsage>;
  /**
   * Changes the currency of an account WITHOUT history. Refused once any
   * transaction or transfer references it — historical amounts are never
   * silently converted. The opening balance must be re-entered in the new
   * currency's minor units.
   */
  changeCurrency(id: Uuid, currency: CurrencyCode, openingBalanceMinor: number): Promise<Account>;
}

export interface AccountUsage {
  transactionCount: number;
  transferCount: number;
}

export interface PreferencesRepository {
  get(): Promise<UserPreferences | null>;
  /** Works offline (queued for sync). Throws not_found until the server-created row has synced. */
  update(patch: PreferencesUpdate): Promise<UserPreferences>;
}

/** A rate the user entered (1 base = rate quote from rateDate). */
export interface ManualRate {
  id: string;
  base: CurrencyCode;
  quote: CurrencyCode;
  rate: DecimalString;
  rateDate: IsoDate;
  enteredAt: string;
}

/** Bookkeeping for one refresh scope (e.g. a provider). */
export interface FxFetchLog {
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  retryAfter: string | null;
}

/** Provider coverage per currency (contiguous cached range). */
export interface RateCoverage {
  currency: CurrencyCode;
  firstDate: IsoDate;
  lastDate: IsoDate;
  lastFetchedAt: string | null;
}

/** One currency's value in the base currency today, for the rates screen. */
export interface CurrentRateRow {
  currency: CurrencyCode;
  rate: ResolvedRate | null;
  fetchedAt: string | null;
}

export interface ExchangeRateRepository {
  /**
   * Rate converting 1 unit of `from` into `to` for an entry on
   * `onOrBefore` (YYYY-MM-DD), historical policy. Null when unknown —
   * callers must never guess.
   */
  findRate(
    from: CurrencyCode,
    to: CurrencyCode,
    onOrBefore: IsoDate,
  ): Promise<DecimalString | null>;
  /** Full resolution (rate, date, source, kind, derivation, staleness). */
  resolve(
    from: CurrencyCode,
    to: CurrencyCode,
    date: IsoDate,
    mode: RateMode,
  ): Promise<ResolvedRate | null>;
  /** Upserts validated provider rows in one transaction; returns rows written. */
  storeProviderRates(
    rows: readonly ProviderRate[],
    meta: { source: string; attribution: string; fetchedAt: string },
  ): Promise<number>;
  /**
   * Saves a manual rate. Throws a 'conflict' AppError when one already exists
   * for the pair and date unless `replace` is true (explicit confirmation).
   */
  saveManualRate(
    input: ManualRateInput,
    options: { today: IsoDate; replace: boolean },
  ): Promise<ManualRate>;
  findManualRate(
    base: CurrencyCode,
    quote: CurrencyCode,
    rateDate: IsoDate,
  ): Promise<ManualRate | null>;
  listManualRates(): Promise<ManualRate[]>;
  deleteManualRate(id: string): Promise<void>;
  /** Currencies of the user's accounts, entries, budgets, bills and goals + base. */
  currenciesInUse(): Promise<CurrencyCode[]>;
  /** Earliest entry date that may need a conversion into `base`, or null. */
  earliestConversionDate(base: CurrencyCode): Promise<IsoDate | null>;
  coverage(currencies: readonly CurrencyCode[], source: string): Promise<RateCoverage[]>;
  recordCoverage(
    source: string,
    currencies: readonly CurrencyCode[],
    from: string,
    to: string,
  ): Promise<void>;
  currentRates(
    currencies: readonly CurrencyCode[],
    base: CurrencyCode,
    today: IsoDate,
  ): Promise<CurrentRateRow[]>;
  fetchLog(scope: string): Promise<FxFetchLog>;
  recordFetch(scope: string, patch: Partial<FxFetchLog>): Promise<void>;
}

export interface CategoryUsage {
  /** Transactions + split lines using the category (non-deleted). */
  transactionCount: number;
  activeChildCount: number;
  ruleCount: number;
}

export interface CategoryRepository {
  list(options?: { kind?: CategoryKind; includeArchived?: boolean }): Promise<Category[]>;
  getById(id: Uuid): Promise<Category | null>;
  create(input: CategoryInput): Promise<Category>;
  /** Kind cannot change; parent changes are validated (one level, same kind). */
  update(id: Uuid, patch: CategoryUpdate): Promise<Category>;
  /** Archiving a parent also archives its active subcategories. Restoring a child requires an active parent. */
  setArchived(id: Uuid, archived: boolean): Promise<Category>;
  /** Soft-deletes an UNUSED category; anything with history must be archived instead. */
  remove(id: Uuid): Promise<void>;
  getUsage(id: Uuid): Promise<CategoryUsage>;
  /** Swaps sort order with the neighbouring sibling. */
  move(id: Uuid, direction: 'up' | 'down'): Promise<void>;
}

export interface CategoryRuleRepository {
  list(): Promise<CategoryRule[]>;
  /** Remembers "always use this category for this merchant" (payee equals rule). */
  upsertMerchantRule(merchantKey: string, categoryId: Uuid): Promise<CategoryRule>;
  remove(id: Uuid): Promise<void>;
}

export interface TagRepository {
  list(): Promise<Tag[]>;
}

export interface TransactionFilter {
  accountIds?: Uuid[];
  /** Matches the category, its subcategories, and split lines. */
  categoryIds?: Uuid[];
  types?: TransactionType[];
  from?: IsoDate;
  to?: IsoDate;
  /** Major-unit decimal strings ("12.50"), compared exactly per currency exponent. */
  minAmount?: string | null;
  maxAmount?: string | null;
  tagNames?: string[];
  search?: string;
  /** Extra category ids matching the search (e.g. by translated display name). */
  searchCategoryIds?: Uuid[];
  limit?: number;
  /** Keyset cursor: the last row of the previous page. */
  after?: { localDate: IsoDate; occurredAt: string; id: Uuid };
}

export interface TransactionListItem {
  id: Uuid;
  type: TransactionType;
  amountMinor: number;
  currency: CurrencyCode;
  payee: string | null;
  notes: string | null;
  localDate: IsoDate;
  occurredAt: string;
  timeZone: string;
  accountId: Uuid;
  accountName: string;
  categoryId: Uuid | null;
  categoryName: string | null;
  categorySystemKey: string | null;
  categoryIcon: string | null;
  categoryColor: string | null;
  isSplit: boolean;
  splitCount: number;
  transferId: Uuid | null;
  /** For transfer legs: the other account's name. */
  counterpartAccountName: string | null;
  refundOfTransactionId: Uuid | null;
  hasReceipt: boolean;
}

export interface TransactionSplitDetail extends TransactionSplit {
  categoryName: string | null;
  categorySystemKey: string | null;
}

export interface TransferLegSummary {
  transactionId: Uuid;
  accountId: Uuid;
  accountName: string;
  amountMinor: number;
  currency: CurrencyCode;
}

export interface TransactionDetail {
  transaction: Transaction;
  account: Pick<Account, 'id' | 'name' | 'type' | 'currency' | 'isArchived'>;
  category: Category | null;
  splits: TransactionSplitDetail[];
  tags: Tag[];
  attachments: Attachment[];
  /** For transfers: both legs and accounts. */
  transfer: { id: Uuid; from: TransferLegSummary; to: TransferLegSummary } | null;
  refundOf: Pick<Transaction, 'id' | 'payee' | 'amountMinor' | 'currency' | 'localDate'> | null;
}

/** Aggregates for Home, in each row's base-currency snapshot. */
export interface CashFlowRow {
  type: TransactionType;
  baseCurrency: CurrencyCode;
  totalMinor: number;
}

export interface CategorySpendRow {
  categoryId: Uuid | null;
  baseCurrency: CurrencyCode;
  /** Signed sum (expenses negative, refunds positive). */
  totalMinor: number;
}

export interface TransactionRepository {
  list(filter?: TransactionFilter): Promise<TransactionListItem[]>;
  getById(id: Uuid): Promise<TransactionDetail | null>;
  /** Expense / income / refund. Returns the new id. Works offline. */
  create(input: TransactionInput): Promise<Uuid>;
  update(id: Uuid, input: TransactionInput): Promise<void>;
  createTransfer(input: TransferInput): Promise<Uuid>;
  /** Edits both legs of a transfer together. */
  updateTransfer(transferId: Uuid, input: TransferInput): Promise<void>;
  /** Soft-deletes the transaction (or the whole transfer) with its splits, tags and receipts. */
  remove(id: Uuid): Promise<void>;
  /** Copies a transaction (or a complete transfer) to the given local date/time. Returns the new id. */
  duplicate(
    id: Uuid,
    at: { localDate: IsoDate; localTime: string; timeZone: string },
  ): Promise<Uuid>;
  cashFlow(from: IsoDate, to: IsoDate): Promise<CashFlowRow[]>;
  categorySpending(from: IsoDate, to: IsoDate): Promise<CategorySpendRow[]>;
  /** Most recent category used for this merchant with the given kind. */
  lastCategoryForMerchant(merchantKey: string, kind: CategoryKind): Promise<Uuid | null>;
  /** Most used categories of a kind since `since`. */
  frequentCategoryIds(kind: CategoryKind, since: IsoDate, limit: number): Promise<Uuid[]>;
  /** Recent expenses that a refund can be linked to. */
  refundCandidates(search: string, limit: number): Promise<TransactionListItem[]>;
}

export interface AttachmentRepository {
  /** Saves a receipt locally and queues the row for sync; the file uploads separately. */
  add(transactionId: Uuid, file: ReceiptFile): Promise<Attachment>;
  remove(id: Uuid): Promise<void>;
  pendingUploads(): Promise<(Attachment & { localUri: string })[]>;
  markUploaded(id: Uuid): Promise<void>;
  markUploadFailed(id: Uuid): Promise<void>;
}

// ---------------------------------------------------------------- planning

export interface BudgetListItem {
  budget: Budget;
  category: Category | null;
  evaluation: BudgetEvaluation;
  /** Currencies whose spending could not be converted (no known rate). */
  missingRates: CurrencyCode[];
  /** What converted amounts are based on (rates used, dates, sources, missing). */
  fx: ConversionNote;
}

export interface BudgetSpendingLine {
  transactionId: Uuid;
  type: 'expense' | 'refund';
  payee: string | null;
  localDate: IsoDate;
  accountName: string;
  categoryId: Uuid | null;
  categoryName: string | null;
  categorySystemKey: string | null;
  /** Signed contribution (split line or whole transaction) in `currency`. */
  amountMinor: number;
  currency: CurrencyCode;
  isSplitLine: boolean;
}

export interface BudgetRepository {
  list(options?: { includeArchived?: boolean }): Promise<Budget[]>;
  getById(id: Uuid): Promise<Budget | null>;
  revisions(budgetId: Uuid): Promise<BudgetRevision[]>;
  /** Budgets with their evaluated periods as of `today` (user's local date). */
  overviews(today: IsoDate, options?: { archived?: boolean }): Promise<BudgetListItem[]>;
  overview(id: Uuid, today: IsoDate): Promise<BudgetListItem | null>;
  /** Transactions and split lines counted by the budget within [from, to]. */
  spendingLines(id: Uuid, from: IsoDate, to: IsoDate): Promise<BudgetSpendingLine[]>;
  create(input: BudgetInput): Promise<Budget>;
  /** Amount/rollover changes apply from the current period; past periods keep theirs. */
  update(id: Uuid, input: BudgetInput, today: IsoDate): Promise<void>;
  setArchived(id: Uuid, archived: boolean): Promise<void>;
  /** Whether scope/period/currency can still change (no completed period yet). */
  hasHistory(id: Uuid, today: IsoDate): Promise<boolean>;
}

export interface BillListItem {
  bill: Bill;
  accountName: string | null;
  categoryName: string | null;
  categorySystemKey: string | null;
  categoryIcon: string | null;
  categoryColor: string | null;
}

export interface BillPaymentDetail extends BillPayment {
  /** The paying transaction as it is now (null for skipped/linked-but-missing). */
  transaction: {
    id: Uuid;
    amountMinor: number;
    currency: CurrencyCode;
    localDate: IsoDate;
    accountName: string;
  } | null;
}

export interface PaidBillItem {
  payment: BillPaymentDetail;
  billName: string;
  isSubscription: boolean;
}

export interface SubscriptionSummary {
  count: number;
  perCurrency: {
    currency: CurrencyCode;
    monthly: PeriodicCost;
    yearly: PeriodicCost;
  }[];
  /** All subscriptions in the base currency; null when a rate is missing. */
  base: { currency: CurrencyCode; monthly: PeriodicCost; yearly: PeriodicCost } | null;
  missingRates: CurrencyCode[];
  /** What converted amounts are based on (rates used, dates, sources, missing). */
  fx: ConversionNote;
}

export type BillKind = 'bill' | 'subscription';

export interface BillRepository {
  /** Active (or archived) bills sorted by next due date. */
  list(options: { kind?: BillKind; archived?: boolean }): Promise<BillListItem[]>;
  /** Active bills due on or before `through` (includes overdue). */
  upcoming(
    through: IsoDate,
    options?: { kind?: BillKind; limit?: number },
  ): Promise<BillListItem[]>;
  getById(id: Uuid): Promise<(BillListItem & { payments: BillPaymentDetail[] }) | null>;
  recentPayments(options: { kind?: BillKind; limit: number }): Promise<PaidBillItem[]>;
  create(input: BillInput): Promise<Bill>;
  update(id: Uuid, input: BillInput): Promise<void>;
  setArchived(id: Uuid, archived: boolean): Promise<void>;
  /** Records the payment as a normal expense transaction. Returns its id. */
  markPaid(billId: Uuid, input: BillPaymentInput): Promise<Uuid>;
  /** Marks a due date paid by an existing expense transaction. */
  linkPayment(billId: Uuid, input: BillLinkInput): Promise<void>;
  skip(billId: Uuid, dueDate: IsoDate): Promise<void>;
  /** Removes a payment/skip record; the due date becomes unpaid again. The transaction is kept. */
  undoPayment(paymentId: Uuid): Promise<void>;
  subscriptionSummary(today: IsoDate, baseCurrency: CurrencyCode): Promise<SubscriptionSummary>;
}

export interface GoalListItem {
  goal: SavingsGoal;
  progress: GoalProgress;
  /** Contributions in other currencies without a known rate (excluded from saved). */
  missingRates: CurrencyCode[];
  /** What converted amounts are based on (rates used, dates, sources, missing). */
  fx: ConversionNote;
}

export interface ContributionDetail extends GoalContribution {
  accountName: string | null;
  transfer: {
    id: Uuid;
    fromAccountName: string;
    toAccountName: string;
    amountMinor: number;
    currency: CurrencyCode;
    localDate: IsoDate;
  } | null;
}

export interface TransferCandidate {
  id: Uuid;
  localDate: IsoDate;
  fromAccountName: string;
  toAccountName: string;
  amountMinor: number;
  currency: CurrencyCode;
}

export type GoalFilter = 'active' | 'completed' | 'archived';

export interface GoalRepository {
  list(filter: GoalFilter, today: IsoDate): Promise<GoalListItem[]>;
  getById(
    id: Uuid,
    today: IsoDate,
  ): Promise<
    (GoalListItem & { accountName: string | null; contributions: ContributionDetail[] }) | null
  >;
  create(input: GoalInput): Promise<SavingsGoal>;
  update(id: Uuid, input: GoalInput): Promise<void>;
  setArchived(id: Uuid, archived: boolean): Promise<void>;
  addContribution(goalId: Uuid, input: ContributionInput): Promise<Uuid>;
  updateContribution(id: Uuid, input: ContributionInput): Promise<void>;
  /** Removes the contribution only; a linked transfer stays (money did move). */
  removeContribution(id: Uuid): Promise<void>;
  /** Recent transfers not yet linked to a contribution. */
  transferCandidates(limit: number): Promise<TransferCandidate[]>;
}

// ---------------------------------------------------------------- reports

export interface ReportLineQuery {
  range: DateRange;
  kind: 'income' | 'spending' | 'category' | 'merchant';
  /** kind 'category': the category (null = uncategorised). */
  categoryId?: string | null;
  /** kind 'category': also match its subcategories (top-level rows). */
  includeSubcategories?: boolean;
  /** kind 'merchant': normalised key (null = no merchant recorded). */
  merchantKey?: string | null;
  /** Report currency: each line also gets its value in it (same policy as the totals). */
  base?: CurrencyCode;
}

/** One entry (or split line) behind a report value, in its own currency. */
export interface ReportLine {
  transactionId: Uuid;
  type: 'income' | 'expense' | 'refund';
  payee: string | null;
  localDate: IsoDate;
  accountName: string;
  categoryId: Uuid | null;
  categoryName: string | null;
  categorySystemKey: string | null;
  /** Signed as stored (expenses < 0). */
  amountMinor: number;
  currency: CurrencyCode;
  isSplitLine: boolean;
  /** Value in the query's `base` (null = no rate; absent when no base was asked). */
  baseMinor?: number | null;
  /** How baseMinor was obtained (same policy as the report totals). */
  basis?: ConversionBasis;
}

export interface AccountBalanceHistoryInput {
  accountId: Uuid;
  name: string;
  type: Account['type'];
  currency: CurrencyCode;
  input: BalanceInput;
}

export interface ReportRepository {
  flows(range: DateRange, base: CurrencyCode): Promise<FlowRow[]>;
  categorySpending(range: DateRange, base: CurrencyCode): Promise<ReportCategoryRow[]>;
  merchantSpending(range: DateRange, base: CurrencyCode): Promise<MerchantSpendRow[]>;
  /** Display name per merchant key (the most recent spelling used). */
  merchantNames(keys: readonly string[]): Promise<Record<string, string>>;
  /** Earliest date with any recorded data (transaction or opening balance). */
  dataStart(): Promise<IsoDate | null>;
  balanceInputs(range: DateRange): Promise<AccountBalanceHistoryInput[]>;
  lines(query: ReportLineQuery): Promise<ReportLine[]>;
  /**
   * What income/spending totals for the range are based on in `base`
   * (snapshots, report conversions with rate dates and sources, missing).
   */
  conversionNote(range: DateRange, base: CurrencyCode): Promise<ConversionNote>;
}

// ------------------------------------------------------- import / export

export interface ImportProgress {
  done: number;
  total: number;
}

export interface ImportRunResult {
  batchId: Uuid;
  status: 'committed' | 'failed';
  /** Rows written by this run (completed chunks stay even when it failed). */
  imported: number;
  /** Rows skipped because their identity already existed. */
  skipped: number;
  error: unknown;
}

export interface ImportBatchSummary {
  id: Uuid;
  fileName: string;
  createdAt: string;
  rowCount: number;
  importedCount: number;
}

export interface ImportRepository {
  existingHashes(hashes: readonly string[]): Promise<Set<string>>;
  /** Counts of existing transactions per (account, date, signed amount, currency). */
  existingMatches(
    accountIds: readonly string[],
    from: IsoDate,
    to: IsoDate,
  ): Promise<Map<string, number>>;
  run(
    meta: {
      fileName: string;
      accountId: Uuid | null;
      rowCount: number;
      duplicateCount: number;
      errorCount: number;
      columnMapping: Record<string, unknown>;
    },
    rows: readonly { hash: string; input: TransactionInput }[],
    onProgress?: (p: ImportProgress) => void,
  ): Promise<ImportRunResult>;
  incompleteBatches(): Promise<ImportBatchSummary[]>;
  dismissBatch(id: Uuid): Promise<void>;
}

export interface ExportFilter {
  from: IsoDate | null;
  to: IsoDate | null;
  accountIds: readonly Uuid[];
  types: readonly TransactionType[];
}

export type ExportRepository = SqliteExportRepository;

export interface Repositories {
  accounts: AccountRepository;
  preferences: PreferencesRepository;
  exchangeRates: ExchangeRateRepository;
  categories: CategoryRepository;
  categoryRules: CategoryRuleRepository;
  tags: TagRepository;
  transactions: TransactionRepository;
  attachments: AttachmentRepository;
  budgets: BudgetRepository;
  bills: BillRepository;
  goals: GoalRepository;
  reports: ReportRepository;
  imports: ImportRepository;
  exports: ExportRepository;
}

export type LocalChangeListener = (table: string) => void;
