import type { CurrencyCode } from '@/domain/currency/currencies';
import type { CsvRecord } from '@/domain/csv/csv';
import {
  buildPlan,
  type ImportMapping,
  interpretRecord,
  type PlanRow,
} from '@/domain/imports/plan';
import type { Account, Category } from '@/domain/models';
import { normalizeSearchText } from '@/domain/text/search';
import type { Repositories } from '@/repositories/types';
import type { TransactionInput } from '@/validation/transactions';

/**
 * Connects the pure import plan (domain/imports) to the user's data: which
 * accounts/categories labels map to, which identities already exist, and
 * which transactions look like possible duplicates. Nothing is written.
 */

export type CategoryKindKey = 'expense' | 'income';

export interface ImportSelections {
  /** Target account when the file has no account column (or a row leaves it blank). */
  targetAccountId: string | null;
  /** Account label (from the file) → account id. */
  accountMap: Record<string, string>;
  /** `${kind}:${label}` → category id. */
  categoryMap: Record<string, string>;
  /** Category for rows with no (or an unmapped) category, per kind. */
  fallback: Record<CategoryKindKey, string | null>;
}

export const categoryKey = (kind: CategoryKindKey, label: string) => `${kind}:${label}`;

/** Labels found in the file that need mapping. */
export function collectLabels(
  records: readonly CsvRecord[],
  mapping: ImportMapping,
  timeZone: string,
  anyCurrency: CurrencyCode,
): { accounts: string[]; categories: { kind: CategoryKindKey; label: string }[] } {
  const accounts = new Set<string>();
  const categories = new Map<string, { kind: CategoryKindKey; label: string }>();
  for (const r of records) {
    const result = interpretRecord(r, mapping, { timeZone, currencyFor: () => anyCurrency });
    if (!result.ok) {
      // Still collect the account label so the user can map it.
      const index = mapping.columns.account;
      const label = index === undefined ? '' : (r.cells[index] ?? '').trim();
      if (label) accounts.add(label);
      continue;
    }
    const c = result.candidate;
    if (c.accountLabel) accounts.add(c.accountLabel);
    if (c.categoryLabel) {
      const kind: CategoryKindKey = c.type === 'income' ? 'income' : 'expense';
      categories.set(categoryKey(kind, c.categoryLabel), { kind, label: c.categoryLabel });
    }
  }
  return {
    accounts: [...accounts].sort((a, b) => a.localeCompare(b)),
    categories: [...categories.values()].sort((a, b) => a.label.localeCompare(b.label)),
  };
}

const same = (a: string, b: string) => normalizeSearchText(a) === normalizeSearchText(b);

/**
 * Suggestions only where exactly ONE active account / category has the same
 * name (case- and accent-insensitive; categories also by their translated
 * name). Ambiguous or unknown labels stay unmapped for the user to choose.
 */
export function autoMatch(
  labels: ReturnType<typeof collectLabels>,
  accounts: readonly Account[],
  categories: readonly Category[],
  displayName: (c: Category) => string,
): Pick<ImportSelections, 'accountMap' | 'categoryMap'> {
  const accountMap: Record<string, string> = {};
  for (const label of labels.accounts) {
    const hits = accounts.filter((a) => !a.isArchived && same(a.name, label));
    if (hits.length === 1) accountMap[label] = hits[0]!.id;
  }
  const categoryMap: Record<string, string> = {};
  for (const { kind, label } of labels.categories) {
    const hits = categories.filter(
      (c) =>
        !c.isArchived && c.kind === kind && (same(c.name, label) || same(displayName(c), label)),
    );
    if (hits.length === 1) categoryMap[categoryKey(kind, label)] = hits[0]!.id;
  }
  return { accountMap, categoryMap };
}

/** Builds the reviewed plan against the user's data (two passes: identities, then lookups). */
export async function planImport(input: {
  repos: Pick<Repositories, 'imports'>;
  records: readonly CsvRecord[];
  mapping: ImportMapping;
  selections: ImportSelections;
  accounts: readonly Account[];
  categories: readonly Category[];
  timeZone: string;
}): Promise<PlanRow[]> {
  const { repos, records, mapping, selections, timeZone } = input;
  const active = new Map(input.accounts.filter((a) => !a.isArchived).map((a) => [a.id, a]));
  const activeCategories = new Map(
    input.categories.filter((c) => !c.isArchived).map((c) => [c.id, c]),
  );
  const accountFor = (label: string | null) => {
    const id =
      mapping.columns.account !== undefined && label
        ? selections.accountMap[label]
        : selections.targetAccountId;
    const account = id ? active.get(id) : undefined;
    return account ? { id: account.id, currency: account.currency } : null;
  };
  const categoryFor = (kind: CategoryKindKey, label: string | null) => {
    const id =
      (label ? selections.categoryMap[categoryKey(kind, label)] : undefined) ??
      selections.fallback[kind];
    const category = id ? activeCategories.get(id) : undefined;
    return category && category.kind === kind ? category.id : null;
  };
  const base = { timeZone, accountFor, categoryFor };
  const first = buildPlan(records, mapping, {
    ...base,
    existingHashes: new Set(),
    existingMatches: new Map(),
  });
  const valid = first.filter((r) => r.candidate && r.hash && r.accountId);
  if (valid.length === 0) return first;
  const dates = valid.map((r) => r.candidate!.localDate).sort();
  const [existingHashes, existingMatches] = await Promise.all([
    repos.imports.existingHashes(valid.map((r) => r.hash!)),
    repos.imports.existingMatches(
      [...new Set(valid.map((r) => r.accountId!))],
      dates[0]!,
      dates[dates.length - 1]!,
    ),
  ]);
  return buildPlan(records, mapping, { ...base, existingHashes, existingMatches });
}

/**
 * A planned row as a normal transaction input. CSV rows carry no time, so
 * entries are placed at 12:00 local time on their date (never near
 * midnight, so no time-zone or DST shift can move them to another day).
 */
export function toTransactionInput(row: PlanRow, timeZone: string): TransactionInput {
  const c = row.candidate!;
  return {
    type: c.type,
    accountId: row.accountId!,
    amountMinor: c.amountMinor,
    localDate: c.localDate,
    localTime: '12:00',
    timeZone,
    payee: c.payee,
    notes: c.notes,
    categoryId: row.categoryId,
    splits: [],
    tagNames: [],
    refundOfTransactionId: null,
  };
}

/** Rows that will be written, with their identities. */
export function rowsToImport(rows: readonly PlanRow[], timeZone: string) {
  return rows
    .filter((r) => r.include && r.hash && r.candidate)
    .map((r) => ({ hash: r.hash!, input: toTransactionInput(r, timeZone) }));
}
