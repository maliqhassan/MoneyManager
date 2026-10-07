import { useEffect, useState } from 'react';
import { ActivityIndicator, Animated, type DimensionValue, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { errorMessageKey } from '@/lib/errors';
import { makeStyles, useTheme } from '@/theme';

import { Button } from './Button';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';

/**
 * Standard loading / empty / error presentations. Every data-driven screen
 * renders exactly one of: content, LoadingState (or Skeleton), EmptyState,
 * ErrorState — never a blank screen.
 */

export interface EmptyStateProps {
  icon: IconName;
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function EmptyState({ icon, title, description, actionLabel, onAction }: EmptyStateProps) {
  const styles = useStyles();
  return (
    <View style={styles.center} accessibilityRole="summary">
      <View style={styles.iconCircle}>
        <Icon name={icon} size={28} tone="primary" />
      </View>
      <Text variant="heading" align="center">
        {title}
      </Text>
      {description ? (
        <Text variant="bodySmall" tone="textSecondary" align="center" style={styles.description}>
          {description}
        </Text>
      ) : null}
      {actionLabel && onAction ? (
        <View style={styles.action}>
          <Button label={actionLabel} onPress={onAction} fullWidth={false} size="md" />
        </View>
      ) : null}
    </View>
  );
}

export interface ErrorStateProps {
  /** The caught error; mapped to a friendly, translated message. Internals are never shown. */
  error: unknown;
  onRetry?: () => void;
  title?: string;
}

export function ErrorState({ error, onRetry, title }: ErrorStateProps) {
  const { t } = useTranslation();
  const styles = useStyles();
  return (
    <View style={styles.center} accessibilityRole="alert">
      <View style={[styles.iconCircle, styles.errorCircle]}>
        <Icon name="alert-circle-outline" size={28} tone="negative" />
      </View>
      <Text variant="heading" align="center">
        {title ?? t('states.errorTitle')}
      </Text>
      <Text variant="bodySmall" tone="textSecondary" align="center" style={styles.description}>
        {t(errorMessageKey(error))}
      </Text>
      {onRetry ? (
        <View style={styles.action}>
          <Button
            label={t('common.retry')}
            onPress={onRetry}
            variant="secondary"
            fullWidth={false}
            size="md"
          />
        </View>
      ) : null}
    </View>
  );
}

export function LoadingState({ label }: { label?: string }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const styles = useStyles();
  const text = label ?? t('common.loading');
  return (
    <View
      style={styles.center}
      accessible
      accessibilityLabel={text}
      accessibilityRole="progressbar"
    >
      <ActivityIndicator size="large" color={theme.colors.primary} />
      <Text variant="bodySmall" tone="textSecondary">
        {text}
      </Text>
    </View>
  );
}

/** Placeholder block shown while content loads. Pulses unless reduce-motion is on. */
export function Skeleton({
  width = '100%',
  height = 16,
  radius,
}: {
  width?: DimensionValue;
  height?: number;
  radius?: number;
}) {
  const theme = useTheme();
  const [opacity] = useState(() => new Animated.Value(1));

  useEffect(() => {
    if (theme.reduceMotion) {
      opacity.setValue(1);
      return undefined;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.5, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity, theme.reduceMotion]);

  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        width,
        height,
        opacity,
        borderRadius: radius ?? theme.radius.sm,
        backgroundColor: theme.colors.skeleton,
      }}
    />
  );
}

const useStyles = makeStyles((t) => ({
  center: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: t.spacing.sm,
    paddingVertical: t.spacing.xxl,
    paddingHorizontal: t.spacing.xl,
  },
  iconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.colors.primaryMuted,
    marginBottom: t.spacing.xs,
  },
  errorCircle: { backgroundColor: t.colors.negativeMuted },
  description: { maxWidth: 320 },
  action: { marginTop: t.spacing.md },
}));
