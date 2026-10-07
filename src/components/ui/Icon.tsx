import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps } from 'react';

import { type ColorScheme, useTheme } from '@/theme';

export type IconName = ComponentProps<typeof Ionicons>['name'];

export interface IconProps {
  name: IconName;
  size?: number;
  tone?: keyof ColorScheme;
  /** Decorative by default; pass a label only when the icon conveys meaning on its own. */
  accessibilityLabel?: string;
}

export function Icon({ name, size = 22, tone = 'text', accessibilityLabel }: IconProps) {
  const theme = useTheme();
  return (
    <Ionicons
      name={name}
      size={size}
      color={theme.colors[tone]}
      accessible={Boolean(accessibilityLabel)}
      accessibilityLabel={accessibilityLabel}
      importantForAccessibility={accessibilityLabel ? 'yes' : 'no-hide-descendants'}
    />
  );
}
