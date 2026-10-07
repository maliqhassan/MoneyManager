import { summarizeCashFlow } from '@/domain/finance/cashflow';
import { at, balanceOf, createAccount, createLedger, type Ledger } from '@/test/ledger';

let L: Ledger;
beforeEach(async () => {
  L = await createLedger();
});
afterEach(() => L.db.close());

const expense = (accountId: string, amountMinor: number, extra: object = {}) =>
  L.repos.transactions.create({
    type: 'expense',
    accountId,
    amountMinor,
    ...at,
    payee: 'Grocery Store',
    categoryId: L.cat.groceries,
    ...extra,
  });

describe('balances', () => {
  it('expense decreases, income and refund increase the balance', async () => {
    const chk = await createAccount(L, { openingBalanceMinor: 100_000 });
    await expense(chk.id, 8_540);
    await L.repos.transactions.create({
      type: 'income',
      accountId: chk.id,
      amountMinor: 350_000,
      ...at,
      payee: 'Salary',
      categoryId: L.cat.salary,
    });
    await L.repos.transactions.create({
      type: 'refund',
      accountId: chk.id,
      amountMinor: 3_000,
      ...at,
      payee: 'Grocery Store',
      categoryId: L.cat.groceries,
    });
    expect(await balanceOf(L, chk.id)).toEqual({
      amountMinor: 100_000 - 8_540 + 350_000 + 3_000,
      currency: 'USD',
    });
  });

  it('a transfer moves money without changing the combined balance', async () => {
    const chk = await createAccount(L, { openingBalanceMinor: 100_000 });
    const sav = await createAccount(L, {
      name: 'Savings',
      type: 'savings',
      openingBalanceMinor: 20_000,
    });
    await L.repos.transactions.createTransfer({
      fromAccountId: chk.id,
      toAccountId: sav.id,
      amountMinor: 50_000,
      ...at,
    });
    const a = await balanceOf(L, chk.id);
    const b = await balanceOf(L, sav.id);
    expect(a?.amountMinor).toBe(50_000);
    expect(b?.amountMinor).toBe(70_000);
    expect((a?.amountMinor ?? 0) + (b?.amountMinor ?? 0)).toBe(120_000);
  });

  it('credit card purchase and payment: liability moves, spending counted once', async () => {
    const chk = await createAccount(L, { openingBalanceMinor: 300_000 });
    const card = await createAccount(L, { name: 'Visa', type: 'credit_card' });
    await expense(card.id, 50_000, { payee: 'Electronics Store' });
    expect(await balanceOf(L, card.id)).toEqual({ amountMinor: -50_000, currency: 'USD' });

    await L.repos.transactions.createTransfer({
      fromAccountId: chk.id,
      toAccountId: card.id,
      amountMinor: 50_000,
      ...at,
    });
    expect(await balanceOf(L, card.id)).toEqual({ amountMinor: 0, currency: 'USD' });
    expect(await balanceOf(L, chk.id)).toEqual({ amountMinor: 250_000, currency: 'USD' });

    const rows = await L.repos.transactions.cashFlow('2026-10-01', '2026-10-31');
    const flow = summarizeCashFlow(
      rows.map((r) => ({
        type: r.type,
        amountMinor: r.totalMinor,
        currency: r.baseCurrency,
        deletedAt: null,
      })),
      'USD',
    );
    expect(flow.expenses.amountMinor).toBe(50_000); // not 100 000
    expect(flow.income.amountMinor).toBe(0);
    expect(rows.some((r) => r.type === 'transfer')).toBe(false);
  });

  it('refunds reduce net spending rather than counting as income', async () => {
    const chk = await createAccount(L);
    const original = await expense(chk.id, 10_000);
    await L.repos.transactions.create({
      type: 'refund',
      accountId: chk.id,
      amountMinor: 3_000,
      ...at,
      categoryId: L.cat.groceries,
      refundOfTransactionId: original,
    });
    const rows = await L.repos.transactions.cashFlow('2026-10-01', '2026-10-31');
    const flow = summarizeCashFlow(
      rows.map((r) => ({
        type: r.type,
        amountMinor: r.totalMinor,
        currency: r.baseCurrency,
        deletedAt: null,
      })),
      'USD',
    );
    expect(flow.expenses.amountMinor).toBe(7_000);
    expect(flow.income.amountMinor).toBe(0);
    const spend = await L.repos.transactions.categorySpending('2026-10-01', '2026-10-31');
    expect(spend).toEqual([
      { categoryId: L.cat.groceries, baseCurrency: 'USD', totalMinor: -7_000 },
    ]);
    const detail = await L.repos.transactions.getById(
      (await L.repos.transactions.list({ types: ['refund'] }))[0]!.id,
    );
    expect(detail?.refundOf).toMatchObject({ id: original, amountMinor: -10_000 });
  });

  it('keeps foreign amounts unconverted when no rate exists, and converts when one does', async () => {
    const eur = await createAccount(L, { name: 'Euro', currency: 'EUR' });
    const noRate = await expense(eur.id, 2_000);
    expect((await L.repos.transactions.getById(noRate))?.transaction).toMatchObject({
      amountMinor: -2_000,
      currency: 'EUR',
      baseCurrency: 'EUR',
      baseAmountMinor: -2_000,
      baseFxSource: 'unconverted',
    });
    await L.db.run(
      `INSERT INTO exchange_rates (id, base_currency, quote_currency, rate, rate_date, source, created_at)
       VALUES ('r1', 'EUR', 'USD', '1.08', '2026-10-01', 'ecb', '2026-10-01T00:00:00Z')`,
    );
    const withRate = await expense(eur.id, 2_000);
    expect((await L.repos.transactions.getById(withRate))?.transaction).toMatchObject({
      amountMinor: -2_000,
      currency: 'EUR',
      originalAmountMinor: -2_000,
      originalCurrency: 'EUR',
      baseCurrency: 'USD',
      baseAmountMinor: -2_160,
      baseFxRate: '1.08',
    });
    expect(await balanceOf(L, eur.id)).toEqual({ amountMinor: -4_000, currency: 'EUR' });
  });

  it('cross-currency transfers use the received amount', async () => {
    const gbp = await createAccount(L, {
      name: 'UK',
      currency: 'GBP',
      openingBalanceMinor: 50_000,
    });
    const eur = await createAccount(L, { name: 'Euro', currency: 'EUR' });
    await expect(
      L.repos.transactions.createTransfer({
        fromAccountId: gbp.id,
        toAccountId: eur.id,
        amountMinor: 10_000,
        ...at,
      }),
    ).rejects.toMatchObject({
      fieldErrors: { receivedAmountMinor: 'transactions.errors.receivedAmountRequired' },
    });
    await L.repos.transactions.createTransfer({
      fromAccountId: gbp.id,
      toAccountId: eur.id,
      amountMinor: 10_000,
      receivedAmountMinor: 11_650,
      ...at,
    });
    expect(await balanceOf(L, gbp.id)).toEqual({ amountMinor: 40_000, currency: 'GBP' });
    expect(await balanceOf(L, eur.id)).toEqual({ amountMinor: 11_650, currency: 'EUR' });
  });
});

describe('validation', () => {
  it('rejects zero, negative and fractional amounts', async () => {
    const chk = await createAccount(L);
    for (const amountMinor of [0, -500, 10.5]) {
      await expect(expense(chk.id, amountMinor)).rejects.toMatchObject({ code: 'validation' });
    }
    expect(await L.repos.transactions.list()).toHaveLength(0);
  });

  it('requires an existing, active account', async () => {
    await expect(expense('missing', 100)).rejects.toMatchObject({
      fieldErrors: { accountId: 'transactions.errors.accountNotFound' },
    });
    await expect(expense('', 100)).rejects.toMatchObject({
      fieldErrors: { accountId: 'validation.required' },
    });
    const old = await createAccount(L, { name: 'Old' });
    await L.repos.accounts.setArchived(old.id, true);
    await expect(expense(old.id, 100)).rejects.toMatchObject({
      fieldErrors: { accountId: 'transactions.errors.accountArchived' },
    });
  });

  it('blocks transfers to/from archived accounts and to the same account', async () => {
    const a = await createAccount(L);
    const b = await createAccount(L, { name: 'B' });
    await L.repos.accounts.setArchived(b.id, true);
    await expect(
      L.repos.transactions.createTransfer({
        fromAccountId: a.id,
        toAccountId: b.id,
        amountMinor: 100,
        ...at,
      }),
    ).rejects.toMatchObject({
      fieldErrors: { toAccountId: 'transactions.errors.accountArchived' },
    });
    await expect(
      L.repos.transactions.createTransfer({
        fromAccountId: b.id,
        toAccountId: a.id,
        amountMinor: 100,
        ...at,
      }),
    ).rejects.toMatchObject({
      fieldErrors: { fromAccountId: 'transactions.errors.accountArchived' },
    });
    await expect(
      L.repos.transactions.createTransfer({
        fromAccountId: a.id,
        toAccountId: a.id,
        amountMinor: 100,
        ...at,
      }),
    ).rejects.toMatchObject({ fieldErrors: { toAccountId: 'transactions.errors.sameAccount' } });
  });

  it('keeps history on archived accounts editable but not re-targetable', async () => {
    const a = await createAccount(L);
    const b = await createAccount(L, { name: 'Closed' });
    const id = await expense(b.id, 1_000);
    await L.repos.accounts.setArchived(b.id, true);
    const base = {
      type: 'expense' as const,
      amountMinor: 1_000,
      ...at,
      categoryId: L.cat.groceries,
    };
    await expect(
      L.repos.transactions.update(id, { ...base, accountId: b.id, notes: 'fixed' }),
    ).resolves.toBeUndefined();
    const other = await expense(a.id, 500);
    await expect(
      L.repos.transactions.update(other, { ...base, accountId: b.id }),
    ).rejects.toMatchObject({
      fieldErrors: { accountId: 'transactions.errors.accountArchived' },
    });
    expect(await L.repos.transactions.list({ accountIds: [b.id] })).toHaveLength(1);
  });

  it('validates categories: required, existing, matching kind, not archived', async () => {
    const chk = await createAccount(L);
    await expect(expense(chk.id, 100, { categoryId: null })).rejects.toMatchObject({
      fieldErrors: { categoryId: 'transactions.errors.categoryRequired' },
    });
    await expect(expense(chk.id, 100, { categoryId: 'nope' })).rejects.toMatchObject({
      fieldErrors: { categoryId: 'transactions.errors.categoryNotFound' },
    });
    await expect(expense(chk.id, 100, { categoryId: L.cat.salary })).rejects.toMatchObject({
      fieldErrors: { categoryId: 'transactions.errors.categoryKind' },
    });
    await L.repos.categories.setArchived(L.cat.household, true);
    await expect(expense(chk.id, 100, { categoryId: L.cat.household })).rejects.toMatchObject({
      fieldErrors: { categoryId: 'transactions.errors.categoryArchived' },
    });
  });

  it('rejects refund links to non-expenses and on non-refunds', async () => {
    const chk = await createAccount(L);
    const income = await L.repos.transactions.create({
      type: 'income',
      accountId: chk.id,
      amountMinor: 100,
      ...at,
      categoryId: L.cat.salary,
    });
    await expect(
      L.repos.transactions.create({
        type: 'refund',
        accountId: chk.id,
        amountMinor: 100,
        ...at,
        categoryId: L.cat.groceries,
        refundOfTransactionId: income,
      }),
    ).rejects.toMatchObject({
      fieldErrors: { refundOfTransactionId: 'transactions.errors.refundLinkInvalid' },
    });
    await expect(expense(chk.id, 100, { refundOfTransactionId: income })).rejects.toMatchObject({
      fieldErrors: { refundOfTransactionId: 'transactions.errors.refundLinkOnlyForRefunds' },
    });
  });

  it('does not allow changing a transaction type on edit', async () => {
    const chk = await createAccount(L);
    const id = await expense(chk.id, 100);
    await expect(
      L.repos.transactions.update(id, {
        type: 'income',
        accountId: chk.id,
        amountMinor: 100,
        ...at,
        categoryId: L.cat.salary,
      }),
    ).rejects.toMatchObject({ fieldErrors: { type: 'transactions.errors.typeLocked' } });
  });
});

describe('splits', () => {
  const splits = () => [
    { categoryId: L.cat.groceries, amountMinor: 6_000 },
    { categoryId: L.cat.household, amountMinor: 2_500 },
    { categoryId: L.cat.personalCare, amountMinor: 1_500 },
  ];

  it('stores exact splits with the parent sign and exact base allocation', async () => {
    const chk = await createAccount(L);
    const id = await expense(chk.id, 10_000, { categoryId: null, splits: splits() });
    const detail = await L.repos.transactions.getById(id);
    expect(detail?.transaction).toMatchObject({
      isSplit: true,
      categoryId: null,
      amountMinor: -10_000,
    });
    expect(detail?.splits.map((s) => [s.categoryId, s.amountMinor])).toEqual([
      [L.cat.groceries, -6_000],
      [L.cat.household, -2_500],
      [L.cat.personalCare, -1_500],
    ]);
    expect(detail?.splits.reduce((a, s) => a + s.baseAmountMinor, 0)).toBe(-10_000);
    const spend = await L.repos.transactions.categorySpending('2026-10-01', '2026-10-31');
    expect(spend.find((s) => s.categoryId === L.cat.household)?.totalMinor).toBe(-2_500);
  });

  it('rejects under- and over-allocation and single splits', async () => {
    const chk = await createAccount(L);
    const under = [
      { categoryId: L.cat.groceries, amountMinor: 6_000 },
      { categoryId: L.cat.household, amountMinor: 3_999 },
    ];
    const over = [
      { categoryId: L.cat.groceries, amountMinor: 6_000 },
      { categoryId: L.cat.household, amountMinor: 4_001 },
    ];
    await expect(
      expense(chk.id, 10_000, { categoryId: null, splits: under }),
    ).rejects.toMatchObject({
      fieldErrors: { splits: 'transactions.errors.splitMismatch' },
    });
    await expect(expense(chk.id, 10_000, { categoryId: null, splits: over })).rejects.toMatchObject(
      {
        fieldErrors: { splits: 'transactions.errors.splitMismatch' },
      },
    );
    await expect(
      expense(chk.id, 10_000, {
        categoryId: null,
        splits: [{ categoryId: L.cat.groceries, amountMinor: 10_000 }],
      }),
    ).rejects.toMatchObject({ fieldErrors: { splits: 'transactions.errors.splitTooFew' } });
    await expect(
      L.repos.transactions.create({
        type: 'refund',
        accountId: chk.id,
        amountMinor: 10_000,
        ...at,
        splits: splits(),
      }),
    ).rejects.toMatchObject({ fieldErrors: { splits: 'transactions.errors.splitNotAllowed' } });
  });

  it('edits splits (replacing lines) and removes them with the transaction', async () => {
    const chk = await createAccount(L);
    const id = await expense(chk.id, 10_000, { categoryId: null, splits: splits() });
    await L.repos.transactions.update(id, {
      type: 'expense',
      accountId: chk.id,
      amountMinor: 10_000,
      ...at,
      categoryId: null,
      splits: [
        { categoryId: L.cat.groceries, amountMinor: 7_000 },
        { categoryId: L.cat.household, amountMinor: 3_000 },
      ],
    });
    expect((await L.repos.transactions.getById(id))?.splits.map((s) => s.amountMinor)).toEqual([
      -7_000, -3_000,
    ]);
    // Un-split back to a single category.
    await L.repos.transactions.update(id, {
      type: 'expense',
      accountId: chk.id,
      amountMinor: 10_000,
      ...at,
      categoryId: L.cat.groceries,
    });
    expect((await L.repos.transactions.getById(id))?.splits).toEqual([]);
    await L.repos.transactions.remove(id);
    const live = await L.db.getFirst<{ n: number }>(
      `SELECT COUNT(*) AS n FROM transaction_splits WHERE deleted_at IS NULL`,
    );
    expect(live?.n).toBe(0);
  });

  it('allocates JPY splits without fractional yen', async () => {
    const jpy = await createAccount(L, { name: 'JP', currency: 'JPY' });
    const id = await expense(jpy.id, 1_001, {
      categoryId: null,
      splits: [
        { categoryId: L.cat.groceries, amountMinor: 500 },
        { categoryId: L.cat.household, amountMinor: 501 },
      ],
    });
    const detail = await L.repos.transactions.getById(id);
    expect(detail?.splits.every((s) => Number.isInteger(s.amountMinor))).toBe(true);
    expect(detail?.splits.reduce((a, s) => a + s.amountMinor, 0)).toBe(-1_001);
  });
});

describe('edit, delete, duplicate', () => {
  it('edits all fields of an expense', async () => {
    const chk = await createAccount(L);
    const sav = await createAccount(L, { name: 'Savings', type: 'savings' });
    const id = await expense(chk.id, 1_000, { tagNames: ['Work'] });
    await L.repos.transactions.update(id, {
      type: 'expense',
      accountId: sav.id,
      amountMinor: 2_500,
      localDate: '2026-10-07',
      localTime: '18:30',
      timeZone: 'Europe/London',
      payee: 'Cafe Nero',
      notes: 'team coffee',
      categoryId: L.cat.restaurants,
      tagNames: ['Team'],
    });
    const d = await L.repos.transactions.getById(id);
    expect(d?.transaction).toMatchObject({
      accountId: sav.id,
      amountMinor: -2_500,
      localDate: '2026-10-07',
      timeZone: 'Europe/London',
      occurredAt: '2026-10-07T17:30:00.000Z',
      payee: 'Cafe Nero',
      merchantKey: 'cafe nero',
      categoryId: L.cat.restaurants,
    });
    expect(d?.tags.map((t) => t.name)).toEqual(['Team']);
    expect(await balanceOf(L, chk.id)).toEqual({ amountMinor: 0, currency: 'USD' });
  });

  it('edits a transfer as a coherent pair', async () => {
    const a = await createAccount(L, { openingBalanceMinor: 10_000 });
    const b = await createAccount(L, { name: 'B' });
    const c = await createAccount(L, { name: 'C' });
    const legId = await L.repos.transactions.createTransfer({
      fromAccountId: a.id,
      toAccountId: b.id,
      amountMinor: 3_000,
      ...at,
    });
    const detail = await L.repos.transactions.getById(legId);
    await L.repos.transactions.updateTransfer(detail!.transfer!.id, {
      fromAccountId: a.id,
      toAccountId: c.id,
      amountMinor: 4_000,
      ...at,
      notes: 'moved',
    });
    expect(await balanceOf(L, a.id)).toEqual({ amountMinor: 6_000, currency: 'USD' });
    expect(await balanceOf(L, b.id)).toEqual({ amountMinor: 0, currency: 'USD' });
    expect(await balanceOf(L, c.id)).toEqual({ amountMinor: 4_000, currency: 'USD' });
    const legs = await L.db.getAll(
      `SELECT id FROM transactions WHERE transfer_id = ? AND deleted_at IS NULL`,
      [detail!.transfer!.id],
    );
    expect(legs).toHaveLength(2);
    await expect(
      L.repos.transactions.update(legId, {
        type: 'expense',
        accountId: a.id,
        amountMinor: 1,
        ...at,
        categoryId: L.cat.groceries,
      }),
    ).rejects.toMatchObject({ fieldErrors: { type: 'transactions.errors.useTransferEdit' } });
  });

  it('deletes a transfer completely (both legs and the transfer)', async () => {
    const a = await createAccount(L, { openingBalanceMinor: 10_000 });
    const b = await createAccount(L, { name: 'B' });
    const legId = await L.repos.transactions.createTransfer({
      fromAccountId: a.id,
      toAccountId: b.id,
      amountMinor: 3_000,
      ...at,
    });
    const incoming = (await L.repos.transactions.list({ accountIds: [b.id] }))[0]!;
    await L.repos.transactions.remove(incoming.id); // deleting either side removes both
    expect(await L.repos.transactions.list()).toHaveLength(0);
    expect(await balanceOf(L, a.id)).toEqual({ amountMinor: 10_000, currency: 'USD' });
    const t = await L.db.getFirst<{ deleted_at: string | null }>(
      `SELECT deleted_at FROM transfers`,
    );
    expect(t?.deleted_at).not.toBeNull();
    expect(await L.repos.transactions.getById(legId)).toBeNull();
  });

  it('duplicates a transaction with new ids and the given date', async () => {
    const chk = await createAccount(L);
    const id = await expense(chk.id, 1_500, { tagNames: ['Weekly'], notes: 'bread' });
    const copy = await L.repos.transactions.duplicate(id, {
      localDate: '2026-10-09',
      localTime: '08:00',
      timeZone: at.timeZone,
    });
    expect(copy).not.toBe(id);
    const d = await L.repos.transactions.getById(copy);
    expect(d?.transaction).toMatchObject({
      amountMinor: -1_500,
      localDate: '2026-10-09',
      notes: 'bread',
      version: 0,
    });
    expect(d?.tags.map((t) => t.name)).toEqual(['Weekly']);
    expect(await L.repos.tags.list()).toHaveLength(1); // tag reused, not duplicated
  });

  it('duplicates a transfer as a complete new pair', async () => {
    const a = await createAccount(L, { openingBalanceMinor: 10_000 });
    const b = await createAccount(L, { name: 'B' });
    const legId = await L.repos.transactions.createTransfer({
      fromAccountId: a.id,
      toAccountId: b.id,
      amountMinor: 1_000,
      ...at,
    });
    await L.repos.transactions.duplicate(legId, at);
    const transfers = await L.db.getAll(`SELECT id FROM transfers WHERE deleted_at IS NULL`);
    expect(transfers).toHaveLength(2);
    expect(await balanceOf(L, b.id)).toEqual({ amountMinor: 2_000, currency: 'USD' });
    expect(await balanceOf(L, a.id)).toEqual({ amountMinor: 8_000, currency: 'USD' });
  });
});

describe('time zones', () => {
  it('stores the local date chosen by the user even at extreme offsets', async () => {
    const chk = await createAccount(L);
    const id = await expense(chk.id, 100, {
      localDate: '2026-01-01',
      localTime: '00:30',
      timeZone: 'Pacific/Kiritimati',
    });
    expect((await L.repos.transactions.getById(id))?.transaction).toMatchObject({
      localDate: '2026-01-01',
      occurredAt: '2025-12-31T10:30:00.000Z',
      timeZone: 'Pacific/Kiritimati',
    });
    const late = await expense(chk.id, 100, {
      localDate: '2026-12-31',
      localTime: '23:30',
      timeZone: 'Pacific/Pago_Pago',
    });
    expect((await L.repos.transactions.getById(late))?.transaction.localDate).toBe('2026-12-31');
    // Date filters use the local date, not the UTC instant.
    expect(
      (await L.repos.transactions.list({ from: '2026-01-01', to: '2026-01-01' })).map((t) => t.id),
    ).toEqual([id]);
    expect(
      (await L.repos.transactions.list({ from: '2026-12-31', to: '2026-12-31' })).map((t) => t.id),
    ).toEqual([late]);
  });
});
