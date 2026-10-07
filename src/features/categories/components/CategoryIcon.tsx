import Ionicons from '@expo/vector-icons/Ionicons';
import { View } from 'react-native';

import { Icon, type IconName } from '@/components/ui';
import { ACCOUNT_COLORS } from '@/theme';

const FALLBACK_ICON: IconName = 'pricetag-outline';

/** Stored icon names are user data; only render glyphs that exist. */
export function resolveCategoryIcon(icon: string | null | undefined): IconName {
  return icon && icon in Ionicons.glyphMap ? (icon as IconName) : FALLBACK_ICON;
}

export function resolveCategoryColor(color: string | null | undefined): string {
  return color && /^#[0-9A-Fa-f]{6}$/.test(color) ? color : ACCOUNT_COLORS[8];
}

/** Colored circle with a white glyph. Decorative — rows carry the name. */
export function CategoryIcon({
  icon,
  color,
  size = 36,
}: {
  icon: string | null | undefined;
  color: string | null | undefined;
  size?: number;
}) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: resolveCategoryColor(color),
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Icon name={resolveCategoryIcon(icon)} size={size * 0.5} tone="onAccent" />
    </View>
  );
}
