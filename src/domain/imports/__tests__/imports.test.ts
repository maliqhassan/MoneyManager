import type { CurrencyCode } from '../../currency/currencies';
import {
  detectDateFormats,
  detectDecimalSeparator,
  parseImportAmount,
  parseImportDate,
  suggestMapping,
} from '../parsing';
import {
  buildPlan,
  fnv1a64,
  type ImportMapping,
  importHashes,
  interpretRecord,
  matchKey,
  summarizePlan,
} from '../plan';

describe('dates', () => {
  it('reads year-first dates regardless of format and ignores a time', () => {
    expect(parseImportDate('2026-10-05', null, 'UTC')).toBe('2026-10-05');
    expect(parseImportDate('2026/1/5 14:30', 'DMY', 'UTC')).toBe('2026-01-05');
  });

  it('needs an explicit format for day/month dates and rejects invalid ones', () => {
    expect(parseImportDate('03/04/2026', null, 'UTC')).toBeNull();
    expect(parseImportDate('03/04/2026', 'DMY', 'UTC')).toBe('2026-04-03');
    expect(parseImportDate('03/04/2026', 'MDY', 'UTC')).toBe('2026-03-04');
    expect(parseImportDate('31.12.2026', 'DMY', 'UTC')).toBe('2026-12-31');
    expect(parseImportDate('13/31/2026', 'DMY', 'UTC')).toBeNull();
    expect(parseImportDate('29/02/2027', 'DMY', 'UTC')).toBeNull();
    expect(parseImportDate('29/02/2028', 'DMY', 'UTC')).toBe('2028-02-29');
    expect(parseImportDate('03/04/26', 'DMY', 'UTC')).toBeNull(); // 2-digit year
    expect(parseImportDate('03/04/2026', 'YMD', 'UTC')).toBeNull();
    expect(parseImportDate('yesterday', 'DMY', 'UTC')).toBeNull();
    expect(parseImportDate('', 'DMY', 'UTC')).toBeNull();
  });

  it('converts timestamps with an offset to the user time zone', () => {
    // 03:30 UTC on 1 Nov is still 31 Oct in New York.
    expect(parseImportDate('2026-11-01T03:30:00Z', null, 'America/New_York')).toBe('2026-10-31');
    expect(parseImportDate('2026-11-01T03:30:00+05:00', null, 'UTC')).toBe('2026-10-31');
    expect(parseImportDate('2026-13-01T03:30:00Z', null, 'UTC')).toBeNull();
  });

  it('detects ambiguity instead of guessing', () => {
    expect(detectDateFormats(['03/04/2026', '05/06/2026'])).toEqual(['DMY', 'MDY']);
    expect(detectDateFormats(['03/04/2026', '25/06/2026'])).toEqual(['DMY']);
    expect(detectDateFormats(['2026-10-01', ''])).toEqual(['YMD']);
    expect(detectDateFormats(['nonsense'])).toEqual([]);
    expect(detectDateFormats([])).toEqual([]);
  });
});

describe('amounts', () => {
  it('parses exactly with an explicit decimal separator', () => {
    expect(parseImportAmount('1,234.56', 'USD', '.')).toEqual({ ok: true, minor: 123_456 });
    expect(parseImportAmount('1.234,56', 'EUR', ',')).toEqual({ ok: true, minor: 123_456 });
    expect(parseImportAmount("1'234.50 CHF", 'CHF', '.')).toEqual({ ok: true, minor: 123_450 });
    expect(parseImportAmount('$ -12.50', 'USD', '.')).toEqual({ ok: true, minor: -1_250 });
    expect(parseImportAmount('12.50-', 'USD', '.')).toEqual({ ok: true, minor: -1_250 });
    expect(parseImportAmount('(12.50)', 'USD', '.')).toEqual({ ok: true, minor: -1_250 });
    expect(parseImportAmount('\u22127', 'USD', '.')).toEqual({ ok: true, minor: -700 });
    expect(parseImportAmount('Rs 1,500', 'PKR', '.')).toEqual({ ok: true, minor: 150_000 });
    expect(parseImportAmount('0', 'USD', '.')).toEqual({ ok: true, minor: 0 });
  });

  it('respects currency minor units and rejects bad values', () => {
    expect(parseImportAmount('1500', 'JPY', '.')).toEqual({ ok: true, minor: 1_500 });
    expect(parseImportAmount('15.5', 'JPY', '.')).toEqual({
      ok: false,
      issue: 'too_many_decimals',
    });
    expect(parseImportAmount('1.234', 'KWD', '.')).toEqual({ ok: true, minor: 1_234 });
    expect(parseImportAmount('1.2345', 'KWD', '.')).toEqual({
      ok: false,
      issue: 'too_many_decimals',
    });
    expect(parseImportAmount('', 'USD', '.')).toEqual({ ok: false, issue: 'missing_amount' });
    expect(parseImportAmount('12-3', 'USD', '.')).toEqual({ ok: false, issue: 'invalid_amount' });
    expect(parseImportAmount('abc', 'USD', '.')).toEqual({ ok: false, issue: 'invalid_amount' });
    expect(parseImportAmount('1.2.3', 'USD', '.')).toEqual({ ok: false, issue: 'invalid_amount' });
  });

  it('reports which decimal separators read every value', () => {
    expect(detectDecimalSeparator(['1,234.56', '12.00'])).toEqual(['.']);
    expect(detectDecimalSeparator(['12,505', '3,999'])).toEqual(['.']);
    expect(detectDecimalSeparator(['12,50', '3,99'])).toEqual(['.', ',']);
  });
});

describe('column suggestions', () => {
  it('matches common header names exactly (user confirms)', () => {
    expect(
      suggestMapping([
        'Transaction Date',
        'Description',
        'Debit',
        'Credit',
        'Currency',
        'Memo',
        'Transaction ID',
        'Other',
      ]),
    ).toEqual({ date: 0, payee: 1, debit: 2, credit: 3, currency: 4, notes: 5, externalId: 6 });
    expect(suggestMapping(['Fecha', 'Importe'])).toEqual({});
  });
});

const base: ImportMapping = {
  columns: { date: 0, amount: 1, payee: 2 },
  amountMode: 'signed',
  negativeMeans: 'expense',
  dateFormat: 'DMY',
  decimal: '.',
  transferRows: 'skip',
};
const usd = { timeZone: 'UTC', currencyFor: (): CurrencyCode => 'USD' };
const rec = (...cells: string[]) => ({ line: 2, cells });

describe('row interpretation', () => {
  it('signed amounts follow the chosen convention', () => {
    expect(interpretRecord(rec('05/10/2026', '-12.50', 'Cafe'), base, usd)).toMatchObject({
      ok: true,
      candidate: { localDate: '2026-10-05', type: 'expense', amountMinor: 1_250, payee: 'Cafe' },
    });
    expect(
      interpretRecord(
        rec('05/10/2026', '12.50', 'Cafe'),
        { ...base, negativeMeans: 'income' },
        usd,
      ),
    ).toMatchObject({
      candidate: { type: 'expense' },
    });
    expect(interpretRecord(rec('05/10/2026', '0', 'x'), base, usd)).toMatchObject({
      ok: false,
      issue: 'zero_amount',
    });
  });

  it('debit/credit columns must not both hold a value', () => {
    const m: ImportMapping = {
      ...base,
      amountMode: 'debit_credit',
      columns: { date: 0, debit: 1, credit: 2 },
    };
    expect(interpretRecord(rec('05/10/2026', '10', ''), m, usd)).toMatchObject({
      candidate: { type: 'expense', amountMinor: 1_000 },
    });
    expect(interpretRecord(rec('05/10/2026', '', '20'), m, usd)).toMatchObject({
      candidate: { type: 'income', amountMinor: 2_000 },
    });
    expect(interpretRecord(rec('05/10/2026', '10', '20'), m, usd)).toMatchObject({
      issue: 'debit_credit_both',
    });
    expect(interpretRecord(rec('05/10/2026', '', ''), m, usd)).toMatchObject({
      issue: 'debit_credit_none',
    });
    expect(interpretRecord(rec('05/10/2026', '0', ''), m, usd)).toMatchObject({
      issue: 'zero_amount',
    });
    expect(interpretRecord(rec('05/10/2026', 'x', ''), m, usd)).toMatchObject({
      issue: 'invalid_amount',
    });
    expect(interpretRecord(rec('05/10/2026', '', 'x'), m, usd)).toMatchObject({
      issue: 'invalid_amount',
    });
  });

  it('type columns: refunds kept, unknown types rejected, transfers never imported as transfers', () => {
    const m: ImportMapping = {
      ...base,
      amountMode: 'type_column',
      columns: { date: 0, amount: 1, type: 2 },
    };
    expect(interpretRecord(rec('05/10/2026', '-5', 'Refund'), m, usd)).toMatchObject({
      candidate: { type: 'refund', amountMinor: 500 },
    });
    expect(interpretRecord(rec('05/10/2026', '5', 'DEPOSIT'), m, usd)).toMatchObject({
      candidate: { type: 'income' },
    });
    expect(interpretRecord(rec('05/10/2026', '5', 'misc'), m, usd)).toMatchObject({
      issue: 'unknown_type',
    });
    expect(interpretRecord(rec('05/10/2026', '-5', 'transfer'), m, usd)).toMatchObject({
      issue: 'transfer_row',
    });
    const ordinary = { ...m, transferRows: 'as_ordinary' as const };
    expect(interpretRecord(rec('05/10/2026', '-5', 'transfer'), ordinary, usd)).toMatchObject({
      candidate: { type: 'expense' },
    });
    expect(interpretRecord(rec('05/10/2026', '5', 'Transfer'), ordinary, usd)).toMatchObject({
      candidate: { type: 'income' },
    });
  });

  it('checks dates, accounts and currencies', () => {
    expect(interpretRecord(rec('', '-1', 'x'), base, usd)).toMatchObject({ issue: 'missing_date' });
    expect(interpretRecord(rec('32/10/2026', '-1', 'x'), base, usd)).toMatchObject({
      issue: 'invalid_date',
    });
    expect(
      interpretRecord(rec('05/10/2026', '-1', 'x'), base, {
        timeZone: 'UTC',
        currencyFor: () => null,
      }),
    ).toMatchObject({
      issue: 'unmapped_account',
    });
    const withCurrency: ImportMapping = { ...base, columns: { ...base.columns, currency: 3 } };
    expect(interpretRecord(rec('05/10/2026', '-1', 'x', 'eur'), withCurrency, usd)).toMatchObject({
      issue: 'currency_mismatch',
    });
    expect(interpretRecord(rec('05/10/2026', '-1', 'x', 'ZZ'), withCurrency, usd)).toMatchObject({
      issue: 'invalid_currency',
    });
    expect(interpretRecord(rec('05/10/2026', '-1', 'x', 'usd'), withCurrency, usd)).toMatchObject({
      ok: true,
    });
    expect(interpretRecord(rec('05/10/2026', '-1.234', 'x'), base, usd)).toMatchObject({
      issue: 'too_many_decimals',
    });
  });

  it('clips long text and keeps optional fields', () => {
    const m: ImportMapping = {
      ...base,
      columns: { date: 0, amount: 1, payee: 2, notes: 3, category: 4, account: 5, externalId: 6 },
    };
    const r = interpretRecord(
      rec('05/10/2026', '-1', 'P'.repeat(300), 'n', 'Food', 'Main', 'ID-1'),
      m,
      usd,
    );
    expect(r).toMatchObject({
      candidate: { notes: 'n', categoryLabel: 'Food', accountLabel: 'Main', externalId: 'ID-1' },
    });
    expect(r.ok && r.candidate.payee?.length).toBe(200);
  });
});

describe('identities and plan', () => {
  const account = { id: 'acc-1', currency: 'USD' as CurrencyCode };
  const ctx = (patch: Partial<Parameters<typeof buildPlan>[2]> = {}) => ({
    timeZone: 'UTC',
    accountFor: () => account,
    categoryFor: (kind: 'expense' | 'income') => (kind === 'expense' ? 'cat-exp' : 'cat-inc'),
    existingHashes: new Set<string>(),
    existingMatches: new Map<string, number>(),
    ...patch,
  });
  const file = [
    { line: 2, cells: ['05/10/2026', '-4.50', 'Coffee'] },
    { line: 3, cells: ['05/10/2026', '-4.50', 'Coffee'] }, // a second, legitimate coffee
    { line: 4, cells: ['06/10/2026', '100', 'Salary'] },
    { line: 5, cells: ['bad', '1', 'x'] },
  ];

  it('gives identical rows distinct, reproducible identities', () => {
    const first = buildPlan(file, base, ctx());
    expect(first.map((r) => r.status)).toEqual(['new', 'new', 'new', 'error']);
    expect(new Set(first.map((r) => r.hash)).size).toBe(4); // 3 hashes + null
    const again = buildPlan(file, base, ctx());
    expect(again.map((r) => r.hash)).toEqual(first.map((r) => r.hash));
    expect(first[0]!.hash).toMatch(/^f:[0-9a-f]{16}$/);
  });

  it('skips rows already imported (idempotent re-import)', () => {
    const first = buildPlan(file, base, ctx());
    const existingHashes = new Set(first.filter((r) => r.hash).map((r) => r.hash!));
    const matches = new Map([
      [matchKey('acc-1', '2026-10-05', -450, 'USD'), 2],
      [matchKey('acc-1', '2026-10-06', 10_000, 'USD'), 1],
    ]);
    const second = buildPlan(file, base, ctx({ existingHashes, existingMatches: matches }));
    expect(second.map((r) => [r.status, r.include])).toEqual([
      ['already_imported', false],
      ['already_imported', false],
      ['already_imported', false],
      ['error', false],
    ]);
  });

  it('flags matches with transactions entered by hand, once per existing entry', () => {
    const plan = buildPlan(
      file,
      base,
      ctx({ existingMatches: new Map([[matchKey('acc-1', '2026-10-05', -450, 'USD'), 1]]) }),
    );
    expect(plan.map((r) => r.status)).toEqual(['possible_duplicate', 'new', 'new', 'error']);
    expect(summarizePlan(plan)).toEqual({
      total: 4,
      toImport: 2,
      alreadyImported: 0,
      possibleDuplicates: 1,
      errors: 1,
      issues: { invalid_date: 1 },
    });
  });

  it('uses external ids when present, scoped to the account', () => {
    const m: ImportMapping = { ...base, columns: { ...base.columns, externalId: 3 } };
    const rows = [
      { line: 2, cells: ['05/10/2026', '-4.50', 'Coffee', 'T-1'] },
      { line: 3, cells: ['05/10/2026', '-4.50', 'Coffee', 'T-2'] },
    ];
    const plan = buildPlan(rows, m, ctx());
    expect(plan[0]!.hash).toMatch(/^x:/);
    expect(plan[0]!.hash).not.toBe(plan[1]!.hash);
    const other = buildPlan(rows, m, ctx({ accountFor: () => ({ id: 'acc-2', currency: 'USD' }) }));
    expect(other[0]!.hash).not.toBe(plan[0]!.hash);
  });

  it('rejects rows whose category cannot be resolved', () => {
    const plan = buildPlan(file.slice(0, 1), base, ctx({ categoryFor: () => null }));
    expect(plan[0]).toMatchObject({ status: 'error', issue: 'unmapped_category', include: false });
  });

  it('hashes deterministically', () => {
    expect(fnv1a64('')).toBe('cbf29ce484222325');
    expect(fnv1a64('a')).toBe('af63dc4c8601ec8c');
    expect(importHashes([])).toEqual([]);
  });
});
