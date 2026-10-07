import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import type { CategoryKind } from '@/domain/enums';
import { addDays } from '@/domain/dates/calendar';
import { useFormatter } from '@/i18n/FormatContext';
import { useRepositories } from '@/providers/DataProvider';
import type { CategoryInput, CategoryUpdate } from '@/validation/entities';

import { categoryDisplayName } from './displayName';

export function useCategories(options: { kind?: CategoryKind; includeArchived?: boolean } = {}) {
  const { categories } = useRepositories();
  return useQuery({
    queryKey: ['categories', 'list', options.kind ?? 'all', options.includeArchived ?? false],
    queryFn: () => categories.list(options),
  });
}

export function useCategory(id: string) {
  const { categories } = useRepositories();
  return useQuery({
    queryKey: ['categories', 'detail', id],
    enabled: id.length > 0,
    queryFn: async () => {
      const [category, usage] = await Promise.all([
        categories.getById(id),
        categories.getUsage(id),
      ]);
      return category ? { category, usage } : null;
    },
  });
}

export function useFrequentCategoryIds(kind: CategoryKind) {
  const { transactions } = useRepositories();
  const today = useFormatter().today();
  return useQuery({
    queryKey: ['transactions', 'frequent-categories', kind, today],
    queryFn: () => transactions.frequentCategoryIds(kind, addDays(today, -90), 6),
  });
}

export function useTags() {
  const { tags } = useRepositories();
  return useQuery({ queryKey: ['tags'], queryFn: () => tags.list() });
}

export function useCategoryMutations() {
  const { categories } = useRepositories();
  return {
    create: useMutation({ mutationFn: (input: CategoryInput) => categories.create(input) }),
    update: useMutation({
      mutationFn: ({ id, patch }: { id: string; patch: CategoryUpdate }) =>
        categories.update(id, patch),
    }),
    setArchived: useMutation({
      mutationFn: ({ id, archived }: { id: string; archived: boolean }) =>
        categories.setArchived(id, archived),
    }),
    remove: useMutation({ mutationFn: (id: string) => categories.remove(id) }),
    move: useMutation({
      mutationFn: ({ id, direction }: { id: string; direction: 'up' | 'down' }) =>
        categories.move(id, direction),
    }),
  };
}

/** Display name resolver bound to the current language. */
export function useCategoryName() {
  const { t } = useTranslation();
  return (
    category: { name: string | null; systemKey: string | null } | null | undefined,
    fallback = '',
  ) => categoryDisplayName(t, category, fallback);
}
