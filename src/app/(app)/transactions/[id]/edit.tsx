import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from 'react-native';

import { EmptyState, ErrorState, LoadingState, Screen } from '@/components/ui';
import { localTimeInZone } from '@/domain/dates/zoned';
import { normalizeMerchant } from '@/domain/merchants/normalize';
import { useAccounts } from '@/features/accounts/hooks/useAccounts';
import { TransactionForm } from '@/features/transactions/components/TransactionForm';
import { TransferForm } from '@/features/transactions/components/TransferForm';
import {
  formValuesFromDetail,
  toTransactionInput,
  toTransferInput,
} from '@/features/transactions/formSchema';
import { useTransaction, useTransactionMutations } from '@/features/transactions/hooks';
import { useFormatter } from '@/i18n/FormatContext';
import { showToast } from '@/stores/toastStore';

/**
 * Edit a transaction. Transfers are edited as one coherent pair. Dates and
 * times are interpreted in the time zone the transaction was recorded in.
 */
export default function EditTransactionScreen() {
  const { t } = useTranslation();
  const formatter = useFormatter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const query = useTransaction(id);
  const accounts = useAccounts({ includeArchived: true });
  const mutations = useTransactionMutations();
  const decimal = formatter.separators.decimal;
  const detail = query.data;

  const values = useMemo(() => {
    if (!detail) return null;
    const tx = detail.transaction;
    const localTime = localTimeInZone(new Date(tx.occurredAt), tx.timeZone);
    return formValuesFromDetail(
      detail,
      (minor, currency) => formatter.amountForInput({ amountMinor: minor, currency }),
      localTime,
    );
  }, [detail, formatter]);

  if (query.isLoading || accounts.isLoading) return <LoadingState />;
  if (query.error) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  if (!detail || !values) {
    return (
      <Screen>
        <EmptyState icon="help-circle-outline" title={t('transactions.detail.notFound')} />
      </Screen>
    );
  }

  const tz = detail.transaction.timeZone;
  const saved = () => {
    showToast(t('transactions.toast.updated'));
    router.back();
  };

  if (detail.transfer) {
    const transfer = detail.transfer;
    return (
      <Screen keyboard>
        <Stack.Screen options={{ title: t('transactions.editTransferTitle') }} />
        <TransferForm
          accounts={accounts.data ?? []}
          submitLabel={t('common.saveChanges')}
          initialValues={{
            amount: formatter.amountForInput({
              amountMinor: Math.abs(transfer.from.amountMinor),
              currency: transfer.from.currency,
            }),
            received:
              transfer.from.currency === transfer.to.currency
                ? ''
                : formatter.amountForInput({
                    amountMinor: transfer.to.amountMinor,
                    currency: transfer.to.currency,
                  }),
            fromAccountId: transfer.from.accountId,
            toAccountId: transfer.to.accountId,
            localDate: values.localDate,
            localTime: values.localTime,
            notes: detail.transaction.notes ?? '',
          }}
          onSubmit={async (v) => {
            const all = accounts.data ?? [];
            const from = all.find((a) => a.id === v.fromAccountId)!;
            const to = all.find((a) => a.id === v.toAccountId)!;
            await mutations.updateTransfer.mutateAsync({
              transferId: transfer.id,
              input: toTransferInput(v, from.currency, to.currency, decimal, tz),
            });
            saved();
          }}
        />
      </Screen>
    );
  }

  return (
    <Screen keyboard>
      <TransactionForm
        initialValues={values}
        accounts={accounts.data ?? []}
        submitLabel={t('common.saveChanges')}
        receipts={detail.attachments.map((a) => ({
          id: a.id,
          localUri: a.localUri,
          storagePath: a.storagePath,
          mimeType: a.mimeType,
          fileName: a.fileName,
          uploadStatus: a.uploadStatus,
        }))}
        onAddReceipt={async (file) => {
          await mutations.addReceipt.mutateAsync({ transactionId: id, file });
        }}
        onRemoveReceipt={(item) =>
          Alert.alert(t('transactions.fields.removeReceipt'), item.fileName, [
            { text: t('common.cancel'), style: 'cancel' },
            {
              text: t('common.delete'),
              style: 'destructive',
              onPress: () => item.id && mutations.removeReceipt.mutate(item.id),
            },
          ])
        }
        onSubmit={async (v) => {
          const currency = (accounts.data ?? []).find((a) => a.id === v.accountId)?.currency;
          if (!currency) return;
          await mutations.update.mutateAsync({
            id,
            input: toTransactionInput(v, currency, decimal, tz),
          });
          const merchantKey = normalizeMerchant(v.payee);
          if (v.rememberCategory && merchantKey && v.categoryId) {
            await mutations.rememberCategory.mutateAsync({ merchantKey, categoryId: v.categoryId });
          }
          saved();
        }}
      />
    </Screen>
  );
}
