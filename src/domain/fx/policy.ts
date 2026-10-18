import type { CurrencyCode } from '../currency/currencies';
import { addDays, compareDates } from '../dates/calendar';
import type { DecimalString } from '../money/decimal';

import { deriveRate, type RateLeg } from './rateMath';

/**
 * Exchange-rate policy: which stored rates may be used for which purpose.
 * See docs/exchange-rates.md. All values are in calendar days unless noted.
 */
export const FX_POLICY = {
  /** Every provider rate is stored against this currency (keeps precision). */
  pivot: 'USD' as CurrencyCode,
  /** Historical use (entry dates): how much older than the date a rate may be. */
  historicalLookbackDays: { provider: 7, manual: 31 },
  /** Current use (today's value): older than this is shown as stale. */
  staleAfterDays: { provider: 3, manual: 31 },
  /** Automatic refresh at most this often (hours). */
  refreshEveryHours: 12,
  /** After a failed refresh, automatic retries wait at least this long (minutes). */
  retryAfterFailureMinutes: 15,
  /** Network timeout per provider request (ms). */
  requestTimeoutMs: 15_000,
  /** Forward fill reaches back at most this far when the cache is old. */
  forwardFillMaxDays: 31,
  /** The last days are requested again on each refresh (late publications). */
  revisitDays: 2,
  /** Backfill request size and per-refresh budget (days). */
  backfillChunkDays: 366,
  backfillMaxDaysPerRefresh: 3 * 366,
} as const;

export type RateKind = 'provider' | 'manual';
export type RateMode = 'historical' | 'current';
export type RateDerivation = 'direct' | 'inverse' | 'cross';

/** A stored rate row as the resolver sees it. */
export interface StoredRate {
  base: CurrencyCode;
  quote: CurrencyCode;
  rate: DecimalString;
  rateDate: string;
  source: string;
  kind: RateKind;
}

/** A rate ready to convert `from` → `to`, with where it came from. */
export interface ResolvedRate {
  from: CurrencyCode;
  to: CurrencyCode;
  rate: DecimalString;
  /** Effective date (the older leg for a cross rate). */
  rateDate: string;
  /** Provider id(s) or "manual"; joined with "+" for mixed cross rates. */
  source: string;
  kind: RateKind;
  derivation: RateDerivation;
  /** Current mode only: older than the stale threshold. */
  stale: boolean;
}

/** Oldest rate date acceptable for `date` in this mode (null = no limit). */
export function earliestAcceptable(date: string, kind: RateKind, mode: RateMode): string | null {
  return mode === 'historical' ? addDays(date, -FX_POLICY.historicalLookbackDays[kind]) : null;
}

export function isStale(rateDate: string, today: string, kind: RateKind): boolean {
  return compareDates(rateDate, addDays(today, -FX_POLICY.staleAfterDays[kind])) < 0;
}

/** A candidate route: one or two stored rows with their orientation. */
export interface Route {
  derivation: RateDerivation;
  legs: readonly { row: StoredRate; inverted: boolean }[];
}

const DERIVATION_ORDER: Record<RateDerivation, number> = { direct: 0, inverse: 1, cross: 2 };

function routeDate(route: Route): string {
  return route.legs.reduce(
    (oldest, l) => (compareDates(l.row.rateDate, oldest) < 0 ? l.row.rateDate : oldest),
    route.legs[0]!.row.rateDate,
  );
}

function routeKind(route: Route): RateKind {
  return route.legs.some((l) => l.row.kind === 'manual') ? 'manual' : 'provider';
}

/**
 * Picks the best route: latest effective date; on the same date a manual
 * rate (entered deliberately by the user) beats a provider rate; then
 * direct > inverse > cross. Returns the derived rate, or null.
 */
export function chooseRoute(
  from: CurrencyCode,
  to: CurrencyCode,
  routes: readonly Route[],
  mode: RateMode,
  today: string,
): ResolvedRate | null {
  let best: { route: Route; date: string; kind: RateKind } | null = null;
  for (const route of routes) {
    const date = routeDate(route);
    const kind = routeKind(route);
    if (!best) {
      best = { route, date, kind };
      continue;
    }
    const byDate = compareDates(date, best.date);
    const better =
      byDate > 0 ||
      (byDate === 0 && kind === 'manual' && best.kind === 'provider') ||
      (byDate === 0 &&
        kind === best.kind &&
        DERIVATION_ORDER[route.derivation] < DERIVATION_ORDER[best.route.derivation]);
    if (better) best = { route, date, kind };
  }
  if (!best) return null;
  const legs: RateLeg[] = best.route.legs.map((l) => ({ rate: l.row.rate, inverted: l.inverted }));
  const sources = [...new Set(best.route.legs.map((l) => l.row.source))].sort();
  return {
    from,
    to,
    rate: deriveRate(legs),
    rateDate: best.date,
    source: sources.join('+'),
    kind: best.kind,
    derivation: best.route.derivation,
    stale: mode === 'current' && isStale(best.date, today, best.kind),
  };
}
