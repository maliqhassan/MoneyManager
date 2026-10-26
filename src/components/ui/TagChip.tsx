import { Pressable, View } from 'react-native';

import { MAX_FONT_SCALE_DENSE, makeStyles, useTheme } from '@/theme';

import { Icon } from './Icon';
import { Text } from './Text';

export interface TagChipProps {
  name: string;
  /**
   * 'solid': a tag that is applied (tinted brand);
   * 'outline': a suggestion or an unselected filter.
   */
  variant?: 'solid' | 'outline';
  /** Shows × and removes the tag when pressed. */
  onRemove?: () => void;
  /** Makes the whole chip a button (e.g. add a suggested tag). */
  onPress?: () => void;
  accessibilityLabel?: string;
}

/**
 * One tag, written "#name" with a muted hash so the name leads. 32 pt tall
 * with an 8 pt hit slop (48 pt target). Used wherever tags appear: entry,
 * transaction detail and recurring rules.
 */
export function TagChip({
  name,
  variant = 'solid',
  onRemove,
  onPress,
  accessibilityLabel,
}: TagChipProps) {
  const theme = useTheme();
  const styles = useStyles();
  const solid = variant === 'solid';
  const action = onRemove ?? onPress;

  const body = (
    <>
      {variant === 'outline' && onPress ? (
        <Icon name="add" size={14} tone="primary" />
      ) : (
        <Text
          variant="label"
          tone={solid ? 'primary' : 'textMuted'}
          maxFontSizeMultiplier={MAX_FONT_SCALE_DENSE}
          style={styles.hash}
        >
          #
        </Text>
      )}
      <Text
        variant="label"
        numberOfLines={1}
        maxFontSizeMultiplier={MAX_FONT_SCALE_DENSE}
        style={[styles.name, { color: solid ? theme.colors.onPrimaryMuted : theme.colors.text }]}
      >
        {name}
      </Text>
      {onRemove ? (
        <View style={styles.remove}>
          <Icon name="close" size={12} tone="onPrimaryMuted" />
        </View>
      ) : null}
    </>
  );

  const style = [styles.chip, solid ? styles.solid : styles.outline];
  if (!action) {
    return (
      <View style={style} accessible accessibilityLabel={accessibilityLabel ?? `#${name}`}>
        {body}
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? `#${name}`}
      onPress={action}
      hitSlop={8}
      style={({ pressed }) => [...style, pressed && { opacity: 0.7 }]}
    >
      {body}
    </Pressable>
  );
}

const useStyles = makeStyles((t) => ({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.xxs,
    minHeight: 32,
    maxWidth: 220,
    paddingStart: t.spacing.md,
    paddingEnd: t.spacing.md,
    borderRadius: t.radius.pill,
    borderWidth: 1,
  },
  solid: { backgroundColor: t.colors.primaryMuted, borderColor: t.colors.primaryMuted },
  outline: { backgroundColor: t.colors.surface, borderColor: t.colors.border },
  hash: { opacity: 0.8 },
  name: { flexShrink: 1 },
  remove: {
    width: 18,
    height: 18,
    borderRadius: 9,
    marginStart: t.spacing.xxs,
    marginEnd: -t.spacing.xs,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.colors.surface,
  },
}));
