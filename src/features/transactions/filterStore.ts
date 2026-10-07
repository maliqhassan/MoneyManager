import { create } from 'zustand';

import type { TransactionType } from '@/domain/enums';

/**
 * Transactions tab filter state (UI state only, not persisted). The list
 * query reads it; the filter screen edits a draft and applies it.
 */
export interface TransactionFilterState {
  search: string;
  accountIds: string[];
  categoryIds: string[];
  types: TransactionType[];
  from: string | null;
  to: string | null;
  minAmount: string;
  maxAmount: string;
  tagNames: string[];
}

export const EMPTY_FILTERS: TransactionFilterState = {
  search: '',
  accountIds: [],
  categoryIds: [],
  types: [],
  from: null,
  to: null,
  minAmount: '',
  maxAmount: '',
  tagNames: [],
};

/** Number of active filters (search excluded), for the badge. */
export function activeFilterCount(f: TransactionFilterState): number {
  return (
    (f.accountIds.length > 0 ? 1 : 0) +
    (f.categoryIds.length > 0 ? 1 : 0) +
    (f.types.length > 0 ? 1 : 0) +
    (f.from || f.to ? 1 : 0) +
    (f.minAmount || f.maxAmount ? 1 : 0) +
    (f.tagNames.length > 0 ? 1 : 0)
  );
}

interface FilterStore {
  filters: TransactionFilterState;
  setSearch: (search: string) => void;
  apply: (filters: Omit<TransactionFilterState, 'search'>) => void;
  clear: () => void;
}

export const useTransactionFilters = create<FilterStore>()((set) => ({
  filters: EMPTY_FILTERS,
  setSearch: (search) => set((s) => ({ filters: { ...s.filters, search } })),
  apply: (next) => set((s) => ({ filters: { ...next, search: s.filters.search } })),
  clear: () => set((s) => ({ filters: { ...EMPTY_FILTERS, search: s.filters.search } })),
}));
