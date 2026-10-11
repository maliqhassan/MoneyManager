import type { CurrencyCode } from '../currency/currencies';
import { isCurrencyCode } from '../currency/currencies';
import type { CalendarDate } from '../dates/calendar';
import { normalizeMerchant } from '../merchants/normalize';
import type { EntryType } from '../transactions/transactions';
import {
  type AmountIssue,
  type ImportDateFormat,
  type ImportField,
  parseImportAmount,
  parseImportDate,
} from './parsing';

/**
 * Turning CSV records into an import PLAN. Nothing is written here; the plan
 * is what the user reviews and confirms.
 *
 * TYPE RULES (explicit, chosen by the user):
 * - 'signed': one amount column; its sign gives the direction
 *   (`negativeMeans` says whether negative is money out (expense) or in).
 * - 'debit_credit': two columns; exactly one must hold a non-zero value
 *   (debit = expense, credit = income); both or neither is rejected.
 * - 'type_column': a type column (expense/debit/withdrawal…,
 *   income/credit/deposit…, refund…) and the amount's magnitude.
 * Transfer rows are never imported as transfers (one CSV row is one leg);
 * they are skipped, or — only if the user chooses — imported as an ordinary
 * expense/income by the amount's sign.
 *
 * CURRENCY: amounts are in the target account's currency. A currency
 * column, when mapped, must match the account's currency (rows that differ
 * are rejected; nothing is converted and an account's currency never
 * changes).
 */

export type AmountMode = 'signed' | 'debit_credit' | 'type_column';

export interface ImportMapping {
  columns: Partial<Record<ImportField, number>>;
  amountMode: AmountMode;
  /** 'signed' mode: what a negative amount means. */
  negativeMeans: 'expense' | 'income';
  dateFormat: ImportDateFormat | null;
  decimal: '.' | ',';
  transferRows: 'skip' | 'as_ordinary';
}

export type RowIssue =
  | 'missing_date'
  | 'invalid_date'
  | AmountIssue
  | 'zero_amount'
  | 'debit_credit_both'
  | 'debit_credit_none'
  | 'unknown_type'
  | 'transfer_row'
  | 'invalid_currency'
  | 'currency_mismatch'
  | 'unmapped_account'
  | 'unmapped_category';

export interface ImportCandidate {
  line: number;
  localDate: CalendarDate;
  type: EntryType;
  /** Positive magnitude in `currency` minor units. */
  amountMinor: number;
  currency: CurrencyCode;
  payee: string | null;
  notes: string | null;
  categoryLabel: string | null;
  accountLabel: string | null;
  externalId: string | null;
}

const TYPE_WORDS: Record<string, EntryType | 'transfer'> = {
  expense: 'expense',
  debit: 'expense',
  dr: 'expense',
  withdrawal: 'expense',
  payment: 'expense',
  purchase: 'expense',
  spending: 'expense',
  charge: 'expense',
  fee: 'expense',
  income: 'income',
  credit: 'income',
  cr: 'income',
  deposit: 'income',
  salary: 'income',
  interest: 'income',
  refund: 'refund',
  return: 'refund',
  reversal: 'refund',
  transfer: 'transfer',
  xfer: 'transfer',
};

const cell = (cells: readonly string[], index: number | undefined) =>
  index === undefined ? '' : (cells[index] ?? '').trim();

const clip = (text: string, max: number) => (text === '' ? null : text.slice(0, max));

/** Reads one record. `currencyFor` gives the target account's currency for its label. */
export function interpretRecord(
  record: { line: number; cells: readonly string[] },
  mapping: ImportMapping,
  ctx: { timeZone: string; currencyFor: (accountLabel: string | null) => CurrencyCode | null },
): { ok: true; candidate: ImportCandidate } | { ok: false; line: number; issue: RowIssue } {
  const { cells, line } = record;
  const c = mapping.columns;
  const fail = (issue: RowIssue) => ({ ok: false as const, line, issue });

  const rawDate = cell(cells, c.date);
  if (rawDate === '') return fail('missing_date');
  const localDate = parseImportDate(rawDate, mapping.dateFormat, ctx.timeZone);
  if (!localDate) return fail('invalid_date');

  const accountLabel = c.account !== undefined ? clip(cell(cells, c.account), 100) : null;
  const accountCurrency = ctx.currencyFor(accountLabel);
  if (!accountCurrency) return fail('unmapped_account');

  let currency = accountCurrency;
  if (c.currency !== undefined && cell(cells, c.currency) !== '') {
    const code = cell(cells, c.currency).toUpperCase();
    if (!isCurrencyCode(code)) return fail('invalid_currency');
    if (code !== accountCurrency) return fail('currency_mismatch');
    currency = code;
  }

  const amountOf = (index: number | undefined) =>
    parseImportAmount(cell(cells, index), currency, mapping.decimal);

  let type: EntryType;
  let magnitude: number;
  if (mapping.amountMode === 'debit_credit') {
    const debitText = cell(cells, c.debit);
    const creditText = cell(cells, c.credit);
    const debit = debitText === '' ? null : amountOf(c.debit);
    const credit = creditText === '' ? null : amountOf(c.credit);
    if (debit && !debit.ok) return fail(debit.issue);
    if (credit && !credit.ok) return fail(credit.issue);
    const d = debit?.ok ? Math.abs(debit.minor) : 0;
    const cr = credit?.ok ? Math.abs(credit.minor) : 0;
    if (d > 0 && cr > 0) return fail('debit_credit_both');
    if (d === 0 && cr === 0) return fail(debit || credit ? 'zero_amount' : 'debit_credit_none');
    type = d > 0 ? 'expense' : 'income';
    magnitude = d > 0 ? d : cr;
  } else {
    const amount = amountOf(c.amount);
    if (!amount.ok) return fail(amount.issue);
    if (amount.minor === 0) return fail('zero_amount');
    const bySign: EntryType =
      amount.minor < 0
        ? mapping.negativeMeans
        : mapping.negativeMeans === 'expense'
          ? 'income'
          : 'expense';
    magnitude = Math.abs(amount.minor);
    if (mapping.amountMode === 'type_column') {
      const word = TYPE_WORDS[cell(cells, c.type).toLowerCase()];
      if (!word) return fail('unknown_type');
      if (word === 'transfer') {
        if (mapping.transferRows === 'skip') return fail('transfer_row');
        // Explicitly requested: an ordinary entry by the sign (negative = money out).
        type = amount.minor < 0 ? 'expense' : 'income';
      } else type = word;
    } else type = bySign;
  }

  return {
    ok: true,
    candidate: {
      line,
      localDate,
      type,
      amountMinor: magnitude,
      currency,
      payee: clip(cell(cells, c.payee), 200),
      notes: clip(cell(cells, c.notes), 1000),
      categoryLabel: clip(cell(cells, c.category), 100),
      accountLabel,
      externalId: clip(cell(cells, c.externalId), 120),
    },
  };
}

// ---------------------------------------------------------- identities ----

/** FNV-1a 64-bit, hex. Deterministic and dependency-free (not cryptographic). */
export function fnv1a64(text: string): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= BigInt(text.charCodeAt(i));
    hash = (hash * prime) & mask;
  }
  return hash.toString(16).padStart(16, '0');
}

/** Signed amount from the account's point of view (expense < 0). */
export const signedOf = (c: Pick<ImportCandidate, 'type' | 'amountMinor'>) =>
  c.type === 'expense' ? -c.amountMinor : c.amountMinor;

/**
 * Stable identity of each candidate, stored as `transactions.import_hash`.
 * - With an external id: hash("x|account|id"). A repeated id is the same
 *   transaction.
 * - Otherwise: hash("f|account|date|type|amount|currency|merchant#n") where
 *   n numbers identical rows within the file (1, 2, …). Re-importing the same
 *   file reproduces the same identities; two genuinely identical purchases
 *   in one file stay distinct.
 * The account id is a per-user UUID, so identities never collide across users.
 */
export function importHashes(
  rows: readonly { candidate: ImportCandidate; accountId: string }[],
): string[] {
  const seen = new Map<string, number>();
  return rows.map(({ candidate: c, accountId }) => {
    if (c.externalId) return `x:${fnv1a64(`x|${accountId}|${c.externalId}`)}`;
    const key = [
      'f',
      accountId,
      c.localDate,
      c.type,
      c.amountMinor,
      c.currency,
      normalizeMerchant(c.payee) ?? '',
    ].join('|');
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    return `f:${fnv1a64(`${key}#${n}`)}`;
  });
}

/** Key used to find possible duplicates among existing transactions. */
export const matchKey = (
  accountId: string,
  localDate: string,
  signedMinor: number,
  currency: string,
) => `${accountId}|${localDate}|${signedMinor}|${currency}`;

// ---------------------------------------------------------------- plan ----

export type PlanStatus =
  | 'new'
  /** Same identity already imported: always skipped (idempotent re-import). */
  | 'already_imported'
  /** Matches an existing transaction (same account, date, amount): skipped unless included. */
  | 'possible_duplicate'
  | 'error';

export interface PlanRow {
  line: number;
  status: PlanStatus;
  issue: RowIssue | null;
  candidate: ImportCandidate | null;
  accountId: string | null;
  categoryId: string | null;
  hash: string | null;
  /** Whether the row will be imported (users may include possible duplicates). */
  include: boolean;
}

export interface PlanContext {
  timeZone: string;
  /** Resolves an account label (null = the single target account). */
  accountFor: (label: string | null) => { id: string; currency: CurrencyCode } | null;
  /** Resolves a category label for a kind (mapping, else fallback; null = unmapped). */
  categoryFor: (kind: 'expense' | 'income', label: string | null) => string | null;
  /** Identities already present among the user's transactions. */
  existingHashes: ReadonlySet<string>;
  /** Count of existing transactions per `matchKey`. */
  existingMatches: ReadonlyMap<string, number>;
}

export function buildPlan(
  records: readonly { line: number; cells: readonly string[] }[],
  mapping: ImportMapping,
  ctx: PlanContext,
): PlanRow[] {
  const interpreted = records.map((r) =>
    interpretRecord(r, mapping, {
      timeZone: ctx.timeZone,
      currencyFor: (label) => ctx.accountFor(label)?.currency ?? null,
    }),
  );
  const good: {
    index: number;
    candidate: ImportCandidate;
    accountId: string;
    categoryId: string | null;
  }[] = [];
  const rows: PlanRow[] = interpreted.map((r, index) => {
    if (!r.ok) {
      return {
        line: r.line,
        status: 'error',
        issue: r.issue,
        candidate: null,
        accountId: null,
        categoryId: null,
        hash: null,
        include: false,
      };
    }
    const c = r.candidate;
    const account = ctx.accountFor(c.accountLabel)!;
    const categoryId = ctx.categoryFor(c.type === 'income' ? 'income' : 'expense', c.categoryLabel);
    if (!categoryId) {
      return {
        line: c.line,
        status: 'error',
        issue: 'unmapped_category',
        candidate: c,
        accountId: account.id,
        categoryId: null,
        hash: null,
        include: false,
      };
    }
    good.push({ index, candidate: c, accountId: account.id, categoryId });
    return {
      line: c.line,
      status: 'new',
      issue: null,
      candidate: c,
      accountId: account.id,
      categoryId,
      hash: null,
      include: true,
    };
  });

  const hashes = importHashes(good);
  const remaining = new Map(ctx.existingMatches);
  const consume = (key: string) => {
    const n = remaining.get(key) ?? 0;
    if (n > 0) remaining.set(key, n - 1);
    return n > 0;
  };
  // 1) Already imported: always skipped, and accounts for its own existing match.
  good.forEach((g, i) => {
    const row = rows[g.index]!;
    row.hash = hashes[i]!;
    if (ctx.existingHashes.has(row.hash)) {
      row.status = 'already_imported';
      row.include = false;
      consume(
        matchKey(g.accountId, g.candidate.localDate, signedOf(g.candidate), g.candidate.currency),
      );
    }
  });
  // 2) Possible duplicates of transactions entered another way: skipped by default.
  good.forEach((g) => {
    const row = rows[g.index]!;
    if (row.status !== 'new') return;
    const key = matchKey(
      g.accountId,
      g.candidate.localDate,
      signedOf(g.candidate),
      g.candidate.currency,
    );
    if (consume(key)) {
      row.status = 'possible_duplicate';
      row.include = false;
    }
  });
  return rows;
}

export interface PlanSummary {
  total: number;
  toImport: number;
  alreadyImported: number;
  possibleDuplicates: number;
  errors: number;
  /** Error counts per issue. */
  issues: Partial<Record<RowIssue, number>>;
}

export function summarizePlan(rows: readonly PlanRow[]): PlanSummary {
  const issues: Partial<Record<RowIssue, number>> = {};
  for (const r of rows) if (r.issue) issues[r.issue] = (issues[r.issue] ?? 0) + 1;
  return {
    total: rows.length,
    toImport: rows.filter((r) => r.include).length,
    alreadyImported: rows.filter((r) => r.status === 'already_imported').length,
    possibleDuplicates: rows.filter((r) => r.status === 'possible_duplicate').length,
    errors: rows.filter((r) => r.status === 'error').length,
    issues,
  };
}
