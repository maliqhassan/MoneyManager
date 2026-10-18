import { parseCsv } from '@/domain/csv/csv';
import { manifestJson, readmeText, renderTable } from '@/domain/exports/export';
import { createAccount, createLedger, type Ledger, TZ } from '@/test/ledger';

import { buildExport, type ExportOptions } from '../exportBuilder';

describe('export builder (real SQLite)', () => {
  let L: Ledger;
  let chk: Awaited<ReturnType<typeof createAccount>>;
  let eur: Awaited<ReturnType<typeof createAccount>>;
  let expenseId: string;

  const options = (patch: Partial<ExportOptions> = {}): ExportOptions => ({
    scope: 'transactions',
    filter: { from: null, to: null, accountIds: [], types: [] },
    categoryName: (c) => c.name ?? '',
    dateDisplay: (d) => d.split('-').reverse().join('/'),
    baseCurrency: 'USD',
    timeZone: TZ,
    appVersion: '0.1.0',
    now: '2026-10-11T12:00:00.000Z',
    ...patch,
  });
  const table = async (o: ExportOptions, file = 'transactions.csv') => {
    const built = await buildExport(L.repos, o);
    const t = built.tables.find((x) => x.file === file);
    return t ? parseCsv(renderTable(t)) : null;
  };
  const column = (csv: NonNullable<Awaited<ReturnType<typeof table>>>, name: string) =>
    csv.records.map((r) => r.cells[csv.headers.indexOf(name)]);

  beforeEach(async () => {
    L = await createLedger();
    chk = await createAccount(L, { openingBalanceMinor: 100_000 });
    eur = await createAccount(L, { name: 'Euro €', currency: 'EUR' });
    const at = (localDate: string) => ({ localDate, localTime: '09:30', timeZone: TZ });
    expenseId = await L.repos.transactions.create({
      type: 'expense',
      accountId: chk.id,
      amountMinor: 1_250,
      ...at('2026-10-01'),
      payee: '=HYPERLINK("evil")',
      notes: 'Café, "special"\nsecond line ✓',
      categoryId: L.cat.groceries,
      tagNames: ['Work', 'Trip'],
    });
    await L.repos.transactions.create({
      type: 'refund',
      accountId: chk.id,
      amountMinor: 250,
      ...at('2026-10-02'),
      categoryId: L.cat.groceries,
      refundOfTransactionId: expenseId,
    });
    await L.repos.transactions.create({
      type: 'expense',
      accountId: chk.id,
      amountMinor: 1_000,
      ...at('2026-10-03'),
      categoryId: null,
      splits: [
        { categoryId: L.cat.restaurants, amountMinor: 600 },
        { categoryId: L.cat.household, amountMinor: 400, notes: '+tip' },
      ],
    });
    await L.repos.transactions.create({
      type: 'income',
      accountId: eur.id,
      amountMinor: 5_000,
      ...at('2026-09-15'),
      categoryId: L.cat.salary,
    });
    await L.repos.transactions.createTransfer({
      fromAccountId: chk.id,
      toAccountId: eur.id,
      amountMinor: 1_100,
      receivedAmountMinor: 1_000,
      ...at('2026-10-04'),
    });
  });
  afterEach(() => L.db.close());

  it('exports every transaction with exact amounts, both transfer legs and the refund link', async () => {
    const csv = (await table(options()))!;
    expect(csv.records).toHaveLength(6);
    expect(column(csv, 'type')).toEqual([
      'income',
      'expense',
      'refund',
      'expense',
      'transfer',
      'transfer',
    ]);
    expect(column(csv, 'amount')).toEqual(['50.00', '-12.50', '2.50', '-10.00', '-11.00', '10.00']);
    expect(column(csv, 'currency')).toEqual(['EUR', 'USD', 'USD', 'USD', 'USD', 'EUR']);
    expect(column(csv, 'date_display')[1]).toBe('01/10/2026');
    expect(column(csv, 'time')[1]).toBe('09:30');
    const transferIds = column(csv, 'transfer_id').filter(Boolean);
    expect(transferIds).toHaveLength(2);
    expect(new Set(transferIds).size).toBe(1);
    expect(column(csv, 'transfer_other_account').slice(4)).toEqual(['Euro €', 'Checking']);
    expect(column(csv, 'refund_of_transaction_id')[2]).toBe(expenseId);
    expect(column(csv, 'split_count')[3]).toBe('2');
    expect(column(csv, 'category')[1]).toBe('Food');
    expect(column(csv, 'subcategory')[1]).toBe('Groceries');
    expect(column(csv, 'tags')[1]).toBe('Trip; Work');
  });

  it('protects free text against formulas but keeps Unicode and line breaks', async () => {
    const csv = (await table(options()))!;
    expect(column(csv, 'merchant')[1]).toBe('\'=HYPERLINK("evil")');
    expect(column(csv, 'notes')[1]).toBe('Café, "special"\nsecond line ✓');
    expect(column(csv, 'amount')[1]).toBe('-12.50'); // numbers are never prefixed
  });

  it('exports split parts in their own file; they add up to the transaction', async () => {
    const built = await buildExport(L.repos, options());
    expect(built.tables.map((t) => t.file)).toEqual(['transactions.csv', 'transaction_splits.csv']);
    const splits = (await table(options(), 'transaction_splits.csv'))!;
    expect(column(splits, 'amount')).toEqual(['-6.00', '-4.00']);
    expect(column(splits, 'category')).toEqual(['Food', 'Household']);
    expect(column(splits, 'subcategory')).toEqual(['Restaurants', '']);
    expect(column(splits, 'notes')[1]).toBe("'+tip");
    expect(column(splits, 'amount_minor').reduce((s, v) => s + Number(v), 0)).toBe(-1_000);
  });

  it('applies date, account and type filters', async () => {
    const october = (await table(
      options({ filter: { from: '2026-10-01', to: '2026-10-31', accountIds: [], types: [] } }),
    ))!;
    expect(october.records).toHaveLength(5);
    const euro = (await table(
      options({ filter: { from: null, to: null, accountIds: [eur.id], types: [] } }),
    ))!;
    expect(column(euro, 'account')).toEqual(['Euro €', 'Euro €']);
    const refunds = (await table(
      options({ filter: { from: null, to: null, accountIds: [], types: ['refund'] } }),
    ))!;
    expect(column(refunds, 'type')).toEqual(['refund']);
    const none = await buildExport(
      L.repos,
      options({ filter: { from: '2027-01-01', to: '2027-01-31', accountIds: [], types: [] } }),
    );
    expect(none.tables).toHaveLength(1);
    expect(none.tables[0]!.rows).toEqual([]);
  });

  it('full export: every entity, a manifest, unsynced changes stated, no secrets', async () => {
    await L.repos.budgets.create({
      name: 'Food',
      categoryId: L.cat.food,
      periodType: 'monthly',
      startDate: '2026-10-01',
      currency: 'USD',
      amountMinor: 50_000,
    });
    await L.repos.goals.create({ name: 'Trip', targetAmountMinor: 100_000, currency: 'EUR' });
    await L.repos.exchangeRates.saveManualRate(
      { base: 'EUR', quote: 'PKR', rate: '310.5', rateDate: '2026-10-05' },
      { today: '2026-10-08', replace: false },
    );
    const built = await buildExport(L.repos, options({ scope: 'all' }));
    expect(built.tables.map((t) => t.file)).toEqual([
      'transactions.csv',
      'transaction_splits.csv',
      'accounts.csv',
      'categories.csv',
      'budgets.csv',
      'budget_revisions.csv',
      'bills.csv',
      'bill_payments.csv',
      'savings_goals.csv',
      'goal_contributions.csv',
      'exchange_rates.csv',
    ]);
    // The user's own rates are exported (downloaded reference rates are not).
    const fx = parseCsv(renderTable(built.tables.find((t) => t.file === 'exchange_rates.csv')!));
    expect(fx.headers).toEqual([
      'from_currency',
      'to_currency',
      'rate',
      'effective_date',
      'source',
      'entered_at_utc',
    ]);
    expect(fx.records.map((r) => r.cells.slice(0, 5))).toEqual([
      ['EUR', 'PKR', '310.5', '2026-10-05', 'manual'],
    ]);
    const accounts = parseCsv(renderTable(built.tables.find((t) => t.file === 'accounts.csv')!));
    expect(column(accounts, 'current_balance')).toEqual(['969.00', '60.00']);
    expect(built.manifest.pendingLocalChanges).toBeGreaterThan(0);
    const everything = [
      ...built.tables.map(renderTable),
      manifestJson(built.manifest),
      readmeText(built.manifest),
    ].join('\n');
    // No key, token or account identifier VALUES (the README may name them).
    expect(everything).not.toMatch(/sb_(secret|publishable)_[A-Za-z0-9]/);
    expect(everything).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}/); // JWT-shaped tokens
    expect(everything).not.toMatch(/"(access|refresh)_token"\s*:/);
    expect(everything).not.toContain(L.ctx.userId);
  });
  it('exports the conversion recorded with each entry so it can be reproduced', async () => {
    await L.repos.exchangeRates.storeProviderRates(
      [{ base: 'USD', quote: 'EUR', rateDate: '2026-10-04', rate: '0.8' }],
      { source: 'frankfurter', attribution: 'Frankfurter', fetchedAt: '2026-10-04T10:00:00Z' },
    );
    await L.repos.transactions.create({
      type: 'expense',
      accountId: eur.id,
      amountMinor: 1_000,
      localDate: '2026-10-05',
      localTime: '09:30',
      timeZone: TZ,
      categoryId: L.cat.groceries,
    });
    const csv = (await table(
      options({
        filter: { from: '2026-10-05', to: '2026-10-05', accountIds: [eur.id], types: [] },
      }),
    ))!;
    expect(csv.headers).toEqual(expect.arrayContaining(['base_fx_rate', 'base_fx_rate_date']));
    expect(column(csv, 'amount')).toEqual(['-10.00']);
    expect(column(csv, 'currency')).toEqual(['EUR']);
    expect(column(csv, 'base_amount')).toEqual(['-12.50']);
    expect(column(csv, 'base_fx_rate')).toEqual(['1.25']);
    expect(column(csv, 'base_fx_rate_date')).toEqual(['2026-10-04']);
    expect(column(csv, 'base_conversion')).toEqual(['frankfurter:inverse']);
  });
});
