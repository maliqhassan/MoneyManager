import { SyncEngine } from '@/sync/SyncEngine';
import { FakeRemote } from '@/test/fakeRemote';
import { sequentialIds } from '@/test/factories';
import { at, createAccount, createLedger, type Ledger } from '@/test/ledger';

const offline = () => Object.assign(new TypeError('Network request failed'), { name: 'TypeError' });

describe('transactions offline & sync', () => {
  let L: Ledger;
  let remote: FakeRemote;
  let engine: SyncEngine;

  beforeEach(async () => {
    L = await createLedger();
    remote = new FakeRemote();
    engine = new SyncEngine({ db: L.db, remote, newId: sequentialIds() });
  });
  afterEach(() => L.db.close());

  const outbox = () =>
    L.db.getAll<{ entity: string; operation: string }>(
      `SELECT entity, operation FROM sync_outbox ORDER BY rowid`,
    );

  it('writes rows and outbox entries atomically, parents before children', async () => {
    const chk = await createAccount(L);
    const sav = await createAccount(L, { name: 'Savings', type: 'savings' });
    await L.db.run(`DELETE FROM sync_outbox`);
    await L.repos.transactions.createTransfer({
      fromAccountId: chk.id,
      toAccountId: sav.id,
      amountMinor: 5_000,
      ...at,
    });
    expect((await outbox()).map((o) => o.entity)).toEqual([
      'transfers',
      'transactions',
      'transactions',
    ]);

    await L.db.run(`DELETE FROM sync_outbox`);
    await L.repos.transactions.create({
      type: 'expense',
      accountId: chk.id,
      amountMinor: 1_000,
      ...at,
      categoryId: null,
      tagNames: ['Work'],
      splits: [
        { categoryId: L.cat.groceries, amountMinor: 600 },
        { categoryId: L.cat.household, amountMinor: 400 },
      ],
    });
    expect((await outbox()).map((o) => o.entity)).toEqual([
      'transactions',
      'transaction_splits',
      'transaction_splits',
      'tags',
      'transaction_tags',
    ]);
  });

  it('rolls back the row when validation fails mid-write (no orphan outbox entries)', async () => {
    const chk = await createAccount(L);
    await L.db.run(`DELETE FROM sync_outbox`);
    await expect(
      L.repos.transactions.create({
        type: 'expense',
        accountId: chk.id,
        amountMinor: 1_000,
        ...at,
        categoryId: null,
        tagNames: ['New tag'],
        splits: [
          { categoryId: L.cat.groceries, amountMinor: 600 },
          { categoryId: 'missing', amountMinor: 400 },
        ],
      }),
    ).rejects.toMatchObject({ code: 'validation' });
    expect(await outbox()).toEqual([]);
    expect(await L.db.getAll(`SELECT * FROM transactions`)).toEqual([]);
    expect(await L.db.getAll(`SELECT * FROM tags`)).toEqual([]);
  });

  it('creates, edits and deletes offline, then syncs the latest state once online', async () => {
    const chk = await createAccount(L);
    const id = await L.repos.transactions.create({
      type: 'expense',
      accountId: chk.id,
      amountMinor: 1_000,
      ...at,
      payee: 'Shop',
      categoryId: L.cat.groceries,
    });
    await L.repos.transactions.update(id, {
      type: 'expense',
      accountId: chk.id,
      amountMinor: 1_250,
      ...at,
      payee: 'Shop',
      categoryId: L.cat.groceries,
    });
    const doomed = await L.repos.transactions.create({
      type: 'expense',
      accountId: chk.id,
      amountMinor: 99,
      ...at,
      categoryId: L.cat.groceries,
    });
    await L.repos.transactions.remove(doomed);

    remote.failNextWrites = { count: 1, error: offline() };
    expect((await engine.sync()).errorCode).toBe('network');
    expect(remote.tables.get('transactions')?.size ?? 0).toBe(0);

    const result = await engine.sync();
    expect(result).toMatchObject({ errorCode: null, conflicts: 0 });
    const server = remote.tables.get('transactions')!;
    expect(server.get(id)).toMatchObject({
      amount_minor: -1_250,
      is_split: false,
      merchant_key: 'shop',
    });
    expect(server.get(id)).not.toHaveProperty('search_text'); // local-only column
    expect(server.get(doomed)?.deleted_at).not.toBeNull();
    expect(await L.db.getAll(`SELECT * FROM sync_outbox`)).toEqual([]);
  });

  it('does not duplicate a transaction when a response is lost and retried', async () => {
    const chk = await createAccount(L);
    await engine.sync();
    const id = await L.repos.transactions.create({
      type: 'income',
      accountId: chk.id,
      amountMinor: 5_000,
      ...at,
      categoryId: L.cat.salary,
    });
    remote.loseNextResponse = true;
    await engine.sync();
    await engine.sync();
    expect(remote.tables.get('transactions')?.size).toBe(1);
    expect(remote.tables.get('transactions')?.get(id)?.amount_minor).toBe(5_000);
  });

  it('records a conflict when the same transaction changed on another device', async () => {
    const chk = await createAccount(L);
    const id = await L.repos.transactions.create({
      type: 'expense',
      accountId: chk.id,
      amountMinor: 1_000,
      ...at,
      categoryId: L.cat.groceries,
    });
    await engine.sync();
    remote.serverWrite('transactions', {
      ...remote.tables.get('transactions')!.get(id)!,
      notes: 'edited elsewhere',
    });
    await L.repos.transactions.update(id, {
      type: 'expense',
      accountId: chk.id,
      amountMinor: 1_000,
      ...at,
      categoryId: L.cat.groceries,
      notes: 'edited here',
    });
    const result = await engine.sync();
    expect(result.conflicts).toBe(1);
    const local = await L.repos.transactions.getById(id);
    expect(local?.transaction.notes).toBe('edited elsewhere'); // existing policy: server wins…
    const saved = await L.db.getFirst<{ local_payload: string }>(
      `SELECT local_payload FROM sync_conflicts`,
    );
    expect(JSON.parse(saved!.local_payload)).toMatchObject({ notes: 'edited here' }); // …local copy kept
  });

  it('derives the local search column for transactions pulled from the server', async () => {
    const chk = await createAccount(L);
    await engine.sync();
    remote.serverWrite('transactions', {
      id: 'remote-tx',
      user_id: L.ctx.userId,
      created_at: '2026-10-08T00:00:00Z',
      deleted_at: null,
      account_id: chk.id,
      type: 'expense',
      amount_minor: -500,
      currency: 'USD',
      original_amount_minor: -500,
      original_currency: 'USD',
      fx_rate: '1',
      base_currency: 'USD',
      base_amount_minor: -500,
      base_fx_rate: '1',
      base_fx_rate_date: '2026-10-08',
      base_fx_source: 'identity',
      category_id: L.cat.groceries,
      payee: 'Crème Café',
      notes: null,
      occurred_at: '2026-10-08T12:00:00Z',
      local_date: '2026-10-08',
      time_zone: 'UTC',
      is_split: false,
      merchant_key: 'creme cafe',
    });
    await engine.sync();
    expect((await L.repos.transactions.list({ search: 'creme' })).map((t) => t.id)).toEqual([
      'remote-tx',
    ]);
  });
});
