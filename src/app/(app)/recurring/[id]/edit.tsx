import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { ErrorState, LoadingState, Screen } from '@/components/ui';
import { useAccounts } from '@/features/accounts/hooks/useAccounts';
import { toastSaved } from '@/features/planning/feedback';
import { RecurringForm } from '@/features/recurring/components/RecurringForm';
import { recurringFormValues, toRecurringInput } from '@/features/recurring/formSchema';
import { useRecurringMutations, useRecurringRule } from '@/features/recurring/hooks';
import { useFormatter } from '@/i18n/FormatContext';
import { AppError } from '@/lib/errors';

/** Edit a rule: applies to dates not yet added or skipped; history is unchanged. */
export default function EditRecurringScreen() {
  const { t } = useTranslation();
  const formatter = useFormatter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const detail = useRecurringRule(id);
  const accounts = useAccounts({ includeArchived: true });
  const { update } = useRecurringMutations();

  if (detail.isLoading || accounts.isLoading) return <LoadingState />;
  if (detail.error || !detail.data) {
    return (
      <Screen>
        <ErrorState
          error={detail.error ?? new AppError('not_found', 'Recurring rule not found')}
          onRetry={() => void detail.refetch()}
        />
      </Screen>
    );
  }
  const rule = detail.data.rule;
  const all = accounts.data ?? [];

  return (
    <Screen keyboard>
      <Stack.Screen options={{ title: t('recurring.editTitle') }} />
      <RecurringForm
        isEdit
        accounts={all}
        submitLabel={t('common.save')}
        initialValues={recurringFormValues(
          rule,
          formatter.amountForInput({ amountMinor: rule.amountMinor, currency: rule.currency }),
        )}
        onSubmit={async (values) => {
          const currency = all.find((a) => a.id === values.accountId)?.currency;
          if (!currency) return;
          await update.mutateAsync({
            id,
            input: toRecurringInput(values, currency, formatter.separators.decimal, rule.timeZone),
          });
          toastSaved(t, t('recurring.toast.saved'));
          router.back();
        }}
      />
    </Screen>
  );
}
