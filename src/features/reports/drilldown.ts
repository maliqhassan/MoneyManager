import { type Href, router } from 'expo-router';

import type { DateRange } from '@/domain/reports/periods';

export type DrillDown =
  | { kind: 'income' | 'spending'; title: string; range: DateRange }
  | {
      kind: 'category';
      title: string;
      range: DateRange;
      categoryId: string | null;
      includeSubcategories: boolean;
    }
  | { kind: 'merchant'; title: string; range: DateRange; merchantKey: string | null };

/** Opens the transactions behind a report value (same query, same range). */
export function openDrillDown(d: DrillDown): void {
  const params = new URLSearchParams({
    kind: d.kind,
    title: d.title,
    from: d.range.start,
    to: d.range.end,
  });
  if (d.kind === 'category') {
    params.set('categoryId', d.categoryId ?? '');
    params.set('sub', d.includeSubcategories ? '1' : '0');
  }
  if (d.kind === 'merchant') params.set('merchantKey', d.merchantKey ?? '');
  router.push(`/reports/transactions?${params.toString()}` as Href);
}
