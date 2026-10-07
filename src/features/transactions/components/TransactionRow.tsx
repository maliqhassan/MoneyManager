import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import { Badge, Icon, Text } from '@/components/ui';
import { CategoryIcon } from '@/features/categories/components/CategoryIcon';
import { categoryDisplayName } from '@/features/categories/displayName';
import { useFormatter } from '@/i18n/FormatContext';
import type { TransactionListItem } from '@/repositories/types';
import { makeStyles, useTheme } from '@/theme';

/**
 * One transaction in a list. Memoised: rows only re-render when their item
 * changes. Sign is shown explicitly (+/−); color is a secondary cue.
 */
export const TransactionRow = memo(function TransactionRow({
  item,
  onPress,
}: {
  item: TransactionListItem;
  onPress: (item: TransactionListItem) => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const styles = useStyles();
  const formatter = useFormatter();

  const isTransfer = item.type === 'transfer';
  const money = { amountMinor: item.amountMinor, currency: item.currency };
  const amount = formatter.money(money, { signDisplay: 'exceptZero' });
  const category = item.isSplit
    ? t('transactions.splitCount', { count: item.splitCount })
    : categoryDisplayName(
        t,
        { name: item.categoryName, systemKey: item.categorySystemKey },
        t('transactions.uncategorized'),
      );

  const title = isTransfer
    ? item.amountMinor < 0
      ? t('transactions.transferLabel', {
          from: item.accountName,
          to: item.counterpartAccountName ?? '',
        })
      : t('transactions.transferLabel', {
          from: item.counterpartAccountName ?? '',
          to: item.accountName,
        })
    : item.payee || category;
  const subtitle = isTransfer
    ? t('transactions.types.transfer')
    : `${category} · ${item.accountName}`;

  const a11y = isTransfer
    ? t('transactions.a11y.transferRow', {
        from: (item.amountMinor < 0 ? item.accountName : item.counterpartAccountName) ?? '',
        to: (item.amountMinor < 0 ? item.counterpartAccountName : item.accountName) ?? '',
        amount,
      })
    : t('transactions.a11y.row', { payee: title, category, account: item.accountName, amount });

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        item.type === 'refund' ? `${t('transactions.types.refund')}, ${a11y}` : a11y
      }
      onPress={() => onPress(item)}
      style={({ pressed }) => [
        styles.row,
        pressed && { backgroundColor: theme.colors.surfaceMuted },
      ]}
    >
      {isTransfer ? (
        <View style={styles.transferIcon}>
          <Icon name="swap-horizontal" size={18} tone="textSecondary" />
        </View>
      ) : (
        <CategoryIcon
          icon={item.isSplit ? 'git-branch-outline' : item.categoryIcon}
          color={item.categoryColor}
        />
      )}
      <View style={styles.body}>
        <Text variant="bodyStrong" numberOfLines={1}>
          {title}
        </Text>
        <View style={styles.meta}>
          <Text variant="bodySmall" tone="textSecondary" numberOfLines={1} style={styles.metaText}>
            {subtitle}
          </Text>
          {item.type === 'refund' ? (
            <Badge label={t('transactions.types.refund')} tone="positive" />
          ) : null}
          {item.hasReceipt ? <Icon name="attach" size={16} tone="textMuted" /> : null}
        </View>
      </View>
      <Text
        variant="amount"
        tone={isTransfer ? 'textSecondary' : item.amountMinor > 0 ? 'positive' : 'text'}
        numberOfLines={1}
      >
        {amount}
      </Text>
    </Pressable>
  );
});

const useStyles = makeStyles((t) => ({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.md,
    minHeight: 64,
    paddingVertical: t.spacing.sm,
    paddingHorizontal: t.spacing.lg,
  },
  transferIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: t.colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { flex: 1, gap: t.spacing.xxs },
  meta: { flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm },
  metaText: { flexShrink: 1 },
}));
