import { Pressable, View } from 'react-native';

import { ShareBar } from '@/components/charts/ShareBar';
import { Icon, Text } from '@/components/ui';
import { makeStyles, useTheme } from '@/theme';

/**
 * A pressable report line: name, amount, optional detail and a bar showing
 * its share. Everything the bar shows is also written, and the whole row
 * is one accessible button that opens the transactions behind it.
 */
export function ReportRow({
  title,
  amount,
  detail,
  barBasisPoints,
  onPress,
}: {
  title: string;
  amount: string;
  detail: string | null;
  barBasisPoints: number;
  onPress: () => void;
}) {
  const theme = useTheme();
  const styles = useStyles();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[title, amount, detail].filter(Boolean).join(', ')}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        pressed && { backgroundColor: theme.colors.surfaceMuted },
      ]}
    >
      <View style={styles.header}>
        <Text variant="body" style={styles.flex} numberOfLines={2}>
          {title}
        </Text>
        <Text variant="amount">{amount}</Text>
        <Icon name="chevron-forward" size={16} tone="textMuted" />
      </View>
      <ShareBar valueBasisPoints={barBasisPoints} />
      {detail ? (
        <Text variant="caption" tone="textSecondary">
          {detail}
        </Text>
      ) : null}
    </Pressable>
  );
}

const useStyles = makeStyles((t) => ({
  row: {
    gap: t.spacing.xs,
    paddingHorizontal: t.spacing.lg,
    paddingVertical: t.spacing.md,
    minHeight: t.minTouchTarget,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm },
  flex: { flex: 1 },
}));
