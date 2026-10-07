import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Screen } from '@/components/ui';
import { BudgetForm } from '@/features/budgets/components/BudgetForm';
import { toBudgetInput } from '@/features/budgets/formSchema';
import { useBudgetMutations } from '@/features/budgets/hooks';
import { toastSaved } from '@/features/planning/feedback';
import { useFormatter } from '@/i18n/FormatContext';

/** Create a budget (works offline; queued for sync). */
export default function NewBudgetScreen() {
  const { t } = useTranslation();
  const formatter = useFormatter();
  const { create } = useBudgetMutations();

  return (
    <Screen keyboard>
      <BudgetForm
        submitLabel={t('budgets.create')}
        initialValues={{
          scope: 'category',
          categoryId: null,
          name: '',
          amount: '',
          currency: formatter.settings.baseCurrency,
          periodType: 'monthly',
          startDate: formatter.today(),
          endDate: null,
          rolloverEnabled: false,
        }}
        onSubmit={async (values) => {
          await create.mutateAsync(toBudgetInput(values, formatter.separators.decimal));
          toastSaved(t, t('budgets.toast.created'));
          router.back();
        }}
      />
    </Screen>
  );
}
