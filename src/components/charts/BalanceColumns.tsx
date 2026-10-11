import { View } from 'react-native';

import { divideAndRound } from '@/domain/money/decimal';
import type { BalancePoint } from '@/domain/reports/aggregate';
import { makeStyles, useTheme } from '@/theme';

const PLOT_HEIGHT = 96;

const scaled = (value: number, scale: number) =>
  scale <= 0
    ? 0
    : Number(
        divideAndRound(BigInt(value) * BigInt(PLOT_HEIGHT), BigInt(scale), 'half-away-from-zero'),
      );

/**
 * One account's balance at the sample dates on a single axis that includes
 * zero (liabilities go below the line). Dates without a known balance
 * (before the opening-balance date) are drawn as an empty outline, never as
 * zero. The chart is decorative for screen readers: the same values are
 * provided as text by the caller (`accessibilityLabel`).
 */
export function BalanceColumns({
  points,
  accessibilityLabel,
}: {
  points: readonly BalancePoint[];
  accessibilityLabel: string;
}) {
  const theme = useTheme();
  const styles = useStyles();
  const values = points.map((p) => p.balanceMinor).filter((v): v is number => v !== null);
  const maxPos = Math.max(0, ...values);
  const maxNeg = Math.max(0, ...values.map((v) => -v));
  const scale = maxPos + maxNeg;
  const zeroFromBottom = scaled(maxNeg, scale);

  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel}
      style={styles.plot}
    >
      <View style={[styles.zero, { bottom: zeroFromBottom }]} />
      {points.map((p) => (
        <View key={p.date} style={styles.slot}>
          {p.balanceMinor === null ? (
            <View style={[styles.placeholder, { bottom: zeroFromBottom }]} />
          ) : (
            <View
              style={[
                styles.column,
                {
                  backgroundColor: theme.colors.chartIncome,
                  height: Math.max(1, Math.abs(scaled(p.balanceMinor, scale))),
                },
                p.balanceMinor >= 0
                  ? { bottom: zeroFromBottom, borderTopLeftRadius: 2, borderTopRightRadius: 2 }
                  : {
                      top: PLOT_HEIGHT - zeroFromBottom,
                      borderBottomLeftRadius: 2,
                      borderBottomRightRadius: 2,
                    },
              ]}
            />
          )}
        </View>
      ))}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  plot: { height: PLOT_HEIGHT, flexDirection: 'row', gap: 2 },
  slot: { flex: 1, height: PLOT_HEIGHT, alignItems: 'center' },
  column: { position: 'absolute', width: '70%', maxWidth: 14 },
  placeholder: {
    position: 'absolute',
    width: '70%',
    maxWidth: 14,
    height: 12,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: t.colors.borderStrong,
    borderRadius: 2,
  },
  zero: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: t.colors.borderStrong,
  },
}));
