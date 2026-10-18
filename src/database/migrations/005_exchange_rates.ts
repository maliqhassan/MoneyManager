import type { Migration } from './index';

/**
 * Local schema v5 — Phase 6 (exchange rates). LOCAL ONLY: `exchange_rates`
 * is a device cache (not synced) and `fx_fetch_log` is bookkeeping like
 * `sync_outbox`, so there is no Supabase counterpart. Additive; existing
 * rows are kept and backfilled.
 *
 * - exchange_rates.kind: 'provider' (downloaded) or 'manual' (entered by the
 *   user). Rows that existed before (none are written by released versions)
 *   become 'provider' unless their source is 'manual'.
 * - exchange_rates.fetched_at: when the rate was retrieved (entered, for
 *   manual rates); backfilled from created_at.
 * - exchange_rates.attribution: provider attribution shown with the rate.
 * - fx_fetch_log: last attempt / success / error per refresh scope and the
 *   server's Retry-After, so refreshes are throttled across app restarts;
 *   per-currency scopes ("frankfurter:EUR") record the date range already
 *   requested (covered_from/covered_to), so dates the provider has no data
 *   for are not requested again.
 */
export const migration005ExchangeRates: Migration = {
  version: 5,
  name: 'exchange_rates',
  statements: [
    `ALTER TABLE exchange_rates ADD COLUMN kind TEXT NOT NULL DEFAULT 'provider' CHECK (kind IN ('provider', 'manual'))`,
    `ALTER TABLE exchange_rates ADD COLUMN fetched_at TEXT`,
    `ALTER TABLE exchange_rates ADD COLUMN attribution TEXT`,
    `UPDATE exchange_rates SET kind = 'manual' WHERE source = 'manual'`,
    `UPDATE exchange_rates SET fetched_at = created_at WHERE fetched_at IS NULL`,
    `CREATE INDEX idx_exchange_rates_kind_date ON exchange_rates(kind, quote_currency, rate_date)`,
    `CREATE TABLE fx_fetch_log (
  scope TEXT PRIMARY KEY NOT NULL,
  last_attempt_at TEXT,
  last_success_at TEXT,
  last_error TEXT,
  retry_after TEXT,
  covered_from TEXT,
  covered_to TEXT
)`,
  ],
};
