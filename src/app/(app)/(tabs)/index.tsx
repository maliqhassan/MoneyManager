import { type Href, router } from 'expo-router';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshControl, View } from 'react-native';

import {
  Button,
  Card,
  Divider,
  EmptyState,
  ErrorState,
  Screen,
  SectionHeader,
  Skeleton,
} from '@/components/ui';
import { AccountRow } from '@/features/accounts/components/AccountRow';
import { TotalBalanceCard } from '@/features/accounts/components/TotalBalanceCard';
import { useAccountsOverview } from '@/features/accounts/hooks/useAccounts';
import { CashFlowCard } from '@/features/dashboard/components/CashFlowCard';
import {
  HomeBudgets,
  HomeGoals,
  HomeUpcomingBills,
} from '@/features/dashboard/components/PlanningCards';
import { TopCategoriesCard } from '@/features/dashboard/components/TopCategoriesCard';
import { SyncStatusBanner } from '@/features/sync/components/SyncStatusBanner';
import { TransactionRow } from '@/features/transactions/components/TransactionRow';
import { useHomeInsights, useRecentTransactions } from '@/features/transactions/hooks';
import { useData } from '@/providers/DataProvider';
import type { TransactionListItem } from '@/repositories/types';
import { makeStyles, useTheme } from '@/theme';

const RECENT_ACCOUNTS = 3;
const RECENT_TRANSACTIONS = 5;

/**
 * Home answers "How am I doing financially?" with real local data only —
 * no sample numbers. Every section has its own loading/empty/error state.
 */
export default function HomeScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const styles = useStyles();
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

  const quickActions = (
    <View style={styles.section}>
      <SectionHeader title={t('home.quickActions')} />
      <View style={styles.actions}>
        {(
          [
            ['expense', 'home.addExpense', 'arrow-up-circle-outline'],
            ['income', 'home.addIncome', 'arrow-down-circle-outline'],
            ['transfer', 'home.addTransfer', 'swap-horizontal-outline'],
          ] as const
        ).map(([type, label, icon]) => (
          <View key={type} style={styles.action}>
            <Button
              label={t(label)}
              icon={icon}
              variant="secondary"
              size="md"
              onPress={() => router.push(`/transactions/new?type=${type}` as Href)}
            />
          </View>
        ))}
      </View>
    </View>
  );

  return (
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
        <Card>
          <View style={styles.skeleton}>
            <Skeleton width={120} height={14} />
            <Skeleton width={220} height={36} />
            <Skeleton width={90} height={14} />
          </View>
        </Card>
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
        <TotalBalanceCard
          combinedTotal={data.combinedTotal}
          totals={data.totals}
          missingRates={data.missingRates}
          accountCount={data.activeCount}
        />
      )}

      {data && data.activeCount > 0 ? (
        hasTransactions ? (
          <>
            {insights.data ? (
              <CashFlowCard
                period={insights.data.period}
                summary={insights.data.flow.summary}
                missingRates={insights.data.flow.missingRates}
              />
            ) : insights.error ? (
              <ErrorState error={insights.error} onRetry={() => void insights.refetch()} />
            ) : (
              <Skeleton height={140} radius={16} />
            )}

            {quickActions}

            <HomeBudgets />
            <HomeUpcomingBills />
            <HomeGoals />

            {insights.data ? (
              <View style={styles.section}>
                <SectionHeader title={t('home.topCategories')} />
                <TopCategoriesCard
                  items={insights.data.top.items}
                  categoriesById={insights.data.categoriesById}
                />
              </View>
            ) : null}

            <View style={styles.section}>
              <SectionHeader
                title={t('home.recentTransactions')}
                actionLabel={t('common.seeAll')}
                onAction={() => router.push('/transactions')}
              />
              <Card padding="none">
                {(recent.data ?? []).map((item, index) => (
                  <View key={item.id}>
                    {index > 0 ? <Divider inset={64} /> : null}
                    <TransactionRow item={item} onPress={openTransaction} />
                  </View>
                ))}
              </Card>
            </View>
          </>
        ) : recent.error ? (
          <ErrorState error={recent.error} onRetry={() => void recent.refetch()} />
        ) : recent.isLoading ? (
          <Skeleton height={140} radius={16} />
        ) : (
          <>
            <Card>
              <EmptyState
                icon="pulse-outline"
                title={t('home.activityEmptyTitle')}
                description={t('home.activityEmptyBody')}
                actionLabel={t('transactions.addFirst')}
                onAction={() => router.push('/transactions/new?type=expense' as Href)}
              />
            </Card>
            {quickActions}
            <HomeUpcomingBills />
            <HomeBudgets />
            <HomeGoals />
          </>
        )
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
  );
}

const useStyles = makeStyles((t) => ({
  skeleton: { gap: t.spacing.sm },
  section: { gap: t.spacing.sm },
  actions: { flexDirection: 'row', gap: t.spacing.sm, flexWrap: 'wrap' },
  action: { flexGrow: 1, flexBasis: 100 },
}));
