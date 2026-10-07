import type { CurrencyCode } from '@/domain/currency/currencies';
import type { CategoryKind, TransactionType } from '@/domain/enums';
import type { Money } from '@/domain/money/money';
import type {
  Account,
  Attachment,
  Budget,
  BudgetAllocation,
  Category,
  CategoryRule,
  IsoDate,
  Tag,
  Transaction,
  TransactionSplit,
  UserPreferences,
  Uuid,
} from '@/domain/models';
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

export interface ExchangeRateRepository {
  /**
   * Latest known rate converting 1 unit of `from` into `to` on or before
   * `onOrBefore` (YYYY-MM-DD). Uses the inverse quote when only that is
   * stored. Null when unknown — callers must never guess.
   */
  findRate(
    from: CurrencyCode,
    to: CurrencyCode,
    onOrBefore: IsoDate,
  ): Promise<DecimalString | null>;
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

export interface BudgetRepository {
  list(options?: { includeArchived?: boolean }): Promise<Budget[]>;
  getById(id: Uuid): Promise<(Budget & { allocations: BudgetAllocation[] }) | null>;
}

export interface Repositories {
  accounts: AccountRepository;
  preferences: PreferencesRepository;
  exchangeRates: ExchangeRateRepository;
  categories: CategoryRepository;
  categoryRules: CategoryRuleRepository;
  tags: TagRepository;
  transactions: TransactionRepository;
  attachments: AttachmentRepository;
}

export type LocalChangeListener = (table: string) => void;
