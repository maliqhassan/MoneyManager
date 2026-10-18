import { type CurrencyCode, isCurrencyCode } from '../currency/currencies';
import { isCalendarDate } from '../dates/calendar';
import type { DecimalString } from '../money/decimal';

import { isJsonNumber, isJsonObject, type JsonValue, parseJsonExact } from './json';
import { numberLiteralToDecimal, validateRate } from './rateMath';

/**
 * Frankfurter v2 (https://frankfurter.dev) response handling — pure, so it is
 * fully testable without the network.
 *
 * `GET /v2/rates?base=USD&quotes=EUR,PKR[&date=YYYY-MM-DD | &from=…&to=…]`
 * returns `[{ "date": "2026-10-18", "base": "USD", "quote": "PKR", "rate": 277.33 }, …]`.
 */
export const FRANKFURTER_ID = 'frankfurter';
export const FRANKFURTER_BASE_URL = 'https://api.frankfurter.dev/v2';
export const FRANKFURTER_ATTRIBUTION =
  'Frankfurter (frankfurter.dev) — blended reference rates from central banks and official sources';

export interface ProviderRate {
  base: CurrencyCode;
  quote: CurrencyCode;
  rateDate: string;
  rate: DecimalString;
}

export class ProviderResponseError extends Error {
  constructor(readonly reason: string) {
    super(`Invalid exchange-rate response: ${reason}`);
    this.name = 'ProviderResponseError';
  }
}

export interface ParseOptions {
  base: CurrencyCode;
  /** Only these quotes are accepted (others are ignored, never stored). */
  quotes: readonly CurrencyCode[];
  /** Rows dated after this day are rejected (clock or provider error). */
  latestAllowedDate: string;
}

/**
 * Parses and validates a rates response. Every row must have a real calendar
 * date, the requested base, a requested quote and a valid positive rate;
 * otherwise the WHOLE response is rejected (nothing partial is stored).
 */
export function parseFrankfurterRates(text: string, options: ParseOptions): ProviderRate[] {
  let value: JsonValue;
  try {
    value = parseJsonExact(text);
  } catch {
    throw new ProviderResponseError('not JSON');
  }
  if (!Array.isArray(value)) throw new ProviderResponseError('expected an array');
  const wanted = new Set<string>(options.quotes);
  const seen = new Set<string>();
  const out: ProviderRate[] = [];
  for (const item of value) {
    if (!isJsonObject(item)) throw new ProviderResponseError('row is not an object');
    const { date, base, quote, rate } = item;
    if (typeof date !== 'string' || !isCalendarDate(date)) {
      throw new ProviderResponseError('invalid date');
    }
    if (date > options.latestAllowedDate) throw new ProviderResponseError('date in the future');
    if (base !== options.base) throw new ProviderResponseError('unexpected base currency');
    if (typeof quote !== 'string' || !isCurrencyCode(quote)) {
      // Currencies MoneyManager doesn't know are skipped, not stored.
      continue;
    }
    if (!wanted.has(quote) || quote === base) continue;
    if (!isJsonNumber(rate)) throw new ProviderResponseError('rate is not a number');
    const decimal = numberLiteralToDecimal(rate.literal);
    let valid: DecimalString;
    try {
      if (decimal === null) throw new Error('literal');
      valid = validateRate(decimal);
    } catch {
      throw new ProviderResponseError('invalid rate value');
    }
    const key = `${quote}@${date}`;
    if (seen.has(key)) throw new ProviderResponseError('duplicate row');
    seen.add(key);
    out.push({ base: options.base, quote, rateDate: date, rate: valid });
  }
  return out;
}

/** Message from an error body (`{ "status": 422, "message": "…" }`), if any. */
export function parseFrankfurterError(text: string): string | null {
  try {
    const value = parseJsonExact(text);
    if (isJsonObject(value) && typeof value.message === 'string') {
      return value.message.slice(0, 200);
    }
  } catch {
    // not JSON
  }
  return null;
}

/** Request URL for the given quotes on one date, a range, or the latest. */
export function frankfurterUrl(
  base: CurrencyCode,
  quotes: readonly CurrencyCode[],
  when: { date: string } | { from: string; to: string } | 'latest',
  baseUrl: string = FRANKFURTER_BASE_URL,
): string {
  const params = [`base=${base}`, `quotes=${[...quotes].sort().join(',')}`];
  if (when !== 'latest') {
    if ('date' in when) params.push(`date=${when.date}`);
    else params.push(`from=${when.from}`, `to=${when.to}`);
  }
  return `${baseUrl}/rates?${params.join('&')}`;
}
