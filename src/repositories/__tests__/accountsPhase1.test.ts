import { buildAccountsOverview } from '@/domain/accounts/accounts';
import type { Account } from '@/domain/models';
import { FakeRemote } from '@/test/fakeRemote';
import { createTestContext, sequentialIds, TEST_USER_ID } from '@/test/factories';
import { createMigratedTestDatabase, type TestDatabase } from '@/test/nodeSqliteDatabase';
import { SyncEngine } from '@/sync/SyncEngine';

import { SqliteAccountRepository } from '../sqlite/SqliteAccountRepository';
import { SqliteExchangeRateRepository } from '../sqlite/SqliteExchangeRateRepository';

const checking = {
  name: 'Everyday',
  type: 'checking',
  currency: 'USD',
  openingBalanceMinor: 300_000,
  openingBalanceDate: '2026-10-01',
} as const;

const card = {
  name: 'Visa',
  type: 'credit_card',
  currency: 'USD',
  openingBalanceMinor: -85_050, // $850.50 owed
  openingBalanceDate: '2026-10-01',
  creditLimitMinor: 500_000,
} as const;

let seq = 0;
async function insertTransaction(
  db: TestDatabase,
  accountId: string,
  type: 'expense' | 'income' | 'refund' | 'transfer',
  amountMinor: number,
  transferId: string | null = null,
  currency = 'USD',
) {
  seq += 1;
  await db.run(
    `INSERT INTO transactions (id, user_id, created_at, updated_at, account_id, type, amount_minor,
       currency, original_amount_minor, original_currency, base_currency, base_amount_minor,
       base_fx_rate_date, base_fx_source, occurred_at, local_date, time_zone, transfer_id)
     VALUES (?, ?, '2026-10-02T00:00:00Z', '2026-10-02T00:00:00Z', ?, ?, ?, ?, ?, ?, ?, ?,
       '2026-10-02', 'identity', '2026-10-02T00:00:00Z', '2026-10-02', 'UTC', ?)`,
    [
      `t${seq}`,
      TEST_USER_ID,
      accountId,
      type,
      amountMinor,
      currency,
      amountMinor,
      currency,
      currency,
      amountMinor,
      transferId,
    ],
  );
}

async function insertTransfer(
  db: TestDatabase,
  id: string,
  from: string,
  to: string,
  amount: number,
) {
  await db.run(
    `INSERT INTO transfers (id, user_id, created_at, updated_at, from_account_id, to_account_id,
       from_amount_minor, from_currency, to_amount_minor, to_currency, occurred_at, local_date)
     VALUES (?, ?, '2026-10-02T00:00:00Z', '2026-10-02T00:00:00Z', ?, ?, ?, 'USD', ?, 'USD',
       '2026-10-02T00:00:00Z', '2026-10-02')`,
    [id, TEST_USER_ID, from, to, amount, amount],
  );
  await insertTransaction(db, from, 'transfer', -amount, id);
  await insertTransaction(db, to, 'transfer', amount, id);
}

describe('accounts — Phase 1 behaviour', () => {
  let db: TestDatabase;
  let repo: SqliteAccountRepository;

  beforeEach(async () => {
    db = await createMigratedTestDatabase();
    repo = new SqliteAccountRepository(db, createTestContext());
  });
  afterEach(() => db.close());

  const balanceOf = async (id: string) =>
    (await repo.getBalances()).find((b) => b.accountId === id)?.balance;

  it('stores credit card opening balances as negative and computes them', async () => {
    const cc = await repo.create(card);
    expect(cc.openingBalanceMinor).toBe(-85_050);
    expect(cc.creditLimitMinor).toBe(500_000);
    expect(await balanceOf(cc.id)).toEqual({ amountMinor: -85_050, currency: 'USD' });
  });

  it('applies income, expense, refund and transfers to balances', async () => {
    const chk = await repo.create(checking);
    const cc = await repo.create(card);
    await insertTransaction(db, chk.id, 'income', 250_000);
    await insertTransaction(db, chk.id, 'expense', -4_599);
    await insertTransaction(db, cc.id, 'expense', -12_000);
    await insertTransaction(db, cc.id, 'refund', 2_000);
    // Credit card payment = transfer from checking to the card.
    await insertTransfer(db, 'pay-1', chk.id, cc.id, 50_000);

    expect(await balanceOf(chk.id)).toEqual({
      amountMinor: 300_000 + 250_000 - 4_599 - 50_000,
      currency: 'USD',
    });
    expect(await balanceOf(cc.id)).toEqual({
      amountMinor: -85_050 - 12_000 + 2_000 + 50_000,
      currency: 'USD',
    });
  });

  it('archives and restores, keeping archived balances for history', async () => {
    const chk = await repo.create(checking);
    await insertTransaction(db, chk.id, 'expense', -1_000);
    const archived = await repo.setArchived(chk.id, true);
    expect(archived.isArchived).toBe(true);
    expect(await repo.list()).toHaveLength(0);
    expect(await repo.list({ includeArchived: true })).toHaveLength(1);
    expect(await balanceOf(chk.id)).toEqual({ amountMinor: 299_000, currency: 'USD' });

    const restored = await repo.setArchived(chk.id, false);
    expect(restored.isArchived).toBe(false);
    expect(await repo.list()).toHaveLength(1);
  });

  it('reports usage including transfers', async () => {
    const a = await repo.create(checking);
    const b = await repo.create({ ...checking, name: 'Savings', type: 'savings' });
    expect(await repo.getUsage(a.id)).toEqual({ transactionCount: 0, transferCount: 0 });
    await insertTransfer(db, 'tr-1', a.id, b.id, 1_000);
    expect(await repo.getUsage(a.id)).toEqual({ transactionCount: 1, transferCount: 1 });
  });

  it('allows a currency change only while the account has no history', async () => {
    const a = await repo.create(checking);
    const changed = await repo.changeCurrency(a.id, 'JPY', 45_000);
    expect(changed).toMatchObject({ currency: 'JPY', openingBalanceMinor: 45_000 });

    await insertTransaction(db, a.id, 'expense', -500, null, 'JPY');
    await expect(repo.changeCurrency(a.id, 'USD', 0)).rejects.toMatchObject({
      code: 'validation',
      fieldErrors: { currency: 'accounts.errors.currencyLocked' },
    });
    expect((await repo.getById(a.id))?.currency).toBe('JPY');
  });

  it('refuses to delete accounts referenced by transfers', async () => {
    const a = await repo.create(checking);
    const b = await repo.create({ ...checking, name: 'Savings', type: 'savings' });
    await db.run(
      `INSERT INTO transfers (id, user_id, created_at, updated_at, from_account_id, to_account_id,
         from_amount_minor, from_currency, to_amount_minor, to_currency, occurred_at, local_date)
       VALUES ('tr-x', ?, '2026-10-02T00:00:00Z', '2026-10-02T00:00:00Z', ?, ?, 1, 'USD', 1, 'USD',
         '2026-10-02T00:00:00Z', '2026-10-02')`,
      [TEST_USER_ID, a.id, b.id],
    );
    await expect(repo.remove(a.id)).rejects.toMatchObject({ code: 'validation' });
  });

  it('edits name/type/icon/color/notes without touching currency or balance', async () => {
    const a = await repo.create(checking);
    const edited = await repo.update(a.id, {
      name: 'Joint account',
      type: 'savings',
      icon: 'leaf-outline',
      color: '#13774F',
      notes: 'Shared with family',
    });
    expect(edited).toMatchObject({
      name: 'Joint account',
      type: 'savings',
      icon: 'leaf-outline',
      color: '#13774F',
      notes: 'Shared with family',
      currency: 'USD',
      openingBalanceMinor: 300_000,
    });
  });

  it('keeps multiple currencies separate in the overview', async () => {
    const usd = await repo.create(checking);
    await repo.create({
      ...checking,
      name: 'Euro savings',
      type: 'savings',
      currency: 'EUR',
      openingBalanceMinor: 240_000,
    });
    const rates = new SqliteExchangeRateRepository(db, createTestContext());
    const accounts = await repo.list({ includeArchived: true });
    const balances = new Map((await repo.getBalances()).map((b) => [b.accountId, b.balance]));

    const missing = await rates.findRate('EUR', 'USD', '2026-10-08');
    const overview = buildAccountsOverview<Account>(accounts, balances, 'USD', () => missing);
    expect(overview.combinedTotal).toBeNull();
    expect(overview.missingRates).toEqual(['EUR']);
    expect(overview.totals).toEqual([
      { amountMinor: 240_000, currency: 'EUR' },
      { amountMinor: 300_000, currency: 'USD' },
    ]);
    expect(balances.get(usd.id)).toEqual({ amountMinor: 300_000, currency: 'USD' });
  });
});

describe('SqliteExchangeRateRepository', () => {
  let db: TestDatabase;
  let rates: SqliteExchangeRateRepository;

  beforeEach(async () => {
    db = await createMigratedTestDatabase();
    rates = new SqliteExchangeRateRepository(db, createTestContext());
    const insert = (id: string, base: string, quote: string, rate: string, date: string) =>
      db.run(
        `INSERT INTO exchange_rates (id, base_currency, quote_currency, rate, rate_date, source, created_at)
         VALUES (?, ?, ?, ?, ?, 'ecb', '2026-10-01T00:00:00Z')`,
        [id, base, quote, rate, date],
      );
    await insert('r1', 'EUR', 'USD', '1.08', '2026-10-01');
    await insert('r2', 'EUR', 'USD', '1.09', '2026-10-05');
    await insert('r3', 'GBP', 'USD', '1.25', '2026-10-05');
  });
  afterEach(() => db.close());

  it('returns the latest rate on or before the date', async () => {
    expect(await rates.findRate('EUR', 'USD', '2026-10-04')).toBe('1.08');
    expect(await rates.findRate('EUR', 'USD', '2026-10-12')).toBe('1.09');
  });

  it('uses the inverse quote when needed', async () => {
    expect(await rates.findRate('USD', 'GBP', '2026-10-12')).toBe('0.8');
  });

  it('never applies an old rate to a later entry, but shows it (stale) as the current value', async () => {
    // Historical policy: at most 7 days older than the entry date.
    expect(await rates.findRate('EUR', 'USD', '2026-10-13')).toBeNull();
    expect(await rates.resolve('EUR', 'USD', '2026-10-31', 'current')).toMatchObject({
      rate: '1.09',
      rateDate: '2026-10-05',
      stale: true,
    });
  });

  it('never guesses: unknown pairs and dates before any rate are null', async () => {
    expect(await rates.findRate('JPY', 'USD', '2026-10-31')).toBeNull();
    expect(await rates.findRate('EUR', 'USD', '2026-09-01')).toBeNull();
    expect(await rates.findRate('USD', 'USD', '2026-10-31')).toBe('1');
  });
});

describe('offline account operations', () => {
  it('queue while offline and reach the server once online', async () => {
    const db = await createMigratedTestDatabase();
    const repo = new SqliteAccountRepository(db, createTestContext());
    const remote = new FakeRemote();
    const engine = new SyncEngine({ db, remote, newId: sequentialIds() });
    const offline = Object.assign(new TypeError('Network request failed'), { name: 'TypeError' });

    // Create, edit and archive with no connection.
    const a = await repo.create(checking);
    await repo.update(a.id, { name: 'Renamed offline' });
    await repo.setArchived(a.id, true);
    remote.failNextWrites = { count: 1, error: offline };
    expect((await engine.sync()).errorCode).toBe('network');
    expect(remote.tables.get('accounts')?.size ?? 0).toBe(0);
    expect(await db.getAll('SELECT * FROM sync_outbox')).toHaveLength(1); // coalesced

    // Back online: one push carries the latest state.
    const result = await engine.sync();
    expect(result).toMatchObject({ pushed: 1, errorCode: null });
    expect(remote.tables.get('accounts')?.get(a.id)).toMatchObject({
      name: 'Renamed offline',
      is_archived: true,
      opening_balance_minor: 300_000,
    });
    db.close();
  });
});
