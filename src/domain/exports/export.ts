import type { CurrencyCode } from '../currency/currencies';
import { protectText, toCsv } from '../csv/csv';
import { money, toMajorString } from '../money/money';

/**
 * Export format (version 1). Each table is a CSV file with a header row,
 * comma-separated, UTF-8 with a byte-order mark (so spreadsheet apps detect
 * the encoding), CRLF line endings and RFC 4180 quoting.
 *
 * - Amounts are exact decimals with "." as the separator ("-12.50"), plus the
 *   integer minor units ("-1250") and the ISO currency code. Signs are from
 *   the account's point of view (money out < 0).
 * - Dates are ISO "YYYY-MM-DD" (the transaction's local date) — plus the
 *   date in the user's chosen display format, the local time, the time zone
 *   and the UTC instant.
 * - Free-text fields (names, merchants, notes, tags) that start with
 *   = + - @ TAB or CR are prefixed with an apostrophe (') so spreadsheets
 *   never run them as formulas. Numbers, dates and ids are never altered.
 */

export const EXPORT_FORMAT_VERSION = 1;

export type ExportValue = string | number | boolean | null;

export interface ExportColumn {
  key: string;
  /** Free text written by users: protected against formula injection. */
  text?: boolean;
}

export interface ExportTable {
  file: string;
  columns: readonly ExportColumn[];
  rows: readonly Record<string, ExportValue>[];
}

const BOM = '\uFEFF';

function renderValue(value: ExportValue, text: boolean): string {
  if (value === null) return '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return String(value);
  return text ? protectText(value) : value;
}

/** CSV text for a table (header row = column keys). */
export function renderTable(table: ExportTable): string {
  const header = table.columns.map((c) => c.key);
  const body = table.rows.map((row) =>
    table.columns.map((c) => renderValue(row[c.key] ?? null, c.text === true)),
  );
  return BOM + toCsv([header, ...body]);
}

/** Exact decimal amount ("-12.50") for minor units in a currency. */
export function decimalAmount(amountMinor: number, currency: CurrencyCode): string {
  return toMajorString(money(amountMinor, currency));
}

const col = (key: string, text = false): ExportColumn => (text ? { key, text } : { key });

export const TRANSACTION_COLUMNS: readonly ExportColumn[] = [
  col('transaction_id'),
  col('date'),
  col('date_display'),
  col('time'),
  col('time_zone'),
  col('occurred_at_utc'),
  col('type'),
  col('amount'),
  col('amount_minor'),
  col('currency'),
  col('base_amount'),
  col('base_currency'),
  col('base_conversion'),
  col('account', true),
  col('account_id'),
  col('category', true),
  col('subcategory', true),
  col('category_id'),
  col('merchant', true),
  col('notes', true),
  col('tags', true),
  col('transfer_id'),
  col('transfer_other_account', true),
  col('refund_of_transaction_id'),
  col('split_count'),
  col('sync_status'),
];

export const SPLIT_COLUMNS: readonly ExportColumn[] = [
  col('transaction_id'),
  col('split_index'),
  col('amount'),
  col('amount_minor'),
  col('currency'),
  col('category', true),
  col('subcategory', true),
  col('category_id'),
  col('notes', true),
];

export const ACCOUNT_COLUMNS: readonly ExportColumn[] = [
  col('account_id'),
  col('name', true),
  col('type'),
  col('currency'),
  col('opening_balance'),
  col('opening_balance_date'),
  col('current_balance'),
  col('credit_limit'),
  col('include_in_totals'),
  col('archived'),
  col('notes', true),
];

export const CATEGORY_COLUMNS: readonly ExportColumn[] = [
  col('category_id'),
  col('name', true),
  col('kind'),
  col('parent_category', true),
  col('parent_id'),
  col('archived'),
  col('system_key'),
];

export const BUDGET_COLUMNS: readonly ExportColumn[] = [
  col('budget_id'),
  col('name', true),
  col('category', true),
  col('category_id'),
  col('period_type'),
  col('start_date'),
  col('end_date'),
  col('currency'),
  col('current_amount'),
  col('rollover'),
  col('archived'),
];

export const BUDGET_REVISION_COLUMNS: readonly ExportColumn[] = [
  col('budget_id'),
  col('effective_from'),
  col('amount'),
  col('currency'),
  col('rollover'),
];

export const BILL_COLUMNS: readonly ExportColumn[] = [
  col('bill_id'),
  col('name', true),
  col('kind'),
  col('amount'),
  col('currency'),
  col('amount_varies'),
  col('account', true),
  col('category', true),
  col('frequency'),
  col('interval'),
  col('first_due_date'),
  col('next_due_date'),
  col('end_date'),
  col('reminder_days_before'),
  col('autopay'),
  col('active'),
  col('notes', true),
];

export const BILL_PAYMENT_COLUMNS: readonly ExportColumn[] = [
  col('payment_id'),
  col('bill_id'),
  col('due_date'),
  col('status'),
  col('paid_at_utc'),
  col('amount'),
  col('currency'),
  col('transaction_id'),
];

export const GOAL_COLUMNS: readonly ExportColumn[] = [
  col('goal_id'),
  col('name', true),
  col('target_amount'),
  col('currency'),
  col('target_date'),
  col('account', true),
  col('status'),
];

export const GOAL_CONTRIBUTION_COLUMNS: readonly ExportColumn[] = [
  col('contribution_id'),
  col('goal_id'),
  col('date'),
  col('amount'),
  col('currency'),
  col('account', true),
  col('transfer_id'),
  col('notes', true),
];

export interface ManifestInput {
  exportedAt: string;
  appVersion: string;
  baseCurrency: CurrencyCode;
  timeZone: string;
  range: { start: string; end: string } | null;
  accountFilter: readonly string[];
  typeFilter: readonly string[];
  files: readonly { file: string; rows: number }[];
  pendingLocalChanges: number;
}

/** Machine-readable manifest (manifest.json). */
export function manifestJson(m: ManifestInput): string {
  return JSON.stringify(
    {
      format: 'moneymanager-export',
      formatVersion: EXPORT_FORMAT_VERSION,
      exportedAt: m.exportedAt,
      appVersion: m.appVersion,
      baseCurrency: m.baseCurrency,
      timeZone: m.timeZone,
      transactionDateRange: m.range,
      accountFilter: m.accountFilter,
      typeFilter: m.typeFilter,
      files: m.files,
      pendingLocalChanges: m.pendingLocalChanges,
      containsUnsyncedChanges: m.pendingLocalChanges > 0,
      attachmentsIncluded: false,
      restorable: false,
    },
    null,
    2,
  );
}

/** Human-readable description of the export (README.txt). */
export function readmeText(m: ManifestInput): string {
  const range = m.range ? `${m.range.start} to ${m.range.end}` : 'all dates';
  return [
    'MoneyManager data export',
    `Format version ${EXPORT_FORMAT_VERSION}, exported ${m.exportedAt} (app ${m.appVersion}).`,
    '',
    `Transactions: ${range}.`,
    m.accountFilter.length ? `Accounts: ${m.accountFilter.length} selected.` : 'Accounts: all.',
    m.typeFilter.length ? `Types: ${m.typeFilter.join(', ')}.` : 'Types: all.',
    'Accounts, categories, budgets, bills and goals are exported in full (current state).',
    '',
    'FILES',
    ...m.files.map((f) => `  ${f.file} — ${f.rows} rows`),
    '',
    'CONVENTIONS',
    '  - CSV, UTF-8 (with BOM), comma-separated, RFC 4180 quoting, CRLF line endings.',
    '  - Amounts: exact decimals with "." as separator plus integer minor units and',
    '    the ISO currency code. Signs are from the account’s point of view (money out < 0).',
    `  - base_amount is the conversion to ${m.baseCurrency} recorded when the entry was saved;`,
    '    base_conversion "unconverted" means no exchange rate was known.',
    '  - Dates: ISO YYYY-MM-DD local dates; date_display uses your date format;',
    '    occurred_at_utc is the exact instant.',
    "  - Free text starting with = + - @ TAB or CR is prefixed with an apostrophe (')",
    '    to stop spreadsheets running it as a formula.',
    '',
    'RELATIONSHIPS',
    '  - A transfer is two transaction rows (one per account) with the same transfer_id;',
    '    transfer_other_account names the other side.',
    '  - refund_of_transaction_id links a refund to the expense it refunds.',
    '  - Split transactions: split_count > 0 and the parts are in transaction_splits.csv',
    '    (joined by transaction_id); the parts add up to the transaction amount.',
    '  - budget_revisions.csv holds each budget amount and the date it applies from.',
    '  - bill_payments.transaction_id and goal_contributions.transfer_id link to transactions.',
    '',
    'LIMITATIONS',
    '  - Receipt images and other attachments are not included.',
    '  - This is an export, not a backup: MoneyManager cannot restore from it.',
    m.pendingLocalChanges > 0
      ? `  - Contains ${m.pendingLocalChanges} change(s) saved on this device that were not yet synced.`
      : '  - All included changes had been synced when exported.',
    '  - No passwords, tokens or keys are included.',
    '',
  ].join('\r\n');
}
