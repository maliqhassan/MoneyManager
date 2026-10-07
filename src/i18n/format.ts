import { type CurrencyCode, getMinorUnits } from '@/domain/currency/currencies';
import type { DateFormat, NumberFormat } from '@/domain/enums';
import type { NumberSeparators } from '@/domain/money/parse';
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

// ---------------------------------------------------------------------------
// Regional preferences → Intl
// ---------------------------------------------------------------------------

/** Representative locales for explicit number formats (see domain/enums NUMBER_FORMATS). */
const NUMBER_FORMAT_LOCALES: Record<Exclude<NumberFormat, 'locale'>, string> = {
  comma_period: 'en-US',
  period_comma: 'de-DE',
  space_comma: 'fr-FR',
  apostrophe_period: 'de-CH',
};

/** The locale whose numeric conventions are used for amounts and numbers. */
export function resolveNumberLocale(numberFormat: NumberFormat, locale: string): string {
  return numberFormat === 'locale' ? locale : NUMBER_FORMAT_LOCALES[numberFormat];
}

/** Decimal and grouping separators that Intl uses for `locale`. */
export function getNumberSeparators(locale: string): NumberSeparators {
  const parts = numberFormat(locale, { minimumFractionDigits: 1, useGrouping: true }).formatToParts(
    1234567.5,
  );
  return {
    decimal: parts.find((p) => p.type === 'decimal')?.value ?? '.',
    group: parts.find((p) => p.type === 'group')?.value ?? ',',
  };
}

/** Locale-aware currency symbol, e.g. USD → "$", EUR → "€", AED → "AED". */
export function getCurrencySymbol(currency: CurrencyCode, locale: string): string {
  try {
    const part = numberFormat(locale, {
      style: 'currency',
      currency,
      currencyDisplay: 'narrowSymbol',
    })
      .formatToParts(0)
      .find((p) => p.type === 'currency');
    return part?.value ?? currency;
  } catch {
    return currency;
  }
}

/** Formats a plain (non-monetary) number, e.g. counts. */
export function formatNumber(value: number, locale: string): string {
  return numberFormat(locale, { maximumFractionDigits: 0 }).format(value);
}

/**
 * Converts minor units to an editable string in the user's number format,
 * without grouping ("1234.5" → "1234,50" for de-DE). For pre-filling inputs.
 */
export function formatAmountForInput(value: Money, separators: NumberSeparators): string {
  const exponent = getMinorUnits(value.currency);
  const negative = value.amountMinor < 0;
  const abs = Math.abs(value.amountMinor);
  const scale = 10 ** exponent;
  const whole = String(Math.floor(abs / scale));
  const fraction = exponent > 0 ? String(abs % scale).padStart(exponent, '0') : '';
  return `${negative ? '-' : ''}${whole}${fraction ? `${separators.decimal}${fraction}` : ''}`;
}

/**
 * Formats a canonical calendar date for display.
 * - 'numeric': honours an explicit DateFormat (MDY/DMY/YMD) or the locale's numeric order.
 * - 'medium' / 'long': month names in the user's language, locale ordering.
 */
export function formatDateWithPreference(
  date: string,
  locale: string,
  dateFormat: DateFormat,
  style: 'numeric' | 'medium' | 'long' = 'numeric',
): string {
  if (style !== 'numeric') return formatCalendarDate(date, locale, style);
  const [y = '', m = '', d = ''] = date.split('-');
  switch (dateFormat) {
    case 'MDY':
      return `${m}/${d}/${y}`;
    case 'DMY':
      return `${d}/${m}/${y}`;
    case 'YMD':
      return `${y}-${m}-${d}`;
    case 'locale': {
      const utc = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
      return new Intl.DateTimeFormat(locale, {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        timeZone: 'UTC',
      }).format(utc);
    }
  }
}

/** Builds a BCP-47 tag from language + region, falling back safely. */
export function buildLocaleTag(language: string, region: string | null): string {
  const candidate = region ? `${language}-${region}` : language;
  try {
    return Intl.getCanonicalLocales(candidate)[0] ?? 'en-US';
  } catch {
    return 'en-US';
  }
}
