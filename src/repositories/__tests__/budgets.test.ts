import { createAccount, createLedger, type Ledger, TZ } from '@/test/ledger';

/**
 * Budget engine against real transactions in SQLite. Today is fixed per test
 * (the user's local date); preferences: base USD, weeks start Monday.
 */
describe('budgets', () => {
  let L: Ledger;
  let chk: Awaited<ReturnType<typeof createAccount>>;

  beforeEach(async () => {
    L = await createLedger();
    chk = await createAccount(L);
  });
  afterEach(() => L.db.close());

  const spend = (
    amountMinor: number,
    categoryId: string | null,
    localDate: string,
    extra: Partial<Parameters<Ledger['repos']['transactions']['create']>[0]> = {},
  ) =>
    L.repos.transactions.create({
      type: 'expense',
      accountId: chk.id,
      amountMinor,
      localDate,
      localTime: '12:00',
      timeZone: TZ,
      categoryId,
      ...extra,
    });

  const budget = (patch: Partial<Parameters<Ledger['repos']['budgets']['create']>[0]> = {}) =>
    L.repos.budgets.create({
      name: 'Groceries',
      categoryId: L.cat.groceries,
      periodType: 'monthly',
      startDate: '2026-10-01',
      currency: 'USD',
      amountMinor: 60_000,
      rolloverEnabled: false,
      ...patch,
    });

  const current = async (id: string, today = '2026-10-20') =>
    (await L.repos.budgets.overview(id, today))!.evaluation.current;

  it('creates a budget with its first revision, queued parent first', async () => {
    await L.db.run(`DELETE FROM sync_outbox`);
    const b = await budget({ startDate: '2026-10-17' });
    expect(b).toMatchObject({ startDate: '2026-10-01', categoryId: L.cat.groceries });
    expect(await L.repos.budgets.revisions(b.id)).toEqual([
      expect.objectContaining({ effectiveFrom: '2026-10-01', amountMinor: 60_000 }),
    ]);
    const outbox = await L.db.getAll<{ entity: string }>(
      `SELECT entity FROM sync_outbox ORDER BY rowid`,
    );
    expect(outbox.map((o) => o.entity)).toEqual(['budgets', 'budget_revisions']);
    expect(L.ctx.changes).toContain('budgets');
  });

  it('counts expenses and lets refunds reduce spending ($500 − $100 = $400)', async () => {
    const b = await budget({ amountMinor: 100_000 });
    await spend(50_000, L.cat.groceries, '2026-10-05');
    await L.repos.transactions.create({
      type: 'refund',
      accountId: chk.id,
      amountMinor: 10_000,
      localDate: '2026-10-08',
      localTime: '12:00',
      timeZone: TZ,
      categoryId: L.cat.groceries,
    });
    expect(await current(b.id)).toMatchObject({
      spentMinor: 40_000,
      remainingMinor: 60_000,
      usedBasisPoints: 4_000,
    });
  });

  it('ignores income, transfers and credit-card payments', async () => {
    const card = await createAccount(L, { name: 'Visa', type: 'credit_card' });
    const overall = await budget({ name: 'Total', categoryId: null, amountMinor: 300_000 });
    // Card purchase is spending…
    await L.repos.transactions.create({
      type: 'expense',
      accountId: card.id,
      amountMinor: 10_000,
      localDate: '2026-10-03',
      localTime: '12:00',
      timeZone: TZ,
      categoryId: L.cat.household,
    });
    // …paying the card is a transfer, not spending.
    await L.repos.transactions.createTransfer({
      fromAccountId: chk.id,
      toAccountId: card.id,
      amountMinor: 10_000,
      localDate: '2026-10-10',
      localTime: '12:00',
      timeZone: TZ,
    });
    await L.repos.transactions.create({
      type: 'income',
      accountId: chk.id,
      amountMinor: 500_000,
      localDate: '2026-10-01',
      localTime: '09:00',
      timeZone: TZ,
      categoryId: L.cat.salary,
    });
    expect((await current(overall.id)).spentMinor).toBe(10_000);
  });

  it('allocates split lines to their own categories; overall counts the total once', async () => {
    const groceries = await budget({ amountMinor: 50_000 });
    const household = await budget({
      name: 'Household',
      categoryId: L.cat.household,
      amountMinor: 50_000,
    });
    const overall = await budget({ name: 'Total', categoryId: null, amountMinor: 300_000 });
    await spend(10_000, null, '2026-10-06', {
      splits: [
        { categoryId: L.cat.groceries, amountMinor: 6_000 },
        { categoryId: L.cat.household, amountMinor: 4_000 },
      ],
    });
    expect((await current(groceries.id)).spentMinor).toBe(6_000);
    expect((await current(household.id)).spentMinor).toBe(4_000);
    expect((await current(overall.id)).spentMinor).toBe(10_000);
  });

  it('parent budgets include subcategories without double counting', async () => {
    const food = await budget({ name: 'Food', categoryId: L.cat.food, amountMinor: 80_000 });
    const groceries = await budget({ amountMinor: 50_000 });
    await spend(2_500, L.cat.groceries, '2026-10-02');
    await spend(3_000, L.cat.restaurants, '2026-10-02');
    await spend(1_000, L.cat.food, '2026-10-02');
    await spend(7_000, null, '2026-10-03', {
      splits: [
        { categoryId: L.cat.restaurants, amountMinor: 2_000 },
        { categoryId: L.cat.household, amountMinor: 5_000 },
      ],
    });
    expect((await current(food.id)).spentMinor).toBe(8_500);
    expect((await current(groceries.id)).spentMinor).toBe(2_500);

    const lines = await L.repos.budgets.spendingLines(food.id, '2026-10-01', '2026-10-31');
    expect(lines.map((l) => [l.amountMinor, l.isSplitLine])).toEqual(
      expect.arrayContaining([
        [-2_000, true],
        [-2_500, false],
        [-3_000, false],
        [-1_000, false],
      ]),
    );
    expect(lines).toHaveLength(4);
  });

  it('assigns transactions by their local date in the user time zone', async () => {
    const b = await budget();
    // 23:30 on 31 Oct in New York is already 1 Nov in UTC; it belongs to October.
    await spend(1_234, L.cat.groceries, '2026-10-31', { localTime: '23:30' });
    expect((await current(b.id, '2026-10-31')).spentMinor).toBe(1_234);
    expect((await current(b.id, '2026-11-01')).spentMinor).toBe(0);
  });

  it('weekly budgets follow the first-day-of-week preference', async () => {
    const weekly = await budget({
      name: 'Dining',
      categoryId: L.cat.restaurants,
      periodType: 'weekly',
      startDate: '2026-10-07',
      amountMinor: 15_000,
    });
    expect(weekly.startDate).toBe('2026-10-05'); // Monday
    await spend(1_000, L.cat.restaurants, '2026-10-04'); // Sunday before
    await spend(2_000, L.cat.restaurants, '2026-10-05'); // Monday
    expect(await current(weekly.id, '2026-10-07')).toMatchObject({
      start: '2026-10-05',
      end: '2026-10-11',
      spentMinor: 2_000,
    });

    await L.db.run(`UPDATE user_preferences SET first_day_of_week = 0`);
    const sundayWeek = await L.repos.budgets.create({
      name: 'Dining (Sun)',
      categoryId: L.cat.restaurants,
      periodType: 'weekly',
      startDate: '2026-10-07',
      currency: 'EUR',
      amountMinor: 15_000,
    });
    expect(sundayWeek.startDate).toBe('2026-10-04');
  });

  it('custom periods validate their range and report days remaining', async () => {
    await expect(
      budget({
        name: 'Travel',
        periodType: 'custom',
        startDate: '2026-11-10',
        endDate: '2026-11-01',
      }),
    ).rejects.toMatchObject({ fieldErrors: { endDate: 'budgets.errors.endBeforeStart' } });
    await expect(budget({ periodType: 'custom', endDate: null })).rejects.toMatchObject({
      fieldErrors: { endDate: 'budgets.errors.endRequired' },
    });
    const travel = await budget({
      name: 'Travel',
      categoryId: null,
      periodType: 'custom',
      startDate: '2026-11-01',
      endDate: '2026-12-15',
      amountMinor: 200_000,
      rolloverEnabled: true,
    });
    expect(travel.rolloverEnabled).toBe(false); // single period: no rollover
    await spend(50_000, L.cat.household, '2026-10-31'); // before the range
    await spend(30_000, L.cat.household, '2026-11-20');
    expect(await current(travel.id, '2026-11-30')).toMatchObject({
      spentMinor: 30_000,
      daysTotal: 45,
      daysRemaining: 15,
    });
  });

  it('rolls unspent money forward but never overspending', async () => {
    const b = await budget({ startDate: '2026-08-01', amountMinor: 50_000, rolloverEnabled: true });
    await spend(40_000, L.cat.groceries, '2026-08-10'); // carry 10,000
    await spend(70_000, L.cat.groceries, '2026-09-10'); // 60,000 available → over, carry 0
    await spend(10_000, L.cat.groceries, '2026-10-02');
    const overview = (await L.repos.budgets.overview(b.id, '2026-10-20'))!;
    expect(
      overview.evaluation.periods.map((p) => [p.start, p.carryInMinor, p.availableMinor, p.status]),
    ).toEqual([
      ['2026-08-01', 0, 50_000, 'warning'], // 80% used
      ['2026-09-01', 10_000, 60_000, 'over'],
      ['2026-10-01', 0, 50_000, 'on_track'],
    ]);
  });

  it('edits apply from the current period; completed periods keep their amount', async () => {
    const b = await budget({ startDate: '2026-09-01', amountMinor: 50_000, rolloverEnabled: true });
    await spend(20_000, L.cat.groceries, '2026-09-15');
    expect(await L.repos.budgets.hasHistory(b.id, '2026-10-20')).toBe(true);

    await L.repos.budgets.update(
      b.id,
      {
        name: 'Groceries',
        categoryId: L.cat.groceries,
        periodType: 'monthly',
        startDate: '2026-09-01',
        currency: 'USD',
        amountMinor: 70_000,
        rolloverEnabled: true,
      },
      '2026-10-20',
    );
    const { periods } = (await L.repos.budgets.overview(b.id, '2026-10-20'))!.evaluation;
    expect(periods.map((p) => [p.limitMinor, p.carryInMinor])).toEqual([
      [50_000, 0],
      [70_000, 30_000],
    ]);
    expect(await L.repos.budgets.revisions(b.id)).toHaveLength(2);

    // A second edit in the same period updates that revision instead of adding one.
    await L.repos.budgets.update(
      b.id,
      {
        name: 'Food shop',
        categoryId: L.cat.groceries,
        periodType: 'monthly',
        startDate: '2026-09-01',
        currency: 'USD',
        amountMinor: 65_000,
        rolloverEnabled: true,
      },
      '2026-10-21',
    );
    expect((await L.repos.budgets.revisions(b.id)).map((r) => r.amountMinor)).toEqual([
      50_000, 65_000,
    ]);
    expect((await L.repos.budgets.getById(b.id))!.name).toBe('Food shop');

    // Scope, period and currency are locked once a period has completed.
    await expect(
      L.repos.budgets.update(
        b.id,
        {
          name: 'x',
          categoryId: L.cat.household,
          periodType: 'monthly',
          startDate: '2026-09-01',
          currency: 'USD',
          amountMinor: 1,
        },
        '2026-10-21',
      ),
    ).rejects.toMatchObject({ fieldErrors: { categoryId: 'budgets.errors.historyLocked' } });
  });

  it('can be reshaped freely before any period completes', async () => {
    const b = await budget();
    await L.repos.budgets.update(
      b.id,
      {
        name: 'Dining',
        categoryId: L.cat.restaurants,
        periodType: 'weekly',
        startDate: '2026-10-14',
        currency: 'EUR',
        amountMinor: 9_000,
        rolloverEnabled: true,
      },
      '2026-10-14',
    );
    expect(await L.repos.budgets.getById(b.id)).toMatchObject({
      categoryId: L.cat.restaurants,
      periodType: 'weekly',
      startDate: '2026-10-12',
      currency: 'EUR',
      amountMinor: 9_000,
    });
    expect(await L.repos.budgets.revisions(b.id)).toEqual([
      expect.objectContaining({
        effectiveFrom: '2026-10-12',
        amountMinor: 9_000,
        rolloverEnabled: true,
      }),
    ]);
  });

  it('locks the amount of an ended custom budget', async () => {
    const b = await budget({
      periodType: 'custom',
      startDate: '2026-09-01',
      endDate: '2026-09-30',
    });
    await expect(
      L.repos.budgets.update(
        b.id,
        {
          name: 'Groceries',
          categoryId: L.cat.groceries,
          periodType: 'custom',
          startDate: '2026-09-01',
          endDate: '2026-09-30',
          currency: 'USD',
          amountMinor: 1,
        },
        '2026-10-05',
      ),
    ).rejects.toMatchObject({ fieldErrors: { amountMinor: 'budgets.errors.ended' } });
  });

  it('prevents duplicate active budgets and checks the category', async () => {
    await budget();
    await expect(budget({ name: 'Again' })).rejects.toMatchObject({
      fieldErrors: { categoryId: 'budgets.errors.duplicate' },
    });
    // A different currency or period type is a different budget.
    await expect(budget({ currency: 'EUR' })).resolves.toBeTruthy();
    await expect(budget({ periodType: 'weekly' })).resolves.toBeTruthy();
    await expect(budget({ categoryId: L.cat.salary })).rejects.toMatchObject({
      fieldErrors: { categoryId: 'budgets.errors.categoryKind' },
    });
    await expect(
      budget({ categoryId: '00000000-0000-4000-8000-0000000000ff' }),
    ).rejects.toMatchObject({
      fieldErrors: { categoryId: 'budgets.errors.categoryNotFound' },
    });
    await L.repos.categories.setArchived(L.cat.household, true);
    await expect(budget({ categoryId: L.cat.household })).rejects.toMatchObject({
      fieldErrors: { categoryId: 'budgets.errors.categoryArchived' },
    });
  });

  it('archives and restores; archived budgets leave the active list', async () => {
    const b = await budget();
    await L.repos.budgets.setArchived(b.id, true);
    expect(await L.repos.budgets.overviews('2026-10-20')).toHaveLength(0);
    expect(await L.repos.budgets.overviews('2026-10-20', { archived: true })).toHaveLength(1);
    expect(await L.repos.budgets.list()).toHaveLength(0);
    expect(await L.repos.budgets.list({ includeArchived: true })).toHaveLength(1);

    const replacement = await budget({ name: 'New groceries' });
    await expect(L.repos.budgets.setArchived(b.id, false)).rejects.toMatchObject({
      fieldErrors: { categoryId: 'budgets.errors.duplicate' },
    });
    await L.repos.budgets.setArchived(replacement.id, true);
    await L.repos.budgets.setArchived(b.id, false);
    expect((await L.repos.budgets.overviews('2026-10-20')).map((o) => o.budget.id)).toEqual([b.id]);
    await expect(L.repos.budgets.setArchived('missing', true)).rejects.toMatchObject({
      code: 'not_found',
    });
  });

  it('converts other currencies with known rates and reports missing ones', async () => {
    const eurAccount = await createAccount(L, { name: 'Euro', currency: 'EUR' });
    const gbpAccount = await createAccount(L, { name: 'Pound', currency: 'GBP' });
    const usd = await budget({ name: 'Total', categoryId: null, amountMinor: 100_000 });
    const eur = await budget({
      name: 'Total EUR',
      categoryId: null,
      currency: 'EUR',
      amountMinor: 100_000,
    });
    await L.db.run(
      `INSERT INTO exchange_rates (id, base_currency, quote_currency, rate, rate_date, source, created_at)
       VALUES ('r1', 'EUR', 'USD', '1.1', '2026-10-01', 'test', '2026-10-01T00:00:00Z')`,
    );
    // EUR expense: base snapshot (USD) recorded at entry using the rate.
    await L.repos.transactions.create({
      type: 'expense',
      accountId: eurAccount.id,
      amountMinor: 10_000,
      localDate: '2026-10-05',
      localTime: '12:00',
      timeZone: TZ,
      categoryId: L.cat.household,
    });
    // GBP expense: no rate at all → excluded and reported.
    await L.repos.transactions.create({
      type: 'expense',
      accountId: gbpAccount.id,
      amountMinor: 5_000,
      localDate: '2026-10-05',
      localTime: '12:00',
      timeZone: TZ,
      categoryId: L.cat.household,
    });
    await spend(2_200, L.cat.household, '2026-10-06');

    const usdView = (await L.repos.budgets.overview(usd.id, '2026-10-20'))!;
    expect(usdView.evaluation.current.spentMinor).toBe(11_000 + 2_200);
    expect(usdView.missingRates).toEqual(['GBP']);

    // USD spending in a EUR budget uses the inverse of the EUR→USD rate.
    const eurView = (await L.repos.budgets.overview(eur.id, '2026-10-20'))!;
    expect(eurView.evaluation.current.spentMinor).toBe(10_000 + 2_000);
    expect(eurView.missingRates).toEqual(['GBP']);
  });

  it('refreshes after a new expense (workflow: create budget → add expense)', async () => {
    const b = await budget();
    expect((await current(b.id)).spentMinor).toBe(0);
    L.ctx.changes.length = 0;
    await spend(4_500, L.cat.groceries, '2026-10-19');
    expect(L.ctx.changes).toContain('transactions');
    expect((await current(b.id)).spentMinor).toBe(4_500);
  });

  it('uses the budget amount when revisions have not synced yet', async () => {
    const b = await budget({ amountMinor: 12_345 });
    await L.db.run(`DELETE FROM budget_revisions`);
    expect((await current(b.id)).limitMinor).toBe(12_345);
    expect(await L.repos.budgets.revisions(b.id)).toHaveLength(1);
    // Reshaping recreates a real revision.
    await L.repos.budgets.update(
      b.id,
      {
        name: 'Groceries',
        categoryId: L.cat.groceries,
        periodType: 'monthly',
        startDate: '2026-10-01',
        currency: 'USD',
        amountMinor: 20_000,
      },
      '2026-10-20',
    );
    expect(
      await L.db.getAll(`SELECT amount_minor FROM budget_revisions WHERE deleted_at IS NULL`),
    ).toEqual([{ amount_minor: 20_000 }]);
  });

  it('returns nothing for unknown budgets', async () => {
    expect(await L.repos.budgets.getById('nope')).toBeNull();
    expect(await L.repos.budgets.overview('nope', '2026-10-20')).toBeNull();
    expect(await L.repos.budgets.revisions('nope')).toEqual([]);
    expect(await L.repos.budgets.spendingLines('nope', '2026-10-01', '2026-10-31')).toEqual([]);
    expect(await L.repos.budgets.hasHistory('nope', '2026-10-20')).toBe(false);
    await expect(
      L.repos.budgets.update(
        'nope',
        {
          name: 'x',
          categoryId: null,
          periodType: 'monthly',
          startDate: '2026-10-01',
          currency: 'USD',
          amountMinor: 1,
        },
        '2026-10-20',
      ),
    ).rejects.toMatchObject({ code: 'not_found' });
  });
});
