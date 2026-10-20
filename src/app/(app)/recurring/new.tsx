import { router, Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { EmptyState, LoadingState, Screen } from '@/components/ui';
import { useAccounts } from '@/features/accounts/hooks/useAccounts';
import { toastSaved } from '@/features/planning/feedback';
import { RecurringForm } from '@/features/recurring/components/RecurringForm';
import { toRecurringInput } from '@/features/recurring/formSchema';
import { useRecurringMutations } from '@/features/recurring/hooks';
import { useFormatter } from '@/i18n/FormatContext';
import { useReminderSettings } from '@/stores/reminderSettingsStore';

/** Create a recurring income or expense (works offline; queued for sync). */
export default function NewRecurringScreen() {
  const { t } = useTranslation();
  const formatter = useFormatter();
  const accounts = useAccounts({ includeArchived: true });
  const reminders = useReminderSettings();
  const { create } = useRecurringMutations();
  if (accounts.isLoading) return <LoadingState />;
  const all = accounts.data ?? [];
  const firstActive = all.find((a) => !a.isArchived);

  return (
    <Screen keyboard>
      <Stack.Screen options={{ title: t('recurring.new') }} />
      {!firstActive ? (
        <EmptyState
          icon="wallet-outline"
          title={t('home.noAccountsTitle')}
          description={t('home.noAccountsBody')}
          actionLabel={t('home.addAccount')}
          onAction={() => router.push('/accounts/new')}
        />
      ) : (
        <RecurringForm
          accounts={all}
          submitLabel={t('common.save')}
          initialValues={{
            type: 'expense',
            amount: '',
            accountId: firstActive.id,
            categoryId: null,
            payee: '',
            notes: '',
            tagNames: [],
            schedule: 'monthly',
            frequency: 'monthly',
            interval: '1',
            startDate: formatter.today(),
            hasEnd: false,
            endDate: null,
            autoPost: false,
            reminder: reminders.enabled ? String(reminders.defaultLeadDays) : 'none',
          }}
          onSubmit={async (values) => {
            const currency = all.find((a) => a.id === values.accountId)?.currency;
            if (!currency) return;
            await create.mutateAsync(
              toRecurringInput(
                values,
                currency,
                formatter.separators.decimal,
                formatter.settings.timeZone,
              ),
            );
            toastSaved(t, t('recurring.toast.saved'));
            router.back();
          }}
        />
      )}
    </Screen>
  );
}
