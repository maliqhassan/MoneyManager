import { View } from 'react-native';

import { Icon } from '@/components/ui';
import type { AccountType } from '@/domain/enums';

import { resolveAccountColor, resolveAccountIcon } from '../meta';

export interface AccountIconProps {
  type: AccountType;
  icon: string | null;
  color: string | null;
  size?: number;
}

/** Colored circle with a white glyph. Decorative: the row/heading carries the name. */
export function AccountIcon({ type, icon, color, size = 40 }: AccountIconProps) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: resolveAccountColor(type, color),
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Icon name={resolveAccountIcon(type, icon)} size={size * 0.5} tone="onAccent" />
    </View>
  );
}
