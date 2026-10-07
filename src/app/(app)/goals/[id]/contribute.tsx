import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { Button, EmptyState, ErrorState, LoadingState, Screen } from '@/components/ui';
import { localTimeInZone } from '@/domain/dates/zoned';
import { useAccounts } from '@/features/accounts/hooks/useAccounts';
import { ContributionForm } from '@/features/goals/components/ContributionForm';
import { toContributionInput } from '@/features/goals/formSchema';
import { useGoal, useGoalMutations, useTransferCandidates } from '@/features/goals/hooks';
import { confirmAction, toastSaved } from '@/features/planning/feedback';
import { useFormatter } from '@/i18n/FormatContext';
import type { TransferCandidate } from '@/repositories/types';

/** Add a contribution, or edit/remove one (`?contributionId=`). */
export default function ContributeScreen() {
  const { t } = useTranslation();
  const formatter = useFormatter();
  const { id = '', contributionId } = useLocalSearchParams<{
    id: string;
    contributionId?: string;
  }>();
  const goal = useGoal(id);
  const accounts = useAccounts({ includeArchived: true });
  const candidates = useTransferCandidates();
  const mutations = useGoalMutations();
  const tz = formatter.settings.timeZone;
  const time = useMemo(() => localTimeInZone(new Date(), tz), [tz]);

  if (goal.error) return <ErrorState error={goal.error} onRetry={() => void goal.refetch()} />;
  if (goal.isLoading || accounts.isLoading || candidates.isLoading) return <LoadingState />;
  const item = goal.data;
  if (!item) return <EmptyState icon="alert-circle-outline" title={t('states.notFound')} />;

  const existing = contributionId
    ? item.contributions.find((c) => c.id === contributionId)
    : undefined;
  if (contributionId && !existing) {
    return <EmptyState icon="alert-circle-outline" title={t('states.notFound')} />;
  }

  // The transfer already linked to this contribution stays selectable.
  const transferOptions: TransferCandidate[] = [
    ...(existing?.transfer
      ? [
          {
            id: existing.transfer.id,
            localDate: existing.transfer.localDate,
            fromAccountName: existing.transfer.fromAccountName,
            toAccountName: existing.transfer.toAccountName,
            amountMinor: existing.transfer.amountMinor,
            currency: existing.transfer.currency,
          },
        ]
      : []),
    ...(candidates.data ?? []),
  ];
  const active = (accounts.data ?? []).filter((a) => !a.isArchived);
  const currency = existing?.currency ?? item.goal.currency;

  return (
    <Screen keyboard>
      <Stack.Screen
        options={{
          title: existing ? t('goals.contribution.editTitle') : t('goals.contribution.add'),
        }}
      />
      <ContributionForm
        accounts={accounts.data ?? []}
        transferCandidates={transferOptions}
        allowNewTransfer={!existing && active.length >= 2}
        submitLabel={existing ? t('common.save') : t('goals.contribution.add')}
        initialValues={{
          amount: existing
            ? formatter.amountForInput({ amountMinor: existing.amountMinor, currency })
            : '',
          currency,
          contributedOn: existing?.contributedOn ?? formatter.today(),
          time,
          accountId: existing?.accountId ?? item.goal.accountId,
          notes: existing?.notes ?? '',
          transferMode: existing?.transferId ? 'link' : 'none',
          fromAccountId: active.find((a) => a.id !== item.goal.accountId)?.id ?? '',
          toAccountId: item.goal.accountId ?? '',
          transferId: existing?.transferId ?? null,
        }}
        onSubmit={async (values) => {
          const input = toContributionInput(values, formatter.separators.decimal, tz);
          if (existing) {
            await mutations.updateContribution.mutateAsync({ id: existing.id, input });
            toastSaved(t, t('goals.toast.contributionSaved'));
          } else {
            await mutations.addContribution.mutateAsync({ goalId: id, input });
            toastSaved(t, t('goals.toast.contributed'));
          }
          router.back();
        }}
      />
      {existing ? (
        <Button
          label={t('goals.contribution.remove')}
          icon="trash-outline"
          variant="destructive"
          onPress={() =>
            confirmAction(t, {
              title: t('goals.contribution.confirmRemove.title'),
              body: t('goals.contribution.confirmRemove.body'),
              confirmLabel: t('common.delete'),
              destructive: true,
              onConfirm: () =>
                mutations.removeContribution.mutate(existing.id, {
                  onSuccess: () => {
                    toastSaved(t, t('goals.toast.contributionRemoved'));
                    router.back();
                  },
                }),
            })
          }
        />
      ) : null}
    </Screen>
  );
}
