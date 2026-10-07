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
