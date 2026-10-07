import { ActivityIndicator, Pressable, type PressableProps, StyleSheet, View } from 'react-native';

import { type ColorScheme, makeStyles, useTheme } from '@/theme';

import { Icon, type IconName } from './Icon';
import { Text, type TextTone } from './Text';

type Variant = 'primary' | 'secondary' | 'ghost' | 'destructive';
type Size = 'md' | 'lg';

export interface ButtonProps extends Omit<PressableProps, 'children' | 'style'> {
  label: string;
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: IconName;
  fullWidth?: boolean;
}

const VARIANT_COLORS: Record<
  Variant,
  {
    bg: keyof ColorScheme | null;
    pressed: keyof ColorScheme | null;
    fg: TextTone;
    border?: keyof ColorScheme;
  }
> = {
  primary: { bg: 'primary', pressed: 'primaryPressed', fg: 'onPrimary' },
  secondary: { bg: 'surface', pressed: 'surfaceMuted', fg: 'text', border: 'borderStrong' },
  ghost: { bg: null, pressed: 'surfaceMuted', fg: 'primary' },
  destructive: { bg: 'negativeMuted', pressed: 'surfaceMuted', fg: 'negative' },
};

export function Button({
  label,
  variant = 'primary',
  size = 'lg',
  loading = false,
  disabled,
  icon,
  fullWidth = true,
  accessibilityHint,
  ...rest
}: ButtonProps) {
  const theme = useTheme();
  const styles = useStyles();
  const colors = VARIANT_COLORS[variant];
  const isDisabled = disabled || loading;
  const fg = colors.fg;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!isDisabled, busy: loading }}
      disabled={isDisabled}
      hitSlop={4}
      style={({ pressed }) => [
        styles.base,
        size === 'md' ? styles.md : styles.lg,
        fullWidth && styles.fullWidth,
        {
          backgroundColor:
            pressed && colors.pressed
              ? theme.colors[colors.pressed]
              : colors.bg
                ? theme.colors[colors.bg]
                : 'transparent',
          borderColor: colors.border ? theme.colors[colors.border] : 'transparent',
          opacity: isDisabled && !loading ? 0.5 : 1,
        },
      ]}
      {...rest}
    >
      <View style={styles.content}>
        {loading ? (
          <ActivityIndicator color={theme.colors[fg]} accessibilityElementsHidden />
        ) : icon ? (
          <Icon name={icon} size={20} tone={fg} />
        ) : null}
        <Text variant="bodyStrong" tone={fg} numberOfLines={1}>
          {label}
        </Text>
      </View>
    </Pressable>
  );
}

const useStyles = makeStyles((t) => ({
  base: {
    borderRadius: t.radius.md,
    borderWidth: StyleSheet.hairlineWidth * 2,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: t.spacing.lg,
  },
  md: { minHeight: t.minTouchTarget },
  lg: { minHeight: 52 },
  fullWidth: { alignSelf: 'stretch' },
  content: { flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm },
}));
