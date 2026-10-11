import { parseCsv } from '@/domain/csv/csv';
import type { ImportMapping } from '@/domain/imports/plan';
import {
  autoMatch,
  collectLabels,
  type ImportSelections,
  planImport,
  rowsToImport,
} from '@/features/data/importPlanner';
import { SyncEngine } from '@/sync/SyncEngine';
import { FakeRemote } from '@/test/fakeRemote';
import { sequentialIds } from '@/test/factories';
import { balanceOf, createAccount, createLedger, type Ledger, TZ } from '@/test/ledger';

const CSV = [
  'Date,Description,Amount,Category',
  '05/10/2026,Coffee,-4.50,Groceries',
  '05/10/2026,Coffee,-4.50,Groceries',
  '06/10/2026,ACME Payroll,2500.00,Salary',
  '07/10/2026,"Store, Main St",-120.00,',
  'bad-date,Oops,-1,',
].join('\n');

const MAPPING: ImportMapping = {
  columns: { date: 0, payee: 1, amount: 2, category: 3 },
  amountMode: 'signed',
  negativeMeans: 'expense',
  dateFormat: 'DMY',
  decimal: '.',
  transferRows: 'skip',
};

describe('CSV import (planner + repository, real SQLite)', () => {
  let L: Ledger;
  let chk: Awaited<ReturnType<typeof createAccount>>;
  let selections: ImportSelections;

  beforeEach(async () => {
    L = await createLedger();
    chk = await createAccount(L, { openingBalanceMinor: 100_000 });
    selections = {
      targetAccountId: chk.id,
      accountMap: {},
      categoryMap: {},
      fallback: { expense: L.cat.household, income: L.cat.other },
    };
  });
  afterEach(() => L.db.close());

  const plan = async (csv = CSV, mapping = MAPPING, sel = selections) => {
    const parsed = parseCsv(csv);
    const [accounts, categories] = await Promise.all([
      L.repos.accounts.list({ includeArchived: true }),
      L.repos.categories.list({ includeArchived: true }),
    ]);
    const labels = collectLabels(parsed.records, mapping, TZ, 'USD');
    const matched = autoMatch(labels, accounts, categories, (c) => c.name);
    return planImport({
      repos: L.repos,
      records: parsed.records,
      mapping,
      selections: { ...sel, ...matched, accountMap: { ...matched.accountMap, ...sel.accountMap } },
      accounts,
      categories,
      timeZone: TZ,
    });
  };
  const run = async (rows: Awaited<ReturnType<typeof plan>>) =>
    L.repos.imports.run(
      {
        fileName: 'bank.csv',
        accountId: chk.id,
        rowCount: rows.length,
        duplicateCount: 0,
        errorCount: 0,
        columnMapping: {},
      },
      rowsToImport(rows, TZ),
    );
  const count = async (sql = `SELECT COUNT(*) AS n FROM transactions WHERE deleted_at IS NULL`) =>
    (await L.db.getFirst<{ n: number }>(sql))!.n;

  it('previewing changes nothing', async () => {
    const before = await Promise.all([
      count(),
      count('SELECT COUNT(*) AS n FROM sync_outbox'),
      count('SELECT COUNT(*) AS n FROM import_batches'),
    ]);
    const rows = await plan();
    expect(rows.map((r) => [r.status, r.include])).toEqual([
      ['new', true],
      ['new', true], // a second, legitimate coffee
      ['new', true],
      ['new', true],
      ['error', false],
    ]);
    expect(
      await Promise.all([
        count(),
        count('SELECT COUNT(*) AS n FROM sync_outbox'),
        count('SELECT COUNT(*) AS n FROM import_batches'),
      ]),
    ).toEqual(before);
  });

  it('imports through the normal transaction rules, batch first in the outbox', async () => {
    const rows = await plan();
    // Matched by name: "Groceries" (expense) and "Salary" (income); blank uses the fallback.
    expect(rows.map((r) => r.categoryId)).toEqual([
      L.cat.groceries,
      L.cat.groceries,
      L.cat.salary,
      L.cat.household,
      null,
    ]);
    await L.db.run(`DELETE FROM sync_outbox`);
    const result = await run(rows);
    expect(result).toMatchObject({ status: 'committed', imported: 4, skipped: 0 });
    expect((await balanceOf(L, chk.id))?.amountMinor).toBe(100_000 - 450 - 450 + 250_000 - 12_000);
    const stored = await L.db.getAll<{
      type: string;
      payee: string;
      import_hash: string;
      import_batch_id: string;
      local_date: string;
    }>(
      `SELECT type, payee, import_hash, import_batch_id, local_date FROM transactions ORDER BY rowid`,
    );
    expect(stored.map((s) => [s.type, s.payee, s.local_date])).toEqual([
      ['expense', 'Coffee', '2026-10-05'],
      ['expense', 'Coffee', '2026-10-05'],
      ['income', 'ACME Payroll', '2026-10-06'],
      ['expense', 'Store, Main St', '2026-10-07'],
    ]);
    expect(new Set(stored.map((s) => s.import_hash)).size).toBe(4);
    expect(stored.every((s) => s.import_batch_id === result.batchId)).toBe(true);
    const outbox = await L.db.getAll<{ entity: string }>(
      `SELECT entity FROM sync_outbox ORDER BY rowid`,
    );
    expect(outbox[0]!.entity).toBe('import_batches');
    expect(
      await L.db.getFirst(
        `SELECT status, imported_count, committed_at IS NOT NULL AS done FROM import_batches`,
      ),
    ).toEqual({
      status: 'committed',
      imported_count: 4,
      done: 1,
    });
  });

  it('re-importing the same file, or retrying, never duplicates', async () => {
    await run(await plan());
    const again = await plan();
    expect(again.map((r) => r.status)).toEqual([
      'already_imported',
      'already_imported',
      'already_imported',
      'already_imported',
      'error',
    ]);
    expect(rowsToImport(again, TZ)).toEqual([]);
    // Even a forced retry of the original rows is skipped row by row.
    const retry = await run(
      await plan().then((r) => r.map((x) => ({ ...x, include: x.status !== 'error' }))),
    );
    expect(retry).toMatchObject({ imported: 0, skipped: 4 });
    expect(await count()).toBe(4);
  });

  it('flags matches with hand-entered transactions; including one imports it', async () => {
    await L.repos.transactions.create({
      type: 'expense',
      accountId: chk.id,
      amountMinor: 12_000,
      localDate: '2026-10-07',
      localTime: '18:00',
      timeZone: TZ,
      categoryId: L.cat.household,
    });
    const rows = await plan();
    const store = rows.find((r) => r.line === 5)!;
    expect(store).toMatchObject({ status: 'possible_duplicate', include: false });
    expect((await run(rows)).imported).toBe(3);
    store.include = true;
    expect((await run(rows)).imported).toBe(1);
    expect(await count()).toBe(5);
  });

  it('resumes an interrupted import without duplicates', async () => {
    const lines = ['Date,Description,Amount'];
    for (let i = 0; i < 450; i += 1) lines.push(`05/10/2026,Item ${i},-1.00`);
    const csv = lines.join('\n');
    const mapping = { ...MAPPING, columns: { date: 0, payee: 1, amount: 2 } };
    const all = await plan(csv, mapping);
    // The app was closed after the first chunk: 200 rows committed, batch unfinished.
    const first = await L.repos.imports.run(
      {
        fileName: 'big.csv',
        accountId: chk.id,
        rowCount: 450,
        duplicateCount: 0,
        errorCount: 0,
        columnMapping: {},
      },
      rowsToImport(all, TZ).slice(0, 200),
    );
    await L.db.run(`UPDATE import_batches SET status = 'previewed' WHERE id = ?`, [first.batchId]);
    expect(await L.repos.imports.incompleteBatches()).toEqual([
      expect.objectContaining({
        id: first.batchId,
        fileName: 'big.csv',
        rowCount: 450,
        importedCount: 200,
      }),
    ]);
    // Importing the same file again finishes the job.
    const resumed = await plan(csv, mapping);
    expect(resumed.filter((r) => r.status === 'already_imported')).toHaveLength(200);
    const progress: number[] = [];
    const second = await L.repos.imports.run(
      {
        fileName: 'big.csv',
        accountId: chk.id,
        rowCount: 450,
        duplicateCount: 200,
        errorCount: 0,
        columnMapping: {},
      },
      rowsToImport(resumed, TZ),
      (p) => progress.push(p.done),
    );
    expect(second).toMatchObject({ status: 'committed', imported: 250 });
    expect(progress).toEqual([200, 250]);
    expect(await count()).toBe(450);
    await L.repos.imports.dismissBatch(first.batchId);
    expect(await L.repos.imports.incompleteBatches()).toEqual([]);
  });

  it('a failure rolls back only its own chunk and reports what was committed', async () => {
    const lines = ['Date,Description,Amount'];
    for (let i = 0; i < 250; i += 1) lines.push(`05/10/2026,Item ${i},-1.00`);
    const mapping = { ...MAPPING, columns: { date: 0, payee: 1, amount: 2 } };
    const rows = await plan(lines.join('\n'), mapping);
    const inputs = rowsToImport(rows, TZ);
    // Row 230 has become invalid since the preview (its category was archived).
    inputs[230] = {
      ...inputs[230]!,
      input: { ...inputs[230]!.input, categoryId: L.cat.subscriptions },
    };
    await L.repos.categories.setArchived(L.cat.subscriptions, true);
    const result = await L.repos.imports.run(
      {
        fileName: 'x.csv',
        accountId: chk.id,
        rowCount: 250,
        duplicateCount: 0,
        errorCount: 0,
        columnMapping: {},
      },
      inputs,
    );
    expect(result).toMatchObject({ status: 'failed', imported: 200 });
    expect(await count()).toBe(200); // the second chunk was rolled back entirely
    expect(await L.db.getFirst(`SELECT status, imported_count FROM import_batches`)).toEqual({
      status: 'failed',
      imported_count: 200,
    });
  });

  it('works offline and syncs the batch before its transactions, once', async () => {
    await run(await plan());
    const remote = new FakeRemote();
    const engine = new SyncEngine({ db: L.db, remote, newId: sequentialIds() });
    expect((await engine.sync()).errorCode).toBeNull();
    const pushed = remote.calls.filter((c) => c.startsWith('insert:'));
    expect(pushed.indexOf('insert:import_batches')).toBeLessThan(
      pushed.indexOf('insert:transactions'),
    );
    expect(remote.tables.get('transactions')?.size).toBe(4);
    expect(
      [...remote.tables.get('transactions')!.values()].every(
        (t) => typeof t.import_hash === 'string',
      ),
    ).toBe(true);
    expect(remote.tables.get('import_batches')?.size).toBe(1);
    expect((await engine.sync()).errorCode).toBeNull();
    expect(await count()).toBe(4);
  });

  it("ignores another user's identical identities", async () => {
    const rows = await plan();
    await L.db.run(
      `INSERT INTO transactions (id, user_id, created_at, updated_at, version, sync_status,
         account_id, type, amount_minor, currency, original_amount_minor, original_currency,
         fx_rate, base_currency, base_amount_minor, base_fx_rate, base_fx_rate_date,
         base_fx_source, occurred_at, local_date, time_zone, is_split, import_hash)
       VALUES ('foreign', 'someone-else', 'x', 'x', 1, 'synced', ?, 'expense', -450, 'USD',
         -450, 'USD', '1', 'USD', -450, '1', '2026-10-05', 'identity', '2026-10-05T12:00:00Z',
         '2026-10-05', 'UTC', 0, ?)`,
      [chk.id, rows[0]!.hash],
    );
    expect((await plan())[0]!.status).toBe('new');
  });

  it('refuses archived accounts and maps account names only when unambiguous', async () => {
    const savings = await createAccount(L, { name: 'Savings', type: 'savings' });
    await L.repos.accounts.setArchived(savings.id, true);
    expect(
      (await plan(CSV, MAPPING, { ...selections, targetAccountId: savings.id }))
        .slice(0, 4)
        .every((r) => r.issue === 'unmapped_account'),
    ).toBe(true);

    const csv =
      'Date,Account,Amount\n05/10/2026,checking,-1\n05/10/2026,Savings,-1\n05/10/2026,Unknown,-1';
    const mapping = { ...MAPPING, columns: { date: 0, account: 1, amount: 2 } };
    const rows = await plan(csv, mapping, { ...selections, targetAccountId: null });
    expect(rows.map((r) => [r.status, r.issue, r.accountId])).toEqual([
      ['new', null, chk.id], // "checking" matches "Checking"
      ['error', 'unmapped_account', null], // archived
      ['error', 'unmapped_account', null], // unknown
    ]);
  });

  it('keeps refunds as refunds, skips transfer rows and never creates splits', async () => {
    const csv =
      'Date,Payee,Amount,Type\n05/10/2026,Shop,15.00,refund\n05/10/2026,To savings,-50.00,transfer';
    const mapping: ImportMapping = {
      ...MAPPING,
      amountMode: 'type_column',
      columns: { date: 0, payee: 1, amount: 2, type: 3 },
    };
    const rows = await plan(csv, mapping);
    expect(rows.map((r) => [r.status, r.issue])).toEqual([
      ['new', null],
      ['error', 'transfer_row'],
    ]);
    await run(rows);
    expect(
      await L.db.getAll(
        `SELECT type, amount_minor, refund_of_transaction_id, transfer_id, is_split FROM transactions`,
      ),
    ).toEqual([
      {
        type: 'refund',
        amount_minor: 1_500,
        refund_of_transaction_id: null,
        transfer_id: null,
        is_split: 0,
      },
    ]);
    expect(await count('SELECT COUNT(*) AS n FROM transaction_splits')).toBe(0);
    expect(await count('SELECT COUNT(*) AS n FROM transfers')).toBe(0);
  });
});
