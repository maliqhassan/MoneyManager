import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Alert, View } from 'react-native';

import {
  Badge,
  Button,
  Card,
  Divider,
  EmptyState,
  ErrorState,
  Icon,
  LoadingState,
  MoneyText,
  Screen,
  SectionHeader,
  Text,
} from '@/components/ui';
import { availableCredit, isLiability } from '@/domain/accounts/accounts';
import { getCurrencyName } from '@/domain/currency/currencies';
import { AccountIcon } from '@/features/accounts/components/AccountIcon';
import { useAccount, useAccountMutations } from '@/features/accounts/hooks/useAccounts';
import { FormError } from '@/features/auth/components/FormError';
import { useFormatter } from '@/i18n/FormatContext';
import { showToast } from '@/stores/toastStore';
import { makeStyles } from '@/theme';

export default function AccountDetailScreen() {
  const { t } = useTranslation();
  const styles = useStyles();
  const formatter = useFormatter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const query = useAccount(id);
  const { setArchived, remove } = useAccountMutations();

  if (query.isLoading) return <LoadingState />;
  if (query.error) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  if (!query.data) {
    return (
      <Screen>
        <EmptyState icon="help-circle-outline" title={t('accounts.detail.notFound')} />
      </Screen>
    );
  }

  const { account, balance, usage } = query.data;
  const liability = isLiability(account.type);
  const credit =
    account.type === 'credit_card' ? availableCredit(account.creditLimitMinor, balance) : null;
  const hasHistory = usage.transactionCount + usage.transferCount > 0;

  const confirmArchive = () =>
    Alert.alert(
      t('accounts.archiveConfirmTitle', { name: account.name }),
      t('accounts.archiveConfirmBody'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.archive'),
          onPress: () =>
            setArchived.mutate(
              { id, archived: true },
              { onSuccess: () => showToast(t('accounts.toast.archived', { name: account.name })) },
            ),
        },
      ],
    );

  const restore = () =>
    setArchived.mutate(
      { id, archived: false },
      { onSuccess: () => showToast(t('accounts.toast.restored', { name: account.name })) },
    );

  const confirmDelete = () =>
    Alert.alert(
      t('accounts.deleteConfirmTitle', { name: account.name }),
      t('accounts.deleteConfirmBody'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: () =>
            remove.mutate(id, {
              onSuccess: () => {
                showToast(t('accounts.toast.deleted', { name: account.name }));
                router.back();
              },
            }),
        },
      ],
    );

  const infoRows: { label: string; value: string }[] = [
    { label: t('accounts.detail.type'), value: t(`accounts.types.${account.type}`) },
    {
      label: t('accounts.detail.currency'),
      value: `${account.currency} · ${getCurrencyName(account.currency)}`,
    },
    {
      label: t('accounts.detail.openingBalance'),
      value: `${formatter.money({ amountMinor: account.openingBalanceMinor, currency: account.currency })} ${t(
        'accounts.detail.asOf',
        { date: formatter.date(account.openingBalanceDate) },
      )}`,
    },
    {
      label: t('accounts.detail.inTotals'),
      value: account.includeInTotals ? t('accounts.detail.yes') : t('accounts.detail.no'),
    },
  ];
  if (account.type === 'credit_card' && account.creditLimitMinor !== null) {
    infoRows.push({
      label: t('accounts.detail.creditLimit'),
      value: formatter.money({ amountMinor: account.creditLimitMinor, currency: account.currency }),
    });
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: account.name }} />

      <Card>
        <View style={styles.hero}>
          <AccountIcon type={account.type} icon={account.icon} color={account.color} size={56} />
          <View style={styles.heroText}>
            <Text variant="heading" numberOfLines={2}>
              {account.name}
            </Text>
            <View style={styles.badges}>
              <Text variant="bodySmall" tone="textSecondary">
                {t(`accounts.types.${account.type}`)}
              </Text>
              {account.isArchived ? <Badge label={t('accounts.archivedBadge')} /> : null}
            </View>
          </View>
        </View>
        <Divider />
        <View style={styles.balance}>
          <Text variant="label" tone="textSecondary">
            {liability && balance.amountMinor < 0
              ? t('accounts.detail.owed')
              : liability && balance.amountMinor > 0
                ? t('accounts.detail.inCredit')
                : t('accounts.detail.balance')}
          </Text>
          <MoneyText value={balance} variant="amountLarge" adjustsFontSizeToFit numberOfLines={1} />
          {credit ? (
            <Text variant="bodySmall" tone="textSecondary">
              {`${t('accounts.detail.availableCredit')}: ${formatter.money(credit)}`}
            </Text>
          ) : null}
        </View>
      </Card>

      {account.isArchived ? (
        <View style={styles.notice} accessibilityRole="text">
          <Icon name="archive-outline" size={18} tone="textSecondary" />
          <Text variant="bodySmall" tone="textSecondary" style={styles.noticeText}>
            {t('accounts.detail.archivedNotice')}
          </Text>
        </View>
      ) : null}

      <Card padding="none">
        {infoRows.map((row, index) => (
          <View key={row.label}>
            {index > 0 ? <Divider inset={16} /> : null}
            <View
              style={styles.infoRow}
              accessible
              accessibilityLabel={`${row.label}: ${row.value}`}
            >
              <Text variant="bodySmall" tone="textSecondary">
                {row.label}
              </Text>
              <Text variant="body" style={styles.infoValue}>
                {row.value}
              </Text>
            </View>
          </View>
        ))}
        {account.notes ? (
          <>
            <Divider inset={16} />
            <View style={styles.notes}>
              <Text variant="bodySmall" tone="textSecondary">
                {t('accounts.detail.notes')}
              </Text>
              <Text variant="body">{account.notes}</Text>
            </View>
          </>
        ) : null}
      </Card>

      <SectionHeader title={t('accounts.detail.transactionsTitle')} />
      <EmptyState
        icon="receipt-outline"
        title={t('accounts.detail.noTransactionsTitle')}
        description={t('accounts.detail.noTransactionsBody')}
      />

      <View style={styles.actions}>
        <Button
          label={t('common.edit')}
          icon="create-outline"
          variant="secondary"
          onPress={() => router.push(`/accounts/${id}/edit`)}
        />
        {account.isArchived ? (
          <Button
            label={t('common.restore')}
            icon="arrow-undo-outline"
            variant="secondary"
            loading={setArchived.isPending}
            onPress={restore}
          />
        ) : (
          <Button
            label={t('common.archive')}
            icon="archive-outline"
            variant="secondary"
            loading={setArchived.isPending}
            onPress={confirmArchive}
          />
        )}
        {hasHistory ? (
          <Text variant="bodySmall" tone="textMuted" align="center">
            {t('accounts.deleteUnavailable')}
          </Text>
        ) : (
          <Button
            label={t('common.delete')}
            icon="trash-outline"
            variant="destructive"
            loading={remove.isPending}
            onPress={confirmDelete}
          />
        )}
        <FormError error={setArchived.error ?? remove.error} />
      </View>
    </Screen>
  );
}

const useStyles = makeStyles((t) => ({
  hero: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.md,
    marginBottom: t.spacing.md,
  },
  heroText: { flex: 1, gap: t.spacing.xxs },
  badges: { flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm },
  balance: { gap: t.spacing.xs, marginTop: t.spacing.md },
  notice: { flexDirection: 'row', gap: t.spacing.sm, alignItems: 'flex-start' },
  noticeText: { flex: 1 },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: t.spacing.md,
    minHeight: 52,
    paddingHorizontal: t.spacing.lg,
  },
  infoValue: { flexShrink: 1, textAlign: 'right' },
  notes: { padding: t.spacing.lg, gap: t.spacing.xs },
  actions: { gap: t.spacing.sm },
}));
