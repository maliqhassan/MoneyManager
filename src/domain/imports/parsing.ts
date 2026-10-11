import type { CurrencyCode } from '../currency/currencies';
import {
  type CalendarDate,
  formatCalendarDate,
  isCalendarDate,
  toCalendarDateInZone,
} from '../dates/calendar';
import { parseMoneyInput } from '../money/parse';

/**
 * Field parsing for CSV import. Nothing is guessed:
 * - dates use an explicit format; a date like 03/04/2026 is only read once
 *   the user has said whether it is day-first or month-first;
 * - amounts use an explicit decimal separator and the currency's minor units
 *   (extra decimals are rejected, never rounded), via the app's exact parser.
 */

export const IMPORT_DATE_FORMATS = ['YMD', 'DMY', 'MDY'] as const;
export type ImportDateFormat = (typeof IMPORT_DATE_FORMATS)[number];

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/;

/**
 * A calendar date from a CSV value, or null when invalid.
 * - Timestamps with an explicit offset or Z are converted to the user's
 *   time zone (the instant is unambiguous).
 * - A 4-digit first part is always year-month-day.
 * - Otherwise the chosen format decides; 2-digit years are rejected.
 * A trailing time ("2026-10-05 14:30") is ignored.
 */
export function parseImportDate(
  value: string,
  format: ImportDateFormat | null,
  timeZone: string,
): CalendarDate | null {
  const text = value.trim();
  if (text === '') return null;
  if (ISO_INSTANT.test(text)) {
    const ms = Date.parse(text);
    return Number.isNaN(ms) ? null : toCalendarDateInZone(new Date(ms), timeZone);
  }
  const datePart = text.split(/[T\s]/)[0] ?? '';
  const parts = datePart.split(/[-/.]/);
  if (parts.length !== 3 || parts.some((p) => !/^\d{1,4}$/.test(p))) return null;
  const [a, b, c] = parts.map(Number) as [number, number, number];
  let year: number;
  let month: number;
  let day: number;
  if (parts[0]!.length === 4) [year, month, day] = [a, b, c];
  else {
    if (parts[2]!.length !== 4 || !format || format === 'YMD') return null;
    year = c;
    [day, month] = format === 'DMY' ? [a, b] : [b, a];
  }
  const date = formatCalendarDate({ year, month, day });
  return isCalendarDate(date) ? date : null;
}

/**
 * Date formats that read EVERY sample value. More than one result means
 * the file is ambiguous (e.g. all days ≤ 12) and the user must choose.
 */
export function detectDateFormats(values: readonly string[]): ImportDateFormat[] {
  const sample = values.map((v) => v.trim()).filter((v) => v !== '');
  if (sample.length === 0) return [];
  return IMPORT_DATE_FORMATS.filter((f) =>
    sample.every((v) => parseImportDate(v, f, 'UTC') !== null),
  ).filter((f, _i, all) =>
    // Year-first values parse under every format; report them as YMD only.
    all.length === 3 ? f === 'YMD' : true,
  );
}

export type AmountIssue = 'missing_amount' | 'invalid_amount' | 'too_many_decimals';

/** Characters a bank may put around a number: currency symbols, codes, spaces. */
const NOISE = /[^\d.,\-()'\u2212]/g;

/**
 * Signed amount in minor units. Accepts a leading or trailing minus and
 * accounting parentheses "(12.50)"; strips currency symbols/codes, spaces
 * and apostrophes. The decimal separator is explicit; the other of "." / ","
 * is treated as grouping.
 */
export function parseImportAmount(
  value: string,
  currency: CurrencyCode,
  decimal: '.' | ',',
): { ok: true; minor: number } | { ok: false; issue: AmountIssue } {
  let text = value.trim();
  if (text === '') return { ok: false, issue: 'missing_amount' };
  let negative = false;
  if (/^\(.*\)$/.test(text)) {
    negative = true;
    text = text.slice(1, -1);
  }
  text = text.replace(NOISE, '').replace(/'/g, '').replace('\u2212', '-');
  if (text.endsWith('-')) {
    negative = !negative;
    text = text.slice(0, -1);
  }
  if (text.startsWith('-')) {
    negative = !negative;
    text = text.slice(1);
  }
  if (text === '' || /[()-]/.test(text)) return { ok: false, issue: 'invalid_amount' };
  const parsed = parseMoneyInput(text, currency, {
    decimal,
    group: decimal === '.' ? ',' : '.',
  });
  if (!parsed.ok) {
    return {
      ok: false,
      issue: parsed.error === 'too_many_decimals' ? 'too_many_decimals' : 'invalid_amount',
    };
  }
  const minor = parsed.value.amountMinor * (negative ? -1 : 1);
  return { ok: true, minor: minor === 0 ? 0 : minor };
}

/** Decimal separator that reads every sample amount ('.' preferred when both do). */
export function detectDecimalSeparator(values: readonly string[]): ('.' | ',')[] {
  const sample = values.map((v) => v.trim()).filter((v) => v !== '');
  return (['.', ','] as const).filter((d) =>
    sample.every((v) => {
      const r = parseImportAmount(v, 'USD', d);
      // A value like "1,234" reads under both; one like "12,50" only under ','.
      return r.ok;
    }),
  );
}

export type ImportField =
  | 'date'
  | 'amount'
  | 'debit'
  | 'credit'
  | 'type'
  | 'currency'
  | 'payee'
  | 'category'
  | 'notes'
  | 'account'
  | 'externalId';

const HEADER_HINTS: Record<ImportField, readonly string[]> = {
  date: ['date', 'transaction date', 'posted date', 'posting date', 'booking date', 'value date'],
  amount: ['amount', 'value', 'transaction amount', 'sum'],
  debit: ['debit', 'withdrawal', 'withdrawals', 'money out', 'paid out', 'out'],
  credit: ['credit', 'deposit', 'deposits', 'money in', 'paid in', 'in'],
  type: ['type', 'transaction type', 'direction', 'dr/cr'],
  currency: ['currency', 'ccy', 'currency code'],
  payee: ['payee', 'merchant', 'description', 'name', 'counterparty', 'details', 'narrative'],
  category: ['category', 'categories'],
  notes: ['notes', 'note', 'memo', 'reference', 'remarks', 'comment'],
  account: ['account', 'account name'],
  externalId: [
    'id',
    'transaction id',
    'reference id',
    'fitid',
    'external id',
    'transaction reference',
  ],
};

/**
 * Suggested column for each field from header names (exact, case- and
 * accent-insensitive matches only; the user confirms every mapping).
 */
export function suggestMapping(headers: readonly string[]): Partial<Record<ImportField, number>> {
  const normalized = headers.map((h) =>
    h
      .normalize('NFKD')
      .replace(/[\u0300-\u036F]/g, '')
      .toLowerCase()
      .replace(/[_\s]+/g, ' ')
      .trim(),
  );
  const used = new Set<number>();
  const out: Partial<Record<ImportField, number>> = {};
  for (const field of Object.keys(HEADER_HINTS) as ImportField[]) {
    const index = normalized.findIndex((h, i) => !used.has(i) && HEADER_HINTS[field].includes(h));
    if (index >= 0) {
      out[field] = index;
      used.add(index);
    }
  }
  return out;
}
