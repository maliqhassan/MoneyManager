import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { EmptyState, ErrorState, LoadingState, Screen } from '@/components/ui';
import { useAccounts } from '@/features/accounts/hooks/useAccounts';
import { BillForm } from '@/features/bills/components/BillForm';
import { billFormValues, toBillInput } from '@/features/bills/formSchema';
import { useBill, useBillMutations } from '@/features/bills/hooks';
import { toastSaved } from '@/features/planning/feedback';
import { useFormatter } from '@/i18n/FormatContext';

export default function EditBillScreen() {
  const { t } = useTranslation();
  const formatter = useFormatter();
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  const query = useBill(id);
  const accounts = useAccounts({ includeArchived: true });
  const { update } = useBillMutations();

  if (query.error) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  if (query.isLoading || accounts.isLoading) return <LoadingState />;
  const bill = query.data?.bill;
  if (!bill) return <EmptyState icon="alert-circle-outline" title={t('states.notFound')} />;

  return (
    <Screen keyboard>
      <Stack.Screen
        options={{ title: bill.isSubscription ? t('bills.editSubscription') : t('bills.editBill') }}
      />
      <BillForm
        accounts={accounts.data ?? []}
        submitLabel={t('common.save')}
        initialValues={billFormValues(
          bill,
          formatter.amountForInput({ amountMinor: bill.amountMinor, currency: bill.currency }),
        )}
        onSubmit={async (values) => {
          await update.mutateAsync({
            id,
            input: toBillInput(values, formatter.separators.decimal),
          });
          toastSaved(t, t('bills.toast.saved'));
          router.back();
        }}
      />
    </Screen>
  );
}
