import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Screen } from '@/components/ui';
import { ACCOUNT_TYPES, type AccountType } from '@/domain/enums';
import { AccountForm } from '@/features/accounts/components/AccountForm';
import { defaultFormValues, toAccountInput } from '@/features/accounts/formSchema';
import { useAccountMutations } from '@/features/accounts/hooks/useAccounts';
import { useFormatter } from '@/i18n/FormatContext';
import { showToast } from '@/stores/toastStore';

/** Create account. Works offline: saved locally and queued for sync. */
export default function NewAccountScreen() {
  const { t } = useTranslation();
  const formatter = useFormatter();
  const { create } = useAccountMutations();
  const params = useLocalSearchParams<{ type?: string }>();
  const type: AccountType = (ACCOUNT_TYPES as readonly string[]).includes(params.type ?? '')
    ? (params.type as AccountType)
    : 'checking';

  return (
    <Screen keyboard>
      <AccountForm
        initialValues={defaultFormValues(type, formatter.settings.baseCurrency)}
        submitLabel={t('accounts.add')}
        submitError={create.error}
        onSubmit={async (values) => {
          const account = await create.mutateAsync(
            toAccountInput(values, formatter.separators.decimal, formatter.today()),
          );
          showToast(t('accounts.toast.created', { name: account.name }));
          router.back();
        }}
      />
    </Screen>
  );
}
