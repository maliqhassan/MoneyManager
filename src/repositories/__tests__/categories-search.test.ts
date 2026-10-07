import { createRepositories } from '@/repositories';
import { createTestContext } from '@/test/factories';
import { at, createAccount, createLedger, type Ledger } from '@/test/ledger';

let L: Ledger;
beforeEach(async () => {
  L = await createLedger();
});
afterEach(() => L.db.close());

describe('categories', () => {
  it('creates top-level and subcategories with sensible sort order', async () => {
    const pets = await L.repos.categories.create({
      name: 'Pets',
      kind: 'expense',
      icon: 'paw-outline',
      color: '#13774F',
    });
    const food = await L.repos.categories.create({
      name: 'Pet food',
      kind: 'expense',
      parentId: pets.id,
    });
    expect(pets).toMatchObject({
      parentId: null,
      sortOrder: 4,
      systemKey: null,
      isArchived: false,
    });
    expect(food).toMatchObject({ parentId: pets.id, sortOrder: 0 });
  });

  it('enforces one level of nesting and matching kinds', async () => {
    await expect(
      L.repos.categories.create({ name: 'Too deep', kind: 'expense', parentId: L.cat.groceries }),
    ).rejects.toMatchObject({ fieldErrors: { parentId: 'categories.errors.tooDeep' } });
    await expect(
      L.repos.categories.create({ name: 'Bonus', kind: 'income', parentId: L.cat.food }),
    ).rejects.toMatchObject({ fieldErrors: { parentId: 'categories.errors.kindMismatch' } });
    await expect(
      L.repos.categories.update(L.cat.food, { parentId: L.cat.household }),
    ).rejects.toMatchObject({
      fieldErrors: { parentId: 'categories.errors.hasChildren' },
    });
    await expect(
      L.repos.categories.update(L.cat.salary, { kind: 'expense' }),
    ).rejects.toMatchObject({
      fieldErrors: { kind: 'categories.errors.kindLocked' },
    });
  });

  it('edits name, icon, color and parent', async () => {
    const updated = await L.repos.categories.update(L.cat.household, {
      name: 'Home supplies',
      icon: 'home-outline',
      color: '#B45309',
      parentId: L.cat.food,
    });
    expect(updated).toMatchObject({
      name: 'Home supplies',
      icon: 'home-outline',
      color: '#B45309',
      parentId: L.cat.food,
    });
  });

  it('archives a parent with its subcategories and restores safely', async () => {
    await L.repos.categories.setArchived(L.cat.food, true);
    const active = await L.repos.categories.list({ kind: 'expense' });
    expect(active.map((c) => c.id)).not.toEqual(
      expect.arrayContaining([L.cat.food, L.cat.groceries]),
    );
    await expect(L.repos.categories.setArchived(L.cat.groceries, false)).rejects.toMatchObject({
      fieldErrors: { _root: 'categories.errors.restoreParentFirst' },
    });
    await L.repos.categories.setArchived(L.cat.food, false);
    await L.repos.categories.setArchived(L.cat.groceries, false);
    expect((await L.repos.categories.getById(L.cat.groceries))?.isArchived).toBe(false);
  });

  it('never deletes categories with history; archived ones still show on old transactions', async () => {
    const chk = await createAccount(L);
    const id = await L.repos.transactions.create({
      type: 'expense',
      accountId: chk.id,
      amountMinor: 100,
      ...at,
      categoryId: L.cat.household,
    });
    expect(await L.repos.categories.getUsage(L.cat.household)).toMatchObject({
      transactionCount: 1,
    });
    await expect(L.repos.categories.remove(L.cat.household)).rejects.toMatchObject({
      fieldErrors: { _root: 'categories.errors.inUse' },
    });
    await L.repos.categories.setArchived(L.cat.household, true);
    const detail = await L.repos.transactions.getById(id);
    expect(detail?.category).toMatchObject({
      id: L.cat.household,
      name: 'Household',
      isArchived: true,
    });
    // Editing other fields of that historical transaction keeps its archived category.
    await L.repos.transactions.update(id, {
      type: 'expense',
      accountId: chk.id,
      amountMinor: 200,
      ...at,
      categoryId: L.cat.household,
    });
    await expect(L.repos.categories.remove(L.cat.food)).rejects.toMatchObject({
      fieldErrors: { _root: 'categories.errors.hasChildren' },
    });
  });

  it('deletes unused categories (soft delete, synced)', async () => {
    const tmp = await L.repos.categories.create({ name: 'Temp', kind: 'income' });
    await L.repos.categories.remove(tmp.id);
    expect(await L.repos.categories.getById(tmp.id)).toBeNull();
    const out = await L.db.getAll<{ operation: string }>(
      `SELECT operation FROM sync_outbox WHERE entity_id = ?`,
      [tmp.id],
    );
    expect(out).toEqual([{ operation: 'delete' }]);
  });

  it('reorders siblings', async () => {
    await L.repos.categories.move(L.cat.restaurants, 'up');
    const children = (await L.repos.categories.list({ kind: 'expense' })).filter(
      (c) => c.parentId === L.cat.food,
    );
    expect(children.map((c) => c.id)).toEqual([L.cat.restaurants, L.cat.groceries]);
    await L.repos.categories.move(L.cat.restaurants, 'up'); // already first: no-op
  });

  it('isolates users', async () => {
    const other = createRepositories(L.db, createTestContext({ userId: 'someone-else' }));
    expect(await other.categories.list({ includeArchived: true })).toEqual([]);
    expect(await other.categories.getById(L.cat.food)).toBeNull();
    await expect(other.categories.setArchived(L.cat.food, true)).rejects.toMatchObject({
      code: 'not_found',
    });
    const chk = await createAccount(L);
    await L.repos.transactions.create({
      type: 'expense',
      accountId: chk.id,
      amountMinor: 100,
      ...at,
      categoryId: L.cat.food,
    });
    expect(await other.transactions.list()).toEqual([]);
  });
});

describe('search and filters', () => {
  let chk: string;
  let card: string;
  beforeEach(async () => {
    chk = (await createAccount(L)).id;
    card = (await createAccount(L, { name: 'Visa', type: 'credit_card' })).id;
    const tx = L.repos.transactions;
    await tx.create({
      type: 'expense',
      accountId: chk,
      amountMinor: 8_540,
      ...at,
      localDate: '2026-10-08',
      payee: 'Café Rouge',
      notes: 'Lunch with Anna',
      categoryId: L.cat.restaurants,
      tagNames: ['Work'],
    });
    await tx.create({
      type: 'expense',
      accountId: card,
      amountMinor: 1_599,
      ...at,
      localDate: '2026-10-07',
      payee: 'NETFLIX.COM',
      categoryId: L.cat.subscriptions,
    });
    await tx.create({
      type: 'income',
      accountId: chk,
      amountMinor: 350_000,
      ...at,
      localDate: '2026-10-01',
      payee: 'ACME Payroll',
      categoryId: L.cat.salary,
    });
    await tx.create({
      type: 'expense',
      accountId: chk,
      amountMinor: 10_000,
      ...at,
      localDate: '2026-09-30',
      payee: 'Walmart #1234',
      categoryId: null,
      splits: [
        { categoryId: L.cat.groceries, amountMinor: 6_000 },
        { categoryId: L.cat.household, amountMinor: 4_000 },
      ],
    });
  });
  const payees = async (filter: Parameters<Ledger['repos']['transactions']['list']>[0]) =>
    (await L.repos.transactions.list(filter)).map((t) => t.payee);

  it('lists newest first by local date', async () => {
    expect(await payees({})).toEqual([
      'Café Rouge',
      'NETFLIX.COM',
      'ACME Payroll',
      'Walmart #1234',
    ]);
  });

  it('searches payee, notes, merchant key, category and tag — case and accent insensitive', async () => {
    expect(await payees({ search: 'cafe' })).toEqual(['Café Rouge']);
    expect(await payees({ search: 'ANNA' })).toEqual(['Café Rouge']);
    expect(await payees({ search: 'walmart' })).toEqual(['Walmart #1234']);
    expect(await payees({ search: 'subscript' })).toEqual(['NETFLIX.COM']);
    expect(await payees({ search: 'groceries' })).toEqual(['Walmart #1234']); // split line category
    expect(await payees({ search: 'work' })).toEqual(['Café Rouge']); // tag
    expect(await payees({ search: '100%' })).toEqual([]); // wildcards are literal
  });

  it('filters by account, type, date range and tag', async () => {
    expect(await payees({ accountIds: [card] })).toEqual(['NETFLIX.COM']);
    expect(await payees({ types: ['income'] })).toEqual(['ACME Payroll']);
    expect(await payees({ from: '2026-10-01', to: '2026-10-07' })).toEqual([
      'NETFLIX.COM',
      'ACME Payroll',
    ]);
    expect(await payees({ tagNames: ['work'] })).toEqual(['Café Rouge']);
    expect(await payees({ tagNames: ['missing'] })).toEqual([]);
  });

  it('filters by category including subcategories and split lines', async () => {
    expect(await payees({ categoryIds: [L.cat.food] })).toEqual(['Café Rouge', 'Walmart #1234']);
    expect(await payees({ categoryIds: [L.cat.household] })).toEqual(['Walmart #1234']);
  });

  it('filters by amount range exactly', async () => {
    expect(await payees({ minAmount: '15.99', maxAmount: '100' })).toEqual([
      'Café Rouge',
      'NETFLIX.COM',
      'Walmart #1234',
    ]);
    expect(await payees({ minAmount: '16' })).toEqual([
      'Café Rouge',
      'ACME Payroll',
      'Walmart #1234',
    ]);
    expect(await payees({ maxAmount: '15.98' })).toEqual([]);
  });

  it('pages with a keyset cursor without gaps or duplicates', async () => {
    const first = await L.repos.transactions.list({ limit: 2 });
    const last = first[first.length - 1]!;
    const second = await L.repos.transactions.list({
      limit: 2,
      after: { localDate: last.localDate, occurredAt: last.occurredAt, id: last.id },
    });
    expect([...first, ...second].map((t) => t.payee)).toEqual([
      'Café Rouge',
      'NETFLIX.COM',
      'ACME Payroll',
      'Walmart #1234',
    ]);
  });

  it('exposes list details for rows (account, category, split count, transfer counterpart)', async () => {
    await L.repos.transactions.createTransfer({
      fromAccountId: chk,
      toAccountId: card,
      amountMinor: 1_599,
      ...at,
      localDate: '2026-10-09',
    });
    const rows = await L.repos.transactions.list({ limit: 10 });
    const legs = rows.filter((r) => r.type === 'transfer');
    expect(legs.find((l) => l.amountMinor < 0)).toMatchObject({
      accountName: 'Checking',
      counterpartAccountName: 'Visa',
      categoryId: null,
    });
    expect(legs.find((l) => l.amountMinor > 0)).toMatchObject({
      accountName: 'Visa',
      counterpartAccountName: 'Checking',
    });
    expect(rows.find((r) => r.payee === 'Walmart #1234')).toMatchObject({
      isSplit: true,
      splitCount: 2,
    });
    expect(rows.find((r) => r.payee === 'Café Rouge')).toMatchObject({
      categoryName: 'Restaurants',
      categorySystemKey: 'dining',
    });
  });
});

describe('category suggestions & rules', () => {
  it('remembers the last category per merchant and supports explicit rules', async () => {
    const chk = await createAccount(L);
    await L.repos.transactions.create({
      type: 'expense',
      accountId: chk.id,
      amountMinor: 1_599,
      ...at,
      payee: 'NETFLIX.COM',
      categoryId: L.cat.subscriptions,
    });
    expect(await L.repos.transactions.lastCategoryForMerchant('netflix', 'expense')).toBe(
      L.cat.subscriptions,
    );
    expect(await L.repos.transactions.lastCategoryForMerchant('netflix', 'income')).toBeNull();

    const rule = await L.repos.categoryRules.upsertMerchantRule('netflix', L.cat.household);
    expect(rule).toMatchObject({
      matchField: 'payee',
      matchType: 'equals',
      pattern: 'netflix',
      categoryId: L.cat.household,
    });
    const again = await L.repos.categoryRules.upsertMerchantRule('netflix', L.cat.subscriptions);
    expect(again.id).toBe(rule.id);
    expect(await L.repos.categoryRules.list()).toHaveLength(1);
    await L.repos.categoryRules.remove(rule.id);
    expect(await L.repos.categoryRules.list()).toHaveLength(0);
  });

  it('ranks frequently used categories', async () => {
    const chk = await createAccount(L);
    for (const c of [L.cat.groceries, L.cat.groceries, L.cat.restaurants]) {
      await L.repos.transactions.create({
        type: 'expense',
        accountId: chk.id,
        amountMinor: 100,
        ...at,
        categoryId: c,
      });
    }
    expect(await L.repos.transactions.frequentCategoryIds('expense', '2026-09-01', 5)).toEqual([
      L.cat.groceries,
      L.cat.restaurants,
    ]);
  });
});

describe('receipts', () => {
  it('saves receipts locally, validates files and tracks uploads', async () => {
    const chk = await createAccount(L);
    const id = await L.repos.transactions.create({
      type: 'expense',
      accountId: chk.id,
      amountMinor: 100,
      ...at,
      categoryId: L.cat.groceries,
    });
    const file = {
      localUri: 'file:///receipts/a.jpg',
      mimeType: 'image/jpeg' as const,
      sizeBytes: 2048,
      fileName: 'a.jpg',
    };
    const att = await L.repos.attachments.add(id, file);
    expect(att.storagePath).toMatch(new RegExp(`^${L.ctx.userId}/.+\\.jpg$`));
    expect(att.uploadStatus).toBe('pending');
    expect(await L.repos.attachments.pendingUploads()).toHaveLength(1);
    await L.repos.attachments.markUploaded(att.id);
    expect(await L.repos.attachments.pendingUploads()).toHaveLength(0);
    expect((await L.repos.transactions.list())[0]?.hasReceipt).toBe(true);

    await expect(
      L.repos.attachments.add(id, { ...file, mimeType: 'text/html' as never }),
    ).rejects.toMatchObject({
      fieldErrors: { mimeType: 'transactions.errors.receiptType' },
    });
    await expect(
      L.repos.attachments.add(id, { ...file, sizeBytes: 11 * 1024 * 1024 }),
    ).rejects.toMatchObject({
      fieldErrors: { sizeBytes: 'transactions.errors.receiptTooLarge' },
    });
    await L.repos.attachments.remove(att.id);
    expect((await L.repos.transactions.getById(id))?.attachments).toEqual([]);
  });
});
