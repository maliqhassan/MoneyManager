import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, RefreshControl, View } from 'react-native';

import {
  Card,
  Divider,
  EmptyState,
  ErrorState,
  Icon,
  IconButton,
  Screen,
  SectionHeader,
  Skeleton,
  Text,
} from '@/components/ui';
import { AccountRow } from '@/features/accounts/components/AccountRow';
import { TotalBalanceCard } from '@/features/accounts/components/TotalBalanceCard';
import { useAccountsOverview } from '@/features/accounts/hooks/useAccounts';
import { makeStyles, useTheme } from '@/theme';

export default function AccountsScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const styles = useStyles();
  const overview = useAccountsOverview();
  const [showArchived, setShowArchived] = useState(false);
  const openNew = () => router.push('/accounts/new');

  const header = (
    <Stack.Screen
      options={{
        headerRight: () => (
          <IconButton icon="add" accessibilityLabel={t('accounts.add')} onPress={openNew} />
        ),
      }}
    />
  );

  if (overview.error) {
    return (
      <Screen>
        {header}
        <ErrorState error={overview.error} onRetry={() => void overview.refetch()} />
      </Screen>
    );
  }

  const data = overview.data;
  if (!data) {
    return (
      <Screen>
        {header}
        <Card>
          <View style={styles.skeleton}>
            <Skeleton width={120} height={14} />
            <Skeleton width={220} height={36} />
          </View>
        </Card>
        <Skeleton height={64} />
        <Skeleton height={64} />
      </Screen>
    );
  }

  if (data.activeCount === 0 && data.archived.length === 0) {
    return (
      <Screen>
        {header}
        <EmptyState
          icon="wallet-outline"
          title={t('accounts.emptyTitle')}
          description={t('accounts.emptyBody')}
          actionLabel={t('accounts.add')}
          onAction={openNew}
        />
      </Screen>
    );
  }

  return (
    <Screen
      refreshControl={
        <RefreshControl
          refreshing={overview.isRefetching}
          onRefresh={() => void overview.refetch()}
          tintColor={theme.colors.primary}
        />
      }
    >
      {header}
      <TotalBalanceCard
        combinedTotal={data.combinedTotal}
        totals={data.totals}
        missingRates={data.missingRates}
        accountCount={data.activeCount}
      />

      {data.groups.map(({ group, items }) => (
        <View key={group} style={styles.section}>
          <SectionHeader title={t(`accounts.groups.${group}`)} />
          <Card padding="none">
            {items.map(({ account, balance }, index) => (
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
      ))}

      {data.archived.length > 0 ? (
        <View style={styles.section}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: showArchived }}
            onPress={() => setShowArchived((v) => !v)}
            style={styles.archivedHeader}
          >
            <Text variant="heading">
              {t('accounts.archivedSection', { count: data.archived.length })}
            </Text>
            <Icon name={showArchived ? 'chevron-up' : 'chevron-down'} tone="textSecondary" />
          </Pressable>
          {showArchived ? (
            <Card padding="none">
              {data.archived.map(({ account, balance }, index) => (
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
          ) : null}
        </View>
      ) : null}

      <Text variant="caption" tone="textMuted">
        {t('balance.excludedNote')}
      </Text>
    </Screen>
  );
}

const useStyles = makeStyles((t) => ({
  skeleton: { gap: t.spacing.sm },
  section: { gap: t.spacing.sm },
  archivedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: t.minTouchTarget,
  },
}));
