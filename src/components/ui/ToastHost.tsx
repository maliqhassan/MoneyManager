import { useEffect, useState } from 'react';
import { AccessibilityInfo, Animated, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useToastStore } from '@/stores/toastStore';
import { makeStyles, motion, useTheme } from '@/theme';

import { Icon } from './Icon';
import { Text } from './Text';

const VISIBLE_MS = 2600;

/**
 * Renders the current toast above the tab bar. Announces it to screen
 * readers; slides/fades only when reduce-motion is off.
 */
export function ToastHost() {
  const theme = useTheme();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const current = useToastStore((s) => s.current);
  const dismiss = useToastStore((s) => s.dismiss);
  const [progress] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (!current) return undefined;
    AccessibilityInfo.announceForAccessibility(current.text);
    progress.setValue(0);
    const duration = theme.reduceMotion ? 0 : motion.normal;
    Animated.timing(progress, { toValue: 1, duration, useNativeDriver: true }).start();
    const timer = setTimeout(() => {
      Animated.timing(progress, { toValue: 0, duration, useNativeDriver: true }).start(() =>
        dismiss(current.id),
      );
    }, VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [current, dismiss, progress, theme.reduceMotion]);

  if (!current) return null;
  const translateY = theme.reduceMotion
    ? 0
    : progress.interpolate({ inputRange: [0, 1], outputRange: [16, 0] });

  return (
    <View pointerEvents="none" style={[styles.host, { bottom: insets.bottom + 88 }]}>
      <Animated.View
        style={[styles.toast, { opacity: progress, transform: [{ translateY }] }]}
        accessibilityLiveRegion="polite"
      >
        {current.tone === 'success' ? (
          <Icon name="checkmark-circle" size={20} tone="positive" />
        ) : null}
        <Text variant="label" style={styles.text}>
          {current.text}
        </Text>
      </Animated.View>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  host: { position: 'absolute', start: t.spacing.lg, end: t.spacing.lg, alignItems: 'center' },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.sm,
    backgroundColor: t.colors.surfaceRaised,
    borderColor: t.colors.border,
    borderWidth: 1,
    borderRadius: t.radius.pill,
    paddingHorizontal: t.spacing.lg,
    paddingVertical: t.spacing.md,
    ...t.elevation.medium,
  },
  text: { flexShrink: 1 },
}));
