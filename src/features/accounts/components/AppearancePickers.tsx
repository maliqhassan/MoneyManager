import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import { Icon, Text } from '@/components/ui';
import { ACCOUNT_COLORS, makeStyles, useTheme } from '@/theme';

import { ACCOUNT_COLOR_NAMES, ACCOUNT_ICON_CHOICES } from '../meta';

/** Icon grid (radio group). The glyph is shown on the currently chosen color. */
export function AccountIconPicker({
  value,
  color,
  onChange,
}: {
  value: string;
  color: string;
  onChange: (icon: string) => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const styles = useStyles();
  return (
    <View style={styles.section}>
      <Text variant="label" tone="textSecondary">
        {t('accounts.fields.icon')}
      </Text>
      <View style={styles.grid} accessibilityRole="radiogroup">
        {ACCOUNT_ICON_CHOICES.map(({ key, icon }) => {
          const selected = icon === value;
          return (
            <Pressable
              key={key}
              accessibilityRole="radio"
              accessibilityLabel={t(`accounts.icons.${key}`)}
              accessibilityState={{ selected, checked: selected }}
              onPress={() => onChange(icon)}
              style={[
                styles.cell,
                {
                  backgroundColor: selected ? color : theme.colors.surfaceMuted,
                  borderColor: selected ? theme.colors.text : 'transparent',
                },
              ]}
            >
              <Icon name={icon} size={22} tone={selected ? 'onAccent' : 'textSecondary'} />
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/** Color swatches (radio group); selection marked by a check, not color alone. */
export function AccountColorPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (color: string) => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const styles = useStyles();
  return (
    <View style={styles.section}>
      <Text variant="label" tone="textSecondary">
        {t('accounts.fields.color')}
      </Text>
      <View style={styles.grid} accessibilityRole="radiogroup">
        {ACCOUNT_COLORS.map((color, index) => {
          const selected = color.toLowerCase() === value.toLowerCase();
          const name = ACCOUNT_COLOR_NAMES[index] ?? 'slate';
          return (
            <Pressable
              key={color}
              accessibilityRole="radio"
              accessibilityLabel={t(`accounts.colorNames.${name}`)}
              accessibilityState={{ selected, checked: selected }}
              onPress={() => onChange(color)}
              style={[
                styles.cell,
                {
                  backgroundColor: color,
                  borderColor: selected ? theme.colors.text : 'transparent',
                },
              ]}
            >
              {selected ? <Icon name="checkmark" size={22} tone="onAccent" /> : null}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  section: { gap: t.spacing.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.sm },
  cell: {
    width: t.minTouchTarget,
    height: t.minTouchTarget,
    borderRadius: t.minTouchTarget / 2,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
}));
