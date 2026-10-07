import { router } from 'expo-router';
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
import { SyncStatusBanner } from '@/features/sync/components/SyncStatusBanner';
import { useData } from '@/providers/DataProvider';
import { makeStyles, useTheme } from '@/theme';

const RECENT_ACCOUNTS = 4;

/**
 * Home answers "How am I doing financially?" with real local data only.
 * Activity, budgets and bills sections appear as those features land.
 */
export default function HomeScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const styles = useStyles();
  const { syncEngine } = useData();
  const overview = useAccountsOverview();
  const data = overview.data;

  const refresh = () => {
    void syncEngine.sync().finally(() => overview.refetch());
  };

  const recent = data
    ? data.groups
        .flatMap((g) => g.items)
        .sort((a, b) => b.account.updatedAt.localeCompare(a.account.updatedAt))
        .slice(0, RECENT_ACCOUNTS)
    : [];

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
        <>
          <TotalBalanceCard
            combinedTotal={data.combinedTotal}
            totals={data.totals}
            missingRates={data.missingRates}
            accountCount={data.activeCount}
          />

          <View style={styles.section}>
            <SectionHeader
              title={t('home.accountsTitle')}
              actionLabel={t('common.seeAll')}
              onAction={() => router.push('/accounts')}
            />
            <Card padding="none">
              {recent.map(({ account, balance }, index) => (
                <View key={account.id}>
                  {index > 0 ? <Divider inset={72} /> : null}
                  <AccountRow
                    account={account}
                    balance={balance}
                    onPress={() => router.push(`/accounts/${account.id}`)}
                  />
                </View>
              ))}
            </Card>
          </View>
        </>
      )}

      <View style={styles.section}>
        <SectionHeader title={t('home.quickActions')} />
        <View style={styles.actions}>
          <View style={styles.action}>
            <Button
              label={t('home.addAccount')}
              icon="wallet-outline"
              variant="secondary"
              size="md"
              onPress={() => router.push('/accounts/new')}
            />
          </View>
          <View style={styles.action}>
            <Button
              label={t('home.addTransaction')}
              icon="add-circle-outline"
              variant="secondary"
              size="md"
              onPress={() => router.push('/add')}
            />
          </View>
        </View>
      </View>

      <View style={styles.section}>
        <SectionHeader title={t('home.activityTitle')} />
        <Card>
          <EmptyState
            icon="pulse-outline"
            title={t('home.activityEmptyTitle')}
            description={t('home.activityEmptyBody')}
          />
        </Card>
      </View>
    </Screen>
  );
}

const useStyles = makeStyles((t) => ({
  skeleton: { gap: t.spacing.sm },
  section: { gap: t.spacing.sm },
  actions: { flexDirection: 'row', gap: t.spacing.sm, flexWrap: 'wrap' },
  action: { flexGrow: 1, flexBasis: 150 },
}));
