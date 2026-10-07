import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Button, Card, Divider, Icon, Text } from '@/components/ui';
import { getCurrencyName } from '@/domain/currency/currencies';
import { findCountry } from '@/domain/regional/countries';
import { useAccount } from '@/features/accounts/hooks/useAccounts';
import { FormError } from '@/features/auth/components/FormError';
import { completeOnboarding } from '@/features/onboarding/completeOnboarding';
import { OnboardingScreen } from '@/features/onboarding/components/OnboardingScreen';
import { useOnboarding } from '@/features/onboarding/useOnboarding';
import { toAppError } from '@/lib/errors';
import { nowIso } from '@/lib/ids';
import { useData } from '@/providers/DataProvider';
import { makeStyles } from '@/theme';

export default function ReadyStep() {
  const { t } = useTranslation();
  const styles = useStyles();
  const { repositories, syncEngine } = useData();
  const { progress, goBack, clear } = useOnboarding();
  const account = useAccount(progress?.accountId ?? '');

  const finish = useMutation({
    mutationFn: async () => {
      if (!progress) return;
      await completeOnboarding(
        { preferences: repositories.preferences, sync: () => syncEngine.sync() },
        progress.draft,
        nowIso(),
      );
      // The gate now switches to the app; local draft is no longer needed.
      clear();
    },
  });

  if (!progress) return null;
  const { draft } = progress;
  const offline = finish.error && toAppError(finish.error).code === 'offline';

  const rows: { label: string; value: string }[] = [
    {
      label: t('onboarding.ready.currency'),
      value: `${draft.currency} · ${getCurrencyName(draft.currency)}`,
    },
    {
      label: t('onboarding.ready.region'),
      value: findCountry(draft.region)?.name ?? t('regional.regionNone'),
    },
    {
      label: t('onboarding.ready.firstDayOfWeek'),
      value: t(`weekdays.${draft.firstDayOfWeek}`),
    },
    {
      label: t('onboarding.ready.firstAccount'),
      value: account.data?.account.name ?? t('onboarding.ready.noAccount'),
    },
  ];

  return (
    <OnboardingScreen
      step="ready"
      title={t('onboarding.ready.title')}
      subtitle={t('onboarding.ready.subtitle')}
      onBack={() => goBack('account')}
      footer={
        <Button
          label={t('onboarding.ready.start')}
          loading={finish.isPending}
          onPress={() => finish.mutate()}
        />
      }
    >
      <Card padding="none">
        {rows.map((row, index) => (
          <View key={row.label}>
            {index > 0 ? <Divider inset={16} /> : null}
            <View style={styles.row} accessible accessibilityLabel={`${row.label}: ${row.value}`}>
              <Text variant="bodySmall" tone="textSecondary">
                {row.label}
              </Text>
              <Text variant="bodyStrong" style={styles.value} numberOfLines={2}>
                {row.value}
              </Text>
            </View>
          </View>
        ))}
      </Card>
      {offline ? (
        <View style={styles.notice} accessibilityRole="alert">
          <Icon name="cloud-offline-outline" size={18} tone="warning" />
          <Text variant="bodySmall" tone="textSecondary" style={styles.noticeText}>
            {t('onboarding.ready.needsConnection')}
          </Text>
        </View>
      ) : (
        <FormError error={finish.error} />
      )}
    </OnboardingScreen>
  );
}

const useStyles = makeStyles((t) => ({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: t.spacing.md,
    minHeight: 56,
    paddingHorizontal: t.spacing.lg,
  },
  value: { flexShrink: 1, textAlign: 'right' },
  notice: { flexDirection: 'row', gap: t.spacing.sm, alignItems: 'flex-start' },
  noticeText: { flex: 1 },
}));
