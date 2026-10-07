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
}

export interface PreferencesRepository {
  get(): Promise<UserPreferences | null>;
  update(
    patch: Partial<
      Pick<
        UserPreferences,
        'baseCurrency' | 'locale' | 'timeZone' | 'firstDayOfWeek' | 'monthStartDay'
      >
    >,
  ): Promise<UserPreferences>;
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
}

export type LocalChangeListener = (table: string) => void;
