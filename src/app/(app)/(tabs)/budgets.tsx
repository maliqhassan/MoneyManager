import { useTranslation } from 'react-i18next';

import { EmptyState, Screen } from '@/components/ui';

/** Shell: budgets UI is built on domain/finance/budget.ts in the Budgets phase. */
export default function BudgetsScreen() {
  const { t } = useTranslation();
  return (
    <Screen edges={[]}>
      <EmptyState
        icon="pie-chart-outline"
        title={t('budgets.emptyTitle')}
        description={t('budgets.emptyBody')}
      />
    </Screen>
  );
}
