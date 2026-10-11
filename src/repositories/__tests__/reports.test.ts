import {
  balanceSeries,
  categorySpending,
  merchantSpending,
  summarizeFlows,
} from '@/domain/reports/aggregate';
import { balanceSampleDates } from '@/domain/reports/periods';
import { SyncEngine } from '@/sync/SyncEngine';
import { FakeRemote } from '@/test/fakeRemote';
import { sequentialIds } from '@/test/factories';
import { balanceOf, createAccount, createLedger, type Ledger, TZ } from '@/test/ledger';

const OCT = { start: '2026-10-01', end: '2026-10-31' };

describe('reports repository (local SQLite, real ledger)', () => {
  let L: Ledger;
  let chk: Awaited<ReturnType<typeof createAccount>>;

  beforeEach(async () => {
    L = await createLedger();
    chk = await createAccount(L, { openingBalanceMinor: 100_000 });
  });
  afterEach(() => L.db.close());

  const entry = (
    type: 'expense' | 'income' | 'refund',
    amountMinor: number,
    patch: Partial<Parameters<Ledger['repos']['transactions']['create']>[0]> = {},
  ) =>
    L.repos.transactions.create({
      type,
      accountId: chk.id,
      amountMinor,
      localDate: '2026-10-05',
      localTime: '12:00',
      timeZone: TZ,
      categoryId: type === 'income' ? L.cat.salary : L.cat.groceries,
      ...patch,
    });

  const flow = async (range = OCT) =>
    summarizeFlows(await L.repos.reports.flows(range, 'USD'), 'USD');
  const parentOf = async () =>
    new Map(
      (await L.repos.categories.list({ includeArchived: true })).map((c) => [c.id, c.parentId]),
    );

  it('income vs spending: refunds net, transfers and card payments never count', async () => {
    const card = await createAccount(L, { name: 'Visa', type: 'credit_card' });
    await entry('income', 300_000);
    await entry('expense', 50_000, { payee: 'Walmart' });
    await entry('refund', 5_000, { payee: 'Walmart' });
    await L.repos.transactions.create({
      type: 'expense',
      accountId: card.id,
      amountMinor: 20_000,
      localDate: '2026-10-06',
      localTime: '12:00',
      timeZone: TZ,
      categoryId: L.cat.household,
    });
    await L.repos.transactions.createTransfer({
      fromAccountId: chk.id,
      toAccountId: card.id,
      amountMinor: 20_000,
      localDate: '2026-10-07',
      localTime: '12:00',
      timeZone: TZ,
    });
    expect(await flow()).toMatchObject({
      incomeMinor: 300_000,
      spendingMinor: 65_000,
      refundsMinor: 5_000,
      netMinor: 235_000,
      transactionCount: 4,
      savingsRateBasisPoints: 7_833,
      complete: true,
    });
  });

  it('counts split transactions once in totals and per line in categories', async () => {
    await entry('expense', 10_000, {
      categoryId: null,
      splits: [
        { categoryId: L.cat.groceries, amountMinor: 6_000 },
        { categoryId: L.cat.household, amountMinor: 4_000 },
      ],
    });
    expect((await flow()).spendingMinor).toBe(10_000);
    const report = categorySpending(
      await L.repos.reports.categorySpending(OCT, 'USD'),
      await parentOf(),
    );
    expect(report.totalMinor).toBe(10_000);
    expect(report.items.map((i) => [i.categoryId, i.spendingMinor])).toEqual([
      [L.cat.food, 6_000],
      [L.cat.household, 4_000],
    ]);
    // Merchant report uses the parent once.
    const merchants = merchantSpending(await L.repos.reports.merchantSpending(OCT, 'USD'));
    expect(merchants.totalMinor).toBe(10_000);
  });

  it('keeps archived categories in historical reports', async () => {
    await entry('expense', 2_500, { categoryId: L.cat.household });
    await L.repos.categories.setArchived(L.cat.household, true);
    const report = categorySpending(
      await L.repos.reports.categorySpending(OCT, 'USD'),
      await parentOf(),
    );
    expect(report.items).toEqual([
      expect.objectContaining({ categoryId: L.cat.household, spendingMinor: 2_500 }),
    ]);
  });

  it('groups merchants by the existing normalisation and labels missing ones', async () => {
    await entry('expense', 1_000, { payee: 'WALMART #1234' });
    await entry('expense', 2_000, { payee: 'Walmart Store 1234', localDate: '2026-10-09' });
    await entry('expense', 500, { payee: null });
    await entry('expense', 700, { payee: 'Target' });
    const merchants = merchantSpending(await L.repos.reports.merchantSpending(OCT, 'USD'));
    expect(
      merchants.items.map((m) => [m.merchantKey, m.spendingMinor, m.transactionCount]),
    ).toEqual([
      ['walmart', 3_000, 2],
      ['target', 700, 1],
      [null, 500, 1],
    ]);
    expect(await L.repos.reports.merchantNames(['walmart', 'target'])).toEqual({
      walmart: 'Walmart Store 1234',
      target: 'Target',
    });
    expect(await L.repos.reports.merchantNames([])).toEqual({});
  });

  it('converts with recorded snapshots or known rates and reports what it cannot convert', async () => {
    const eur = await createAccount(L, { name: 'Euro', currency: 'EUR' });
    const gbp = await createAccount(L, { name: 'Pound', currency: 'GBP' });
    await L.db.run(
      `INSERT INTO exchange_rates (id, base_currency, quote_currency, rate, rate_date, source, created_at)
       VALUES ('r1', 'EUR', 'USD', '1.1', '2026-10-01', 'test', '2026-10-01T00:00:00Z')`,
    );
    await entry('expense', 10_000, { accountId: eur.id });
    await entry('expense', 5_000, { accountId: gbp.id });
    await entry('expense', 2_000);
    const s = await flow();
    expect(s).toMatchObject({
      spendingMinor: 11_000 + 2_000,
      complete: false,
      excludedSpending: [{ currency: 'GBP', amountMinor: 5_000 }],
      savingsRateBasisPoints: null,
    });
  });

  it('respects zero-decimal currencies (minor units) when converting', async () => {
    const jpy = await createAccount(L, { name: 'Yen', currency: 'JPY' });
    await L.db.run(
      `INSERT INTO exchange_rates (id, base_currency, quote_currency, rate, rate_date, source, created_at)
       VALUES ('r2', 'USD', 'JPY', '150', '2026-10-01', 'test', '2026-10-01T00:00:00Z')`,
    );
    await entry('expense', 1_500, { accountId: jpy.id }); // ¥1,500 → $10.00
    expect((await flow()).spendingMinor).toBe(1_000);
  });

  it('drill-down lines add up to the report value', async () => {
    await entry('expense', 10_000, {
      categoryId: null,
      splits: [
        { categoryId: L.cat.groceries, amountMinor: 6_000 },
        { categoryId: L.cat.restaurants, amountMinor: 4_000 },
      ],
    });
    await entry('expense', 1_000, { categoryId: L.cat.food });
    await entry('refund', 500, { categoryId: L.cat.groceries });
    // Uncategorised entries only arrive via sync (the form requires a category).
    const loose = await entry('expense', 300, { payee: 'Unknown' });
    await L.db.run(`UPDATE transactions SET category_id = NULL WHERE id = ?`, [loose]);
    const food = await L.repos.reports.lines({
      range: OCT,
      kind: 'category',
      categoryId: L.cat.food,
      includeSubcategories: true,
    });
    expect(food.reduce((s, l) => s - l.amountMinor, 0)).toBe(6_000 + 4_000 + 1_000 - 500);
    expect(food.filter((l) => l.isSplitLine)).toHaveLength(2);
    const onlyGroceries = await L.repos.reports.lines({
      range: OCT,
      kind: 'category',
      categoryId: L.cat.groceries,
    });
    expect(onlyGroceries.reduce((s, l) => s - l.amountMinor, 0)).toBe(5_500);
    const uncategorized = await L.repos.reports.lines({
      range: OCT,
      kind: 'category',
      categoryId: null,
    });
    expect(uncategorized.map((l) => l.amountMinor)).toEqual([-300]);
    const noMerchant = await L.repos.reports.lines({
      range: OCT,
      kind: 'merchant',
      merchantKey: null,
    });
    expect(noMerchant).toHaveLength(3);
    const unknown = await L.repos.reports.lines({
      range: OCT,
      kind: 'merchant',
      merchantKey: 'unknown',
    });
    expect(unknown.map((l) => l.amountMinor)).toEqual([-300]);
    await entry('income', 9_000);
    expect(
      (await L.repos.reports.lines({ range: OCT, kind: 'income' })).map((l) => l.amountMinor),
    ).toEqual([9_000]);
    const spending = await L.repos.reports.lines({ range: OCT, kind: 'spending' });
    expect(spending.reduce((s, l) => s - l.amountMinor, 0)).toBe((await flow()).spendingMinor);
  });

  it('balance history ends at the real current balance and starts at the opening date', async () => {
    await entry('expense', 20_000, { localDate: '2026-09-15' });
    await entry('income', 50_000, { localDate: '2026-10-03' });
    await entry('expense', 5_000, { localDate: '2026-10-10' });
    const [acc] = await L.repos.reports.balanceInputs(OCT);
    expect(acc).toMatchObject({ name: 'Checking', currency: 'USD' });
    const series = balanceSeries(acc!.input, OCT, balanceSampleDates(OCT));
    expect(series.startMinor).toBe(80_000);
    expect(series.endMinor).toBe((await balanceOf(L, chk.id))?.amountMinor);
    expect(series.endMinor).toBe(125_000);
    expect(await L.repos.reports.dataStart()).toBe('2026-09-15');
  });

  it('reflects edits and deletions immediately (no stale totals)', async () => {
    const id = await entry('expense', 4_000);
    expect((await flow()).spendingMinor).toBe(4_000);
    await L.repos.transactions.update(id, {
      type: 'expense',
      accountId: chk.id,
      amountMinor: 4_500,
      localDate: '2026-10-05',
      localTime: '12:00',
      timeZone: TZ,
      categoryId: L.cat.groceries,
    });
    expect((await flow()).spendingMinor).toBe(4_500);
    await L.repos.transactions.remove(id);
    expect((await flow()).spendingMinor).toBe(0);
  });

  it('includes offline entries once, and syncing does not double-count them', async () => {
    await entry('expense', 3_000);
    const before = await flow();
    const engine = new SyncEngine({ db: L.db, remote: new FakeRemote(), newId: sequentialIds() });
    expect((await engine.sync()).errorCode).toBeNull();
    expect((await engine.sync()).errorCode).toBeNull(); // pull brings the same rows back
    expect(await flow()).toEqual(before);
  });

  it("never includes another user's rows", async () => {
    await L.db.run(
      `INSERT INTO transactions (id, user_id, created_at, updated_at, version, sync_status,
         account_id, type, amount_minor, currency, original_amount_minor, original_currency,
         fx_rate, base_currency, base_amount_minor, base_fx_rate, base_fx_rate_date,
         base_fx_source, occurred_at, local_date, time_zone, is_split)
       VALUES ('foreign', 'someone-else', 'x', 'x', 1, 'synced', ?, 'expense', -99999, 'USD',
         -99999, 'USD', '1', 'USD', -99999, '1', '2026-10-05', 'identity',
         '2026-10-05T12:00:00Z', '2026-10-05', 'UTC', 0)`,
      [chk.id],
    );
    expect((await flow()).spendingMinor).toBe(0);
    expect(await L.repos.reports.lines({ range: OCT, kind: 'spending' })).toEqual([]);
  });
});
