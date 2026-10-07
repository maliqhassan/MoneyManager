import { useTranslation } from 'react-i18next';

import { Badge, Button, OptionPicker } from '@/components/ui';
import { findCountry } from '@/domain/regional/countries';
import { OnboardingScreen } from '@/features/onboarding/components/OnboardingScreen';
import { useOnboarding } from '@/features/onboarding/useOnboarding';
import { FormatPreview } from '@/features/regional/components/FormatPreview';
import { useRegionOptions } from '@/features/regional/options';
import { useFormatter } from '@/i18n/FormatContext';
import { deviceFormatSettings } from '@/i18n/locale';

/**
 * Region must be explicitly chosen or confirmed. The device setting is only a
 * suggestion — never inferred from IP address.
 */
export default function RegionStep() {
  const { t } = useTranslation();
  const formatter = useFormatter();
  const options = useRegionOptions();
  const { progress, advance, goBack, updateDraft } = useOnboarding();
  if (!progress) return null;

  const region = progress.draft.region;
  const suggested = deviceFormatSettings().region;
  const isSuggestion = region !== null && region === suggested;

  return (
    <OnboardingScreen
      step="region"
      title={t('onboarding.region.title')}
      subtitle={t('onboarding.region.subtitle')}
      onBack={() => goBack('currency')}
      footer={
        <Button label={t('common.continue')} disabled={!region} onPress={() => advance('region')} />
      }
    >
      <OptionPicker
        label={t('regional.region')}
        value={region}
        options={options}
        onChange={(value) => updateDraft({ region: value })}
        placeholder={t('regional.regionNone')}
        displayValue={region ? (findCountry(region)?.name ?? region) : undefined}
        searchable
      />
      {isSuggestion ? <Badge label={t('onboarding.region.suggested')} tone="primary" /> : null}
      {region ? <FormatPreview formatter={formatter} /> : null}
    </OnboardingScreen>
  );
}
