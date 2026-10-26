import { Pressable, View } from 'react-native';

import { MAX_FONT_SCALE_DENSE, makeStyles } from '@/theme';

import { Text } from './Text';

export interface Segment<V extends string> {
  value: V;
  label: string;
}

/**
 * Two to four mutually exclusive options in one pill (e.g. Expense / Income /
 * Transfer). The selected segment is filled with the brand colour. Exposed
 * to screen readers as a radio group.
 */
export function SegmentedControl<V extends string>({
  value,
  segments,
  onChange,
  label,
}: {
  value: V;
  segments: readonly Segment<V>[];
  onChange: (value: V) => void;
  /** Names the group for screen readers. */
  label?: string;
}) {
  const styles = useStyles();
  return (
    <View style={styles.track} accessibilityRole="radiogroup" accessibilityLabel={label}>
      {segments.map((s) => {
        const selected = s.value === value;
        return (
          <Pressable
            key={s.value}
            accessibilityRole="radio"
            accessibilityState={{ selected, checked: selected }}
            accessibilityLabel={s.label}
            onPress={() => onChange(s.value)}
            style={[styles.segment, selected && styles.selected]}
          >
            <Text
              variant="label"
              tone={selected ? 'onPrimary' : 'textSecondary'}
              numberOfLines={1}
              maxFontSizeMultiplier={MAX_FONT_SCALE_DENSE}
            >
              {s.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  track: {
    flexDirection: 'row',
    padding: t.spacing.xs,
    gap: t.spacing.xs,
    borderRadius: t.radius.pill,
    backgroundColor: t.colors.surface,
    borderWidth: 1,
    borderColor: t.colors.border,
  },
  segment: {
    flex: 1,
    minHeight: 44,
    borderRadius: t.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: t.spacing.sm,
  },
  selected: { backgroundColor: t.colors.primary },
}));
