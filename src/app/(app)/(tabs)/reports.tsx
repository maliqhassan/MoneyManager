import { useTranslation } from 'react-i18next';

import { EmptyState, Screen } from '@/components/ui';

/** Shell: reports are built on domain/finance/cashflow.ts in the Reports phase. */
export default function ReportsScreen() {
  const { t } = useTranslation();
  return (
    <Screen edges={[]}>
      <EmptyState
        icon="bar-chart-outline"
        title={t('reports.emptyTitle')}
        description={t('reports.emptyBody')}
      />
    </Screen>
  );
}
