import { useMutation, useQuery } from '@tanstack/react-query';

import { useFormatter } from '@/i18n/FormatContext';
import { useRepositories } from '@/providers/DataProvider';
import type { GoalFilter } from '@/repositories/types';
import type { ContributionInput, GoalInput } from '@/validation/planning';

/** Savings goals: planning targets; contributions never move money themselves. */

export function useGoals(filter: GoalFilter) {
  const { goals } = useRepositories();
  const today = useFormatter().today();
  return useQuery({
    queryKey: ['savings_goals', 'list', filter, today],
    queryFn: () => goals.list(filter, today),
  });
}

export function useGoal(id: string) {
  const { goals } = useRepositories();
  const today = useFormatter().today();
  return useQuery({
    queryKey: ['savings_goals', 'detail', id, today],
    enabled: id.length > 0,
    queryFn: () => goals.getById(id, today),
  });
}

export function useTransferCandidates() {
  const { goals } = useRepositories();
  return useQuery({
    queryKey: ['savings_goals', 'transfer-candidates'],
    queryFn: () => goals.transferCandidates(30),
  });
}

export function useGoalMutations() {
  const { goals } = useRepositories();
  return {
    create: useMutation({ mutationFn: (input: GoalInput) => goals.create(input) }),
    update: useMutation({
      mutationFn: ({ id, input }: { id: string; input: GoalInput }) => goals.update(id, input),
    }),
    setArchived: useMutation({
      mutationFn: ({ id, archived }: { id: string; archived: boolean }) =>
        goals.setArchived(id, archived),
    }),
    addContribution: useMutation({
      mutationFn: ({ goalId, input }: { goalId: string; input: ContributionInput }) =>
        goals.addContribution(goalId, input),
    }),
    updateContribution: useMutation({
      mutationFn: ({ id, input }: { id: string; input: ContributionInput }) =>
        goals.updateContribution(id, input),
    }),
    removeContribution: useMutation({
      mutationFn: (id: string) => goals.removeContribution(id),
    }),
  };
}
