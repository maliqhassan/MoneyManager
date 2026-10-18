import type { CurrencyCode } from '@/domain/currency/currencies';
import {
  chooseRoute,
  earliestAcceptable,
  FX_POLICY,
  type RateKind,
  type RateMode,
  type ResolvedRate,
  type Route,
  type StoredRate,
} from '@/domain/fx/policy';
import type { SqlExecutor } from '@/database/types';

const NO_LIMIT = '0000-01-01';

/**
 * Best stored row for base→quote dated on or before `date` within the
 * mode's lookback for each kind: latest date first, manual before provider
 * on the same date.
 */
async function bestRow(
  db: SqlExecutor,
  base: CurrencyCode,
  quote: CurrencyCode,
  date: string,
  mode: RateMode,
): Promise<StoredRate | null> {
  const bound = (kind: RateKind) => earliestAcceptable(date, kind, mode) ?? NO_LIMIT;
  const row = await db.getFirst<{
    rate: string;
    rate_date: string;
    source: string;
    kind: RateKind;
  }>(
    `SELECT rate, rate_date, source, kind FROM exchange_rates
     WHERE base_currency = ? AND quote_currency = ? AND rate_date <= ?
       AND ((kind = 'provider' AND rate_date >= ?) OR (kind = 'manual' AND rate_date >= ?))
     ORDER BY rate_date DESC, CASE kind WHEN 'manual' THEN 0 ELSE 1 END, fetched_at DESC
     LIMIT 1`,
    [base, quote, date, bound('provider'), bound('manual')],
  );
  return row
    ? {
        base,
        quote,
        rate: row.rate,
        rateDate: row.rate_date,
        source: row.source,
        kind: row.kind,
      }
    : null;
}

/** Both orientations of a pair as route legs giving a→b. */
async function legs(
  db: SqlExecutor,
  a: CurrencyCode,
  b: CurrencyCode,
  date: string,
  mode: RateMode,
): Promise<{ row: StoredRate; inverted: boolean }[]> {
  // Sequential: this may run inside a write transaction on one connection.
  const direct = await bestRow(db, a, b, date, mode);
  const inverse = await bestRow(db, b, a, date, mode);
  const out: { row: StoredRate; inverted: boolean }[] = [];
  if (direct) out.push({ row: direct, inverted: false });
  if (inverse) out.push({ row: inverse, inverted: true });
  return out;
}

/**
 * The rate to convert 1 `from` into `to` for `date` (YYYY-MM-DD), or null
 * when no acceptable rate is stored — never a guess.
 *
 * - `historical`: for an entry on `date` (bounded lookback);
 * - `current`: today's value; `date` must be today; any cached age, flagged
 *   `stale` past the threshold.
 *
 * Routes: direct, inverse, and cross via the USD pivot. Usable inside a
 * write transaction.
 */
export async function resolveRate(
  db: SqlExecutor,
  from: CurrencyCode,
  to: CurrencyCode,
  date: string,
  mode: RateMode,
): Promise<ResolvedRate | null> {
  if (from === to) {
    return {
      from,
      to,
      rate: '1',
      rateDate: date,
      source: 'identity',
      kind: 'provider',
      derivation: 'direct',
      stale: false,
    };
  }
  const routes: Route[] = [];
  for (const leg of await legs(db, from, to, date, mode)) {
    routes.push({ derivation: leg.inverted ? 'inverse' : 'direct', legs: [leg] });
  }
  const pivot = FX_POLICY.pivot;
  if (from !== pivot && to !== pivot) {
    const first = await legs(db, from, pivot, date, mode);
    const second = first.length > 0 ? await legs(db, pivot, to, date, mode) : [];
    for (const a of first) {
      for (const b of second) routes.push({ derivation: 'cross', legs: [a, b] });
    }
  }
  return chooseRoute(from, to, routes, mode, date);
}
