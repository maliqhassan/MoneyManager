import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Button, Icon, type IconName, Text } from '@/components/ui';
import { OnboardingScreen } from '@/features/onboarding/components/OnboardingScreen';
import { useOnboarding } from '@/features/onboarding/useOnboarding';
import { makeStyles } from '@/theme';

const PILLARS: { key: 'track' | 'budget' | 'understand' | 'improve'; icon: IconName }[] = [
  { key: 'track', icon: 'wallet-outline' },
  { key: 'budget', icon: 'pie-chart-outline' },
  { key: 'understand', icon: 'bar-chart-outline' },
  { key: 'improve', icon: 'trending-up-outline' },
];

export default function WelcomeStep() {
  const { t } = useTranslation();
  const styles = useStyles();
  const { advance } = useOnboarding();

  return (
    <OnboardingScreen
      step="welcome"
      title={t('onboarding.welcome.title')}
      subtitle={t('onboarding.welcome.subtitle')}
      footer={<Button label={t('onboarding.welcome.start')} onPress={() => advance('welcome')} />}
    >
      <View style={styles.pillars}>
        {PILLARS.map(({ key, icon }, index) => (
          <View key={key} style={styles.pillar} accessible accessibilityRole="text">
            <View style={styles.iconCircle}>
              <Icon name={icon} size={22} tone="primary" />
            </View>
            <View style={styles.pillarText}>
              <Text variant="bodyStrong">{`${index + 1}. ${t(`onboarding.welcome.${key}`)}`}</Text>
              <Text variant="bodySmall" tone="textSecondary">
                {t(`onboarding.welcome.${key}Body`)}
              </Text>
            </View>
          </View>
        ))}
      </View>
    </OnboardingScreen>
  );
}

const useStyles = makeStyles((t) => ({
  pillars: { gap: t.spacing.lg, marginTop: t.spacing.md },
  pillar: { flexDirection: 'row', alignItems: 'center', gap: t.spacing.md },
  iconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: t.colors.primaryMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillarText: { flex: 1, gap: t.spacing.xxs },
}));
