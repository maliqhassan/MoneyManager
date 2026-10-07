import type { CurrencyCode } from '@/domain/currency/currencies';
import { invertRate } from '@/domain/money/conversion';
import type { DecimalString } from '@/domain/money/decimal';
import type { SqlDatabase } from '@/database/types';

import type { ExchangeRateRepository } from '../types';

/**
 * Reads the local exchange-rate cache (reference data pulled from Supabase's
 * exchange_rates table; populated by the multi-currency phase). Read-only:
 * the client never invents or writes rates.
 */
export class SqliteExchangeRateRepository implements ExchangeRateRepository {
  constructor(private readonly db: SqlDatabase) {}

  async findRate(
    from: CurrencyCode,
    to: CurrencyCode,
    onOrBefore: string,
  ): Promise<DecimalString | null> {
    if (from === to) return '1';
    const direct = await this.latest(from, to, onOrBefore);
    if (direct) return direct;
    const inverse = await this.latest(to, from, onOrBefore);
    return inverse ? invertRate(inverse) : null;
  }

  private async latest(
    base: CurrencyCode,
    quote: CurrencyCode,
    onOrBefore: string,
  ): Promise<DecimalString | null> {
    const row = await this.db.getFirst<{ rate: string }>(
      `SELECT rate FROM exchange_rates
       WHERE base_currency = ? AND quote_currency = ? AND rate_date <= ?
       ORDER BY rate_date DESC, created_at DESC
       LIMIT 1`,
      [base, quote, onOrBefore],
    );
    return row?.rate ?? null;
  }
}
