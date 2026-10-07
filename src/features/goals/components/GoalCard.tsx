import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import { Badge, Icon, ProgressBar, Text } from '@/components/ui';
import { CategoryIcon } from '@/features/categories/components/CategoryIcon';
import { useFormatter } from '@/i18n/FormatContext';
import type { GoalListItem } from '@/repositories/types';
import { makeStyles, useTheme } from '@/theme';

/** Saved / target with progress; overfunding shown as over 100%, never capped. */
export const GoalCard = memo(function GoalCard({
  item,
  onPress,
}: {
  item: GoalListItem;
  onPress: (item: GoalListItem) => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const styles = useStyles();
  const formatter = useFormatter();
  const { goal, progress } = item;
  const fmt = (amountMinor: number) => formatter.money({ amountMinor, currency: goal.currency });
  const saved = fmt(progress.savedMinor);
  const target = fmt(progress.targetMinor);
  const status = progress.completed
    ? progress.overMinor > 0
      ? t('goals.overTarget', { amount: fmt(progress.overMinor) })
      : t('goals.completed')
    : t('goals.remaining', { amount: fmt(progress.remainingMinor) });
  const dateText = goal.targetDate
    ? progress.daysRemaining !== null && progress.daysRemaining >= 0 && !progress.completed
      ? `${t('goals.targetOn', { date: formatter.date(goal.targetDate, 'medium') })} · ${t('goals.daysLeft', { count: progress.daysRemaining })}`
      : t('goals.targetOn', { date: formatter.date(goal.targetDate, 'medium') })
    : t('goals.noTargetDate');

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('goals.a11y.card', { name: goal.name, saved, target, status })}
      onPress={() => onPress(item)}
      style={({ pressed }) => [
        styles.card,
        pressed && { backgroundColor: theme.colors.surfaceMuted },
      ]}
    >
      <View style={styles.header}>
        <CategoryIcon icon={goal.icon} color={goal.color} size={36} />
        <View style={styles.flex}>
          <Text variant="bodyStrong" numberOfLines={1}>
            {goal.name}
          </Text>
          <Text variant="bodySmall" tone="textSecondary" numberOfLines={1}>
            {dateText}
          </Text>
        </View>
        {progress.completed ? <Badge label={t('goals.completed')} tone="positive" /> : null}
      </View>
      <Text variant="body">{t('goals.savedOf', { saved, target })}</Text>
      <ProgressBar
        valueBasisPoints={progress.progressBasisPoints}
        tone={progress.completed ? 'positive' : 'primary'}
        accessibilityLabel={t('goals.a11y.progress', { name: goal.name })}
      />
      <View style={styles.footer}>
        <Text variant="bodySmall" tone="textSecondary">
          {formatter.percent(progress.progressBasisPoints, 0)}
        </Text>
        <Text variant="bodySmall" tone={progress.completed ? 'positive' : 'textSecondary'}>
          {status}
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
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: t.spacing.md },
  flex: { flex: 1 },
  footer: { flexDirection: 'row', justifyContent: 'space-between', gap: t.spacing.sm },
  warning: { flexDirection: 'row', gap: t.spacing.xs, alignItems: 'flex-start' },
}));
