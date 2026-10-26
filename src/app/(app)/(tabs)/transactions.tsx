import { type Href, router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  SectionList,
  TextInput,
  View,
} from 'react-native';

import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Icon,
  IconButton,
  Skeleton,
  Text,
} from '@/components/ui';
import type { TransactionType } from '@/domain/enums';
import { normalizeSearchText } from '@/domain/text/search';
import { dayLabel, groupByLocalDate } from '@/domain/transactions/transactions';
import { useCategories, useCategoryName } from '@/features/categories/hooks';
import { TabHeader } from '@/features/navigation/TabHeader';
import { SyncStatusBanner } from '@/features/sync/components/SyncStatusBanner';
import { TransactionRow } from '@/features/transactions/components/TransactionRow';
import { activeFilterCount, useTransactionFilters } from '@/features/transactions/filterStore';
import { useTransactionList } from '@/features/transactions/hooks';
import { useFormatter } from '@/i18n/FormatContext';
import { useData } from '@/providers/DataProvider';
import type { TransactionListItem } from '@/repositories/types';
import { makeStyles, useTheme } from '@/theme';

const SEARCH_DEBOUNCE_MS = 250;

type QuickFilter = 'all' | 'expense' | 'income' | 'recurring';
const QUICK: {
  value: QuickFilter;
  labelKey:
    | 'transactions.filterAll'
    | 'transactions.filterExpenses'
    | 'transactions.filterIncome'
    | 'transactions.filterRecurring';
}[] = [
  { value: 'all', labelKey: 'transactions.filterAll' },
  { value: 'expense', labelKey: 'transactions.filterExpenses' },
  { value: 'income', labelKey: 'transactions.filterIncome' },
  { value: 'recurring', labelKey: 'transactions.filterRecurring' },
];

/** A day's net when every entry is in one currency (mixed currencies: no total). */
function dayTotal(items: readonly TransactionListItem[]) {
  const currency = items[0]?.currency;
  if (!currency || items.some((i) => i.currency !== currency)) return null;
  return { amountMinor: items.reduce((sum, i) => sum + i.amountMinor, 0), currency };
}

/**
 * Activity: search, quick filters (all / expenses / income / recurring) and
 * the advanced filter screen, then entries grouped by day with each day's
 * net. Loads page by page.
 */
export default function TransactionsScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const styles = useStyles();
  const formatter = useFormatter();
  const name = useCategoryName();
  const { syncEngine } = useData();
  const { filters, setSearch, clear } = useTransactionFilters();
  const [searchText, setSearchText] = useState(filters.search);
  const [quick, setQuick] = useState<QuickFilter>('all');
  const categories = useCategories({ includeArchived: true });

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchText), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchText, setSearch]);

  // Category names are matched in their displayed (translated) form too.
  const searchCategoryIds = useMemo(() => {
    const q = normalizeSearchText(filters.search);
    if (!q) return [];
    return (categories.data ?? [])
      .filter((c) => normalizeSearchText(name(c)).includes(q))
      .map((c) => c.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.search, categories.data]);

  // A quick filter narrows the type (it replaces the advanced type filter).
  const types: TransactionType[] | undefined =
    quick === 'expense' ? ['expense'] : quick === 'income' ? ['income'] : filters.types;
  const query = useTransactionList({
    search: filters.search || undefined,
    searchCategoryIds,
    accountIds: filters.accountIds,
    categoryIds: filters.categoryIds,
    types,
    recurringOnly: quick === 'recurring' || undefined,
    from: filters.from ?? undefined,
    to: filters.to ?? undefined,
    minAmount: filters.minAmount || null,
    maxAmount: filters.maxAmount || null,
    tagNames: filters.tagNames,
  });

  const today = formatter.today();
  const rows = useMemo(() => query.data?.pages.flat() ?? [], [query.data]);
  const sections = useMemo(
    () =>
      groupByLocalDate(rows).map((s) => {
        const label = dayLabel(s.localDate, today);
        return {
          key: s.localDate,
          title:
            label.kind === 'today'
              ? t('transactions.today')
              : label.kind === 'yesterday'
                ? t('transactions.yesterday')
                : formatter.date(s.localDate, 'medium'),
          total: dayTotal(s.items),
          data: s.items,
        };
      }),
    [rows, today, t, formatter],
  );

  const openItem = useCallback(
    (item: TransactionListItem) => router.push(`/transactions/${item.id}` as Href),
    [],
  );
  const filterCount = activeFilterCount(filters);
  const isFiltered = filterCount > 0 || filters.search.length > 0 || quick !== 'all';

  const header = (
    <View style={styles.header}>
      <SyncStatusBanner />
      <View style={styles.searchRow}>
        <View style={styles.searchBox}>
          <Icon name="search" size={18} tone="textMuted" />
          <TextInput
            value={searchText}
            onChangeText={setSearchText}
            placeholder={t('transactions.searchPlaceholder')}
            placeholderTextColor={theme.colors.textMuted}
            accessibilityLabel={t('common.search')}
            autoCorrect={false}
            returnKeyType="search"
            style={[styles.searchInput, { color: theme.colors.text }]}
          />
          {searchText ? (
            <IconButton
              icon="close-circle"
              size={18}
              tone="textMuted"
              accessibilityLabel={t('common.close')}
              onPress={() => setSearchText('')}
            />
          ) : null}
        </View>
        <View style={styles.filterButton}>
          <IconButton
            icon="options-outline"
            accessibilityLabel={
              filterCount > 0
                ? `${t('transactions.filters')}, ${t('transactions.filtersActive', { count: filterCount })}`
                : t('transactions.filters')
            }
            onPress={() => router.push('/transactions/filters' as Href)}
          />
          {filterCount > 0 ? (
            <View style={styles.badge} pointerEvents="none">
              <Text variant="caption" style={styles.badgeText}>
                {filterCount}
              </Text>
            </View>
          ) : null}
        </View>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chips}
        accessibilityRole="radiogroup"
      >
        {QUICK.map((q) => {
          const selected = quick === q.value;
          return (
            <Pressable
              key={q.value}
              accessibilityRole="radio"
              accessibilityState={{ selected, checked: selected }}
              onPress={() => setQuick(q.value)}
              style={[styles.chip, selected && styles.chipSelected]}
            >
              <Text variant="label" tone={selected ? 'onPrimary' : 'textSecondary'}>
                {t(q.labelKey)}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
      {filterCount > 0 ? (
        <View style={styles.activeRow}>
          <Badge label={t('transactions.filtersActive', { count: filterCount })} tone="primary" />
          <Button
            label={t('transactions.clearFilters')}
            variant="ghost"
            size="md"
            fullWidth={false}
            onPress={clear}
          />
        </View>
      ) : null}
    </View>
  );

  const title = (
    <TabHeader
      title={t('transactions.activity')}
      right={
        rows.length > 0 ? (
          <Text variant="caption" tone="textSecondary">
            {t('transactions.activityCount', { count: rows.length })}
          </Text>
        ) : null
      }
    />
  );

  if (query.error) {
    return (
      <View style={styles.root}>
        {title}
        {header}
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      </View>
    );
  }

  if (query.isLoading) {
    return (
      <View style={styles.root}>
        {title}
        {header}
        <View style={styles.skeletons}>
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} height={68} radius={20} />
          ))}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      {title}
      <SectionList
        style={styles.root}
        sections={sections}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <TransactionRow item={item} onPress={openItem} variant="card" />}
        renderSectionHeader={({ section }) => (
          <View style={styles.sectionHeader}>
            <Text variant="overline" tone="textSecondary" accessibilityRole="header">
              {section.title}
            </Text>
            {section.total ? (
              <Text variant="caption" tone="textSecondary">
                {formatter.money(section.total, { signDisplay: 'exceptZero' })}
              </Text>
            ) : null}
          </View>
        )}
        stickySectionHeadersEnabled
        ListHeaderComponent={header}
        ListEmptyComponent={
          isFiltered ? (
            <EmptyState
              icon="search-outline"
              title={t('transactions.noResultsTitle')}
              description={t('transactions.noResultsBody')}
              actionLabel={t('transactions.clearFilters')}
              onAction={() => {
                setSearchText('');
                setQuick('all');
                clear();
              }}
            />
          ) : (
            <EmptyState
              icon="receipt-outline"
              title={t('transactions.emptyTitle')}
              description={t('transactions.emptyBody')}
              actionLabel={t('transactions.addFirst')}
              onAction={() => router.push('/transactions/new?type=expense' as Href)}
            />
          )
        }
        ListFooterComponent={
          query.isFetchingNextPage ? (
            <ActivityIndicator
              style={styles.footer}
              color={theme.colors.primary}
              accessibilityLabel={t('transactions.loadMore')}
            />
          ) : (
            <View style={styles.footer} />
          )
        }
        onEndReachedThreshold={0.4}
        onEndReached={() => {
          if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
        }}
        refreshControl={
          <RefreshControl
            refreshing={query.isRefetching && !query.isFetchingNextPage}
            onRefresh={() => void syncEngine.sync().finally(() => query.refetch())}
            tintColor={theme.colors.primary}
          />
        }
        initialNumToRender={15}
        windowSize={11}
        removeClippedSubviews
      />
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  root: { flex: 1, backgroundColor: t.colors.background },
  header: { gap: t.spacing.md, paddingHorizontal: t.spacing.gutter, paddingBottom: t.spacing.sm },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm },
  searchBox: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.sm,
    borderRadius: t.radius.pill,
    backgroundColor: t.colors.surface,
    borderWidth: 1,
    borderColor: t.colors.border,
    paddingStart: t.spacing.lg,
    minHeight: t.minTouchTarget,
  },
  searchInput: { flex: 1, ...t.typography.body, paddingVertical: t.spacing.sm },
  filterButton: {
    borderRadius: t.radius.pill,
    backgroundColor: t.colors.surface,
    borderWidth: 1,
    borderColor: t.colors.border,
  },
  badge: {
    position: 'absolute',
    top: 2,
    end: 2,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    backgroundColor: t.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: t.colors.onPrimary, fontWeight: '700' },
  chips: { gap: t.spacing.sm },
  chip: {
    minHeight: 40,
    justifyContent: 'center',
    paddingHorizontal: t.spacing.lg,
    borderRadius: t.radius.pill,
    backgroundColor: t.colors.surface,
    borderWidth: 1,
    borderColor: t.colors.border,
  },
  chipSelected: { backgroundColor: t.colors.primary, borderColor: t.colors.primary },
  activeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: t.colors.background,
    paddingHorizontal: t.spacing.gutter,
    paddingTop: t.spacing.lg,
    paddingBottom: t.spacing.sm,
  },
  skeletons: { gap: t.spacing.sm, paddingHorizontal: t.spacing.gutter },
  footer: { padding: t.spacing.xl },
}));
