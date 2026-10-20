import { useMutation, useQuery } from '@tanstack/react-query';

import type { CashflowHorizon } from '@/domain/planning/cashflow';
import type { RuleStatus } from '@/domain/planning/recurring';
import { useFormatter } from '@/i18n/FormatContext';
import { useRepositories } from '@/providers/DataProvider';
import type { RecurringRuleInput } from '@/validation/recurring';

/**
 * Recurring rules and upcoming cash flow. Reads are local SQLite; writes go
 * through the repositories (rule/occurrence/transaction + outbox in one
 * transaction), so everything works offline.
 */
export function useRecurringRules(status: RuleStatus | 'all' = 'all') {
  const { recurring } = useRepositories();
  const today = useFormatter().today();
  return useQuery({
    queryKey: ['recurring_transactions', 'list', status, today],
    queryFn: () => recurring.list(today, { status }),
  });
}

export function useRecurringRule(id: string) {
  const { recurring } = useRepositories();
  const today = useFormatter().today();
  return useQuery({
    queryKey: ['recurring_transactions', 'detail', id, today],
    queryFn: () => recurring.getById(id, today),
  });
}

export function useRecurringMutations() {
  const { recurring } = useRepositories();
  const formatter = useFormatter();
  const today = () => formatter.today();
  return {
    create: useMutation({ mutationFn: (input: RecurringRuleInput) => recurring.create(input) }),
    update: useMutation({
      mutationFn: ({ id, input }: { id: string; input: RecurringRuleInput }) =>
        recurring.update(id, input),
    }),
    pause: useMutation({ mutationFn: (id: string) => recurring.pause(id) }),
    resume: useMutation({ mutationFn: (id: string) => recurring.resume(id, today()) }),
    end: useMutation({ mutationFn: (id: string) => recurring.end(id) }),
    post: useMutation({
      mutationFn: ({ id, date }: { id: string; date: string }) => recurring.post(id, date, today()),
    }),
    skip: useMutation({
      mutationFn: ({ id, date }: { id: string; date: string }) => recurring.skip(id, date),
    }),
    unskip: useMutation({
      mutationFn: ({ id, date }: { id: string; date: string }) => recurring.unskip(id, date),
    }),
    postAgain: useMutation({
      mutationFn: ({ id, date }: { id: string; date: string }) =>
        recurring.postAgain(id, date, today()),
    }),
  };
}

export function useUpcomingCashflow(horizon: CashflowHorizon) {
  const { upcoming } = useRepositories();
  const formatter = useFormatter();
  const today = formatter.today();
  const base = formatter.settings.baseCurrency;
  return useQuery({
    queryKey: ['upcoming', 'cashflow', horizon, today, base],
    queryFn: () => upcoming.cashflow(today, horizon, base),
  });
}
