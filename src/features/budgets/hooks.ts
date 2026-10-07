import { useMutation, useQuery } from '@tanstack/react-query';

import { useFormatter } from '@/i18n/FormatContext';
import { useRepositories } from '@/providers/DataProvider';
import type { BudgetInput } from '@/validation/planning';

/**
 * Budget data hooks. Progress is derived from local transactions on read and
 * the queries refresh whenever transactions, categories or preferences
 * change (see providers/queryDependencies.ts). "Today" is the user's local
 * date in their configured time zone, part of every key so periods roll over
 * at local midnight.
 */

export function useBudgetOverviews(archived = false) {
  const { budgets } = useRepositories();
  const today = useFormatter().today();
  return useQuery({
    queryKey: ['budgets', 'overviews', archived, today],
    queryFn: () => budgets.overviews(today, { archived }),
  });
}

export function useBudgetOverview(id: string) {
  const { budgets } = useRepositories();
  const today = useFormatter().today();
  return useQuery({
    queryKey: ['budgets', 'overview', id, today],
    enabled: id.length > 0,
    queryFn: () => budgets.overview(id, today),
  });
}

export function useBudgetHasHistory(id: string) {
  const { budgets } = useRepositories();
  const today = useFormatter().today();
  return useQuery({
    queryKey: ['budgets', 'has-history', id, today],
    enabled: id.length > 0,
    queryFn: () => budgets.hasHistory(id, today),
  });
}

export function useBudgetSpendingLines(id: string, from: string, to: string) {
  const { budgets } = useRepositories();
  return useQuery({
    queryKey: ['budgets', 'lines', id, from, to],
    enabled: id.length > 0 && from.length > 0 && to.length > 0,
    queryFn: () => budgets.spendingLines(id, from, to),
  });
}

export function useBudgetMutations() {
  const { budgets } = useRepositories();
  const formatter = useFormatter();
  return {
    create: useMutation({ mutationFn: (input: BudgetInput) => budgets.create(input) }),
    update: useMutation({
      mutationFn: ({ id, input }: { id: string; input: BudgetInput }) =>
        budgets.update(id, input, formatter.today()),
    }),
    setArchived: useMutation({
      mutationFn: ({ id, archived }: { id: string; archived: boolean }) =>
        budgets.setArchived(id, archived),
    }),
  };
}
