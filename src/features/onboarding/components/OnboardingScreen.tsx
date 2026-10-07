import type { PropsWithChildren, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { IconButton, ProgressBar, Screen, Text } from '@/components/ui';
import { makeStyles } from '@/theme';

import { ONBOARDING_STEPS, type OnboardingStep, stepIndex } from '../model';

export interface OnboardingScreenProps extends PropsWithChildren {
  step: OnboardingStep;
  title: string;
  subtitle?: string;
  onBack?: () => void;
  footer?: ReactNode;
  keyboard?: boolean;
}

/** Shared frame for onboarding steps: progress, back, title, content, pinned action. */
export function OnboardingScreen({
  step,
  title,
  subtitle,
  onBack,
  footer,
  keyboard = false,
  children,
}: OnboardingScreenProps) {
  const { t } = useTranslation();
  const styles = useStyles();
  const index = stepIndex(step);
  const total = ONBOARDING_STEPS.length;
  const progressLabel = t('onboarding.progress', { current: index + 1, total });

  return (
    <Screen edges={['top', 'bottom']} keyboard={keyboard} footer={footer}>
      <View style={styles.topBar}>
        {onBack ? (
          <IconButton icon="chevron-back" accessibilityLabel={t('common.back')} onPress={onBack} />
        ) : (
          <View style={styles.backPlaceholder} />
        )}
        <View style={styles.progress}>
          <ProgressBar
            valueBasisPoints={Math.round(((index + 1) / total) * 10_000)}
            accessibilityLabel={progressLabel}
            height={6}
          />
        </View>
        <Text variant="caption" tone="textSecondary" style={styles.stepText}>
          {`${index + 1}/${total}`}
        </Text>
      </View>
      <View style={styles.header}>
        <Text variant="title">{title}</Text>
        {subtitle ? (
          <Text variant="body" tone="textSecondary">
            {subtitle}
          </Text>
        ) : null}
      </View>
      {children}
    </Screen>
  );
}

const useStyles = makeStyles((t) => ({
  topBar: { flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm },
  backPlaceholder: { width: t.minTouchTarget, height: t.minTouchTarget },
  progress: { flex: 1 },
  stepText: { minWidth: 32, textAlign: 'right' },
  header: { gap: t.spacing.sm, marginTop: t.spacing.sm },
}));
