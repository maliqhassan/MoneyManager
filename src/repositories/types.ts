import type { CurrencyCode } from '@/domain/currency/currencies';
import type { CategoryKind, TransactionType } from '@/domain/enums';
import type { Money } from '@/domain/money/money';
import type {
  Account,
  Budget,
  BudgetAllocation,
  Category,
  IsoDate,
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

export interface CategoryRepository {
  list(options?: { kind?: CategoryKind; includeArchived?: boolean }): Promise<Category[]>;
  getById(id: Uuid): Promise<Category | null>;
  create(input: CategoryInput): Promise<Category>;
  update(id: Uuid, patch: CategoryUpdate): Promise<Category>;
  setArchived(id: Uuid, archived: boolean): Promise<Category>;
}

export interface TransactionFilter {
  accountIds?: Uuid[];
  categoryIds?: Uuid[];
  types?: TransactionType[];
  from?: IsoDate;
  to?: IsoDate;
  search?: string;
  currency?: CurrencyCode;
  limit?: number;
  /** Keyset pagination cursor: (localDate, occurredAt, id) of the last row seen. */
  after?: { localDate: IsoDate; occurredAt: string; id: Uuid };
}

export interface TransactionWithSplits extends Transaction {
  splits: TransactionSplit[];
}

export interface TransactionRepository {
  list(filter?: TransactionFilter): Promise<Transaction[]>;
  getById(id: Uuid): Promise<TransactionWithSplits | null>;
  // Writes are defined with the transactions feature (expense/income/refund
  // creation, transfers as paired legs, splits, duplicate, delete).
}

export interface BudgetRepository {
  list(options?: { includeArchived?: boolean }): Promise<Budget[]>;
  getById(id: Uuid): Promise<(Budget & { allocations: BudgetAllocation[] }) | null>;
}

export interface Repositories {
  accounts: AccountRepository;
  preferences: PreferencesRepository;
  exchangeRates: ExchangeRateRepository;
}

export type LocalChangeListener = (table: string) => void;
