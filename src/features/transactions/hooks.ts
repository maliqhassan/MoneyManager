import { useInfiniteQuery, useMutation, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { suggestCategory } from '@/domain/categorization/suggest';
import type { CurrencyCode } from '@/domain/currency/currencies';
import type { CategoryKind } from '@/domain/enums';
import { getBudgetPeriod } from '@/domain/finance/budget';
import { normalizeMerchant } from '@/domain/merchants/normalize';
import { dailySpending } from '@/domain/reports/aggregate';
import { cashFlowInBase, topSpendingCategories } from '@/domain/transactions/insights';
import { usePreferences } from '@/features/settings/hooks/usePreferences';
import { useFormatter } from '@/i18n/FormatContext';
import { useRepositories } from '@/providers/DataProvider';
import type { TransactionFilter } from '@/repositories/types';
import type { ReceiptFile, TransactionInput, TransferInput } from '@/validation/transactions';

/**
 * Transaction data hooks. Every read is local SQLite (works offline);
 * writes go through the repository (row + outbox in one transaction).
 */

const PAGE_SIZE = 40;

export function useTransactionList(filter: Omit<TransactionFilter, 'after' | 'limit'>) {
  const { transactions } = useRepositories();
  return useInfiniteQuery({
    queryKey: ['transactions', 'list', filter],
    initialPageParam: undefined as TransactionFilter['after'],
    queryFn: ({ pageParam }) =>
      transactions.list({
        ...filter,
        limit: PAGE_SIZE,
        ...(pageParam ? { after: pageParam } : {}),
      }),
    getNextPageParam: (lastPage) => {
      if (lastPage.length < PAGE_SIZE) return undefined;
      const last = lastPage[lastPage.length - 1]!;
      return { localDate: last.localDate, occurredAt: last.occurredAt, id: last.id };
    },
  });
}

export function useTransaction(id: string) {
  const { transactions } = useRepositories();
  return useQuery({
    queryKey: ['transactions', 'detail', id],
    enabled: id.length > 0,
    queryFn: () => transactions.getById(id),
  });
}

export function useRecentTransactions(limit: number) {
  const { transactions } = useRepositories();
  return useQuery({
    queryKey: ['transactions', 'recent', limit],
    queryFn: () => transactions.list({ limit }),
  });
}

export function useRefundCandidates(search: string) {
  const { transactions } = useRepositories();
  return useQuery({
    queryKey: ['transactions', 'refund-candidates', search],
    queryFn: () => transactions.refundCandidates(search, 30),
  });
}

export function useTransactionMutations() {
  const { transactions, attachments, categoryRules } = useRepositories();
  return {
    create: useMutation({ mutationFn: (input: TransactionInput) => transactions.create(input) }),
    update: useMutation({
      mutationFn: ({ id, input }: { id: string; input: TransactionInput }) =>
        transactions.update(id, input),
    }),
    createTransfer: useMutation({
      mutationFn: (input: TransferInput) => transactions.createTransfer(input),
    }),
    updateTransfer: useMutation({
      mutationFn: ({ transferId, input }: { transferId: string; input: TransferInput }) =>
        transactions.updateTransfer(transferId, input),
    }),
    remove: useMutation({ mutationFn: (id: string) => transactions.remove(id) }),
    duplicate: useMutation({
      mutationFn: ({
        id,
        at,
      }: {
        id: string;
        at: { localDate: string; localTime: string; timeZone: string };
      }) => transactions.duplicate(id, at),
    }),
    addReceipt: useMutation({
      mutationFn: ({ transactionId, file }: { transactionId: string; file: ReceiptFile }) =>
        attachments.add(transactionId, file),
    }),
    removeReceipt: useMutation({ mutationFn: (id: string) => attachments.remove(id) }),
    rememberCategory: useMutation({
      mutationFn: ({ merchantKey, categoryId }: { merchantKey: string; categoryId: string }) =>
        categoryRules.upsertMerchantRule(merchantKey, categoryId),
    }),
  };
}

/**
 * Deterministic suggestion for the payee being typed: user rule → last
 * category used for the same merchant. Never AI, never guessed.
 */
export function useCategorySuggestion(payee: string, notes: string, kind: CategoryKind | null) {
  const repos = useRepositories();
  const merchantKey = normalizeMerchant(payee);
  return useQuery({
    queryKey: ['transactions', 'suggestion', kind, merchantKey, notes],
    enabled: kind !== null && (merchantKey !== null || notes.trim().length > 0),
    queryFn: async () => {
      if (!kind) return null;
      const [rules, categories, last] = await Promise.all([
        repos.categoryRules.list(),
        repos.categories.list({ kind }),
        merchantKey ? repos.transactions.lastCategoryForMerchant(merchantKey, kind) : null,
      ]);
      return suggestCategory({
        payee: payee || null,
        notes: notes || null,
        merchantKey,
        rules,
        lastCategoryForMerchant: last,
        allowedCategoryIds: new Set(categories.map((c) => c.id)),
      });
    },
  });
}

/** Income, expenses, net and top categories for the current monthly period. */
export function useHomeInsights() {
  const repos = useRepositories();
  const formatter = useFormatter();
  const prefs = usePreferences();
  const base = formatter.settings.baseCurrency;
  const today = formatter.today();
  const period = useMemo(
    () =>
      getBudgetPeriod({ periodType: 'monthly', startDate: '1970-01-01', endDate: null }, today, {
        firstDayOfWeek: formatter.settings.firstDayOfWeek,
        monthStartDay: prefs.data?.monthStartDay ?? 1,
      }),
    [today, formatter.settings.firstDayOfWeek, prefs.data?.monthStartDay],
  );

  return useQuery({
    queryKey: ['transactions', 'insights', base, period?.start, period?.end],
    enabled: period !== null,
    queryFn: async () => {
      if (!period) return null;
      // Same conversion policy as Reports: each entry's recorded snapshot or
      // the rate on its own date (never today's rate for older entries).
      const range = { start: period.start, end: period.end };
      const [flowRows, spendRows, categories, fx] = await Promise.all([
        repos.reports.flows(range, base),
        repos.reports.categorySpending(range, base),
        repos.categories.list({ includeArchived: true }),
        repos.reports.conversionNote(range, base),
      ]);
      const noRate = () => null;
      const missing = (rows: readonly { currency: CurrencyCode; baseMinor: number | null }[]) =>
        [...new Set(rows.filter((r) => r.baseMinor === null).map((r) => r.currency))].sort();

      const flowResult = cashFlowInBase(
        flowRows
          .filter((r) => r.baseMinor !== null)
          .map((r) => ({ type: r.type, currency: base, totalMinor: r.baseMinor! })),
        base,
        noRate,
      );
      // Never a partial total: any amount without a rate makes it incomplete.
      const flowMissing = missing(flowRows);
      const flow = {
        summary: flowMissing.length > 0 ? null : flowResult.summary,
        missingRates: flowMissing,
      };
      const parentOf = new Map(categories.map((c) => [c.id, c.parentId]));
      const topResult = topSpendingCategories(
        spendRows
          .filter((r) => r.baseMinor !== null)
          .map((r) => ({ categoryId: r.categoryId, currency: base, totalMinor: r.baseMinor! })),
        parentOf,
        base,
        noRate,
        5,
      );
      const top = { ...topResult, missingRates: missing(spendRows) };
      return {
        period,
        flow,
        top,
        daily: dailySpending(flowRows, period.start, period.end),
        fx,
        categoriesById: new Map(categories.map((c) => [c.id, c])),
        hasTransactions: flowRows.length > 0,
      };
    },
  });
}
