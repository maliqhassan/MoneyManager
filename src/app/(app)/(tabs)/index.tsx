import { type Href, router } from 'expo-router';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, RefreshControl, View } from 'react-native';

import {
  Card,
  Divider,
  EmptyState,
  ErrorState,
  Screen,
  SectionHeader,
  Skeleton,
  Text,
} from '@/components/ui';
import { AccountRow } from '@/features/accounts/components/AccountRow';
import { useAccountsOverview } from '@/features/accounts/hooks/useAccounts';
import { BalanceHero } from '@/features/dashboard/components/BalanceHero';
import {
  CategorySpendStrip,
  PlanRings,
  SummaryTiles,
} from '@/features/dashboard/components/HomeWidgets';
import { HomeUpcomingBills } from '@/features/dashboard/components/PlanningCards';
import { TabHeader } from '@/features/navigation/TabHeader';
import { SyncStatusBanner } from '@/features/sync/components/SyncStatusBanner';
import { TransactionRow } from '@/features/transactions/components/TransactionRow';
import { useHomeInsights, useRecentTransactions } from '@/features/transactions/hooks';
import { useFormatter } from '@/i18n/FormatContext';
import { useData } from '@/providers/DataProvider';
import type { TransactionListItem } from '@/repositories/types';
import { useSyncStore } from '@/stores/syncStore';
import { makeStyles, useTheme } from '@/theme';

const RECENT_ACCOUNTS = 3;
const RECENT_TRANSACTIONS = 5;

/** "Synced 14:05" / "Syncing…" / "On this device only" under the wordmark; tap to sync. */
function SyncLine() {
  const { t } = useTranslation();
  const formatter = useFormatter();
  const { mode, syncEngine } = useData();
  const phase = useSyncStore((s) => s.phase);
  const lastSyncedAt = useSyncStore((s) => s.lastSyncedAt);
  const text =
    mode === 'local'
      ? t('home.localOnly')
      : phase === 'syncing'
        ? t('home.syncing')
        : lastSyncedAt
          ? t('home.syncedAt', { time: formatter.dateTime(lastSyncedAt) })
          : t('home.notSynced');
  if (mode === 'local') {
    return (
      <Text variant="overline" tone="textSecondary" numberOfLines={1}>
        {text}
      </Text>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityHint={t('home.syncNowHint')}
      onPress={() => void syncEngine.sync()}
      hitSlop={8}
    >
      <Text variant="overline" tone="textSecondary" numberOfLines={1}>
        {text}
      </Text>
    </Pressable>
  );
}

/**
 * Home answers "How am I doing this month?" with real local data only: the
 * balance in a ring of this month's daily spending, spent / income tiles,
 * top categories, budget and goal rings, upcoming bills, recent activity.
 * Every section has its own loading / empty / error state.
 */
export default function HomeScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const styles = useStyles();
  const formatter = useFormatter();
  const { syncEngine } = useData();
  const overview = useAccountsOverview();
  const insights = useHomeInsights();
  const recent = useRecentTransactions(RECENT_TRANSACTIONS);
  const data = overview.data;

  const openTransaction = useCallback(
    (item: TransactionListItem) => router.push(`/transactions/${item.id}` as Href),
    [],
  );
  const refresh = () => {
    void syncEngine.sync().finally(() => {
      void overview.refetch();
      void insights.refetch();
      void recent.refetch();
    });
  };

  const accounts = data
    ? data.groups
        .flatMap((g) => g.items)
        .sort((a, b) => b.account.updatedAt.localeCompare(a.account.updatedAt))
        .slice(0, RECENT_ACCOUNTS)
    : [];
  const hasTransactions = (recent.data?.length ?? 0) > 0;
  const summary = insights.data?.flow.summary ?? null;
  const incomplete = t('home.flowIncomplete', {
    currencies: insights.data?.flow.missingRates.join(', ') ?? '',
  });

  return (
    <View style={styles.root}>
      <TabHeader brand title={t('common.appName')} subtitle={<SyncLine />} />
      <Screen
        edges={[]}
        refreshControl={
          <RefreshControl
            refreshing={overview.isRefetching}
            onRefresh={refresh}
            tintColor={theme.colors.primary}
          />
        }
      >
        <SyncStatusBanner />

        {overview.error ? (
          <ErrorState error={overview.error} onRetry={() => void overview.refetch()} />
        ) : !data ? (
          <View style={styles.heroSkeleton}>
            <Skeleton width={220} height={220} radius={110} />
          </View>
        ) : data.activeCount === 0 ? (
          <Card>
            <EmptyState
              icon="wallet-outline"
              title={t('home.noAccountsTitle')}
              description={t('home.noAccountsBody')}
              actionLabel={t('home.addAccount')}
              onAction={() => router.push('/accounts/new')}
            />
          </Card>
        ) : (
          <BalanceHero
            balance={data.combinedTotal}
            daily={insights.data?.daily ?? null}
            spent={summary?.expenses ?? null}
            net={summary?.net ?? null}
            today={formatter.today()}
          />
        )}

        {data && data.activeCount > 0 ? (
          <>
            {insights.error ? (
              <ErrorState error={insights.error} onRetry={() => void insights.refetch()} />
            ) : (
              <SummaryTiles
                tiles={[
                  {
                    key: 'spent',
                    icon: 'arrow-up-circle-outline',
                    label: t('home.spentThisMonth'),
                    value: summary?.expenses ?? null,
                    note: insights.data ? incomplete : undefined,
                  },
                  {
                    key: 'income',
                    icon: 'arrow-down-circle-outline',
                    label: t('home.incomeThisMonth'),
                    value: summary?.income ?? null,
                    note: insights.data ? incomplete : undefined,
                  },
                ]}
              />
            )}

            {insights.data ? (
              <CategorySpendStrip
                items={insights.data.top.items}
                categoriesById={insights.data.categoriesById}
              />
            ) : null}

            <PlanRings />
            <HomeUpcomingBills />

            <View style={styles.section}>
              <SectionHeader
                title={t('home.recentTransactions')}
                actionLabel={hasTransactions ? t('common.seeAll') : undefined}
                onAction={hasTransactions ? () => router.navigate('/transactions') : undefined}
              />
              {recent.error ? (
                <ErrorState error={recent.error} onRetry={() => void recent.refetch()} />
              ) : recent.isLoading ? (
                <Skeleton height={140} radius={20} />
              ) : hasTransactions ? (
                <Card padding="none">
                  {(recent.data ?? []).map((item, index) => (
                    <View key={item.id}>
                      {index > 0 ? <Divider inset={72} /> : null}
                      <TransactionRow item={item} onPress={openTransaction} />
                    </View>
                  ))}
                </Card>
              ) : (
                <Card>
                  <EmptyState
                    icon="pulse-outline"
                    title={t('home.activityEmptyTitle')}
                    description={t('home.activityEmptyBody')}
                    actionLabel={t('transactions.addFirst')}
                    onAction={() => router.push('/transactions/new?type=expense' as Href)}
                  />
                </Card>
              )}
            </View>
          </>
        ) : null}

        {accounts.length > 0 ? (
          <View style={styles.section}>
            <SectionHeader
              title={t('home.accountsTitle')}
              actionLabel={t('common.seeAll')}
              onAction={() => router.push('/accounts')}
            />
            <Card padding="none">
              {accounts.map(({ account, balance }, index) => (
                <View key={account.id}>
                  {index > 0 ? <Divider inset={72} /> : null}
                  <AccountRow
                    account={account}
                    balance={balance}
                    onPress={() => router.push(`/accounts/${account.id}` as Href)}
                  />
                </View>
              ))}
            </Card>
          </View>
        ) : null}
      </Screen>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  root: { flex: 1, backgroundColor: t.colors.background },
  heroSkeleton: { alignItems: 'center', paddingVertical: t.spacing.xl },
  section: { gap: t.spacing.md },
}));
