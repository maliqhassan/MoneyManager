import { StyleSheet, View } from 'react-native';

import { useTheme } from '@/theme';

export function Divider({ inset = 0 }: { inset?: number }) {
  const theme = useTheme();
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no"
      style={{
        height: StyleSheet.hairlineWidth,
        backgroundColor: theme.colors.border,
        marginStart: inset,
      }}
    />
  );
}
