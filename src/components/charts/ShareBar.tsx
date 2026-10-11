import { View } from 'react-native';

import { makeStyles, useTheme } from '@/theme';

/**
 * A thin horizontal bar whose length is `valueBasisPoints` of the track
 * (10 000 = full). Purely visual: the value it represents is always written
 * next to it, so it is hidden from screen readers.
 */
export function ShareBar({
  valueBasisPoints,
  tone = 'spending',
}: {
  valueBasisPoints: number;
  tone?: 'spending' | 'income';
}) {
  const theme = useTheme();
  const styles = useStyles();
  const clamped = Math.max(0, Math.min(10_000, valueBasisPoints));
  return (
    <View
      style={styles.track}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <View
        style={[
          styles.fill,
          {
            width: `${clamped / 100}%`,
            backgroundColor:
              tone === 'income' ? theme.colors.chartIncome : theme.colors.chartSpending,
          },
        ]}
      />
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  track: {
    height: 6,
    borderRadius: 3,
    backgroundColor: t.colors.surfaceMuted,
    overflow: 'hidden',
    width: '100%',
  },
  fill: { height: 6, borderRadius: 3, minWidth: 2 },
}));
