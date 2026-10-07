import { getCalendars, getLocales } from 'expo-localization';

import { type CurrencyCode, DEFAULT_CURRENCY, isCurrencyCode } from '@/domain/currency/currencies';
import type { Weekday } from '@/domain/enums';
import type { NumberSeparators } from '@/domain/money/parse';
import { findCountry } from '@/domain/regional/countries';
import { isValidTimeZone } from '@/domain/regional/timeZones';

import type { FormatSettings } from './formatter';

/**
 * Snapshot of the device's regional settings, used as defaults until the
 * user's synced preferences (base currency, locale, first day of week) load.
 */
export interface DeviceLocale {
  /** BCP-47 tag, e.g. "en-GB". */
  languageTag: string;
  /** Primary language, e.g. "en". */
  languageCode: string;
  /** ISO 3166 region from device settings, if any (a suggestion only). */
  regionCode: string | null;
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
    regionCode: locale.regionCode ?? null,
    isRTL: locale.textDirection === 'rtl',
    currency,
    timeZone: calendar.timeZone && isValidTimeZone(calendar.timeZone) ? calendar.timeZone : 'UTC',
    firstDayOfWeek: firstWeekday,
    separators: {
      decimal: locale.decimalSeparator ?? '.',
      group: locale.digitGroupingSeparator ?? ',',
    },
  };
}

/**
 * Formatting defaults from the device, used before the user's synced
 * preferences exist (and as onboarding suggestions).
 */
export function deviceFormatSettings(device: DeviceLocale = getDeviceLocale()): FormatSettings {
  const region = findCountry(device.regionCode)?.code ?? null;
  return {
    locale: device.languageTag,
    language: device.languageCode,
    region,
    numberFormat: 'locale',
    dateFormat: 'locale',
    timeZone: device.timeZone,
    firstDayOfWeek: device.firstDayOfWeek,
    baseCurrency: device.currency,
  };
}
