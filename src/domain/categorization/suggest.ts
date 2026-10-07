import type { RuleMatchField, RuleMatchType } from '../enums';
import { normalizeSearchText } from '../text/search';

/**
 * Deterministic category suggestion — no AI. Order:
 *   1. an enabled user rule matching the payee/notes (highest priority first)
 *   2. the category the user last used for the same normalised merchant
 *   3. nothing (the user chooses)
 * Every manual categorisation therefore teaches step 2 automatically, and the
 * user can make it permanent with a rule.
 */

export interface SuggestionRule {
  id: string;
  matchField: RuleMatchField;
  matchType: RuleMatchType;
  pattern: string;
  categoryId: string;
  priority: number;
  isEnabled: boolean;
  createdAt: string;
}

export interface SuggestionInput {
  payee: string | null;
  notes: string | null;
  merchantKey: string | null;
  rules: readonly SuggestionRule[];
  /** Category of the most recent transaction with the same merchant key, if any. */
  lastCategoryForMerchant: string | null;
  /** Categories that may be suggested (active, right kind). */
  allowedCategoryIds: ReadonlySet<string>;
}

export type CategorySuggestion = {
  categoryId: string;
  source: 'rule' | 'history';
  ruleId?: string;
};

export function ruleMatches(
  rule: Pick<SuggestionRule, 'matchField' | 'matchType' | 'pattern'>,
  text: string,
): boolean {
  const haystack = normalizeSearchText(text);
  const needle = normalizeSearchText(rule.pattern);
  if (!needle || !haystack) return false;
  switch (rule.matchType) {
    case 'equals':
      return haystack === needle;
    case 'starts_with':
      return haystack.startsWith(needle);
    case 'contains':
      return haystack.includes(needle);
  }
}

export function suggestCategory(input: SuggestionInput): CategorySuggestion | null {
  const ordered = [...input.rules]
    .filter((r) => r.isEnabled && input.allowedCategoryIds.has(r.categoryId))
    .sort(
      (a, b) =>
        b.priority - a.priority ||
        a.createdAt.localeCompare(b.createdAt) ||
        a.id.localeCompare(b.id),
    );

  for (const rule of ordered) {
    const text =
      rule.matchField === 'payee'
        ? // Payee rules match the original text or the normalised merchant key.
          [input.payee ?? '', input.merchantKey ?? '']
        : [input.notes ?? ''];
    if (text.some((t) => ruleMatches(rule, t))) {
      return { categoryId: rule.categoryId, source: 'rule', ruleId: rule.id };
    }
  }

  if (
    input.lastCategoryForMerchant &&
    input.allowedCategoryIds.has(input.lastCategoryForMerchant)
  ) {
    return { categoryId: input.lastCategoryForMerchant, source: 'history' };
  }
  return null;
}
