import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { EmptyState, ErrorState, LoadingState, Screen } from '@/components/ui';
import { useAccounts } from '@/features/accounts/hooks/useAccounts';
import { GoalForm } from '@/features/goals/components/GoalForm';
import { goalFormValues, toGoalInput } from '@/features/goals/formSchema';
import { useGoal, useGoalMutations } from '@/features/goals/hooks';
import { toastSaved } from '@/features/planning/feedback';
import { useFormatter } from '@/i18n/FormatContext';

export default function EditGoalScreen() {
  const { t } = useTranslation();
  const formatter = useFormatter();
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  const query = useGoal(id);
  const accounts = useAccounts({ includeArchived: true });
  const { update } = useGoalMutations();

  if (query.error) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  if (query.isLoading || accounts.isLoading) return <LoadingState />;
  const item = query.data;
  if (!item) return <EmptyState icon="alert-circle-outline" title={t('states.notFound')} />;
  const { goal } = item;

  return (
    <Screen keyboard>
      <GoalForm
        accounts={accounts.data ?? []}
        submitLabel={t('common.save')}
        currencyLocked={item.contributions.length > 0}
        initialValues={goalFormValues(
          goal,
          formatter.amountForInput({
            amountMinor: goal.targetAmountMinor,
            currency: goal.currency,
          }),
          formatter.today(),
        )}
        onSubmit={async (values) => {
          await update.mutateAsync({
            id,
            input: toGoalInput(values, formatter.separators.decimal),
          });
          toastSaved(t, t('goals.toast.saved'));
          router.back();
        }}
      />
    </Screen>
  );
}
