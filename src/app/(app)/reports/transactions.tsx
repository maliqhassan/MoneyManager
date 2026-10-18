import { type Href, router, Stack, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, View } from 'react-native';

import { Button, Divider, EmptyState, ErrorState, LoadingState, Text } from '@/components/ui';
import type { CurrencyCode } from '@/domain/currency/currencies';
import { useCategoryName } from '@/features/categories/hooks';
import { useRangeLabel } from '@/features/reports/components/ReportParts';
import { useReportLines } from '@/features/reports/hooks';
import { EMPTY_FILTERS, useTransactionFilters } from '@/features/transactions/filterStore';
import { useFormatter } from '@/i18n/FormatContext';
import type { ReportLine, ReportLineQuery } from '@/repositories/types';
import { makeStyles, useTheme } from '@/theme';

const LIMIT = 1000;

/**
 * Drill-down: the exact entries (or split parts) behind a report value, in
 * each transaction's own currency, for the same range and filter the
 * report used. The totals here add up to the report figure.
 */
export default function ReportTransactionsScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const styles = useStyles();
  const formatter = useFormatter();
  const categoryName = useCategoryName();
  const rangeLabel = useRangeLabel();
  const params = useLocalSearchParams<{
    kind?: string;
    title?: string;
    from?: string;
    to?: string;
    categoryId?: string;
    sub?: string;
    merchantKey?: string;
  }>();
  const range = { start: params.from ?? '', end: params.to ?? '' };
  const kind =
    (['income', 'spending', 'category', 'merchant'] as const).find((k) => k === params.kind) ??
    'spending';
  const query: ReportLineQuery = {
    range,
    kind,
    ...(kind === 'category'
      ? { categoryId: params.categoryId || null, includeSubcategories: params.sub === '1' }
      : {}),
    ...(kind === 'merchant' ? { merchantKey: params.merchantKey || null } : {}),
  };
  const lines = useReportLines(query);

  const base = formatter.settings.baseCurrency;
  // The report's own figure: each line converted by the report's policy.
  const baseTotal = (() => {
    const data = lines.data ?? [];
    if (!data.some((l) => l.currency !== base)) return null;
    const missing = [...new Set(data.filter((l) => l.baseMinor === null).map((l) => l.currency))];
    if (missing.length > 0) return { missing: missing.sort(), amount: null };
    const sum = data.reduce(
      (s, l) => s + (kind === 'income' ? (l.baseMinor ?? 0) : -(l.baseMinor ?? 0)),
      0,
    );
    return { missing: [], amount: formatter.money({ amountMinor: sum, currency: base }) };
  })();

  const totals = (() => {
    const map = new Map<CurrencyCode, number>();
    for (const l of lines.data ?? []) {
      // Income as received; spending as spent (refunds reduce it).
      const v = kind === 'income' ? l.amountMinor : -l.amountMinor;
      map.set(l.currency, (map.get(l.currency) ?? 0) + v);
    }
    return [...map.entries()].map(([currency, amountMinor]) =>
      formatter.money({ amountMinor, currency }),
    );
  })();

  if (lines.error) return <ErrorState error={lines.error} onRetry={() => void lines.refetch()} />;
  if (lines.isLoading) return <LoadingState />;

  const openInTransactions =
    kind === 'category' && params.categoryId
      ? () => {
          useTransactionFilters.getState().apply({
            ...EMPTY_FILTERS,
            from: range.start,
            to: range.end,
            categoryIds: [params.categoryId!],
            types: ['expense', 'refund'],
          });
          router.navigate('/transactions' as Href);
        }
      : kind === 'income' || kind === 'spending'
        ? () => {
            useTransactionFilters.getState().apply({
              ...EMPTY_FILTERS,
              from: range.start,
              to: range.end,
              types: kind === 'income' ? ['income'] : ['expense', 'refund'],
            });
            router.navigate('/transactions' as Href);
          }
        : null;

  const renderItem = ({ item }: { item: ReportLine }) => {
    const category = item.categoryName
      ? categoryName({ name: item.categoryName, systemKey: item.categorySystemKey })
      : null;
    const amount = formatter.money(
      { amountMinor: item.amountMinor, currency: item.currency },
      { signDisplay: 'exceptZero' },
    );
    const converted =
      item.currency !== base && item.baseMinor !== null && item.baseMinor !== undefined
        ? t('reports.lines.converted', {
            amount: formatter.money(
              { amountMinor: item.baseMinor, currency: base },
              { signDisplay: 'exceptZero' },
            ),
          })
        : null;
    const meta = [
      formatter.date(item.localDate, 'medium'),
      category,
      item.isSplitLine ? t('reports.lines.splitPart') : null,
      item.accountName,
    ]
      .filter(Boolean)
      .join(' · ');
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${item.payee ?? category ?? ''}, ${meta}, ${amount}${converted ? `, ${converted}` : ''}`}
        onPress={() => router.push(`/transactions/${item.transactionId}` as Href)}
        style={({ pressed }) => [
          styles.row,
          pressed && { backgroundColor: theme.colors.surfaceMuted },
        ]}
      >
        <View style={styles.flex}>
          <Text variant="bodyStrong" numberOfLines={1}>
            {item.payee ?? category ?? '—'}
          </Text>
          <Text variant="bodySmall" tone="textSecondary" numberOfLines={2}>
            {meta}
          </Text>
        </View>
        <View style={styles.amounts}>
          <Text variant="amount" tone={item.amountMinor > 0 ? 'positive' : 'text'}>
            {amount}
          </Text>
          {converted ? (
            <Text variant="caption" tone="textSecondary">
              {converted}
            </Text>
          ) : null}
        </View>
      </Pressable>
    );
  };

  return (
    <>
      <Stack.Screen options={{ title: params.title ?? t('reports.lines.title') }} />
      <FlatList
        style={styles.list}
        data={lines.data ?? []}
        keyExtractor={(l, index) => `${l.transactionId}:${index}`}
        renderItem={renderItem}
        ItemSeparatorComponent={() => <Divider inset={16} />}
        ListHeaderComponent={
          <View style={styles.header}>
            <Text variant="bodySmall" tone="textSecondary">
              {rangeLabel(range)}
            </Text>
            {totals.length > 0 ? (
              <Text variant="bodyStrong">
                {totals.length === 1
                  ? t('reports.lines.total', { amount: totals[0] ?? '' })
                  : t('reports.lines.totalMixed', { amounts: totals.join(', ') })}
              </Text>
            ) : null}
            {baseTotal ? (
              <Text variant="bodySmall" tone={baseTotal.amount ? 'textSecondary' : 'warning'}>
                {baseTotal.amount
                  ? t('reports.lines.baseTotal', { base, amount: baseTotal.amount })
                  : t('reports.lines.baseIncomplete', {
                      base,
                      currencies: baseTotal.missing.join(', '),
                    })}
              </Text>
            ) : null}
            {(lines.data?.length ?? 0) >= LIMIT ? (
              <Text variant="caption" tone="textMuted">
                {t('reports.lines.limit')}
              </Text>
            ) : null}
            {openInTransactions ? (
              <Button
                label={t('reports.categories.openInTransactions')}
                icon="list-outline"
                variant="secondary"
                size="md"
                onPress={openInTransactions}
              />
            ) : null}
          </View>
        }
        ListEmptyComponent={<EmptyState icon="receipt-outline" title={t('reports.lines.empty')} />}
        initialNumToRender={20}
        windowSize={7}
      />
    </>
  );
}

const useStyles = makeStyles((t) => ({
  list: { backgroundColor: t.colors.background },
  header: { padding: t.spacing.lg, gap: t.spacing.sm },
  amounts: { alignItems: 'flex-end', gap: t.spacing.xxs },
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
