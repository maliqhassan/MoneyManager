import { ActivityIndicator, Pressable, type PressableProps, View } from 'react-native';

import { type ColorScheme, makeStyles, useTheme } from '@/theme';

import { Icon, type IconName } from './Icon';
import { Text, type TextTone } from './Text';

/**
 * - primary: the one main action of a screen (filled brand colour);
 * - tonal: a secondary action that still needs presence (tinted brand);
 * - secondary: a neutral outlined action;
 * - ghost: a text action (links, "See all");
 * - destructive: deletes or signs out.
 */
type Variant = 'primary' | 'tonal' | 'secondary' | 'ghost' | 'destructive';
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
  tonal: { bg: 'primaryMuted', pressed: 'surfaceMuted', fg: 'primary' },
  secondary: { bg: 'surface', pressed: 'surfaceMuted', fg: 'text', border: 'borderStrong' },
  ghost: { bg: null, pressed: 'surfaceMuted', fg: 'primary' },
  destructive: { bg: 'negativeMuted', pressed: 'surfaceMuted', fg: 'negative' },
};

/**
 * Pill-shaped button, 52 pt (lg) or 48 pt (md) tall. Disabled buttons turn
 * neutral grey (not just faded) so the state reads at a glance; loading shows
 * a spinner and is announced as busy.
 */
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
  const inactive = disabled && !loading;
  const fg: TextTone = inactive && variant !== 'ghost' ? 'textMuted' : colors.fg;

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
            inactive && colors.bg
              ? theme.colors.surfaceMuted
              : pressed && colors.pressed
                ? theme.colors[colors.pressed]
                : colors.bg
                  ? theme.colors[colors.bg]
                  : 'transparent',
          borderColor: colors.border && !inactive ? theme.colors[colors.border] : 'transparent',
          opacity: inactive && variant === 'ghost' ? 0.5 : 1,
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
        <Text variant={size === 'md' ? 'label' : 'bodyStrong'} tone={fg} numberOfLines={1}>
          {label}
        </Text>
      </View>
    </Pressable>
  );
}

const useStyles = makeStyles((t) => ({
  base: {
    borderRadius: t.radius.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: t.spacing.xl,
  },
  md: { minHeight: t.minTouchTarget, paddingHorizontal: t.spacing.lg },
  lg: { minHeight: 52 },
  fullWidth: { alignSelf: 'stretch' },
  content: { flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm },
}));
