import type { CurrencyCode } from '../currency/currencies';
import type { AccountType } from '../enums';
import { LIABILITY_ACCOUNT_TYPES } from '../enums';
import { convert } from '../money/conversion';
import type { DecimalString } from '../money/decimal';
import { add, type Money, money, zero } from '../money/money';

/**
 * Account rules shared by every feature. UI never re-implements these.
 *
 * Sign convention (same as transactions): balances are signed from the
 * account holder's point of view. Assets are normally ≥ 0; liabilities
 * (credit cards, loans) are normally ≤ 0 — a card with $850.50 owed has a
 * balance of -85 050 minor units.
 */

export function isLiability(type: AccountType): boolean {
  return LIABILITY_ACCOUNT_TYPES.includes(type);
}

/**
 * Users enter what they naturally think of: the balance for assets, the
 * amount OWED for liabilities. These convert between that entry and the
 * stored signed value. Entering a negative "owed" amount (credit balance on
 * a card) is supported and round-trips.
 */
export function openingBalanceFromEntry(type: AccountType, enteredMinor: number): number {
  const stored = isLiability(type) ? -enteredMinor : enteredMinor;
  return stored === 0 ? 0 : stored;
}

export function openingBalanceToEntry(type: AccountType, storedMinor: number): number {
  return openingBalanceFromEntry(type, storedMinor);
}

/** Remaining credit for a card: limit + (negative) balance. Null without a limit. */
export function availableCredit(creditLimitMinor: number | null, balance: Money): Money | null {
  if (creditLimitMinor === null) return null;
  return add(money(creditLimitMinor, balance.currency), balance);
}

/** Archived accounts keep their history but cannot receive new transactions until restored. */
export function canReceiveTransactions(account: { isArchived: boolean; deletedAt: string | null }) {
  return !account.isArchived && account.deletedAt === null;
}

export const ACCOUNT_GROUPS = ['cash_bank', 'credit', 'loans', 'other'] as const;
export type AccountGroup = (typeof ACCOUNT_GROUPS)[number];

export function accountGroup(type: AccountType): AccountGroup {
  switch (type) {
    case 'cash':
    case 'checking':
    case 'savings':
    case 'debit_card':
    case 'digital_wallet':
      return 'cash_bank';
    case 'credit_card':
      return 'credit';
    case 'loan':
      return 'loans';
    case 'other':
      return 'other';
  }
}

/** Sums balances per currency — never across currencies. Ordered by currency code. */
export function totalsByCurrency(balances: readonly Money[]): Money[] {
  const totals = new Map<CurrencyCode, Money>();
  for (const b of balances) {
    totals.set(b.currency, add(totals.get(b.currency) ?? zero(b.currency), b));
  }
  return [...totals.values()].sort((a, b) => a.currency.localeCompare(b.currency));
}

export interface OverviewAccount {
  id: string;
  type: AccountType;
  isArchived: boolean;
  includeInTotals: boolean;
}

export interface AccountsOverview<A extends OverviewAccount> {
  /** Active accounts grouped (empty groups omitted), in ACCOUNT_GROUPS order. */
  groups: { group: AccountGroup; items: { account: A; balance: Money }[] }[];
  archived: { account: A; balance: Money }[];
  /** Per-currency totals of active accounts included in totals. */
  totals: Money[];
  /**
   * Combined total in the base currency, or null when ANY included balance
   * lacks an exchange rate — a partial sum would be misleading.
   */
  combinedTotal: Money | null;
  missingRates: CurrencyCode[];
  activeCount: number;
}

/**
 * Builds the accounts overview: grouping, per-currency totals and (when every
 * rate is known) a converted total. Rates are never guessed.
 */
export function buildAccountsOverview<A extends OverviewAccount>(
  accounts: readonly A[],
  balances: ReadonlyMap<string, Money>,
  baseCurrency: CurrencyCode,
  getRate: (currency: CurrencyCode) => DecimalString | null,
): AccountsOverview<A> {
  const groups = new Map<AccountGroup, { account: A; balance: Money }[]>();
  const archived: { account: A; balance: Money }[] = [];
  const included: Money[] = [];

  for (const account of accounts) {
    const balance = balances.get(account.id);
    if (!balance) continue;
    if (account.isArchived) {
      archived.push({ account, balance });
      continue;
    }
    const group = accountGroup(account.type);
    groups.set(group, [...(groups.get(group) ?? []), { account, balance }]);
    if (account.includeInTotals) included.push(balance);
  }

  const totals = totalsByCurrency(included);
  const missing = new Set<CurrencyCode>();
  let combined = zero(baseCurrency);
  for (const total of totals) {
    if (total.currency === baseCurrency) {
      combined = add(combined, total);
      continue;
    }
    const rate = getRate(total.currency);
    if (rate === null) missing.add(total.currency);
    else combined = add(combined, convert(total, rate, baseCurrency));
  }

  return {
    groups: ACCOUNT_GROUPS.filter((g) => groups.has(g)).map((group) => ({
      group,
      items: groups.get(group) ?? [],
    })),
    archived,
    totals,
    combinedTotal: missing.size === 0 ? combined : null,
    missingRates: [...missing].sort(),
    activeCount: accounts.filter((a) => !a.isArchived).length,
  };
}
