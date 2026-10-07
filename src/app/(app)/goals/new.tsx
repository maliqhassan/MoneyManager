import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { LoadingState, Screen } from '@/components/ui';
import { useAccounts } from '@/features/accounts/hooks/useAccounts';
import { GoalForm } from '@/features/goals/components/GoalForm';
import { toGoalInput } from '@/features/goals/formSchema';
import { useGoalMutations } from '@/features/goals/hooks';
import { toastSaved } from '@/features/planning/feedback';
import { useFormatter } from '@/i18n/FormatContext';
import { ACCOUNT_COLORS } from '@/theme';

export default function NewGoalScreen() {
  const { t } = useTranslation();
  const formatter = useFormatter();
  const accounts = useAccounts({ includeArchived: true });
  const { create } = useGoalMutations();
  if (accounts.isLoading) return <LoadingState />;

  return (
    <Screen keyboard>
      <GoalForm
        accounts={accounts.data ?? []}
        submitLabel={t('goals.new')}
        initialValues={{
          name: '',
          target: '',
          currency: formatter.settings.baseCurrency,
          hasTargetDate: false,
          targetDate: formatter.today(),
          accountId: null,
          icon: 'leaf-outline',
          color: ACCOUNT_COLORS[1] ?? ACCOUNT_COLORS[0],
        }}
        onSubmit={async (values) => {
          await create.mutateAsync(toGoalInput(values, formatter.separators.decimal));
          toastSaved(t, t('goals.toast.created'));
          router.back();
        }}
      />
    </Screen>
  );
}
