import { router, useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { EmptyState, ErrorState, LoadingState, Screen, Text } from '@/components/ui';
import { AccountForm } from '@/features/accounts/components/AccountForm';
import {
  formValuesFromAccount,
  openingBalanceMinorFrom,
  toAccountPatch,
} from '@/features/accounts/formSchema';
import { useAccount, useAccountMutations } from '@/features/accounts/hooks/useAccounts';
import { useFormatter } from '@/i18n/FormatContext';
import { showToast } from '@/stores/toastStore';

/**
 * Edit account. Currency can only change while the account has no history;
 * otherwise the field is locked and a safe alternative is explained.
 */
export default function EditAccountScreen() {
  const { t } = useTranslation();
  const formatter = useFormatter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const query = useAccount(id);
  const { update, changeCurrency } = useAccountMutations();
  const data = query.data;
  const initialValues = useMemo(
    () => (data ? formValuesFromAccount(data.account, formatter) : null),
    [data, formatter],
  );

  if (query.isLoading) return <LoadingState />;
  if (query.error) {
    return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  }
  if (!data || !initialValues) {
    return <EmptyState icon="help-circle-outline" title={t('accounts.detail.notFound')} />;
  }

  const hasHistory = data.usage.transactionCount + data.usage.transferCount > 0;
  const decimal = formatter.separators.decimal;

  return (
    <Screen keyboard>
      {!hasHistory ? (
        <Text variant="bodySmall" tone="textSecondary">
          {t('accounts.currencyChangeHint')}
        </Text>
      ) : null}
      <AccountForm
        initialValues={initialValues}
        currencyLocked={hasHistory}
        submitLabel={t('common.saveChanges')}
        submitError={update.error ?? changeCurrency.error}
        onSubmit={async (values) => {
          if (values.currency !== data.account.currency) {
            await changeCurrency.mutateAsync({
              id,
              currency: values.currency,
              openingBalanceMinor: openingBalanceMinorFrom(values, decimal),
            });
          }
          await update.mutateAsync({ id, patch: toAccountPatch(values, decimal) });
          showToast(t('accounts.toast.updated'));
          router.back();
        }}
      />
    </Screen>
  );
}
