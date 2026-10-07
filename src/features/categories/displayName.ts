import type { TFunction } from 'i18next';

import { findDefaultCategory } from '@/domain/categories/defaults';

/**
 * Default categories are seeded with English names and a system key. While
 * the user has not renamed one, show it translated; once renamed, the user's
 * own name always wins.
 */
export function categoryDisplayName(
  t: TFunction,
  category: { name: string | null; systemKey: string | null } | null | undefined,
  fallback = '',
): string {
  if (!category?.name) return fallback;
  const seeded = findDefaultCategory(category.systemKey);
  if (seeded && seeded.name === category.name) {
    return t(`categories.system.${seeded.key}` as 'categories.system.housing', {
      defaultValue: category.name,
    });
  }
  return category.name;
}
