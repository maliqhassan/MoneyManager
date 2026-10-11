import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import { Text } from '@/components/ui';
import type { TrendPoint } from '@/domain/reports/aggregate';
import { divideAndRound } from '@/domain/money/decimal';
import { MAX_FONT_SCALE_DENSE, makeStyles, useTheme } from '@/theme';

const PLOT_HEIGHT = 120;

/** Column height in px for a value relative to the chart maximum (display only). */
function heightFor(value: number, max: number): number {
  if (value <= 0 || max <= 0) return 0;
  const px = Number(divideAndRound(BigInt(value) * BigInt(PLOT_HEIGHT), BigInt(max), 'ceil'));
  return Math.max(2, px);
}

export interface MonthlyColumnsProps {
  points: readonly TrendPoint[];
  monthLabel: (point: TrendPoint) => string;
  /** Fully written description of a month (used for screen readers and the selection line). */
  describe: (point: TrendPoint) => string;
  selected: string | null;
  onSelect: (point: TrendPoint) => void;
}

/**
 * Income vs spending per month on ONE axis starting at zero (no dual axis,
 * no truncated baseline). Months before any recorded data are drawn as an
 * empty outline labelled "no data", distinct from a month with zero
 * activity. Identity never relies on colour alone: a legend is always shown
 * and every month has a written description.
 */
export function MonthlyColumns({
  points,
  monthLabel,
  describe,
  selected,
  onSelect,
}: MonthlyColumnsProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const styles = useStyles();
  const max = Math.max(
    0,
    ...points.flatMap((p) =>
      p.status === 'ok' ? [p.summary.incomeMinor, p.summary.spendingMinor] : [],
    ),
  );

  return (
    <View style={styles.container}>
      <View
        style={styles.legend}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <View style={styles.legendItem}>
          <View style={[styles.swatch, { backgroundColor: theme.colors.chartIncome }]} />
          <Text variant="caption" tone="textSecondary">
            {t('reports.legend.income')}
          </Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.swatch, { backgroundColor: theme.colors.chartSpending }]} />
          <Text variant="caption" tone="textSecondary">
            {t('reports.legend.spending')}
          </Text>
        </View>
      </View>
      <View style={styles.plot}>
        {points.map((p) => {
          const isSelected = selected === p.month;
          const unavailable = p.status === 'unavailable';
          return (
            <Pressable
              key={p.month}
              accessibilityRole="button"
              accessibilityState={{ selected: isSelected }}
              accessibilityLabel={describe(p)}
              onPress={() => onSelect(p)}
              style={[styles.group, isSelected && { backgroundColor: theme.colors.surfaceMuted }]}
            >
              <View style={styles.columns}>
                {unavailable ? (
                  <View style={styles.placeholder} />
                ) : (
                  <>
                    <View
                      style={[
                        styles.column,
                        {
                          height: heightFor(p.summary.incomeMinor, max),
                          backgroundColor: theme.colors.chartIncome,
                        },
                      ]}
                    />
                    <View
                      style={[
                        styles.column,
                        {
                          height: heightFor(p.summary.spendingMinor, max),
                          backgroundColor: theme.colors.chartSpending,
                        },
                      ]}
                    />
                  </>
                )}
              </View>
              <View style={styles.zeroLine} />
              <Text
                variant="caption"
                tone={isSelected ? 'text' : 'textMuted'}
                numberOfLines={1}
                maxFontSizeMultiplier={MAX_FONT_SCALE_DENSE}
                style={styles.label}
              >
                {monthLabel(p)}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  container: { gap: t.spacing.sm },
  legend: { flexDirection: 'row', gap: t.spacing.lg, flexWrap: 'wrap' },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: t.spacing.xs },
  swatch: { width: 10, height: 10, borderRadius: 2 },
  plot: { flexDirection: 'row', alignItems: 'flex-end' },
  group: {
    flex: 1,
    alignItems: 'center',
    gap: t.spacing.xxs,
    paddingTop: t.spacing.xs,
    borderRadius: t.radius.sm,
    minHeight: PLOT_HEIGHT + 24,
    justifyContent: 'flex-end',
  },
  columns: {
    height: PLOT_HEIGHT,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 2,
  },
  column: { width: 6, borderTopLeftRadius: 3, borderTopRightRadius: 3 },
  placeholder: {
    width: 14,
    height: 24,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: t.colors.borderStrong,
    borderRadius: 3,
  },
  label: { fontSize: 11 },
  zeroLine: { alignSelf: 'stretch', height: 1, backgroundColor: t.colors.borderStrong },
}));
