import { type CurrencyCode, getMinorUnits } from '../currency/currencies';
import { MAX_ABS_AMOUNT_MINOR, type Money } from './money';

export interface NumberSeparators {
  decimal: string;
  group: string;
}

export const DEFAULT_SEPARATORS: NumberSeparators = { decimal: '.', group: ',' };

export type ParseMoneyErrorCode = 'empty' | 'invalid' | 'too_many_decimals' | 'out_of_range';

export type ParseMoneyResult =
  { ok: true; value: Money } | { ok: false; error: ParseMoneyErrorCode };

const WHITESPACE = /[\s\u00A0\u202F]/g;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Parses user input such as "1,234.56" (en-US) or "1.234,56" (de-DE) into
 * exact minor units without ever going through a float.
 *
 * Input with more decimals than the currency allows is rejected rather than
 * silently rounded — users must see exactly what gets stored.
 */
export function parseMoneyInput(
  input: string,
  currency: CurrencyCode,
  separators: NumberSeparators = DEFAULT_SEPARATORS,
): ParseMoneyResult {
  let text = input.replace(WHITESPACE, '');
  if (text.length === 0) return { ok: false, error: 'empty' };

  let negative = false;
  if (text.startsWith('-') || text.startsWith('\u2212')) {
    negative = true;
    text = text.slice(1);
  }

  if (separators.group) {
    text = text.replace(new RegExp(escapeRegExp(separators.group), 'g'), '');
  }
  const parts = text.split(separators.decimal);
  if (parts.length > 2) return { ok: false, error: 'invalid' };

  const [whole = '', fraction = ''] = parts;
  if (!/^\d*$/.test(whole) || !/^\d*$/.test(fraction) || (whole === '' && fraction === '')) {
    return { ok: false, error: 'invalid' };
  }

  const minorUnits = getMinorUnits(currency);
  if (fraction.length > minorUnits) return { ok: false, error: 'too_many_decimals' };

  const digits = `${whole || '0'}${fraction.padEnd(minorUnits, '0')}`;
  const magnitude = BigInt(digits);
  if (magnitude > BigInt(MAX_ABS_AMOUNT_MINOR)) return { ok: false, error: 'out_of_range' };

  const amountMinor = Number(magnitude) * (negative ? -1 : 1);
  return { ok: true, value: { amountMinor: amountMinor === 0 ? 0 : amountMinor, currency } };
}

/**
 * Lenient parser for amount *entry* fields.
 *
 * Device keyboards do not always match the user's chosen number format (a
 * German keyboard types "," on a phone set to en-US formatting). Treating the
 * wrong character as a grouping separator would silently store 100× the
 * intended amount, so the decimal separator is inferred:
 *
 * - both "." and "," present → the LAST one is the decimal separator;
 * - one kind, repeated ("1,234,567") → grouping;
 * - one kind, once → decimal if it is the preferred decimal separator,
 *   otherwise grouping only when it looks like thousands ("1,250"), else
 *   decimal ("12,50").
 *
 * Apostrophes (Swiss grouping) and spaces are ignored.
 */
export function parseAmountEntry(
  input: string,
  currency: CurrencyCode,
  preferredDecimal: string = DEFAULT_SEPARATORS.decimal,
): ParseMoneyResult {
  const text = input.replace(WHITESPACE, '').replace(/['’]/g, '');
  if (text.length === 0) return { ok: false, error: 'empty' };

  const unsigned = text.replace(/^[-\u2212]/, '');
  const dots = (unsigned.match(/\./g) ?? []).length;
  const commas = (unsigned.match(/,/g) ?? []).length;

  let decimal: string;
  if (dots > 0 && commas > 0) {
    decimal = unsigned.lastIndexOf('.') > unsigned.lastIndexOf(',') ? '.' : ',';
  } else if (dots + commas === 0) {
    decimal = preferredDecimal === ',' ? ',' : '.';
  } else {
    const char = dots > 0 ? '.' : ',';
    const count = dots + commas;
    if (count > 1) {
      decimal = char === '.' ? ',' : '.';
    } else if (char === preferredDecimal) {
      decimal = char;
    } else {
      const [before = '', after = ''] = unsigned.split(char);
      const looksLikeThousands = after.length === 3 && before.length >= 1 && before.length <= 3;
      decimal = looksLikeThousands ? (char === '.' ? ',' : '.') : char;
    }
  }
  return parseMoneyInput(text, currency, { decimal, group: decimal === '.' ? ',' : '.' });
}
