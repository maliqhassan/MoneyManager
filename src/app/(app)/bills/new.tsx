import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { LoadingState, Screen } from '@/components/ui';
import { useAccounts } from '@/features/accounts/hooks/useAccounts';
import { BillForm } from '@/features/bills/components/BillForm';
import { toBillInput } from '@/features/bills/formSchema';
import { useBillMutations } from '@/features/bills/hooks';
import { toastSaved } from '@/features/planning/feedback';
import { useFormatter } from '@/i18n/FormatContext';

/** Create a bill or a subscription (works offline; queued for sync). */
export default function NewBillScreen() {
  const { t } = useTranslation();
  const formatter = useFormatter();
  const params = useLocalSearchParams<{ kind?: string }>();
  const isSubscription = params.kind === 'subscription';
  const accounts = useAccounts({ includeArchived: true });
  const { create } = useBillMutations();
  if (accounts.isLoading) return <LoadingState />;
  const firstActive = (accounts.data ?? []).find((a) => !a.isArchived);

  return (
    <Screen keyboard>
      <Stack.Screen
        options={{ title: isSubscription ? t('bills.newSubscription') : t('bills.newBill') }}
      />
      <BillForm
        accounts={accounts.data ?? []}
        submitLabel={t('common.save')}
        initialValues={{
          name: '',
          isSubscription,
          amount: '',
          isVariableAmount: false,
          currency: firstActive?.currency ?? formatter.settings.baseCurrency,
          accountId: firstActive?.id ?? null,
          categoryId: null,
          preset: 'monthly',
          frequency: 'monthly',
          interval: '1',
          nextDueDate: formatter.today(),
          hasEnd: false,
          endDate: null,
          reminder: 'none',
          autopay: false,
          notes: '',
        }}
        onSubmit={async (values) => {
          await create.mutateAsync(toBillInput(values, formatter.separators.decimal));
          toastSaved(t, t('bills.toast.created'));
          router.back();
        }}
      />
    </Screen>
  );
}
