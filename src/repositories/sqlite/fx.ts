import type { CurrencyCode } from '@/domain/currency/currencies';
import { convert } from '@/domain/money/conversion';
import type { DecimalString } from '@/domain/money/decimal';
import { money } from '@/domain/money/money';
import type { SqlExecutor } from '@/database/types';

import { findRate } from './SqliteExchangeRateRepository';

/**
 * Converts amounts with KNOWN rates only (latest on or before the given
 * date, direct or inverse). Unknown rates return null and are recorded in
 * `missing` — nothing is ever guessed. Rates are cached per request.
 */
export class Converter {
  private readonly rates = new Map<string, DecimalString | null>();
  readonly missing = new Set<CurrencyCode>();

  constructor(private readonly db: SqlExecutor) {}

  async rate(from: CurrencyCode, to: CurrencyCode, onOrBefore: string) {
    const key = `${from}>${to}@${onOrBefore}`;
    if (!this.rates.has(key)) this.rates.set(key, await findRate(this.db, from, to, onOrBefore));
    return this.rates.get(key) ?? null;
  }

  async convert(
    amountMinor: number,
    from: CurrencyCode,
    to: CurrencyCode,
    onOrBefore: string,
  ): Promise<number | null> {
    if (from === to) return amountMinor;
    const rate = await this.rate(from, to, onOrBefore);
    if (!rate) {
      this.missing.add(from);
      return null;
    }
    return convert(money(amountMinor, from), rate, to).amountMinor;
  }

  missingList(): CurrencyCode[] {
    return [...this.missing].sort();
  }
}

/** A grouped transaction amount as stored, with its recorded base snapshot. */
export interface StoredAmount {
  local_date: string;
  currency: CurrencyCode;
  base_currency: CurrencyCode;
  base_fx_source: string;
  amount: number;
  base: number;
}

/**
 * An amount in `target`: the amount itself when already in that currency,
 * else the base snapshot recorded at entry when it is in `target`, else a
 * KNOWN rate on the entry date. Null (recorded in `converter.missing`) when
 * no rate is known.
 */
export function resolveInCurrency(
  converter: Converter,
  row: StoredAmount,
  target: CurrencyCode,
): Promise<number | null> | number {
  if (row.currency === target) return row.amount;
  if (row.base_currency === target && row.base_fx_source !== 'unconverted') return row.base;
  return converter.convert(row.amount, row.currency, target, row.local_date);
}
