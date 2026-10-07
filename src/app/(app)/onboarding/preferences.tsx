import { useTranslation } from 'react-i18next';

import { Button, ChoiceChips, OptionPicker } from '@/components/ui';
import type { Weekday } from '@/domain/enums';
import { OnboardingScreen } from '@/features/onboarding/components/OnboardingScreen';
import { useOnboarding } from '@/features/onboarding/useOnboarding';
import { FormatPreview } from '@/features/regional/components/FormatPreview';
import {
  useDateFormatOptions,
  useNumberFormatOptions,
  useTimeZoneOptions,
  useWeekdayChoices,
} from '@/features/regional/options';
import { useFormatter } from '@/i18n/FormatContext';

export default function PreferencesStep() {
  const { t } = useTranslation();
  const formatter = useFormatter();
  const { progress, advance, goBack, updateDraft } = useOnboarding();
  const locale = formatter.settings.locale;
  const dateOptions = useDateFormatOptions(locale);
  const numberOptions = useNumberFormatOptions(locale);
  const weekdayChoices = useWeekdayChoices();
  const timeZoneOptions = useTimeZoneOptions(progress?.draft.timeZone ?? 'UTC');
  if (!progress) return null;
  const { draft } = progress;

  return (
    <OnboardingScreen
      step="preferences"
      title={t('onboarding.preferences.title')}
      subtitle={t('onboarding.preferences.subtitle')}
      onBack={() => goBack('region')}
      footer={<Button label={t('common.continue')} onPress={() => advance('preferences')} />}
    >
      <ChoiceChips
        label={t('regional.firstDayOfWeek')}
        value={`${draft.firstDayOfWeek}`}
        choices={weekdayChoices}
        onChange={(value) => updateDraft({ firstDayOfWeek: Number(value) as Weekday })}
      />
      <OptionPicker
        label={t('regional.dateFormat')}
        value={draft.dateFormat}
        options={dateOptions}
        onChange={(value) => updateDraft({ dateFormat: value })}
      />
      <OptionPicker
        label={t('regional.numberFormat')}
        value={draft.numberFormat}
        options={numberOptions}
        onChange={(value) => updateDraft({ numberFormat: value })}
      />
      <OptionPicker
        label={t('regional.timeZone')}
        value={draft.timeZone}
        options={timeZoneOptions}
        onChange={(value) => updateDraft({ timeZone: value })}
        hint={t('regional.timeZoneHint')}
        searchable
      />
      <FormatPreview formatter={formatter} />
    </OnboardingScreen>
  );
}
