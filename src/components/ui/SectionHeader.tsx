import { Pressable, View } from 'react-native';

import { makeStyles } from '@/theme';

import { Text } from './Text';

export interface SectionHeaderProps {
  title: string;
  actionLabel?: string;
  onAction?: () => void;
}

/**
 * Section label: short, all caps and letter-spaced in a secondary colour, so
 * sections are clearly separated without competing with the content; an
 * optional text action ("See all") on the right.
 */
export function SectionHeader({ title, actionLabel, onAction }: SectionHeaderProps) {
  const styles = useStyles();
  return (
    <View style={styles.row}>
      <Text variant="overline" tone="textSecondary" accessibilityRole="header" style={styles.title}>
        {title}
      </Text>
      {actionLabel && onAction ? (
        <Pressable accessibilityRole="button" onPress={onAction} hitSlop={12} style={styles.action}>
          <Text variant="label" tone="primary">
            {actionLabel}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 32,
    gap: t.spacing.md,
  },
  title: { flexShrink: 1 },
  action: { minHeight: 32, justifyContent: 'center' },
}));
