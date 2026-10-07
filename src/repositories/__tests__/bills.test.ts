import { balanceOf, createAccount, createLedger, type Ledger, TZ } from '@/test/ledger';
import type { BillInput } from '@/validation/planning';

describe('bills & subscriptions', () => {
  let L: Ledger;
  let chk: Awaited<ReturnType<typeof createAccount>>;

  beforeEach(async () => {
    L = await createLedger();
    chk = await createAccount(L, { openingBalanceMinor: 100_000 });
  });
  afterEach(() => L.db.close());

  const input = (patch: Partial<BillInput> = {}): BillInput => ({
    name: 'Rent',
    isSubscription: false,
    amountMinor: 120_000,
    currency: 'USD',
    accountId: chk.id,
    categoryId: L.cat.household,
    frequency: 'monthly',
    interval: 1,
    nextDueDate: '2026-01-31',
    ...patch,
  });

  const pay = (billId: string, dueDate: string, amountMinor = 120_000, localDate = dueDate) =>
    L.repos.bills.markPaid(billId, {
      dueDate,
      transaction: {
        type: 'expense',
        accountId: chk.id,
        amountMinor,
        localDate,
        localTime: '09:00',
        timeZone: TZ,
        payee: 'Rent',
        categoryId: L.cat.household,
      },
    });

  const bill = async (id: string) => (await L.repos.bills.getById(id))!;

  it('creating a bill changes no balance and no spending (it is not a transaction)', async () => {
    const b = await L.repos.bills.create(input());
    expect(b).toMatchObject({
      anchorDate: '2026-01-31',
      nextDueDate: '2026-01-31',
      isActive: true,
    });
    expect((await balanceOf(L, chk.id))?.amountMinor).toBe(100_000);
    expect(await L.db.getAll(`SELECT id FROM transactions`)).toHaveLength(0);
  });

  it('mark as paid creates a normal expense, updates balance and budget, advances month-end safely', async () => {
    const budget = await L.repos.budgets.create({
      name: 'Household',
      categoryId: L.cat.household,
      periodType: 'monthly',
      startDate: '2026-01-01',
      currency: 'USD',
      amountMinor: 200_000,
    });
    const b = await L.repos.bills.create(input());
    await L.db.run(`DELETE FROM sync_outbox`);
    const txId = await pay(b.id, '2026-01-31');

    const tx = await L.repos.transactions.getById(txId);
    expect(tx?.transaction).toMatchObject({ type: 'expense', amountMinor: -120_000 });
    expect((await balanceOf(L, chk.id))?.amountMinor).toBe(-20_000);
    const view = (await L.repos.budgets.overview(budget.id, '2026-01-31'))!;
    expect(view.evaluation.current.spentMinor).toBe(120_000); // counted once
    expect((await bill(b.id)).bill.nextDueDate).toBe('2026-02-28');
    expect((await bill(b.id)).payments).toEqual([
      expect.objectContaining({
        dueDate: '2026-01-31',
        status: 'paid',
        transactionId: txId,
        transaction: expect.objectContaining({ amountMinor: -120_000, accountName: 'Checking' }),
      }),
    ]);

    // The transaction is queued before the payment that references it.
    const outbox = await L.db.getAll<{ entity: string }>(
      `SELECT entity FROM sync_outbox ORDER BY rowid`,
    );
    expect(outbox.map((o) => o.entity)).toEqual(['transactions', 'bill_payments', 'bills']);

    await pay(b.id, '2026-02-28');
    expect((await bill(b.id)).bill.nextDueDate).toBe('2026-03-31');
  });

  it('pays only the current due date of an active bill', async () => {
    const b = await L.repos.bills.create(input());
    await expect(pay(b.id, '2026-02-28')).rejects.toMatchObject({
      fieldErrors: { dueDate: 'bills.errors.notDue' },
    });
    await expect(
      L.repos.bills.markPaid(b.id, {
        dueDate: '2026-01-31',
        transaction: {
          type: 'income',
          accountId: chk.id,
          amountMinor: 1,
          localDate: '2026-01-31',
          localTime: '09:00',
          timeZone: TZ,
          categoryId: L.cat.salary,
        },
      }),
    ).rejects.toMatchObject({ fieldErrors: { type: 'bills.errors.paymentType' } });
    await L.repos.bills.setArchived(b.id, true);
    await expect(pay(b.id, '2026-01-31')).rejects.toMatchObject({
      fieldErrors: { billId: 'bills.errors.archived' },
    });
    // Nothing was written by the failed attempts.
    expect(await L.db.getAll(`SELECT id FROM transactions`)).toHaveLength(0);
  });

  it('a payment that fails validation leaves no partial data', async () => {
    const b = await L.repos.bills.create(input());
    await L.repos.accounts.setArchived(chk.id, true);
    await expect(pay(b.id, '2026-01-31')).rejects.toMatchObject({
      fieldErrors: { accountId: 'transactions.errors.accountArchived' },
    });
    expect(await L.db.getAll(`SELECT id FROM bill_payments`)).toHaveLength(0);
    expect((await bill(b.id)).bill.nextDueDate).toBe('2026-01-31');
  });

  it('links an existing expense instead of creating one', async () => {
    const b = await L.repos.bills.create(input({ nextDueDate: '2026-10-01' }));
    const existing = await L.repos.transactions.create({
      type: 'expense',
      accountId: chk.id,
      amountMinor: 119_000,
      localDate: '2026-09-30',
      localTime: '10:00',
      timeZone: TZ,
      categoryId: L.cat.household,
    });
    await L.repos.bills.linkPayment(b.id, { dueDate: '2026-10-01', transactionId: existing });
    expect((await bill(b.id)).payments[0]).toMatchObject({
      amountMinor: 119_000,
      transactionId: existing,
    });
    expect(await L.db.getAll(`SELECT id FROM transactions WHERE deleted_at IS NULL`)).toHaveLength(
      1,
    );

    const other = await L.repos.bills.create(input({ name: 'Other', nextDueDate: '2026-10-01' }));
    await expect(
      L.repos.bills.linkPayment(other.id, { dueDate: '2026-10-01', transactionId: existing }),
    ).rejects.toMatchObject({ fieldErrors: { transactionId: 'bills.errors.alreadyLinked' } });
    const income = await L.repos.transactions.create({
      type: 'income',
      accountId: chk.id,
      amountMinor: 1,
      localDate: '2026-09-30',
      localTime: '10:00',
      timeZone: TZ,
      categoryId: L.cat.salary,
    });
    await expect(
      L.repos.bills.linkPayment(other.id, { dueDate: '2026-10-01', transactionId: income }),
    ).rejects.toMatchObject({ fieldErrors: { transactionId: 'bills.errors.linkInvalid' } });
  });

  it('deleting the paying transaction makes the due date unpaid again', async () => {
    const b = await L.repos.bills.create(input());
    const txId = await pay(b.id, '2026-01-31');
    await pay(b.id, '2026-02-28');
    await L.repos.transactions.remove(txId);
    const after = await bill(b.id);
    expect(after.bill.nextDueDate).toBe('2026-01-31');
    expect(after.payments.map((p) => p.dueDate)).toEqual(['2026-02-28']);
    // Paying January again skips February, which is already paid.
    await pay(b.id, '2026-01-31');
    expect((await bill(b.id)).bill.nextDueDate).toBe('2026-03-31');
  });

  it('skips and undoes due dates', async () => {
    const b = await L.repos.bills.create(
      input({ frequency: 'weekly', interval: 2, nextDueDate: '2026-10-05' }),
    );
    await L.repos.bills.skip(b.id, '2026-10-05');
    const skipped = await bill(b.id);
    expect(skipped.bill.nextDueDate).toBe('2026-10-19');
    expect(skipped.payments[0]).toMatchObject({ status: 'skipped', transaction: null });
    await L.repos.bills.undoPayment(skipped.payments[0]!.id);
    expect((await bill(b.id)).bill.nextDueDate).toBe('2026-10-05');
    await expect(L.repos.bills.undoPayment('nope')).rejects.toMatchObject({ code: 'not_found' });
  });

  it('finishes at the end date and reopens if the last payment is removed', async () => {
    const b = await L.repos.bills.create(
      input({ nextDueDate: '2026-10-15', endDate: '2026-11-20' }),
    );
    await pay(b.id, '2026-10-15');
    const last = await pay(b.id, '2026-11-15');
    expect((await bill(b.id)).bill).toMatchObject({ isActive: false, nextDueDate: '2026-11-15' });
    await L.repos.transactions.remove(last);
    expect((await bill(b.id)).bill).toMatchObject({ isActive: true, nextDueDate: '2026-11-15' });
  });

  it('a manually archived bill stays archived when an old payment is deleted', async () => {
    const b = await L.repos.bills.create(input({ nextDueDate: '2026-10-15' }));
    const first = await pay(b.id, '2026-10-15');
    await L.repos.bills.setArchived(b.id, true);
    await L.repos.transactions.remove(first);
    expect((await bill(b.id)).bill).toMatchObject({ isActive: false, nextDueDate: '2026-10-15' });
  });

  it('lists by due date, upcoming within a horizon, archived separately', async () => {
    await L.repos.bills.create(input({ name: 'Rent', nextDueDate: '2026-11-01' }));
    await L.repos.bills.create(input({ name: 'Water', nextDueDate: '2026-10-03' }));
    const netflix = await L.repos.bills.create(
      input({
        name: 'Netflix',
        isSubscription: true,
        amountMinor: 1_599,
        nextDueDate: '2026-10-10',
        categoryId: L.cat.subscriptions,
      }),
    );
    expect((await L.repos.bills.list({})).map((i) => i.bill.name)).toEqual([
      'Water',
      'Netflix',
      'Rent',
    ]);
    expect((await L.repos.bills.list({ kind: 'subscription' })).map((i) => i.bill.name)).toEqual([
      'Netflix',
    ]);
    expect((await L.repos.bills.upcoming('2026-10-14')).map((i) => i.bill.name)).toEqual([
      'Water',
      'Netflix',
    ]);
    expect(
      (await L.repos.bills.upcoming('2026-10-14', { kind: 'bill' })).map((i) => i.bill.name),
    ).toEqual(['Water']);
    const first = (await L.repos.bills.list({}))[0]!;
    expect(first).toMatchObject({ accountName: 'Checking', categoryName: 'Household' });

    await L.repos.bills.setArchived(netflix.id, true);
    expect((await L.repos.bills.list({ archived: true })).map((i) => i.bill.name)).toEqual([
      'Netflix',
    ]);
    expect(await L.repos.bills.upcoming('2026-10-14', { kind: 'subscription' })).toEqual([]);
    await L.repos.bills.setArchived(netflix.id, false);
    expect(await L.repos.bills.upcoming('2026-10-14', { kind: 'subscription' })).toHaveLength(1);
  });

  it('recent payments list paid occurrences', async () => {
    const b = await L.repos.bills.create(input({ nextDueDate: '2026-10-01' }));
    await pay(b.id, '2026-10-01');
    await L.repos.bills.skip(b.id, '2026-11-01');
    const paid = await L.repos.bills.recentPayments({ limit: 10 });
    expect(paid).toEqual([
      expect.objectContaining({
        billName: 'Rent',
        isSubscription: false,
        payment: expect.objectContaining({ dueDate: '2026-10-01' }),
      }),
    ]);
    expect(await L.repos.bills.recentPayments({ kind: 'subscription', limit: 10 })).toEqual([]);
  });

  it('validates account, currency and category', async () => {
    await expect(L.repos.bills.create(input({ currency: 'EUR' }))).rejects.toMatchObject({
      fieldErrors: { currency: 'bills.errors.currencyMismatch' },
    });
    await expect(L.repos.bills.create(input({ categoryId: L.cat.salary }))).rejects.toMatchObject({
      fieldErrors: { categoryId: 'bills.errors.categoryKind' },
    });
    await expect(L.repos.bills.create(input({ categoryId: 'missing' }))).rejects.toMatchObject({
      fieldErrors: { categoryId: 'bills.errors.categoryNotFound' },
    });
    await expect(L.repos.bills.create(input({ accountId: 'missing' }))).rejects.toMatchObject({
      fieldErrors: { accountId: 'bills.errors.accountNotFound' },
    });
    await expect(L.repos.bills.create(input({ endDate: '2026-01-01' }))).rejects.toMatchObject({
      fieldErrors: { endDate: 'bills.errors.endBeforeDue' },
    });
    await expect(L.repos.bills.create(input({ interval: 0 }))).rejects.toMatchObject({
      fieldErrors: { interval: 'bills.errors.interval' },
    });
    const created = await L.repos.bills.create(input());
    await L.repos.categories.setArchived(L.cat.subscriptions, true);
    await expect(
      L.repos.bills.create(input({ categoryId: L.cat.subscriptions })),
    ).rejects.toMatchObject({
      fieldErrors: { categoryId: 'bills.errors.categoryArchived' },
    });
    await L.repos.accounts.setArchived(chk.id, true);
    await expect(L.repos.bills.create(input())).rejects.toMatchObject({
      fieldErrors: { accountId: 'bills.errors.accountArchived' },
    });
    // An existing bill keeps its (now archived) account when edited.
    await expect(
      L.repos.bills.update(created.id, input({ name: 'Rent 2026' })),
    ).resolves.toBeUndefined();
    await expect(L.repos.bills.update('missing', input())).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(
      L.repos.bills.create(input({ accountId: null, currency: 'EUR' })),
    ).resolves.toBeTruthy();
  });

  it('editing the schedule re-anchors it; other edits keep the anchor', async () => {
    const b = await L.repos.bills.create(input());
    await pay(b.id, '2026-01-31');
    await L.repos.bills.update(
      b.id,
      input({ nextDueDate: '2026-02-28', amountMinor: 125_000, autopay: true }),
    );
    expect((await bill(b.id)).bill).toMatchObject({
      anchorDate: '2026-01-31',
      nextDueDate: '2026-02-28',
      amountMinor: 125_000,
      autopay: true,
    });
    await L.repos.bills.update(
      b.id,
      input({ nextDueDate: '2026-03-05', frequency: 'monthly', interval: 3 }),
    );
    expect((await bill(b.id)).bill).toMatchObject({
      anchorDate: '2026-03-05',
      nextDueDate: '2026-03-05',
      interval: 3,
    });
    expect(await L.repos.bills.getById('missing')).toBeNull();
  });

  it('subscription totals are exact per currency and honest about conversions', async () => {
    const eur = await createAccount(L, { name: 'Euro', currency: 'EUR' });
    await L.repos.bills.create(
      input({ name: 'Music', isSubscription: true, amountMinor: 1_000, nextDueDate: '2026-10-10' }),
    );
    await L.repos.bills.create(
      input({
        name: 'Cloud',
        isSubscription: true,
        amountMinor: 3_000,
        frequency: 'monthly',
        interval: 3,
        nextDueDate: '2026-10-10',
      }),
    );
    let summary = await L.repos.bills.subscriptionSummary('2026-10-07', 'USD');
    expect(summary).toMatchObject({
      count: 2,
      perCurrency: [
        {
          currency: 'USD',
          monthly: { amountMinor: 2_000, approximate: false },
          yearly: { amountMinor: 24_000, approximate: false },
        },
      ],
      base: { currency: 'USD', monthly: { amountMinor: 2_000, approximate: false } },
      missingRates: [],
    });

    await L.repos.bills.create(
      input({
        name: 'Gym',
        isSubscription: true,
        amountMinor: 12_000,
        currency: 'EUR',
        accountId: eur.id,
        frequency: 'yearly',
        interval: 1,
        nextDueDate: '2027-01-01',
      }),
    );
    summary = await L.repos.bills.subscriptionSummary('2026-10-07', 'USD');
    expect(summary.base).toBeNull();
    expect(summary.missingRates).toEqual(['EUR']);
    expect(summary.perCurrency.map((c) => [c.currency, c.monthly.amountMinor])).toEqual([
      ['EUR', 1_000],
      ['USD', 2_000],
    ]);

    await L.db.run(
      `INSERT INTO exchange_rates (id, base_currency, quote_currency, rate, rate_date, source, created_at)
       VALUES ('r1', 'EUR', 'USD', '1.1', '2026-10-01', 'test', '2026-10-01T00:00:00Z')`,
    );
    summary = await L.repos.bills.subscriptionSummary('2026-10-07', 'USD');
    expect(summary.base).toEqual({
      currency: 'USD',
      monthly: { amountMinor: 3_100, approximate: true },
      yearly: { amountMinor: 37_200, approximate: true },
    });
  });
});
