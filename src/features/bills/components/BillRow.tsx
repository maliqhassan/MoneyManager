import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import { Badge, Icon, Text } from '@/components/ui';
import { dueInfo } from '@/domain/planning/bills';
import { CategoryIcon } from '@/features/categories/components/CategoryIcon';
import { useCategoryName } from '@/features/categories/hooks';
import { useFormatter } from '@/i18n/FormatContext';
import type { BillListItem } from '@/repositories/types';
import { makeStyles, useTheme } from '@/theme';

/** "Due in 3 days" / "Due today" / "Overdue by 2 days", in the user's local days. */
export function useDueLabel() {
  const { t } = useTranslation();
  const formatter = useFormatter();
  const today = formatter.today();
  return (dueDate: string) => {
    const info = dueInfo(dueDate, today);
    const text =
      info.status === 'overdue'
        ? t('bills.due.overdue', { count: -info.daysUntil })
        : info.status === 'due_today'
          ? t('bills.due.today')
          : t('bills.due.inDays', { count: info.daysUntil });
    return { ...info, text };
  };
}

/** One bill or subscription with its next due date and amount. */
export const BillRow = memo(function BillRow({
  item,
  onPress,
  showDue = true,
}: {
  item: BillListItem;
  onPress: (item: BillListItem) => void;
  showDue?: boolean;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const styles = useStyles();
  const formatter = useFormatter();
  const dueLabel = useDueLabel();
  const categoryName = useCategoryName();
  const { bill } = item;
  const due = dueLabel(bill.nextDueDate);
  const amount = formatter.money({ amountMinor: bill.amountMinor, currency: bill.currency });
  const shownAmount = bill.isVariableAmount ? `≈ ${amount}` : amount;
  const dueText = !bill.isActive
    ? t('bills.archivedBadge')
    : showDue
      ? `${due.text} · ${formatter.date(bill.nextDueDate, 'medium')}`
      : t('bills.due.on', { date: formatter.date(bill.nextDueDate, 'medium') });
  const meta = [
    item.accountName,
    item.categoryName
      ? categoryName({ name: item.categoryName, systemKey: item.categorySystemKey })
      : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('bills.a11y.row', {
        name: bill.name,
        amount: shownAmount,
        due: dueText,
      })}
      onPress={() => onPress(item)}
      style={({ pressed }) => [
        styles.row,
        pressed && { backgroundColor: theme.colors.surfaceMuted },
      ]}
    >
      {item.categoryIcon || item.categoryColor ? (
        <CategoryIcon icon={item.categoryIcon} color={item.categoryColor} size={40} />
      ) : (
        <View style={styles.icon}>
          <Icon
            name={bill.isSubscription ? 'repeat-outline' : 'receipt-outline'}
            size={20}
            tone="primary"
          />
        </View>
      )}
      <View style={styles.flex}>
        <Text variant="bodyStrong" numberOfLines={1}>
          {bill.name}
        </Text>
        <Text
          variant="bodySmall"
          tone={bill.isActive && due.status === 'overdue' ? 'negative' : 'textSecondary'}
          numberOfLines={1}
        >
          {dueText}
        </Text>
        {meta ? (
          <Text variant="caption" tone="textMuted" numberOfLines={1}>
            {meta}
          </Text>
        ) : null}
      </View>
      <View style={styles.trailing}>
        <Text variant="amount">{shownAmount}</Text>
        {bill.isActive && due.status === 'overdue' ? (
          <Badge label={t('bills.status.overdue')} tone="negative" />
        ) : bill.autopay ? (
          <Badge label={t('bills.autopayBadge')} />
        ) : null}
      </View>
    </Pressable>
  );
});

const useStyles = makeStyles((t) => ({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.md,
    paddingHorizontal: t.spacing.lg,
    paddingVertical: t.spacing.md,
    minHeight: t.minTouchTarget + 8,
  },
  icon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.colors.primaryMuted,
  },
  flex: { flex: 1, gap: 2 },
  trailing: { alignItems: 'flex-end', gap: t.spacing.xxs },
}));
