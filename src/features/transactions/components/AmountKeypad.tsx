import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import { Icon, Text } from '@/components/ui';
import type { KeypadKey } from '@/domain/money/keypad';
import { MAX_FONT_SCALE_DENSE, makeStyles, useTheme } from '@/theme';

/**
 * On-screen number pad for amounts: 1–9, the decimal separator (in the
 * user's number format; absent for currencies without decimals), 0 and
 * delete. Long-press delete clears the amount. Keys are 52 pt tall.
 */
export function AmountKeypad({
  decimal,
  allowDecimal,
  onKey,
}: {
  decimal: string;
  allowDecimal: boolean;
  onKey: (key: KeypadKey) => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const styles = useStyles();

  const digit = (d: KeypadKey) => (
    <Pressable
      key={d}
      accessibilityRole="button"
      accessibilityLabel={d}
      onPress={() => onKey(d)}
      style={({ pressed }) => [
        styles.key,
        pressed && { backgroundColor: theme.colors.surfaceMuted },
      ]}
    >
      <Text variant="heading" maxFontSizeMultiplier={MAX_FONT_SCALE_DENSE}>
        {d}
      </Text>
    </Pressable>
  );

  return (
    <View style={styles.pad}>
      <View style={styles.row}>{(['1', '2', '3'] as const).map(digit)}</View>
      <View style={styles.row}>{(['4', '5', '6'] as const).map(digit)}</View>
      <View style={styles.row}>{(['7', '8', '9'] as const).map(digit)}</View>
      <View style={styles.row}>
        {allowDecimal ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('keypad.decimal')}
            onPress={() => onKey('decimal')}
            style={({ pressed }) => [
              styles.key,
              pressed && { backgroundColor: theme.colors.surfaceMuted },
            ]}
          >
            <Text variant="heading" maxFontSizeMultiplier={MAX_FONT_SCALE_DENSE}>
              {decimal}
            </Text>
          </Pressable>
        ) : (
          <View style={[styles.key, styles.blank]} />
        )}
        {digit('0')}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('keypad.backspace')}
          accessibilityHint={t('keypad.clearHint')}
          onPress={() => onKey('backspace')}
          onLongPress={() => onKey('clear')}
          style={({ pressed }) => [
            styles.key,
            pressed && { backgroundColor: theme.colors.surfaceMuted },
          ]}
        >
          <Icon name="backspace-outline" size={24} tone="textSecondary" />
        </Pressable>
      </View>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  pad: { gap: t.spacing.sm },
  row: { flexDirection: 'row', gap: t.spacing.sm },
  key: {
    flex: 1,
    minHeight: 52,
    borderRadius: t.radius.md,
    backgroundColor: t.colors.surface,
    borderWidth: 1,
    borderColor: t.colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  blank: { backgroundColor: t.colors.background, borderColor: t.colors.background },
}));
