import type { CurrencyCode } from '@/domain/currency/currencies';
import { invertRate } from '@/domain/money/conversion';
import type { DecimalString } from '@/domain/money/decimal';
import type { SqlDatabase, SqlExecutor } from '@/database/types';

import type { ExchangeRateRepository } from '../types';

async function latest(
  db: SqlExecutor,
  base: CurrencyCode,
  quote: CurrencyCode,
  onOrBefore: string,
): Promise<DecimalString | null> {
  const row = await db.getFirst<{ rate: string }>(
    `SELECT rate FROM exchange_rates
     WHERE base_currency = ? AND quote_currency = ? AND rate_date <= ?
     ORDER BY rate_date DESC, created_at DESC
     LIMIT 1`,
    [base, quote, onOrBefore],
  );
  return row?.rate ?? null;
}

/**
 * Latest known rate (1 `from` = rate `to`) on or before a date, using the
 * inverse quote when only that is stored. Null when unknown — never guessed.
 * Usable inside a write transaction.
 */
export async function findRate(
  db: SqlExecutor,
  from: CurrencyCode,
  to: CurrencyCode,
  onOrBefore: string,
): Promise<DecimalString | null> {
  if (from === to) return '1';
  const direct = await latest(db, from, to, onOrBefore);
  if (direct) return direct;
  const inverse = await latest(db, to, from, onOrBefore);
  return inverse ? invertRate(inverse) : null;
}

/**
 * Reads the local exchange-rate cache (reference data pulled from Supabase's
 * exchange_rates table; populated by the multi-currency phase). Read-only:
 * the client never invents or writes rates.
 */
export class SqliteExchangeRateRepository implements ExchangeRateRepository {
  constructor(private readonly db: SqlDatabase) {}

  findRate(
    from: CurrencyCode,
    to: CurrencyCode,
    onOrBefore: string,
  ): Promise<DecimalString | null> {
    return findRate(this.db, from, to, onOrBefore);
  }
}
