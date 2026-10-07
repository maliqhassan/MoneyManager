import { Pressable, View } from 'react-native';

import { makeStyles, useTheme } from '@/theme';

import { Icon, type IconName } from './Icon';
import { Text } from './Text';

export interface Choice<V extends string> {
  value: V;
  label: string;
  icon?: IconName;
  accessibilityHint?: string;
}

export interface ChoiceChipsProps<V extends string> {
  label?: string;
  value: V | null;
  choices: readonly Choice<V>[];
  onChange: (value: V) => void;
  disabled?: boolean;
}

/** Single-select chips (radio group semantics). Wraps onto multiple lines. */
export function ChoiceChips<V extends string>({
  label,
  value,
  choices,
  onChange,
  disabled = false,
}: ChoiceChipsProps<V>) {
  const theme = useTheme();
  const styles = useStyles();
  return (
    <View style={styles.container}>
      {label ? (
        <Text variant="label" tone="textSecondary">
          {label}
        </Text>
      ) : null}
      <View style={styles.row} accessibilityRole="radiogroup" accessibilityLabel={label}>
        {choices.map((choice) => {
          const selected = choice.value === value;
          return (
            <Pressable
              key={choice.value}
              accessibilityRole="radio"
              accessibilityLabel={choice.label}
              accessibilityHint={choice.accessibilityHint}
              accessibilityState={{ selected, checked: selected, disabled }}
              disabled={disabled}
              onPress={() => onChange(choice.value)}
              style={({ pressed }) => [
                styles.chip,
                {
                  backgroundColor: selected
                    ? theme.colors.primaryMuted
                    : pressed
                      ? theme.colors.surfaceMuted
                      : theme.colors.surface,
                  borderColor: selected ? theme.colors.primary : theme.colors.borderStrong,
                  opacity: disabled ? 0.5 : 1,
                },
              ]}
            >
              {choice.icon ? (
                <Icon
                  name={choice.icon}
                  size={18}
                  tone={selected ? 'onPrimaryMuted' : 'textSecondary'}
                />
              ) : null}
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
