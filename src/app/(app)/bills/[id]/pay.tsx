import { router, useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { EmptyState, ErrorState, LoadingState, Screen, Text } from '@/components/ui';
import { localTimeInZone } from '@/domain/dates/zoned';
import { useAccounts } from '@/features/accounts/hooks/useAccounts';
import { PayBillForm } from '@/features/bills/components/PayBillForm';
import { useBill, useBillLinkCandidates, useBillMutations } from '@/features/bills/hooks';
import { toastSaved } from '@/features/planning/feedback';
import { parsePositiveAmount } from '@/features/transactions/formSchema';
import { useFormatter } from '@/i18n/FormatContext';

/**
 * Mark a bill paid: confirm amount, account, date and category, which
 * become a normal expense — or link an expense already recorded.
 */
export default function PayBillScreen() {
  const { t } = useTranslation();
  const formatter = useFormatter();
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  const query = useBill(id);
  const accounts = useAccounts({ includeArchived: true });
  const candidates = useBillLinkCandidates();
  const { markPaid, linkPayment } = useBillMutations();
  const tz = formatter.settings.timeZone;
  const now = useMemo(() => localTimeInZone(new Date(), tz), [tz]);

  if (query.error) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  if (query.isLoading || accounts.isLoading) return <LoadingState />;
  const bill = query.data?.bill;
  if (!bill) return <EmptyState icon="alert-circle-outline" title={t('states.notFound')} />;

  const active = (accounts.data ?? []).filter((a) => !a.isArchived);
  const account =
    active.find((a) => a.id === bill.accountId) ??
    active.find((a) => a.currency === bill.currency) ??
    active[0];
  const today = formatter.today();
  const accountCurrency = account?.currency ?? bill.currency;

  return (
    <Screen keyboard>
      <Text variant="heading">{bill.name}</Text>
      <Text variant="bodySmall" tone="textSecondary">
        {t('bills.pay.dueDate', { date: formatter.date(bill.nextDueDate, 'medium') })}
      </Text>
      <PayBillForm
        accounts={accounts.data ?? []}
        candidates={candidates.data ?? []}
        initialValues={{
          mode: 'new',
          amount:
            accountCurrency === bill.currency
              ? formatter.amountForInput({ amountMinor: bill.amountMinor, currency: bill.currency })
              : '',
          accountId: account?.id ?? '',
          categoryId: bill.categoryId,
          localDate: today,
          localTime: now,
          notes: '',
          transactionId: null,
        }}
        onSubmit={async (values) => {
          if (values.mode === 'link' && values.transactionId) {
            await linkPayment.mutateAsync({
              id,
              input: { dueDate: bill.nextDueDate, transactionId: values.transactionId },
            });
          } else {
            const currency = (accounts.data ?? []).find((a) => a.id === values.accountId)?.currency;
            const amount = currency
              ? parsePositiveAmount(values.amount, currency, formatter.separators.decimal)
              : null;
            if (!amount?.ok) return;
            await markPaid.mutateAsync({
              id,
              input: {
                dueDate: bill.nextDueDate,
                transaction: {
                  type: 'expense',
                  accountId: values.accountId,
                  amountMinor: amount.minor,
                  localDate: values.localDate,
                  localTime: values.localTime,
                  timeZone: tz,
                  payee: bill.name,
                  notes: values.notes,
                  categoryId: values.categoryId,
                },
              },
            });
          }
          toastSaved(t, t('bills.toast.paid'));
          router.back();
        }}
      />
    </Screen>
  );
}
