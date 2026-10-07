import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ChoiceChips, EmptyState, LoadingState, Screen } from '@/components/ui';
import { localTimeInZone } from '@/domain/dates/zoned';
import { normalizeMerchant } from '@/domain/merchants/normalize';
import { useAccounts } from '@/features/accounts/hooks/useAccounts';
import { deleteLocalReceipt } from '@/services/receipts/receiptFiles';
import type { ReceiptItem } from '@/features/transactions/components/ReceiptField';
import { TransactionForm } from '@/features/transactions/components/TransactionForm';
import { TransferForm } from '@/features/transactions/components/TransferForm';
import {
  toTransactionInput,
  toTransferInput,
  type TransactionFormValues,
} from '@/features/transactions/formSchema';
import { useTransaction, useTransactionMutations } from '@/features/transactions/hooks';
import { useFormatter } from '@/i18n/FormatContext';
import { showToast } from '@/stores/toastStore';
import { useSyncStore } from '@/stores/syncStore';
import type { ReceiptFile } from '@/validation/transactions';

type NewType = 'expense' | 'income' | 'refund' | 'transfer';
const TYPES: readonly NewType[] = ['expense', 'income', 'transfer', 'refund'];

/**
 * Create expense / income / refund / transfer. Saves to the local database
 * immediately (works offline) and syncs in the background.
 */
export default function NewTransactionScreen() {
  const { t } = useTranslation();
  const formatter = useFormatter();
  const params = useLocalSearchParams<{ type?: string; accountId?: string; refundOf?: string }>();
  const type: NewType = (TYPES as readonly string[]).includes(params.type ?? '')
    ? (params.type as NewType)
    : 'expense';
  const accounts = useAccounts({ includeArchived: true });
  const refundOf = useTransaction(params.refundOf ?? '');
  const mutations = useTransactionMutations();
  const isOnline = useSyncStore((s) => s.isOnline);
  const [pendingReceipts, setPendingReceipts] = useState<ReceiptFile[]>([]);

  const tz = formatter.settings.timeZone;
  const now = useMemo(
    () => ({ date: formatter.today(), time: localTimeInZone(new Date(), tz) }),
    [formatter, tz],
  );
  const active = useMemo(() => (accounts.data ?? []).filter((a) => !a.isArchived), [accounts.data]);
  const defaultAccount =
    active.find((a) => a.id === params.accountId)?.id ??
    (refundOf.data && !refundOf.data.account.isArchived ? refundOf.data.account.id : undefined) ??
    active[0]?.id ??
    '';

  const done = () => {
    showToast(isOnline ? t('transactions.toast.saved') : t('transactions.toast.savedOffline'));
    router.back();
  };

  const header = (
    <>
      <Stack.Screen options={{ title: t(`transactions.newTitle.${type}`) }} />
      <ChoiceChips
        value={type}
        onChange={(next) => router.setParams({ type: next })}
        choices={TYPES.map((value) => ({ value, label: t(`transactions.types.${value}`) }))}
      />
    </>
  );

  if (accounts.isLoading || (params.refundOf && refundOf.isLoading)) return <LoadingState />;
  if (active.length === 0) {
    return (
      <Screen>
        <EmptyState
          icon="wallet-outline"
          title={t('accounts.emptyTitle')}
          description={t('transactions.errors.noActiveAccounts')}
          actionLabel={t('accounts.add')}
          onAction={() => router.replace('/accounts/new')}
        />
      </Screen>
    );
  }

  if (type === 'transfer') {
    return (
      <Screen keyboard>
        {header}
        <TransferForm
          key="transfer"
          accounts={accounts.data ?? []}
          submitLabel={t('common.save')}
          initialValues={{
            amount: '',
            received: '',
            fromAccountId: defaultAccount,
            toAccountId: active.find((a) => a.id !== defaultAccount)?.id ?? '',
            localDate: now.date,
            localTime: now.time,
            notes: '',
          }}
          onSubmit={async (values) => {
            const from = active.find((a) => a.id === values.fromAccountId)!;
            const to = (accounts.data ?? []).find((a) => a.id === values.toAccountId)!;
            await mutations.createTransfer.mutateAsync(
              toTransferInput(values, from.currency, to.currency, formatter.separators.decimal, tz),
            );
            done();
          }}
        />
      </Screen>
    );
  }

  const original = refundOf.data?.transaction;
  const initialValues: TransactionFormValues = {
    type,
    amount: '',
    accountId: defaultAccount,
    localDate: now.date,
    localTime: now.time,
    payee: type === 'refund' ? (original?.payee ?? '') : '',
    notes: '',
    categoryId: type === 'refund' && original && !original.isSplit ? original.categoryId : null,
    isSplit: false,
    splits: [],
    tagNames: [],
    refundOfTransactionId: type === 'refund' ? (original?.id ?? null) : null,
    rememberCategory: false,
  };

  const receiptItems: ReceiptItem[] = pendingReceipts.map((r) => ({
    localUri: r.localUri,
    mimeType: r.mimeType,
    fileName: r.fileName,
  }));

  return (
    <Screen keyboard>
      {header}
      <TransactionForm
        key={type}
        initialValues={initialValues}
        accounts={accounts.data ?? []}
        submitLabel={t('common.save')}
        receipts={receiptItems}
        onAddReceipt={(file) => setPendingReceipts((list) => [...list, file])}
        onRemoveReceipt={(item) => {
          if (item.localUri) deleteLocalReceipt(item.localUri);
          setPendingReceipts((list) => list.filter((r) => r.localUri !== item.localUri));
        }}
        onSubmit={async (values) => {
          const currency = (accounts.data ?? []).find((a) => a.id === values.accountId)?.currency;
          if (!currency) return;
          const id = await mutations.create.mutateAsync(
            toTransactionInput(values, currency, formatter.separators.decimal, tz),
          );
          const merchantKey = normalizeMerchant(values.payee);
          if (values.rememberCategory && merchantKey && values.categoryId) {
            await mutations.rememberCategory.mutateAsync({
              merchantKey,
              categoryId: values.categoryId,
            });
          }
          for (const file of pendingReceipts) {
            await mutations.addReceipt.mutateAsync({ transactionId: id, file });
          }
          done();
        }}
      />
    </Screen>
  );
}
