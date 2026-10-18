import type { CurrencyCode } from '@/domain/currency/currencies';
import { addDays } from '@/domain/dates/calendar';
import {
  FRANKFURTER_ATTRIBUTION,
  FRANKFURTER_BASE_URL,
  FRANKFURTER_ID,
  frankfurterUrl,
  parseFrankfurterError,
  parseFrankfurterRates,
  type ProviderRate,
  ProviderResponseError,
} from '@/domain/fx/frankfurter';
import { FX_POLICY } from '@/domain/fx/policy';

export type RateRequest =
  { kind: 'latest' } | { kind: 'range'; from: string; to: string } | { kind: 'date'; date: string };

/**
 * A source of exchange rates. Domain code never depends on a specific API:
 * providers return validated rows (1 base = rate quote, per date).
 */
export interface RateProvider {
  readonly id: string;
  readonly attribution: string;
  fetchRates(
    base: CurrencyCode,
    quotes: readonly CurrencyCode[],
    request: RateRequest,
    today: string,
  ): Promise<ProviderRate[]>;
}

export type ProviderErrorKind = 'offline' | 'timeout' | 'rate_limited' | 'http' | 'invalid';

export class ProviderError extends Error {
  constructor(
    readonly kind: ProviderErrorKind,
    message: string,
    readonly details: { status?: number; retryAfterSeconds?: number } = {},
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

type FetchLike = (
  url: string,
  init: { signal: AbortSignal; headers: Record<string, string> },
) => Promise<{
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}>;

/** Parses Retry-After (seconds or an HTTP date) into seconds, capped at a day. */
export function retryAfterSeconds(value: string | null, now: Date): number | undefined {
  if (!value) return undefined;
  const seconds = /^\d+$/.test(value.trim()) ? Number.parseInt(value, 10) : NaN;
  const fromDate = Number.isNaN(seconds) ? (Date.parse(value) - now.getTime()) / 1000 : seconds;
  if (!Number.isFinite(fromDate) || fromDate < 0) return undefined;
  return Math.min(Math.ceil(fromDate), 24 * 60 * 60);
}

/**
 * Frankfurter v2 (no key, public). Only currency codes and dates are sent —
 * never amounts or any other user data.
 */
export class FrankfurterProvider implements RateProvider {
  readonly id = FRANKFURTER_ID;
  readonly attribution = FRANKFURTER_ATTRIBUTION;

  constructor(
    private readonly fetchImpl: FetchLike = (url, init) => fetch(url, init),
    private readonly options: { baseUrl?: string; timeoutMs?: number; now?: () => Date } = {},
  ) {}

  async fetchRates(
    base: CurrencyCode,
    quotes: readonly CurrencyCode[],
    request: RateRequest,
    today: string,
  ): Promise<ProviderRate[]> {
    if (quotes.length === 0) return [];
    const when =
      request.kind === 'latest'
        ? ('latest' as const)
        : request.kind === 'date'
          ? { date: request.date }
          : { from: request.from, to: request.to };
    const url = frankfurterUrl(base, quotes, when, this.options.baseUrl ?? FRANKFURTER_BASE_URL);
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      this.options.timeoutMs ?? FX_POLICY.requestTimeoutMs,
    );
    let response: Awaited<ReturnType<FetchLike>>;
    let text: string;
    try {
      response = await this.fetchImpl(url, {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });
      text = await response.text();
    } catch {
      if (controller.signal.aborted) throw new ProviderError('timeout', 'Rate request timed out');
      throw new ProviderError('offline', 'Rate provider unreachable');
    } finally {
      clearTimeout(timer);
    }
    if (response.status === 429) {
      const retry = retryAfterSeconds(
        response.headers.get('retry-after'),
        this.options.now?.() ?? new Date(),
      );
      throw new ProviderError('rate_limited', 'Rate provider rate limit reached', {
        status: 429,
        ...(retry !== undefined ? { retryAfterSeconds: retry } : {}),
      });
    }
    if (!response.ok) {
      const message = parseFrankfurterError(text) ?? `HTTP ${response.status}`;
      throw new ProviderError('http', message, { status: response.status });
    }
    try {
      // Provider dates are UTC-based; allow one day ahead of the user's date.
      return parseFrankfurterRates(text, {
        base,
        quotes,
        latestAllowedDate: addDays(today, 1),
      });
    } catch (error) {
      if (error instanceof ProviderResponseError) {
        throw new ProviderError('invalid', error.message);
      }
      throw error;
    }
  }
}
