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
