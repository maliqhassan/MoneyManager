import type { PropsWithChildren } from 'react';
import { Pressable, type StyleProp, StyleSheet, View, type ViewStyle } from 'react-native';

import { makeStyles, type SpacingToken, useTheme } from '@/theme';

export interface CardProps extends PropsWithChildren {
  padding?: SpacingToken;
  onPress?: () => void;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
}

/** Surface container. Becomes a single accessible button when `onPress` is set. */
export function Card({
  children,
  padding = 'lg',
  onPress,
  accessibilityLabel,
  accessibilityHint,
  style,
}: CardProps) {
  const theme = useTheme();
  const styles = useStyles();
  const base = [styles.card, { padding: theme.spacing[padding] }, style];

  if (!onPress) return <View style={base}>{children}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      onPress={onPress}
      style={({ pressed }) => [...base, pressed && { backgroundColor: theme.colors.surfaceMuted }]}
    >
      {children}
    </Pressable>
  );
}

const useStyles = makeStyles((t) => ({
  card: {
    backgroundColor: t.colors.surface,
    borderRadius: t.radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: t.colors.border,
    ...t.elevation.low,
  },
}));
