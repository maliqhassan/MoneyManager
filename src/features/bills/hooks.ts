import { useMutation, useQuery } from '@tanstack/react-query';

import { addDays } from '@/domain/dates/calendar';
import { useFormatter } from '@/i18n/FormatContext';
import { useRepositories } from '@/providers/DataProvider';
import type { BillKind } from '@/repositories/types';
import type { BillInput, BillLinkInput, BillPaymentInput } from '@/validation/planning';

/** Bills & subscriptions. Reading is local; paying writes a normal transaction. */

export function useBills(options: { kind?: BillKind; archived?: boolean }) {
  const { bills } = useRepositories();
  return useQuery({
    queryKey: ['bills', 'list', options.kind ?? 'all', options.archived ?? false],
    queryFn: () => bills.list(options),
  });
}

/** Active bills due within `days` days of today (overdue included). */
export function useUpcomingBills(days: number, options: { kind?: BillKind; limit?: number } = {}) {
  const { bills } = useRepositories();
  const today = useFormatter().today();
  const through = addDays(today, days);
  return useQuery({
    queryKey: ['bills', 'upcoming', through, options.kind ?? 'all', options.limit ?? 100],
    queryFn: () => bills.upcoming(through, options),
  });
}

export function useBill(id: string) {
  const { bills } = useRepositories();
  return useQuery({
    queryKey: ['bills', 'detail', id],
    enabled: id.length > 0,
    queryFn: () => bills.getById(id),
  });
}

export function useRecentPayments(kind: BillKind | undefined, limit = 50) {
  const { bills } = useRepositories();
  return useQuery({
    queryKey: ['bills', 'paid', kind ?? 'all', limit],
    queryFn: () => bills.recentPayments({ kind, limit }),
  });
}

export function useSubscriptionSummary() {
  const { bills } = useRepositories();
  const formatter = useFormatter();
  const today = formatter.today();
  const base = formatter.settings.baseCurrency;
  return useQuery({
    queryKey: ['bills', 'subscription-summary', today, base],
    queryFn: () => bills.subscriptionSummary(today, base),
  });
}

/** Recent expenses a bill payment can be linked to. */
export function useBillLinkCandidates() {
  const { transactions } = useRepositories();
  return useQuery({
    queryKey: ['transactions', 'bill-link-candidates'],
    queryFn: () => transactions.list({ types: ['expense'], limit: 30 }),
  });
}

export function useBillMutations() {
  const { bills } = useRepositories();
  return {
    create: useMutation({ mutationFn: (input: BillInput) => bills.create(input) }),
    update: useMutation({
      mutationFn: ({ id, input }: { id: string; input: BillInput }) => bills.update(id, input),
    }),
    setArchived: useMutation({
      mutationFn: ({ id, archived }: { id: string; archived: boolean }) =>
        bills.setArchived(id, archived),
    }),
    markPaid: useMutation({
      mutationFn: ({ id, input }: { id: string; input: BillPaymentInput }) =>
        bills.markPaid(id, input),
    }),
    linkPayment: useMutation({
      mutationFn: ({ id, input }: { id: string; input: BillLinkInput }) =>
        bills.linkPayment(id, input),
    }),
    skip: useMutation({
      mutationFn: ({ id, dueDate }: { id: string; dueDate: string }) => bills.skip(id, dueDate),
    }),
    undoPayment: useMutation({ mutationFn: (paymentId: string) => bills.undoPayment(paymentId) }),
  };
}
