import type { CurrencyCode } from '@/domain/currency/currencies';
import { addDays, compareDates, daysBetween } from '@/domain/dates/calendar';
import { FX_POLICY } from '@/domain/fx/policy';
import type { ExchangeRateRepository } from '@/repositories/types';

import { ProviderError, type ProviderErrorKind, type RateProvider } from './provider';

export type RefreshOutcome =
  | { status: 'updated'; written: number; requests: number }
  | { status: 'up_to_date'; requests: number }
  | {
      status: 'skipped';
      reason: 'single_currency' | 'fresh' | 'recent_failure' | 'rate_limited';
    }
  | { status: 'failed'; error: ProviderErrorKind; written: number };

export interface RefreshOptions {
  rates: ExchangeRateRepository;
  provider: RateProvider;
  baseCurrency: CurrencyCode;
  /** The user's local date (YYYY-MM-DD). */
  today: string;
  now: () => Date;
  /** User pressed "Refresh now": ignore the 12-hour wait (not Retry-After). */
  force?: boolean;
}

const hoursBetween = (from: string, to: Date) => (to.getTime() - Date.parse(from)) / 3_600_000;

const minDate = (dates: readonly string[]) =>
  dates.reduce((a, b) => (compareDates(a, b) <= 0 ? a : b));

/** Splits [from, to] into chunks of at most `size` days, newest first. */
export function chunkRange(from: string, to: string, size: number): { from: string; to: string }[] {
  const out: { from: string; to: string }[] = [];
  let end = to;
  while (compareDates(end, from) >= 0) {
    const start = addDays(end, -(size - 1));
    const chunkStart = compareDates(start, from) < 0 ? from : start;
    out.push({ from: chunkStart, to: end });
    end = addDays(chunkStart, -1);
  }
  return out;
}

/**
 * Plans which date ranges to request: a forward fill from the newest cached
 * rate to today, and a bounded backfill toward the earliest entry that needs
 * a conversion. Pure — exported for tests.
 */
export function planRequests(input: {
  quotes: readonly CurrencyCode[];
  coverage: readonly { currency: CurrencyCode; firstDate: string; lastDate: string }[];
  earliestNeeded: string | null;
  today: string;
}): { from: string; to: string }[] {
  const { quotes, coverage, today } = input;
  if (quotes.length === 0) return [];
  const byCurrency = new Map(coverage.map((c) => [c.currency, c]));
  const floor = addDays(today, -FX_POLICY.forwardFillMaxDays);
  const defaultStart = addDays(today, -FX_POLICY.historicalLookbackDays.provider);

  // Forward fill: from the day after the oldest "newest cached date".
  const forwardStarts = quotes.map((q) => {
    const c = byCurrency.get(q);
    return c ? addDays(c.lastDate, 1) : defaultStart;
  });
  let forwardFrom = minDate(forwardStarts);
  // Recent days are re-checked: sources publish late and blended rates move.
  const revisit = addDays(today, -FX_POLICY.revisitDays);
  if (compareDates(forwardFrom, revisit) > 0) forwardFrom = revisit;
  if (compareDates(forwardFrom, floor) < 0) forwardFrom = floor;
  const ranges: { from: string; to: string }[] = [];
  if (compareDates(forwardFrom, today) <= 0) ranges.push({ from: forwardFrom, to: today });

  // Backfill: older than every currency's cached start, down to the earliest need.
  const earliest = input.earliestNeeded;
  if (earliest && compareDates(earliest, today) <= 0) {
    const starts = quotes.map((q) => byCurrency.get(q)?.firstDate ?? forwardFrom);
    const backfillTo = addDays(minDate(starts), -1);
    if (compareDates(earliest, backfillTo) <= 0) {
      const budgetFrom = addDays(backfillTo, -(FX_POLICY.backfillMaxDaysPerRefresh - 1));
      const from = compareDates(earliest, budgetFrom) < 0 ? budgetFrom : earliest;
      // Older entries may use a rate up to the lookback before their date.
      const paddedFrom = addDays(from, -FX_POLICY.historicalLookbackDays.provider);
      ranges.push(...chunkRange(paddedFrom, backfillTo, FX_POLICY.backfillChunkDays));
    }
  }
  return ranges;
}

/**
 * Refreshes the local rate cache from the provider (foreground only).
 * Throttled across restarts via fx_fetch_log; failures never touch cached
 * rates; nothing about the user is sent except currency codes.
 */
export async function refreshExchangeRates(o: RefreshOptions): Promise<RefreshOutcome> {
  const { rates, provider } = o;
  const now = o.now();
  const log = await rates.fetchLog(provider.id);
  if (log.retryAfter && Date.parse(log.retryAfter) > now.getTime()) {
    return { status: 'skipped', reason: 'rate_limited' };
  }
  if (!o.force) {
    if (log.lastSuccessAt && hoursBetween(log.lastSuccessAt, now) < FX_POLICY.refreshEveryHours) {
      return { status: 'skipped', reason: 'fresh' };
    }
    if (
      log.lastError &&
      log.lastAttemptAt &&
      hoursBetween(log.lastAttemptAt, now) * 60 < FX_POLICY.retryAfterFailureMinutes
    ) {
      return { status: 'skipped', reason: 'recent_failure' };
    }
  }

  const inUse = new Set(await rates.currenciesInUse());
  inUse.add(o.baseCurrency);
  if (inUse.size < 2) return { status: 'skipped', reason: 'single_currency' };
  const quotes = [...inUse].filter((c) => c !== FX_POLICY.pivot).sort();

  const ranges = planRequests({
    quotes,
    coverage: await rates.coverage(quotes, provider.id),
    earliestNeeded: await rates.earliestConversionDate(o.baseCurrency),
    today: o.today,
  });

  await rates.recordFetch(provider.id, { lastAttemptAt: now.toISOString() });
  let written = 0;
  try {
    for (const range of ranges) {
      // A single-day forward fill is a "latest" request in practice.
      const rows = await provider.fetchRates(
        FX_POLICY.pivot,
        quotes,
        daysBetween(range.from, range.to) === 0 && range.to === o.today
          ? { kind: 'latest' }
          : { kind: 'range', from: range.from, to: range.to },
        o.today,
      );
      written += await rates.storeProviderRates(rows, {
        source: provider.id,
        attribution: provider.attribution,
        fetchedAt: o.now().toISOString(),
      });
      await rates.recordCoverage(provider.id, quotes, range.from, range.to);
    }
  } catch (error) {
    const kind: ProviderErrorKind = error instanceof ProviderError ? error.kind : 'invalid';
    const retry = error instanceof ProviderError ? error.details.retryAfterSeconds : undefined;
    await rates.recordFetch(provider.id, {
      lastError: kind,
      retryAfter:
        kind === 'rate_limited'
          ? new Date(now.getTime() + (retry ?? 3600) * 1000).toISOString()
          : null,
    });
    return { status: 'failed', error: kind, written };
  }
  await rates.recordFetch(provider.id, {
    lastSuccessAt: o.now().toISOString(),
    lastError: null,
    retryAfter: null,
  });
  return written > 0
    ? { status: 'updated', written, requests: ranges.length }
    : { status: 'up_to_date', requests: ranges.length };
}
