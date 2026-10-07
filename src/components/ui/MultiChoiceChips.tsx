import { Pressable, View } from 'react-native';

import { makeStyles, useTheme } from '@/theme';

import { Icon } from './Icon';
import { Text } from './Text';

export interface MultiChoiceChipsProps<V extends string> {
  label?: string;
  values: readonly V[];
  choices: readonly { value: V; label: string }[];
  onChange: (values: V[]) => void;
}

/** Multi-select chips (checkbox semantics); selection is marked with a check, not color alone. */
export function MultiChoiceChips<V extends string>({
  label,
  values,
  choices,
  onChange,
}: MultiChoiceChipsProps<V>) {
  const theme = useTheme();
  const styles = useStyles();
  return (
    <View style={styles.container}>
      {label ? (
        <Text variant="label" tone="textSecondary">
          {label}
        </Text>
      ) : null}
      <View style={styles.row}>
        {choices.map((choice) => {
          const selected = values.includes(choice.value);
          return (
            <Pressable
              key={choice.value}
              accessibilityRole="checkbox"
              accessibilityLabel={choice.label}
              accessibilityState={{ checked: selected }}
              onPress={() =>
                onChange(
                  selected ? values.filter((v) => v !== choice.value) : [...values, choice.value],
                )
              }
              style={({ pressed }) => [
                styles.chip,
                {
                  backgroundColor: selected
                    ? theme.colors.primaryMuted
                    : pressed
                      ? theme.colors.surfaceMuted
                      : theme.colors.surface,
                  borderColor: selected ? theme.colors.primary : theme.colors.borderStrong,
                },
              ]}
            >
              {selected ? <Icon name="checkmark" size={16} tone="onPrimaryMuted" /> : null}
              <Text
                variant="label"
                style={{ color: selected ? theme.colors.onPrimaryMuted : theme.colors.text }}
              >
                {choice.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  container: { gap: t.spacing.xs },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.sm },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.xs,
    minHeight: t.minTouchTarget,
    paddingHorizontal: t.spacing.md,
    borderRadius: t.radius.pill,
    borderWidth: 1,
  },
}));
