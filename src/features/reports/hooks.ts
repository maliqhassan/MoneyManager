import { useQuery } from '@tanstack/react-query';

import {
  balanceSeries,
  budgetPeriodsInRange,
  categorySpending,
  merchantSpending,
  monthlyTrend,
  summarizeFlows,
} from '@/domain/reports/aggregate';
import {
  balanceSampleDates,
  type DateRange,
  type ResolvedPeriod,
  trailingMonths,
} from '@/domain/reports/periods';
import { useFormatter } from '@/i18n/FormatContext';
import { useRepositories } from '@/providers/DataProvider';
import type { ReportLineQuery } from '@/repositories/types';

/**
 * Report data hooks. All numbers come from the domain layer
 * (domain/reports/aggregate.ts) over the local database; screens and charts
 * only format them. Query keys start with the table each report is derived
 * from, so the existing invalidation (providers/queryDependencies.ts)
 * refreshes reports whenever transactions, categories, preferences, budgets
 * or accounts change.
 */

const rangeKey = (r: DateRange) => `${r.start}..${r.end}`;

export function useCashFlowReport(period: ResolvedPeriod) {
  const { reports } = useRepositories();
  const base = useFormatter().settings.baseCurrency;
  return useQuery({
    queryKey: [
      'transactions',
      'reports',
      'flow',
      base,
      rangeKey(period.range),
      rangeKey(period.previous),
    ],
    queryFn: async () => {
      const [current, previous] = await Promise.all([
        reports.flows(period.range, base),
        reports.flows(period.previous, base),
      ]);
      return { current: summarizeFlows(current, base), previous: summarizeFlows(previous, base) };
    },
  });
}

/** Income / spending / net for the 12 months ending with the period's end. */
export function useMonthlyTrend(end: string, months = 12) {
  const { reports } = useRepositories();
  const base = useFormatter().settings.baseCurrency;
  return useQuery({
    queryKey: ['transactions', 'reports', 'trend', base, end, months],
    queryFn: async () => {
      const buckets = trailingMonths(end, months);
      const range = { start: buckets[0]!.start, end: buckets[buckets.length - 1]!.end };
      const [rows, dataStart] = await Promise.all([
        reports.flows(range, base),
        reports.dataStart(),
      ]);
      return monthlyTrend(rows, buckets, dataStart, base);
    },
  });
}

export function useCategoryReport(period: ResolvedPeriod) {
  const repos = useRepositories();
  const base = useFormatter().settings.baseCurrency;
  return useQuery({
    queryKey: [
      'transactions',
      'reports',
      'categories',
      base,
      rangeKey(period.range),
      rangeKey(period.previous),
    ],
    queryFn: async () => {
      const [current, previous, categories] = await Promise.all([
        repos.reports.categorySpending(period.range, base),
        repos.reports.categorySpending(period.previous, base),
        repos.categories.list({ includeArchived: true }),
      ]);
      const parentOf = new Map(categories.map((c) => [c.id, c.parentId]));
      return {
        current: categorySpending(current, parentOf),
        previous: categorySpending(previous, parentOf),
        categoriesById: new Map(categories.map((c) => [c.id, c])),
      };
    },
  });
}

export function useMerchantReport(period: ResolvedPeriod) {
  const { reports } = useRepositories();
  const base = useFormatter().settings.baseCurrency;
  return useQuery({
    queryKey: [
      'transactions',
      'reports',
      'merchants',
      base,
      rangeKey(period.range),
      rangeKey(period.previous),
    ],
    queryFn: async () => {
      const [current, previous] = await Promise.all([
        reports.merchantSpending(period.range, base),
        reports.merchantSpending(period.previous, base),
      ]);
      const now = merchantSpending(current);
      const keys = now.items.map((m) => m.merchantKey).filter((k): k is string => k !== null);
      return {
        current: now,
        previous: merchantSpending(previous),
        names: await reports.merchantNames(keys),
      };
    },
  });
}

/** Per-account balance history derived from the ledger (active accounts). */
export function useBalanceHistory(range: DateRange) {
  const { reports } = useRepositories();
  return useQuery({
    queryKey: ['accounts', 'reports', 'balances', rangeKey(range)],
    queryFn: async () => {
      const accounts = await reports.balanceInputs(range);
      const dates = balanceSampleDates(range);
      return accounts.map((a) => ({
        accountId: a.accountId,
        name: a.name,
        type: a.type,
        currency: a.currency,
        series: balanceSeries(a.input, range, dates),
      }));
    },
  });
}

/** Active budgets' periods (from the budget engine) overlapping the range. */
export function useBudgetVsActual(range: DateRange) {
  const { budgets } = useRepositories();
  const today = useFormatter().today();
  return useQuery({
    queryKey: ['budgets', 'reports', rangeKey(range), today],
    queryFn: async () => {
      const active = await budgets.list();
      const out = [];
      for (const b of active) {
        const item = await budgets.overview(b.id, today);
        if (!item) continue;
        const periods = budgetPeriodsInRange(item.evaluation.periods, range);
        if (periods.length > 0) out.push({ item, periods });
      }
      return out;
    },
  });
}

export function useReportLines(query: ReportLineQuery) {
  const { reports } = useRepositories();
  return useQuery({
    queryKey: [
      'transactions',
      'reports',
      'lines',
      query.kind,
      query.categoryId ?? '',
      query.includeSubcategories ?? false,
      query.merchantKey ?? '',
      rangeKey(query.range),
    ],
    queryFn: () => reports.lines(query),
  });
}
