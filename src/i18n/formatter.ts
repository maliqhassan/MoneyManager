import type { CurrencyCode } from '@/domain/currency/currencies';
import { todayInZone } from '@/domain/dates/calendar';
import type { DateFormat, NumberFormat, Weekday } from '@/domain/enums';
import type { Money } from '@/domain/money/money';
import type { NumberSeparators } from '@/domain/money/parse';

import {
  formatAmountForInput,
  formatBasisPoints,
  formatDateTime,
  formatLocalTime,
  formatDateWithPreference,
  formatMoney,
  formatNumber,
  getCurrencySymbol,
  getNumberSeparators,
  type MoneyFormatOptions,
  resolveNumberLocale,
} from './format';

/**
 * Everything presentation needs to format values for this user. Derived from
 * synced user_preferences (or device defaults before they exist).
 */
export interface FormatSettings {
  /** BCP-47 formatting locale (language-region), e.g. "en-GB". */
  locale: string;
  language: string;
  region: string | null;
  numberFormat: NumberFormat;
  dateFormat: DateFormat;
  timeZone: string;
  firstDayOfWeek: Weekday;
  baseCurrency: CurrencyCode;
}

export interface Formatter {
  settings: FormatSettings;
  numberLocale: string;
  separators: NumberSeparators;
  money: (value: Money, options?: MoneyFormatOptions) => string;
  number: (value: number) => string;
  percent: (basisPoints: number, fractionDigits?: number) => string;
  /** Canonical "YYYY-MM-DD" → display. */
  date: (date: string, style?: 'numeric' | 'medium' | 'long') => string;
  /** ISO timestamp → display in the user's time zone. */
  dateTime: (iso: string) => string;
  /** "HH:mm" wall-clock time → locale display ("13:30" / "1:30 PM"). */
  time: (localTime: string) => string;
  currencySymbol: (currency: CurrencyCode) => string;
  amountForInput: (value: Money) => string;
  /** Today's date in the user's configured time zone. */
  today: (now?: Date) => string;
}

/**
 * The single formatting entry point for UI. Screens never call Intl or build
 * number/date strings themselves.
 */
export function createFormatter(settings: FormatSettings): Formatter {
  const numberLocale = resolveNumberLocale(settings.numberFormat, settings.locale);
  const separators = getNumberSeparators(numberLocale);
  return {
    settings,
    numberLocale,
    separators,
    money: (value, options) => formatMoney(value, numberLocale, options),
    number: (value) => formatNumber(value, numberLocale),
    percent: (bp, digits) => formatBasisPoints(bp, numberLocale, digits),
    date: (date, style = 'numeric') =>
      formatDateWithPreference(date, settings.locale, settings.dateFormat, style),
    dateTime: (iso) => formatDateTime(iso, settings.locale, settings.timeZone),
    time: (localTime) => formatLocalTime(localTime, settings.locale),
    currencySymbol: (currency) => getCurrencySymbol(currency, numberLocale),
    amountForInput: (value) => formatAmountForInput(value, separators),
    today: (now) => todayInZone(settings.timeZone, now),
  };
}
