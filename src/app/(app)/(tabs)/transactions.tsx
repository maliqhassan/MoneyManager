import { type Href, router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, RefreshControl, SectionList, TextInput, View } from 'react-native';

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
import { normalizeSearchText } from '@/domain/text/search';
import { dayLabel, groupByLocalDate } from '@/domain/transactions/transactions';
import { useCategories, useCategoryName } from '@/features/categories/hooks';
import { SyncStatusBanner } from '@/features/sync/components/SyncStatusBanner';
import { TransactionRow } from '@/features/transactions/components/TransactionRow';
import { activeFilterCount, useTransactionFilters } from '@/features/transactions/filterStore';
import { useTransactionList } from '@/features/transactions/hooks';
import { useFormatter } from '@/i18n/FormatContext';
import { useData } from '@/providers/DataProvider';
import type { TransactionListItem } from '@/repositories/types';
import { makeStyles, useTheme } from '@/theme';

const SEARCH_DEBOUNCE_MS = 250;

export default function TransactionsScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const styles = useStyles();
  const formatter = useFormatter();
  const name = useCategoryName();
  const { syncEngine } = useData();
  const { filters, setSearch, clear } = useTransactionFilters();
  const [searchText, setSearchText] = useState(filters.search);
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

  const query = useTransactionList({
    search: filters.search || undefined,
    searchCategoryIds,
    accountIds: filters.accountIds,
    categoryIds: filters.categoryIds,
    types: filters.types,
    from: filters.from ?? undefined,
    to: filters.to ?? undefined,
    minAmount: filters.minAmount || null,
    maxAmount: filters.maxAmount || null,
    tagNames: filters.tagNames,
  });

  const today = formatter.today();
  const sections = useMemo(() => {
    const rows = query.data?.pages.flat() ?? [];
    return groupByLocalDate(rows).map((s) => {
      const label = dayLabel(s.localDate, today);
      return {
        key: s.localDate,
        title:
          label.kind === 'today'
            ? t('transactions.today')
            : label.kind === 'yesterday'
              ? t('transactions.yesterday')
              : formatter.date(s.localDate, 'medium'),
        data: s.items,
      };
    });
  }, [query.data, today, t, formatter]);

  const openItem = useCallback(
    (item: TransactionListItem) => router.push(`/transactions/${item.id}` as Href),
    [],
  );
  const filterCount = activeFilterCount(filters);
  const isFiltered = filterCount > 0 || filters.search.length > 0;

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
        <View>
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

  if (query.error) {
    return (
      <View style={styles.root}>
        {header}
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      </View>
    );
  }

  if (query.isLoading) {
    return (
      <View style={styles.root}>
        {header}
        <View style={styles.skeletons}>
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} height={56} radius={12} />
          ))}
        </View>
      </View>
    );
  }

  return (
    <SectionList
      style={styles.root}
      sections={sections}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => <TransactionRow item={item} onPress={openItem} />}
      renderSectionHeader={({ section }) => (
        <Text
          variant="label"
          tone="textSecondary"
          style={styles.sectionHeader}
          accessibilityRole="header"
        >
          {section.title}
        </Text>
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
        ) : null
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
  );
}

const useStyles = makeStyles((t) => ({
  root: { flex: 1, backgroundColor: t.colors.background },
  header: { gap: t.spacing.sm, padding: t.spacing.lg, paddingBottom: t.spacing.sm },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm },
  searchBox: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.sm,
    borderRadius: t.radius.md,
    backgroundColor: t.colors.surface,
    borderWidth: 1,
    borderColor: t.colors.border,
    paddingStart: t.spacing.md,
    minHeight: t.minTouchTarget,
  },
  searchInput: { flex: 1, ...t.typography.body, paddingVertical: t.spacing.sm },
  badge: {
    position: 'absolute',
    top: 4,
    end: 4,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    backgroundColor: t.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: t.colors.onPrimary, fontWeight: '700' },
  activeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionHeader: {
    backgroundColor: t.colors.background,
    paddingHorizontal: t.spacing.lg,
    paddingTop: t.spacing.md,
    paddingBottom: t.spacing.xs,
  },
  skeletons: { gap: t.spacing.sm, paddingHorizontal: t.spacing.lg },
  footer: { padding: t.spacing.lg },
}));
