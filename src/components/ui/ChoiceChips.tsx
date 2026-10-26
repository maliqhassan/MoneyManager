import { Pressable, ScrollView, View } from 'react-native';

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
  /** 'scroll': one horizontal row that scrolls (many options); default wraps. */
  layout?: 'wrap' | 'scroll';
}

/** Single-select chips (radio group semantics). The selected chip is filled. */
export function ChoiceChips<V extends string>({
  label,
  value,
  choices,
  onChange,
  disabled = false,
  layout = 'wrap',
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
      {layout === 'scroll' ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.scrollRow}
          accessibilityRole="radiogroup"
          accessibilityLabel={label}
        >
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
                hitSlop={4}
                style={({ pressed }) => [
                  styles.chip,
                  {
                    backgroundColor: selected
                      ? theme.colors.primary
                      : pressed
                        ? theme.colors.surfaceMuted
                        : theme.colors.surface,
                    borderColor: selected ? theme.colors.primary : theme.colors.border,
                    opacity: disabled ? 0.5 : 1,
                  },
                ]}
              >
                {choice.icon ? (
                  <Icon
                    name={choice.icon}
                    size={18}
                    tone={selected ? 'onPrimary' : 'textSecondary'}
                  />
                ) : null}
                <Text
                  variant="label"
                  style={{ color: selected ? theme.colors.onPrimary : theme.colors.textSecondary }}
                >
                  {choice.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      ) : (
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
                hitSlop={4}
                style={({ pressed }) => [
                  styles.chip,
                  {
                    backgroundColor: selected
                      ? theme.colors.primary
                      : pressed
                        ? theme.colors.surfaceMuted
                        : theme.colors.surface,
                    borderColor: selected ? theme.colors.primary : theme.colors.border,
                    opacity: disabled ? 0.5 : 1,
                  },
                ]}
              >
                {choice.icon ? (
                  <Icon
                    name={choice.icon}
                    size={18}
                    tone={selected ? 'onPrimary' : 'textSecondary'}
                  />
                ) : null}
                <Text
                  variant="label"
                  style={{ color: selected ? theme.colors.onPrimary : theme.colors.textSecondary }}
                >
                  {choice.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  container: { gap: t.spacing.xs },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.sm },
  scrollRow: { flexDirection: 'row', gap: t.spacing.sm, paddingVertical: t.spacing.xs },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.xs,
    // 40 pt chip + 4 pt hit slop above and below = 48 pt target.
    minHeight: 40,
    paddingHorizontal: t.spacing.lg,
    borderRadius: t.radius.pill,
    borderWidth: 1,
  },
}));
