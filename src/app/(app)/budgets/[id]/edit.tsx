import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { EmptyState, ErrorState, LoadingState, Screen } from '@/components/ui';
import { BudgetForm } from '@/features/budgets/components/BudgetForm';
import { budgetFormValues, toBudgetInput } from '@/features/budgets/formSchema';
import {
  useBudgetHasHistory,
  useBudgetMutations,
  useBudgetOverview,
} from '@/features/budgets/hooks';
import { toastSaved } from '@/features/planning/feedback';
import { useFormatter } from '@/i18n/FormatContext';

/**
 * Edit a budget. Once a period has completed, scope/period/currency are
 * locked and amount/rollover changes take effect from the current period,
 * so past periods keep the amount they were measured against.
 */
export default function EditBudgetScreen() {
  const { t } = useTranslation();
  const formatter = useFormatter();
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  const overview = useBudgetOverview(id);
  const history = useBudgetHasHistory(id);
  const { update } = useBudgetMutations();

  if (overview.error) {
    return <ErrorState error={overview.error} onRetry={() => void overview.refetch()} />;
  }
  if (overview.isLoading || history.isLoading) return <LoadingState />;
  const item = overview.data;
  if (!item) return <EmptyState icon="alert-circle-outline" title={t('states.notFound')} />;

  // The amount in force for the current period is what the user edits.
  const current = item.evaluation.current;
  const amountText = formatter.amountForInput({
    amountMinor: current.limitMinor,
    currency: item.budget.currency,
  });
  const values = {
    ...budgetFormValues(item.budget, amountText),
    rolloverEnabled: current.rolloverEnabled,
  };

  return (
    <Screen keyboard>
      <BudgetForm
        submitLabel={t('common.save')}
        initialValues={values}
        historyLocked={history.data === true}
        onSubmit={async (formValues) => {
          await update.mutateAsync({
            id,
            input: toBudgetInput(formValues, formatter.separators.decimal),
          });
          toastSaved(t, t('budgets.toast.saved'));
          router.back();
        }}
      />
    </Screen>
  );
}
