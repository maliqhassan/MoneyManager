import { Pressable, View } from 'react-native';

import { makeStyles } from '@/theme';

import { Text } from './Text';

export interface SectionHeaderProps {
  title: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function SectionHeader({ title, actionLabel, onAction }: SectionHeaderProps) {
  const styles = useStyles();
  return (
    <View style={styles.row}>
      <Text variant="heading">{title}</Text>
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
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  action: { minHeight: t.minTouchTarget, justifyContent: 'center' },
}));
