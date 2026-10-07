import { Switch, View } from 'react-native';

import { makeStyles, useTheme } from '@/theme';

import { Text } from './Text';

export interface SwitchRowProps {
  label: string;
  hint?: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
}

/** Labelled switch; the whole row is one accessible switch control. */
export function SwitchRow({ label, hint, value, onValueChange, disabled }: SwitchRowProps) {
  const theme = useTheme();
  const styles = useStyles();
  return (
    <View
      style={styles.row}
      accessible
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ checked: value, disabled: !!disabled }}
      onAccessibilityTap={() => !disabled && onValueChange(!value)}
    >
      <View style={styles.text}>
        <Text variant="body">{label}</Text>
        {hint ? (
          <Text variant="bodySmall" tone="textSecondary">
            {hint}
          </Text>
        ) : null}
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        trackColor={{ true: theme.colors.primary, false: theme.colors.borderStrong }}
        thumbColor={theme.colors.surface}
        importantForAccessibility="no-hide-descendants"
      />
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.md,
    minHeight: t.minTouchTarget,
  },
  text: { flex: 1, gap: t.spacing.xxs },
}));
