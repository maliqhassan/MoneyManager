import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import type { Choice, PickerOption } from '@/components/ui';
import { Text } from '@/components/ui';
import { type CurrencyCode, getCurrencyName, searchCurrencies } from '@/domain/currency/currencies';
import {
  DATE_FORMATS,
  type DateFormat,
  NUMBER_FORMATS,
  type NumberFormat,
  WEEKDAYS,
  type Weekday,
} from '@/domain/enums';
import { COUNTRIES } from '@/domain/regional/countries';
import {
  formatUtcOffset,
  getUtcOffsetMinutes,
  listTimeZones,
  timeZoneCity,
} from '@/domain/regional/timeZones';
import {
  formatDateWithPreference,
  formatMoney,
  getCurrencySymbol,
  resolveNumberLocale,
} from '@/i18n/format';
import { LANGUAGE_NATIVE_NAMES, SUPPORTED_LANGUAGES } from '@/i18n/languages';
import { getDeviceLocale } from '@/i18n/locale';

/**
 * Option lists for regional preferences, shared by onboarding and Settings.
 * Labels and examples are produced by the formatting layer (Intl), never
 * hand-built in screens.
 */

const SAMPLE_DATE = '2026-01-31';
const SAMPLE_AMOUNT = { amountMinor: 123456789, currency: 'USD' as const };

export function useCurrencyOptions(locale: string): PickerOption<CurrencyCode>[] {
  return useMemo(
    () =>
      searchCurrencies('').map((code) => ({
        value: code,
        label: code,
        description: getCurrencyName(code),
        keywords: getCurrencyName(code),
        leading: (
          <Text variant="bodyStrong" tone="textSecondary">
            {getCurrencySymbol(code, locale)}
          </Text>
        ),
      })),
    [locale],
  );
}

export function useRegionOptions(): PickerOption<string>[] {
  return useMemo(
    () =>
      COUNTRIES.map((c) => ({
        value: c.code,
        label: c.name,
        description: `${c.code} · ${c.currency}`,
        keywords: c.currency,
      })).sort((a, b) => a.label.localeCompare(b.label)),
    [],
  );
}

export function useTimeZoneOptions(current: string): PickerOption<string>[] {
  return useMemo(() => {
    const now = new Date();
    const device = getDeviceLocale().timeZone;
    return listTimeZones([device, current], now).map((tz) => ({
      value: tz,
      label: timeZoneCity(tz),
      description: `${formatUtcOffset(getUtcOffsetMinutes(tz, now))} · ${tz}`,
      keywords: tz,
    }));
  }, [current]);
}

export function useLanguageOptions(): PickerOption<string>[] {
  return useMemo(
    () => SUPPORTED_LANGUAGES.map((code) => ({ value: code, label: LANGUAGE_NATIVE_NAMES[code] })),
    [],
  );
}

export function useDateFormatOptions(locale: string): PickerOption<DateFormat>[] {
  const { t } = useTranslation();
  return useMemo(
    () =>
      DATE_FORMATS.map((format) => ({
        value: format,
        label: t(`formats.date.${format}`, {
          example: formatDateWithPreference(SAMPLE_DATE, locale, format),
        }),
      })),
    [locale, t],
  );
}

export function useNumberFormatOptions(locale: string): PickerOption<NumberFormat>[] {
  const { t } = useTranslation();
  return useMemo(
    () =>
      NUMBER_FORMATS.map((format) => ({
        value: format,
        label: t(`formats.number.${format}`, {
          example: formatMoney(SAMPLE_AMOUNT, resolveNumberLocale(format, locale), {
            currencyDisplay: 'code',
          }).replace(/USD\s?|\s?USD/, ''),
        }),
      })),
    [locale, t],
  );
}

export function useWeekdayChoices(): Choice<`${Weekday}`>[] {
  const { t } = useTranslation();
  // Offer the three conventions used worldwide.
  return useMemo(
    () =>
      ([1, 0, 6] as const)
        .filter((d) => WEEKDAYS.includes(d))
        .map((d) => ({ value: `${d}` as const, label: t(`weekdays.${d}`) })),
    [t],
  );
}
