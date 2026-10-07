import { getCalendars, getLocales } from 'expo-localization';

import { type CurrencyCode, DEFAULT_CURRENCY, isCurrencyCode } from '@/domain/currency/currencies';
import type { Weekday } from '@/domain/enums';
import type { NumberSeparators } from '@/domain/money/parse';

/**
 * Snapshot of the device's regional settings, used as defaults until the
 * user's synced preferences (base currency, locale, first day of week) load.
 */
export interface DeviceLocale {
  /** BCP-47 tag, e.g. "en-GB". */
  languageTag: string;
  /** Primary language, e.g. "en". */
  languageCode: string;
  isRTL: boolean;
  currency: CurrencyCode;
  timeZone: string;
  firstDayOfWeek: Weekday;
  separators: NumberSeparators;
}

export function getDeviceLocale(): DeviceLocale {
  const locale = getLocales()[0];
  const calendar = getCalendars()[0];
  const currency =
    locale.currencyCode && isCurrencyCode(locale.currencyCode)
      ? locale.currencyCode
      : DEFAULT_CURRENCY;
  // expo-localization: 1 = Sunday … 7 = Saturday; domain: 0 = Sunday … 6 = Saturday.
  const firstWeekday = calendar.firstWeekday ? ((calendar.firstWeekday - 1) as Weekday) : 1;

  return {
    languageTag: locale.languageTag,
    languageCode: locale.languageCode ?? 'en',
    isRTL: locale.textDirection === 'rtl',
    currency,
    timeZone: calendar.timeZone ?? 'UTC',
    firstDayOfWeek: firstWeekday,
    separators: {
      decimal: locale.decimalSeparator ?? '.',
      group: locale.digitGroupingSeparator ?? ',',
    },
  };
}
