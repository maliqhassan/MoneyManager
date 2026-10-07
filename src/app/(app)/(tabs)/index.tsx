import { useTranslation } from 'react-i18next';
import { RefreshControl, View } from 'react-native';

import { Card, EmptyState, ErrorState, MoneyText, Screen, Skeleton, Text } from '@/components/ui';
import { useBalanceOverview } from '@/features/dashboard/hooks/useBalanceOverview';
import { SyncStatusBanner } from '@/features/sync/components/SyncStatusBanner';
import { makeStyles, useTheme } from '@/theme';

/**
 * Home answers "How am I doing financially?". This foundation renders the
 * real total balance from local data; income/expense, budgets, bills, goals
 * and recent activity sections are added as their features land.
 */
export default function HomeScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const styles = useStyles();
  const { overview, isLoading, error, refetch, isRefetching } = useBalanceOverview();

  const refreshControl = (
    <RefreshControl
      refreshing={isRefetching}
      onRefresh={() => void refetch()}
      tintColor={theme.colors.primary}
    />
  );

  return (
    <Screen refreshControl={refreshControl} edges={[]}>
      <SyncStatusBanner />
      {error ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : isLoading || !overview ? (
        <Card>
          <View style={styles.cardBody}>
            <Skeleton width={120} height={14} />
            <Skeleton width={200} height={36} />
          </View>
        </Card>
      ) : overview.accountCount === 0 ? (
        <EmptyState
          icon="wallet-outline"
          title={t('home.noAccountsTitle')}
          description={t('home.noAccountsBody')}
        />
      ) : (
        <Card>
          <View style={styles.cardBody}>
            <Text variant="label" tone="textSecondary">
              {t('home.totalBalance')}
            </Text>
            <MoneyText
              value={overview.total}
              variant="amountLarge"
              adjustsFontSizeToFit
              numberOfLines={1}
            />
            <Text variant="bodySmall" tone="textSecondary">
              {t('home.accountsCount', { count: overview.accountCount })}
            </Text>
            {overview.missingRates.length > 0 ? (
              <Text variant="bodySmall" tone="warning">
                {t('home.missingRates', { currencies: overview.missingRates.join(', ') })}
              </Text>
            ) : null}
          </View>
        </Card>
      )}
    </Screen>
  );
}

const useStyles = makeStyles((t) => ({
  cardBody: { gap: t.spacing.sm },
}));
