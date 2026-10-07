import { Pressable, type PressableProps } from 'react-native';

import { type ColorScheme, makeStyles, useTheme } from '@/theme';

import { Icon, type IconName } from './Icon';

export interface IconButtonProps extends Omit<PressableProps, 'children' | 'style'> {
  icon: IconName;
  /** Required: icon-only controls must be named for screen readers. */
  accessibilityLabel: string;
  tone?: keyof ColorScheme;
  size?: number;
}

export function IconButton({ icon, tone = 'text', size = 22, disabled, ...rest }: IconButtonProps) {
  const theme = useTheme();
  const styles = useStyles();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      style={({ pressed }) => [
        styles.base,
        pressed && { backgroundColor: theme.colors.surfaceMuted },
        disabled && { opacity: 0.5 },
      ]}
      {...rest}
    >
      <Icon name={icon} size={size} tone={tone} />
    </Pressable>
  );
}

const useStyles = makeStyles((t) => ({
  base: {
    minWidth: t.minTouchTarget,
    minHeight: t.minTouchTarget,
    borderRadius: t.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
}));
