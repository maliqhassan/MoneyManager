import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import { Badge, type BadgeTone, Icon, ProgressBar, type ProgressTone, Text } from '@/components/ui';
import type { BudgetStatus } from '@/domain/finance/budget';
import type { BudgetPeriodResult } from '@/domain/planning/budgets';
import { CategoryIcon } from '@/features/categories/components/CategoryIcon';
import { useFormatter } from '@/i18n/FormatContext';
import type { BudgetListItem } from '@/repositories/types';
import { makeStyles, useTheme } from '@/theme';

export const STATUS_TONE: Record<BudgetStatus, BadgeTone & ProgressTone> = {
  on_track: 'positive',
  warning: 'warning',
  over: 'negative',
};

/** "1 Oct – 31 Oct 2026" for the period. */
export function usePeriodLabel() {
  const { t } = useTranslation();
  const formatter = useFormatter();
  return (p: Pick<BudgetPeriodResult, 'start' | 'end'>) =>
    t('home.periodRange', {
      from: formatter.date(p.start, 'medium'),
      to: formatter.date(p.end, 'medium'),
    });
}

/**
 * One budget: spent of available, progress, remaining and a status that is
 * also written out (never colour alone).
 */
export const BudgetCard = memo(function BudgetCard({
  item,
  onPress,
}: {
  item: BudgetListItem;
  onPress: (item: BudgetListItem) => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const styles = useStyles();
  const formatter = useFormatter();
  const periodLabel = usePeriodLabel();
  const r = item.evaluation.current;
  const currency = item.budget.currency;
  const fmt = (amountMinor: number) => formatter.money({ amountMinor, currency });
  const spent = fmt(Math.max(0, r.spentMinor));
  const available = fmt(r.availableMinor);
  const remaining =
    r.remainingMinor >= 0
      ? t('budgets.remaining', { amount: fmt(r.remainingMinor) })
      : t('budgets.over', { amount: fmt(-r.remainingMinor) });
  const status = t(`budgets.status.${r.status}`);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('budgets.a11y.card', {
        name: item.budget.name,
        status,
        spent,
        budget: available,
        remaining,
      })}
      onPress={() => onPress(item)}
      style={({ pressed }) => [
        styles.card,
        pressed && { backgroundColor: theme.colors.surfaceMuted },
      ]}
    >
      <View style={styles.header}>
        {item.category ? (
          <CategoryIcon icon={item.category.icon} color={item.category.color} size={36} />
        ) : (
          <View style={styles.overallIcon}>
            <Icon name="pie-chart-outline" size={20} tone="primary" />
          </View>
        )}
        <View style={styles.flex}>
          <Text variant="bodyStrong" numberOfLines={1}>
            {item.budget.name}
          </Text>
          <Text variant="bodySmall" tone="textSecondary" numberOfLines={1}>
            {periodLabel(r)}
          </Text>
        </View>
        <Badge label={status} tone={STATUS_TONE[r.status]} />
      </View>

      <Text variant="body">{t('budgets.spentOf', { spent, budget: available })}</Text>
      <ProgressBar
        valueBasisPoints={r.usedBasisPoints}
        tone={STATUS_TONE[r.status]}
        accessibilityLabel={t('budgets.a11y.progress', { name: item.budget.name })}
      />
      <View style={styles.footer}>
        <Text variant="bodySmall" tone="textSecondary">
          {t('budgets.usedPercent', { percent: formatter.percent(r.usedBasisPoints, 0) })}
        </Text>
        <Text variant="bodySmall" tone={r.remainingMinor < 0 ? 'negative' : 'textSecondary'}>
          {remaining}
        </Text>
      </View>
      {item.missingRates.length > 0 ? (
        <View style={styles.warning}>
          <Icon name="information-circle-outline" size={16} tone="warning" />
          <Text variant="caption" tone="textSecondary" style={styles.flex}>
            {t('planning.incompleteRates', { currencies: item.missingRates.join(', ') })}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
});

const useStyles = makeStyles((t) => ({
  card: {
    gap: t.spacing.sm,
    padding: t.spacing.lg,
    borderRadius: t.radius.lg,
    backgroundColor: t.colors.surface,
    borderWidth: 1,
    borderColor: t.colors.border,
    minHeight: t.minTouchTarget,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: t.spacing.md },
  overallIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.colors.primaryMuted,
  },
  flex: { flex: 1 },
  footer: { flexDirection: 'row', justifyContent: 'space-between', gap: t.spacing.sm },
  warning: { flexDirection: 'row', gap: t.spacing.xs, alignItems: 'flex-start' },
}));
