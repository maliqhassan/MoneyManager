import { type Href, router, Stack, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Alert, Pressable, View } from 'react-native';

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
import { localTimeInZone } from '@/domain/dates/zoned';
import { CategoryIcon } from '@/features/categories/components/CategoryIcon';
import { useCategoryName } from '@/features/categories/hooks';
import { FormError } from '@/features/auth/components/FormError';
import { ReceiptField } from '@/features/transactions/components/ReceiptField';
import { useTransaction, useTransactionMutations } from '@/features/transactions/hooks';
import { useFormatter } from '@/i18n/FormatContext';
import { showToast } from '@/stores/toastStore';
import { makeStyles } from '@/theme';

export default function TransactionDetailScreen() {
  const { t } = useTranslation();
  const styles = useStyles();
  const formatter = useFormatter();
  const name = useCategoryName();
  const { id } = useLocalSearchParams<{ id: string }>();
  const query = useTransaction(id);
  const { remove, duplicate, addReceipt, removeReceipt } = useTransactionMutations();

  if (query.isLoading) return <LoadingState />;
  if (query.error) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  const detail = query.data;
  if (!detail) {
    return (
      <Screen>
        <EmptyState icon="help-circle-outline" title={t('transactions.detail.notFound')} />
      </Screen>
    );
  }

  const tx = detail.transaction;
  const amount = { amountMinor: tx.amountMinor, currency: tx.currency };
  const time = localTimeInZone(new Date(tx.occurredAt), tx.timeZone);
  const isTransfer = !!detail.transfer;
  const title = isTransfer
    ? t('transactions.types.transfer')
    : tx.payee || name(detail.category, t('transactions.uncategorized'));

  const confirmDelete = () => {
    const date = formatter.date(tx.localDate, 'medium');
    const body = detail.transfer
      ? t('transactions.deleteTransferBody', {
          amount: formatter.money({
            amountMinor: Math.abs(detail.transfer.from.amountMinor),
            currency: detail.transfer.from.currency,
          }),
          from: detail.transfer.from.accountName,
          to: detail.transfer.to.accountName,
          date,
        })
      : t('transactions.deleteBody', { payee: title, amount: formatter.money(amount), date });
    Alert.alert(t('transactions.deleteTitle'), body, [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: () =>
          remove.mutate(id, {
            onSuccess: () => {
              showToast(t('transactions.toast.deleted'));
              router.back();
            },
          }),
      },
    ]);
  };

  const onDuplicate = () =>
    duplicate.mutate(
      {
        id,
        at: {
          localDate: formatter.today(),
          localTime: localTimeInZone(new Date(), formatter.settings.timeZone),
          timeZone: formatter.settings.timeZone,
        },
      },
      {
        onSuccess: (newId) => {
          showToast(t('transactions.toast.duplicated'));
          router.replace(`/transactions/${newId}` as Href);
        },
      },
    );

  const rows: { label: string; value: string }[] = [];
  if (detail.transfer) {
    rows.push({
      label: t('transactions.detail.transferFrom'),
      value: `${detail.transfer.from.accountName} · ${formatter.money({ amountMinor: detail.transfer.from.amountMinor, currency: detail.transfer.from.currency })}`,
    });
    rows.push({
      label: t('transactions.detail.transferTo'),
      value: `${detail.transfer.to.accountName} · ${formatter.money({ amountMinor: detail.transfer.to.amountMinor, currency: detail.transfer.to.currency })}`,
    });
  } else {
    rows.push({
      label: t('transactions.detail.account'),
      value: detail.account.isArchived
        ? t('transactions.detail.archivedAccount', { name: detail.account.name })
        : detail.account.name,
    });
    if (!tx.isSplit) {
      rows.push({
        label: t('transactions.detail.category'),
        value: detail.category
          ? detail.category.isArchived
            ? t('transactions.detail.archivedCategory', { name: name(detail.category) })
            : name(detail.category)
          : t('transactions.uncategorized'),
      });
    }
  }
  rows.push({ label: t('transactions.detail.date'), value: formatter.date(tx.localDate, 'long') });
  rows.push({ label: t('transactions.detail.time'), value: formatter.time(time) });

  return (
    <Screen>
      <Stack.Screen options={{ title: t('transactions.detailTitle') }} />
      <Card>
        <View style={styles.hero}>
          {isTransfer ? (
            <View style={styles.transferIcon}>
              <Icon name="swap-horizontal" tone="textSecondary" />
            </View>
          ) : (
            <CategoryIcon
              icon={tx.isSplit ? 'git-branch-outline' : detail.category?.icon}
              color={detail.category?.color}
              size={48}
            />
          )}
          <View style={styles.heroText}>
            <Text variant="heading" numberOfLines={2}>
              {title}
            </Text>
            <Badge
              label={t(`transactions.types.${tx.type}`)}
              tone={
                tx.type === 'income' || tx.type === 'refund'
                  ? 'positive'
                  : tx.type === 'transfer'
                    ? 'neutral'
                    : 'primary'
              }
            />
          </View>
        </View>
        <MoneyText
          value={
            isTransfer && detail.transfer
              ? {
                  amountMinor: Math.abs(detail.transfer.from.amountMinor),
                  currency: detail.transfer.from.currency,
                }
              : amount
          }
          variant="amountLarge"
          format={{ signDisplay: isTransfer ? 'never' : 'exceptZero' }}
          adjustsFontSizeToFit
          numberOfLines={1}
        />
      </Card>

      <Card padding="none">
        {rows.map((row, index) => (
          <View key={row.label}>
            {index > 0 ? <Divider inset={16} /> : null}
            <View style={styles.row} accessible accessibilityLabel={`${row.label}: ${row.value}`}>
              <Text variant="bodySmall" tone="textSecondary">
                {row.label}
              </Text>
              <Text variant="body" style={styles.rowValue}>
                {row.value}
              </Text>
            </View>
          </View>
        ))}
      </Card>

      {tx.isSplit ? (
        <>
          <SectionHeader title={t('transactions.detail.splitLines')} />
          <Card padding="none">
            {detail.splits.map((split, index) => (
              <View key={split.id}>
                {index > 0 ? <Divider inset={16} /> : null}
                <View style={styles.row}>
                  <Text variant="body" style={styles.flex}>
                    {name(
                      { name: split.categoryName, systemKey: split.categorySystemKey },
                      t('transactions.uncategorized'),
                    )}
                  </Text>
                  <MoneyText value={{ amountMinor: split.amountMinor, currency: tx.currency }} />
                </View>
              </View>
            ))}
          </Card>
        </>
      ) : null}

      {detail.refundOf ? (
        <Pressable
          accessibilityRole="link"
          onPress={() => router.push(`/transactions/${detail.refundOf!.id}` as Href)}
          style={styles.link}
        >
          <Icon name="link-outline" size={18} tone="primary" />
          <Text variant="body" tone="primary" style={styles.flex}>
            {`${t('transactions.detail.refundOf')}: ${detail.refundOf.payee ?? ''} · ${formatter.money({ amountMinor: detail.refundOf.amountMinor, currency: detail.refundOf.currency })}`}
          </Text>
        </Pressable>
      ) : null}

      {tx.notes ? (
        <Card>
          <Text variant="bodySmall" tone="textSecondary">
            {t('transactions.detail.notes')}
          </Text>
          <Text variant="body">{tx.notes}</Text>
        </Card>
      ) : null}

      {detail.tags.length > 0 ? (
        <View
          style={styles.tags}
          accessible
          accessibilityLabel={`${t('transactions.detail.tags')}: ${detail.tags.map((tag) => tag.name).join(', ')}`}
        >
          {detail.tags.map((tag) => (
            <Badge key={tag.id} label={tag.name} tone="primary" />
          ))}
        </View>
      ) : null}

      {!isTransfer ? (
        <ReceiptField
          items={detail.attachments.map((a) => ({
            id: a.id,
            localUri: a.localUri,
            storagePath: a.storagePath,
            mimeType: a.mimeType,
            fileName: a.fileName,
            uploadStatus: a.uploadStatus,
          }))}
          onAdd={async (file) => {
            await addReceipt.mutateAsync({ transactionId: id, file });
          }}
          onRemove={(item) =>
            Alert.alert(t('transactions.fields.removeReceipt'), item.fileName, [
              { text: t('common.cancel'), style: 'cancel' },
              {
                text: t('common.delete'),
                style: 'destructive',
                onPress: () => item.id && removeReceipt.mutate(item.id),
              },
            ])
          }
        />
      ) : null}

      <View style={styles.actions}>
        <Button
          label={t('transactions.actions.edit')}
          icon="create-outline"
          variant="secondary"
          onPress={() => router.push(`/transactions/${id}/edit` as Href)}
        />
        <Button
          label={t('transactions.actions.duplicate')}
          icon="copy-outline"
          variant="secondary"
          loading={duplicate.isPending}
          onPress={onDuplicate}
        />
        {tx.type === 'expense' ? (
          <Button
            label={t('transactions.actions.refund')}
            icon="arrow-undo-outline"
            variant="secondary"
            onPress={() => router.push(`/transactions/new?type=refund&refundOf=${id}` as Href)}
          />
        ) : null}
        <Button
          label={t('transactions.actions.delete')}
          icon="trash-outline"
          variant="destructive"
          loading={remove.isPending}
          onPress={confirmDelete}
        />
        <FormError error={remove.error ?? duplicate.error} />
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
  heroText: { flex: 1, gap: t.spacing.xs },
  transferIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: t.colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: t.spacing.md,
    minHeight: 52,
    paddingHorizontal: t.spacing.lg,
  },
  rowValue: { flexShrink: 1, textAlign: 'right' },
  flex: { flex: 1 },
  link: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.sm,
    minHeight: t.minTouchTarget,
  },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.sm },
  actions: { gap: t.spacing.sm },
}));
