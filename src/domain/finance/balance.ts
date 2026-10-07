import type { CurrencyCode } from '../currency/currencies';
import { convert } from '../money/conversion';
import type { DecimalString } from '../money/decimal';
import { add, type Money, money, zero } from '../money/money';

/** The minimal shape of a posting needed to compute a balance. */
export interface BalancePosting {
  amountMinor: number;
  currency: CurrencyCode;
  deletedAt: string | null;
}

export interface BalanceAccount {
  currency: CurrencyCode;
  openingBalanceMinor: number;
}

/**
 * Account balance = opening balance + sum of signed postings (in the account
 * currency). Deleted postings are ignored. A posting in another currency is a
 * data-integrity error and throws rather than being silently skipped.
 */
export function computeAccountBalance(
  account: BalanceAccount,
  postings: readonly BalancePosting[],
): Money {
  return postings.reduce<Money>(
    (balance, posting) =>
      posting.deletedAt ? balance : add(balance, money(posting.amountMinor, posting.currency)),
    money(account.openingBalanceMinor, account.currency),
  );
}

export interface TotalInBaseResult {
  total: Money;
  /** Currencies with no available rate; their balances are NOT in `total`. */
  missingRates: CurrencyCode[];
}

/**
 * Totals balances in different currencies into the base currency.
 * `getRate(currency)` returns the currency → base rate, or null if unknown.
 * Missing rates are reported, never guessed.
 */
export function totalInBaseCurrency(
  balances: readonly Money[],
  baseCurrency: CurrencyCode,
  getRate: (currency: CurrencyCode) => DecimalString | null,
): TotalInBaseResult {
  const missing = new Set<CurrencyCode>();
  let total = zero(baseCurrency);
  for (const balance of balances) {
    if (balance.currency === baseCurrency) {
      total = add(total, balance);
      continue;
    }
    const rate = getRate(balance.currency);
    if (rate === null) {
      missing.add(balance.currency);
      continue;
    }
    total = add(total, convert(balance, rate, baseCurrency));
  }
  return { total, missingRates: [...missing].sort() };
}
