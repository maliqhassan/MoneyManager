import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { ChoiceChips, OptionPicker, Screen, Text } from '@/components/ui';
import type { Weekday } from '@/domain/enums';
import { findCountry } from '@/domain/regional/countries';
import { FormError } from '@/features/auth/components/FormError';
import { FormatPreview } from '@/features/regional/components/FormatPreview';
import {
  useCurrencyOptions,
  useDateFormatOptions,
  useLanguageOptions,
  useNumberFormatOptions,
  useRegionOptions,
  useTimeZoneOptions,
  useWeekdayChoices,
} from '@/features/regional/options';
import { usePreferences } from '@/features/settings/hooks/usePreferences';
import { buildLocaleTag } from '@/i18n/format';
import { useFormatter } from '@/i18n/FormatContext';
import { languageCodeOf } from '@/i18n/languages';
import { getDeviceLocale } from '@/i18n/locale';
import { useRepositories } from '@/providers/DataProvider';
import { showToast } from '@/stores/toastStore';
import type { PreferencesUpdate } from '@/validation/preferences';

/**
 * Regional preferences. Each change is saved immediately to the synced
 * preferences row (works offline; queued for sync) and applies app-wide.
 */
export default function RegionalPreferencesScreen() {
  const { t } = useTranslation();
  const formatter = useFormatter();
  const { preferences } = useRepositories();
  const prefs = usePreferences();
  const s = formatter.settings;

  const currencyOptions = useCurrencyOptions(formatter.numberLocale);
  const regionOptions = useRegionOptions();
  const languageOptions = useLanguageOptions();
  const dateOptions = useDateFormatOptions(s.locale);
  const numberOptions = useNumberFormatOptions(s.locale);
  const weekdayChoices = useWeekdayChoices();
  const timeZoneOptions = useTimeZoneOptions(s.timeZone);

  const save = useMutation({
    mutationFn: (patch: PreferencesUpdate) => preferences.update(patch),
    onSuccess: () => showToast(t('regional.saved'), 'neutral'),
  });

  // The formatting locale follows language + region together.
  const setRegion = (region: string) =>
    save.mutate({ region, locale: buildLocaleTag(s.language, region) });
  const setLanguage = (language: string) =>
    save.mutate({ language, locale: buildLocaleTag(languageCodeOf(language), s.region) });

  return (
    <Screen>
      {!prefs.data && !prefs.isLoading ? (
        <Text variant="bodySmall" tone="warning">
          {t('regional.notSynced')}
        </Text>
      ) : null}
      <FormatPreview formatter={formatter} />
      <OptionPicker
        label={t('regional.region')}
        value={s.region}
        options={regionOptions}
        onChange={setRegion}
        placeholder={t('regional.regionNone')}
        displayValue={s.region ? (findCountry(s.region)?.name ?? s.region) : undefined}
        searchable
      />
      <OptionPicker
        label={t('regional.baseCurrency')}
        value={s.baseCurrency}
        options={currencyOptions}
        onChange={(baseCurrency) => save.mutate({ baseCurrency })}
        hint={t('regional.baseCurrencyHint')}
        searchable
      />
      <OptionPicker
        label={t('regional.language')}
        value={languageCodeOf(s.language)}
        options={languageOptions}
        onChange={setLanguage}
        hint={t('regional.languageHint')}
      />
      <OptionPicker
        label={t('regional.dateFormat')}
        value={s.dateFormat}
        options={dateOptions}
        onChange={(dateFormat) => save.mutate({ dateFormat })}
      />
      <OptionPicker
        label={t('regional.numberFormat')}
        value={s.numberFormat}
        options={numberOptions}
        onChange={(numberFormat) => save.mutate({ numberFormat })}
      />
      <ChoiceChips
        label={t('regional.firstDayOfWeek')}
        value={`${s.firstDayOfWeek}`}
        choices={weekdayChoices}
        onChange={(value) => save.mutate({ firstDayOfWeek: Number(value) as Weekday })}
      />
      <OptionPicker
        label={t('regional.timeZone')}
        value={s.timeZone}
        options={timeZoneOptions}
        onChange={(timeZone) => save.mutate({ timeZone })}
        hint={`${t('regional.timeZoneHint')} ${t('regional.deviceTimeZone', {
          zone: getDeviceLocale().timeZone,
        })}`}
        searchable
      />
      <FormError error={save.error} />
    </Screen>
  );
}
