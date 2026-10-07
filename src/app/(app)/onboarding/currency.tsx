import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Button, Card, ChoiceChips, OptionPicker, Text } from '@/components/ui';
import { getCurrencyName, POPULAR_CURRENCIES } from '@/domain/currency/currencies';
import { OnboardingScreen } from '@/features/onboarding/components/OnboardingScreen';
import { useOnboarding } from '@/features/onboarding/useOnboarding';
import { useCurrencyOptions } from '@/features/regional/options';
import { useFormatter } from '@/i18n/FormatContext';
import { makeStyles } from '@/theme';

export default function CurrencyStep() {
  const { t } = useTranslation();
  const styles = useStyles();
  const formatter = useFormatter();
  const { progress, advance, goBack, updateDraft } = useOnboarding();
  const options = useCurrencyOptions(formatter.numberLocale);
  if (!progress) return null;
  const currency = progress.draft.currency;

  return (
    <OnboardingScreen
      step="currency"
      title={t('onboarding.currency.title')}
      subtitle={t('onboarding.currency.subtitle')}
      onBack={() => goBack('welcome')}
      footer={<Button label={t('common.continue')} onPress={() => advance('currency')} />}
    >
      <Card>
        <View style={styles.selected} accessible accessibilityRole="summary">
          <Text variant="display" tone="primary">
            {formatter.currencySymbol(currency)}
          </Text>
          <View style={styles.selectedText}>
            <Text variant="heading">{currency}</Text>
            <Text variant="bodySmall" tone="textSecondary">
              {getCurrencyName(currency)}
            </Text>
          </View>
        </View>
      </Card>
      <ChoiceChips
        value={currency}
        onChange={(value) => updateDraft({ currency: value })}
        choices={POPULAR_CURRENCIES.map((code) => ({
          value: code,
          label: `${formatter.currencySymbol(code)} ${code}`,
          accessibilityHint: getCurrencyName(code),
        }))}
      />
      <OptionPicker
        label={t('regional.baseCurrency')}
        value={currency}
        options={options}
        onChange={(value) => updateDraft({ currency: value })}
        searchable
        hint={t('regional.baseCurrencyHint')}
      />
    </OnboardingScreen>
  );
}

const useStyles = makeStyles((t) => ({
  selected: { flexDirection: 'row', alignItems: 'center', gap: t.spacing.lg },
  selectedText: { flex: 1, gap: t.spacing.xxs },
}));
