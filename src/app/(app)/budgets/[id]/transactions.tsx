import { type Href, router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, View } from 'react-native';

import { Divider, EmptyState, ErrorState, LoadingState, Text } from '@/components/ui';
import { usePeriodLabel } from '@/features/budgets/components/BudgetCard';
import { useBudgetOverview, useBudgetSpendingLines } from '@/features/budgets/hooks';
import { useCategoryName } from '@/features/categories/hooks';
import { useFormatter } from '@/i18n/FormatContext';
import type { BudgetSpendingLine } from '@/repositories/types';
import { makeStyles, useTheme } from '@/theme';

/**
 * Drill-down: every transaction (or split part) the budget counts for the
 * period, in the transaction's own currency. Virtualised for long periods.
 */
export default function BudgetTransactionsScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const styles = useStyles();
  const formatter = useFormatter();
  const categoryName = useCategoryName();
  const periodLabel = usePeriodLabel();
  const {
    id = '',
    from = '',
    to = '',
  } = useLocalSearchParams<{
    id: string;
    from: string;
    to: string;
  }>();
  const budget = useBudgetOverview(id);
  const lines = useBudgetSpendingLines(id, from, to);

  if (lines.error) return <ErrorState error={lines.error} onRetry={() => void lines.refetch()} />;
  if (lines.isLoading) return <LoadingState />;

  const renderItem = ({ item }: { item: BudgetSpendingLine }) => {
    const category = item.categoryName
      ? categoryName({ name: item.categoryName, systemKey: item.categorySystemKey })
      : t('budgets.detail.uncategorized');
    const amount = formatter.money(
      { amountMinor: -item.amountMinor, currency: item.currency },
      { signDisplay: item.type === 'refund' ? 'exceptZero' : 'auto' },
    );
    const meta = [
      formatter.date(item.localDate, 'medium'),
      category,
      item.isSplitLine ? t('budgets.detail.splitLine') : null,
      item.accountName,
    ]
      .filter(Boolean)
      .join(' · ');
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${item.payee ?? category}, ${meta}, ${amount}`}
        onPress={() => router.push(`/transactions/${item.transactionId}` as Href)}
        style={({ pressed }) => [
          styles.row,
          pressed && { backgroundColor: theme.colors.surfaceMuted },
        ]}
      >
        <View style={styles.flex}>
          <Text variant="bodyStrong" numberOfLines={1}>
            {item.payee ?? category}
          </Text>
          <Text variant="bodySmall" tone="textSecondary" numberOfLines={2}>
            {meta}
          </Text>
        </View>
        <Text variant="amount" tone={item.type === 'refund' ? 'positive' : 'text'}>
          {amount}
        </Text>
      </Pressable>
    );
  };

  return (
    <FlatList
      style={styles.list}
      contentContainerStyle={styles.content}
      data={lines.data ?? []}
      keyExtractor={(l, index) => `${l.transactionId}:${index}`}
      renderItem={renderItem}
      ItemSeparatorComponent={() => <Divider inset={16} />}
      ListHeaderComponent={
        <View style={styles.header}>
          <Text variant="heading">{budget.data?.budget.name ?? ''}</Text>
          {from && to ? (
            <Text variant="bodySmall" tone="textSecondary">
              {periodLabel({ start: from, end: to })}
            </Text>
          ) : null}
        </View>
      }
      ListEmptyComponent={
        <EmptyState icon="receipt-outline" title={t('budgets.detail.transactionsEmpty')} />
      }
      initialNumToRender={20}
      windowSize={7}
    />
  );
}

const useStyles = makeStyles((t) => ({
  list: { backgroundColor: t.colors.background },
  content: { paddingBottom: t.spacing.xxl },
  header: { padding: t.spacing.lg, gap: t.spacing.xxs },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.md,
    paddingHorizontal: t.spacing.lg,
    paddingVertical: t.spacing.md,
    minHeight: t.minTouchTarget + 8,
  },
  flex: { flex: 1 },
}));
