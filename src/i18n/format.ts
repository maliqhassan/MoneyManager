import { getMinorUnits } from '@/domain/currency/currencies';
import type { Money } from '@/domain/money/money';

/**
 * Locale-aware display formatting.
 *
 * Money is formatted EXACTLY: the whole-unit part is a safe integer handed to
 * Intl (so locale grouping such as Indian "12,34,567" is correct) and the
 * fraction digits are spliced in as a string. Amounts never pass through a
 * float, even for display.
 */

type SignDisplay = 'auto' | 'always' | 'never' | 'exceptZero';

export interface MoneyFormatOptions {
  signDisplay?: SignDisplay;
  currencyDisplay?: 'symbol' | 'narrowSymbol' | 'code';
  /** Drop the fraction when it is zero ("$1,200" instead of "$1,200.00"). */
  compactZeroFraction?: boolean;
}

const cache = new Map<string, Intl.NumberFormat>();

function numberFormat(locale: string, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  let nf = cache.get(key);
  if (!nf) {
    nf = new Intl.NumberFormat(locale, options);
    cache.set(key, nf);
  }
  return nf;
}

function decimalSeparator(locale: string): string {
  return (
    numberFormat(locale, { minimumFractionDigits: 1 })
      .formatToParts(1.5)
      .find((p) => p.type === 'decimal')?.value ?? '.'
  );
}

export function formatMoney(
  value: Money,
  locale: string,
  options: MoneyFormatOptions = {},
): string {
  const exponent = getMinorUnits(value.currency);
  const negative = value.amountMinor < 0;
  const absMinor = Math.abs(value.amountMinor);
  const scale = 10 ** exponent;
  const whole = Math.floor(absMinor / scale); // exact: integer division of safe integers
  const fractionDigits = exponent > 0 ? String(absMinor % scale).padStart(exponent, '0') : '';

  let signDisplay = options.signDisplay ?? 'auto';
  if (signDisplay === 'exceptZero') signDisplay = absMinor === 0 ? 'never' : 'always';

  const nf = numberFormat(locale, {
    style: 'currency',
    currency: value.currency,
    currencyDisplay: options.currencyDisplay ?? 'symbol',
    signDisplay,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });

  // -0 keeps the minus sign for amounts like -0.05.
  const parts = nf.formatToParts(negative ? -whole : whole);
  const showFraction =
    exponent > 0 && !(options.compactZeroFraction && /^0+$/.test(fractionDigits));
  if (!showFraction) return parts.map((p) => p.value).join('');

  const lastIntegerIndex = parts.map((p) => p.type).lastIndexOf('integer');
  const decimal = decimalSeparator(locale);
  return parts
    .map((p, i) => (i === lastIntegerIndex ? `${p.value}${decimal}${fractionDigits}` : p.value))
    .join('');
}

/** Formats basis points (10 000 = 100%) as a percentage. */
export function formatBasisPoints(bp: number, locale: string, fractionDigits = 0): string {
  // Display boundary only: bp / 10 000 is a ratio, not a monetary amount.
  return numberFormat(locale, {
    style: 'percent',
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(bp / 10_000);
}

/** Formats a calendar date "YYYY-MM-DD" without any time-zone shift. */
export function formatCalendarDate(
  date: string,
  locale: string,
  style: 'short' | 'medium' | 'long' = 'medium',
): string {
  const [y, m, d] = date.split('-').map(Number);
  const utc = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
  return new Intl.DateTimeFormat(locale, { dateStyle: style, timeZone: 'UTC' }).format(utc);
}

/** Formats an instant in the given IANA time zone. */
export function formatDateTime(iso: string, locale: string, timeZone: string): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone,
  }).format(new Date(iso));
}
