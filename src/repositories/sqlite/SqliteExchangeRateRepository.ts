import type { CurrencyCode } from '@/domain/currency/currencies';
import type { ProviderRate } from '@/domain/fx/frankfurter';
import type { RateMode, ResolvedRate } from '@/domain/fx/policy';
import { validateRate } from '@/domain/fx/rateMath';
import type { DecimalString } from '@/domain/money/decimal';
import type { SqlDatabase, SqlExecutor } from '@/database/types';
import { AppError } from '@/lib/errors';
import { type ManualRateInput, manualRateSchema } from '@/validation/exchangeRates';

import type {
  CurrentRateRow,
  ExchangeRateRepository,
  FxFetchLog,
  ManualRate,
  RateCoverage,
} from '../types';
import { resolveRate } from './rateResolver';
import { type RepositoryContext, validate } from './shared';

export const MANUAL_SOURCE = 'manual';

/**
 * Rate for an entry on `onOrBefore` (historical policy): direct, inverse or
 * cross via USD. Null when unknown — never guessed. Usable inside a write
 * transaction.
 */
export async function findRate(
  db: SqlExecutor,
  from: CurrencyCode,
  to: CurrencyCode,
  onOrBefore: string,
): Promise<DecimalString | null> {
  return (await resolveRate(db, from, to, onOrBefore, 'historical'))?.rate ?? null;
}

interface ManualRow {
  id: string;
  base_currency: CurrencyCode;
  quote_currency: CurrencyCode;
  rate: string;
  rate_date: string;
  fetched_at: string | null;
  created_at: string;
}

const toManual = (r: ManualRow): ManualRate => ({
  id: r.id,
  base: r.base_currency,
  quote: r.quote_currency,
  rate: r.rate,
  rateDate: r.rate_date,
  enteredAt: r.fetched_at ?? r.created_at,
});

/**
 * The device's exchange-rate cache (see docs/exchange-rates.md): provider
 * rows downloaded by services/fx and the user's manual rates. Local only —
 * not synced, and contains no personal financial data.
 */
export class SqliteExchangeRateRepository implements ExchangeRateRepository {
  constructor(
    private readonly db: SqlDatabase,
    private readonly ctx: RepositoryContext,
  ) {}

  findRate(from: CurrencyCode, to: CurrencyCode, onOrBefore: string) {
    return findRate(this.db, from, to, onOrBefore);
  }

  resolve(
    from: CurrencyCode,
    to: CurrencyCode,
    date: string,
    mode: RateMode,
  ): Promise<ResolvedRate | null> {
    return resolveRate(this.db, from, to, date, mode);
  }

  async storeProviderRates(
    rows: readonly ProviderRate[],
    meta: { source: string; attribution: string; fetchedAt: string },
  ): Promise<number> {
    if (meta.source === MANUAL_SOURCE) throw new Error('Provider source cannot be "manual"');
    let written = 0;
    await this.db.transaction(async (tx) => {
      for (const r of rows) {
        // Re-validate at the storage boundary.
        const rate = validateRate(r.rate);
        if (r.base === r.quote) continue;
        const result = await tx.run(
          `INSERT INTO exchange_rates
             (id, base_currency, quote_currency, rate, rate_date, source, created_at,
              kind, fetched_at, attribution)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'provider', ?, ?)
           ON CONFLICT (base_currency, quote_currency, rate_date, source) DO UPDATE SET
             rate = excluded.rate, fetched_at = excluded.fetched_at,
             attribution = excluded.attribution
           WHERE exchange_rates.kind = 'provider' AND exchange_rates.rate <> excluded.rate`,
          [
            this.ctx.newId(),
            r.base,
            r.quote,
            rate,
            r.rateDate,
            meta.source,
            meta.fetchedAt,
            meta.fetchedAt,
            meta.attribution,
          ],
        );
        written += result.changes;
      }
    });
    if (written > 0) this.ctx.onChange('exchange_rates');
    return written;
  }

  async findManualRate(base: CurrencyCode, quote: CurrencyCode, rateDate: string) {
    const row = await this.db.getFirst<ManualRow>(
      `SELECT id, base_currency, quote_currency, rate, rate_date, fetched_at, created_at
       FROM exchange_rates
       WHERE kind = 'manual' AND base_currency = ? AND quote_currency = ? AND rate_date = ?`,
      [base, quote, rateDate],
    );
    return row ? toManual(row) : null;
  }

  async saveManualRate(
    input: ManualRateInput,
    options: { today: string; replace: boolean },
  ): Promise<ManualRate> {
    const v = validate(manualRateSchema(options.today), input);
    const existing = await this.findManualRate(v.base, v.quote, v.rateDate);
    if (existing && !options.replace) {
      throw new AppError('conflict', 'A manual rate already exists for this date', {
        fieldErrors: { rateDate: 'exchangeRates.manual.exists' },
      });
    }
    const now = this.ctx.now();
    const id = existing?.id ?? this.ctx.newId();
    await this.db.transaction(async (tx) => {
      if (existing) {
        await tx.run(`UPDATE exchange_rates SET rate = ?, fetched_at = ? WHERE id = ?`, [
          v.rate,
          now,
          existing.id,
        ]);
      } else {
        await tx.run(
          `INSERT INTO exchange_rates
             (id, base_currency, quote_currency, rate, rate_date, source, created_at,
              kind, fetched_at, attribution)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'manual', ?, NULL)`,
          [id, v.base, v.quote, v.rate, v.rateDate, MANUAL_SOURCE, now, now],
        );
      }
    });
    this.ctx.onChange('exchange_rates');
    return { id, base: v.base, quote: v.quote, rate: v.rate, rateDate: v.rateDate, enteredAt: now };
  }

  async listManualRates(): Promise<ManualRate[]> {
    const rows = await this.db.getAll<ManualRow>(
      `SELECT id, base_currency, quote_currency, rate, rate_date, fetched_at, created_at
       FROM exchange_rates WHERE kind = 'manual'
       ORDER BY rate_date DESC, base_currency, quote_currency`,
    );
    return rows.map(toManual);
  }

  async deleteManualRate(id: string): Promise<void> {
    // Only manual rows can be deleted; provider rows are reference data.
    await this.db.run(`DELETE FROM exchange_rates WHERE id = ? AND kind = 'manual'`, [id]);
    this.ctx.onChange('exchange_rates');
  }

  async currenciesInUse(): Promise<CurrencyCode[]> {
    const u = this.ctx.userId;
    const rows = await this.db.getAll<{ c: CurrencyCode }>(
      `SELECT currency AS c FROM accounts WHERE user_id = ? AND deleted_at IS NULL
       UNION SELECT DISTINCT currency FROM transactions WHERE user_id = ? AND deleted_at IS NULL
       UNION SELECT DISTINCT base_currency FROM transactions WHERE user_id = ? AND deleted_at IS NULL
       UNION SELECT currency FROM budgets WHERE user_id = ? AND deleted_at IS NULL
       UNION SELECT currency FROM bills WHERE user_id = ? AND deleted_at IS NULL
       UNION SELECT currency FROM savings_goals WHERE user_id = ? AND deleted_at IS NULL
       UNION SELECT currency FROM goal_contributions
             WHERE user_id = ? AND deleted_at IS NULL AND currency IS NOT NULL
       UNION SELECT base_currency FROM user_preferences WHERE user_id = ? AND deleted_at IS NULL`,
      [u, u, u, u, u, u, u, u],
    );
    return rows.map((r) => r.c).sort();
  }

  async earliestConversionDate(base: CurrencyCode): Promise<string | null> {
    const u = this.ctx.userId;
    // Entries in another currency, or any entry when a budget/goal/bill is
    // kept in another currency (its totals convert the base-currency entries).
    const row = await this.db.getFirst<{ d: string | null }>(
      `SELECT MIN(d) AS d FROM (
         SELECT MIN(local_date) AS d FROM transactions
          WHERE user_id = ? AND deleted_at IS NULL AND currency <> ?
         UNION ALL
         SELECT MIN(contributed_on) FROM goal_contributions
          WHERE user_id = ? AND deleted_at IS NULL AND currency IS NOT NULL AND currency <> ?
         UNION ALL
         SELECT MIN(t.local_date) FROM transactions t
          WHERE t.user_id = ? AND t.deleted_at IS NULL AND EXISTS (
            SELECT 1 FROM budgets b WHERE b.user_id = ? AND b.deleted_at IS NULL AND b.currency <> ?
            UNION ALL
            SELECT 1 FROM savings_goals g
             WHERE g.user_id = ? AND g.deleted_at IS NULL AND g.currency <> ?)
       )`,
      [u, base, u, base, u, u, base, u, base],
    );
    return row?.d ?? null;
  }

  /**
   * Provider coverage per currency: the cached range of rates, widened by
   * the range already requested (dates the provider had no data for).
   */
  async coverage(currencies: readonly CurrencyCode[], source: string): Promise<RateCoverage[]> {
    if (currencies.length === 0) return [];
    const cached = await this.cachedCoverage(currencies, source);
    const requested = await this.db.getAll<{ scope: string; f: string; t: string }>(
      `SELECT scope, covered_from AS f, covered_to AS t FROM fx_fetch_log
       WHERE covered_from IS NOT NULL AND covered_to IS NOT NULL
         AND scope IN (${currencies.map(() => '?').join(', ')})`,
      currencies.map((c) => `${source}:${c}`),
    );
    const byCurrency = new Map(cached.map((c) => [c.currency, c]));
    for (const r of requested) {
      const currency = r.scope.slice(source.length + 1) as CurrencyCode;
      const c = byCurrency.get(currency);
      if (!c) {
        byCurrency.set(currency, { currency, firstDate: r.f, lastDate: r.t, lastFetchedAt: null });
        continue;
      }
      if (r.f < c.firstDate) c.firstDate = r.f;
      if (r.t > c.lastDate) c.lastDate = r.t;
    }
    return [...byCurrency.values()].sort((a, b) => a.currency.localeCompare(b.currency));
  }

  /** Records that [from, to] was requested successfully for these currencies. */
  async recordCoverage(
    source: string,
    currencies: readonly CurrencyCode[],
    from: string,
    to: string,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      for (const c of currencies) {
        await tx.run(
          `INSERT INTO fx_fetch_log (scope, covered_from, covered_to) VALUES (?, ?, ?)
           ON CONFLICT (scope) DO UPDATE SET
             covered_from = MIN(COALESCE(covered_from, excluded.covered_from), excluded.covered_from),
             covered_to = MAX(COALESCE(covered_to, excluded.covered_to), excluded.covered_to)`,
          [`${source}:${c}`, from, to],
        );
      }
    });
  }

  private async cachedCoverage(
    currencies: readonly CurrencyCode[],
    source: string,
  ): Promise<RateCoverage[]> {
    const rows = await this.db.getAll<{
      quote_currency: CurrencyCode;
      first: string;
      last: string;
      fetched: string | null;
    }>(
      `SELECT quote_currency, MIN(rate_date) AS first, MAX(rate_date) AS last,
              MAX(fetched_at) AS fetched
       FROM exchange_rates
       WHERE kind = 'provider' AND source = ? AND base_currency = 'USD'
         AND quote_currency IN (${currencies.map(() => '?').join(', ')})
       GROUP BY quote_currency`,
      [source, ...currencies],
    );
    return rows.map((r) => ({
      currency: r.quote_currency,
      firstDate: r.first,
      lastDate: r.last,
      lastFetchedAt: r.fetched,
    }));
  }

  async currentRates(
    currencies: readonly CurrencyCode[],
    base: CurrencyCode,
    today: string,
  ): Promise<CurrentRateRow[]> {
    const out: CurrentRateRow[] = [];
    for (const currency of currencies) {
      if (currency === base) continue;
      const rate = await resolveRate(this.db, currency, base, today, 'current');
      // When the rows behind this rate were retrieved (or entered).
      const sources = rate ? rate.source.split('+') : [];
      const fetched = rate
        ? await this.db.getFirst<{ f: string | null }>(
            `SELECT MAX(fetched_at) AS f FROM exchange_rates
             WHERE rate_date = ? AND source IN (${sources.map(() => '?').join(', ')})`,
            [rate.rateDate, ...sources],
          )
        : null;
      out.push({ currency, rate, fetchedAt: fetched?.f ?? null });
    }
    return out;
  }

  async fetchLog(scope: string): Promise<FxFetchLog> {
    const row = await this.db.getFirst<{
      last_attempt_at: string | null;
      last_success_at: string | null;
      last_error: string | null;
      retry_after: string | null;
    }>(`SELECT * FROM fx_fetch_log WHERE scope = ?`, [scope]);
    return {
      lastAttemptAt: row?.last_attempt_at ?? null,
      lastSuccessAt: row?.last_success_at ?? null,
      lastError: row?.last_error ?? null,
      retryAfter: row?.retry_after ?? null,
    };
  }

  async recordFetch(scope: string, patch: Partial<FxFetchLog>): Promise<void> {
    const current = await this.fetchLog(scope);
    const next = { ...current, ...patch };
    await this.db.run(
      `INSERT INTO fx_fetch_log (scope, last_attempt_at, last_success_at, last_error, retry_after)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (scope) DO UPDATE SET
         last_attempt_at = excluded.last_attempt_at, last_success_at = excluded.last_success_at,
         last_error = excluded.last_error, retry_after = excluded.retry_after`,
      [scope, next.lastAttemptAt, next.lastSuccessAt, next.lastError, next.retryAfter],
    );
  }
}
