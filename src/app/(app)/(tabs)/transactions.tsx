import { useTranslation } from 'react-i18next';

import { EmptyState, Screen } from '@/components/ui';
import { SyncStatusBanner } from '@/features/sync/components/SyncStatusBanner';

/** Shell: the transactions list (search, filters, keyset pagination) is the next feature phase. */
export default function TransactionsScreen() {
  const { t } = useTranslation();
  return (
    <Screen edges={[]}>
      <SyncStatusBanner />
      <EmptyState
        icon="receipt-outline"
        title={t('transactions.emptyTitle')}
        description={t('transactions.emptyBody')}
      />
    </Screen>
  );
}
