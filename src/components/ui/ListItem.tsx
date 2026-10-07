import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';

import { makeStyles, useTheme } from '@/theme';

import { Icon, type IconName } from './Icon';
import { Text } from './Text';

export interface ListItemProps {
  title: string;
  subtitle?: string;
  icon?: IconName;
  /** Right-aligned content, e.g. an amount or a badge. */
  trailing?: ReactNode;
  onPress?: () => void;
  showChevron?: boolean;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  destructive?: boolean;
  /** For single-choice lists: announces the selected state to screen readers. */
  selected?: boolean;
}

export function ListItem({
  title,
  subtitle,
  icon,
  trailing,
  onPress,
  showChevron = Boolean(onPress),
  accessibilityLabel,
  accessibilityHint,
  destructive = false,
  selected,
}: ListItemProps) {
  const theme = useTheme();
  const styles = useStyles();

  const content = (
    <>
      {icon ? (
        <View style={styles.iconWrap}>
          <Icon name={icon} size={20} tone={destructive ? 'negative' : 'textSecondary'} />
        </View>
      ) : null}
      <View style={styles.body}>
        <Text variant="body" tone={destructive ? 'negative' : 'text'} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="bodySmall" tone="textSecondary" numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {trailing}
      {showChevron ? <Icon name="chevron-forward" size={18} tone="textMuted" /> : null}
    </>
  );

  if (!onPress) {
    return (
      <View style={styles.row} accessible accessibilityLabel={accessibilityLabel}>
        {content}
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole={selected === undefined ? 'button' : 'radio'}
      accessibilityState={selected === undefined ? undefined : { selected, checked: selected }}
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityHint={accessibilityHint}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        pressed && { backgroundColor: theme.colors.surfaceMuted },
      ]}
    >
      {content}
    </Pressable>
  );
}

const useStyles = makeStyles((t) => ({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.md,
    minHeight: 56,
    paddingVertical: t.spacing.sm,
    paddingHorizontal: t.spacing.lg,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: t.radius.md,
    backgroundColor: t.colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { flex: 1, gap: t.spacing.xxs },
}));
