import { LATEST_SCHEMA_VERSION, migrate } from '@/database/migrations';
import { AppError } from '@/lib/errors';
import { createMigratedTestDatabase, type TestDatabase } from '@/test/nodeSqliteDatabase';
import { createTestContext, TEST_USER_ID } from '@/test/factories';

import { SqliteAccountRepository } from '../sqlite/SqliteAccountRepository';

const checking = {
  name: 'Chase Checking',
  type: 'checking',
  currency: 'USD',
  openingBalanceMinor: 150_000,
  openingBalanceDate: '2026-10-01',
} as const;

describe('SqliteAccountRepository', () => {
  let db: TestDatabase;
  let ctx: ReturnType<typeof createTestContext>;
  let repo: SqliteAccountRepository;

  beforeEach(async () => {
    db = await createMigratedTestDatabase();
    ctx = createTestContext();
    repo = new SqliteAccountRepository(db, ctx);
  });

  afterEach(() => db.close());

  it('migrations are idempotent', async () => {
    await expect(migrate(db)).resolves.toBe(LATEST_SCHEMA_VERSION);
  });

  it('creates an account with defaults and queues it for sync in the same transaction', async () => {
    const account = await repo.create(checking);
    expect(account).toMatchObject({
      name: 'Chase Checking',
      currency: 'USD',
      openingBalanceMinor: 150_000,
      creditLimitMinor: null,
      includeInTotals: true,
      isArchived: false,
      version: 0,
      userId: TEST_USER_ID,
    });
    const outbox = await db.getAll<{ entity: string; entity_id: string; status: string }>(
      'SELECT entity, entity_id, status FROM sync_outbox',
    );
    expect(outbox).toEqual([{ entity: 'accounts', entity_id: account.id, status: 'pending' }]);
    expect(ctx.changes).toEqual(['accounts']);
  });

  it('rejects invalid input without writing anything', async () => {
    await expect(
      repo.create({ ...checking, name: '  ', currency: 'XXX' as 'USD', openingBalanceMinor: 1.5 }),
    ).rejects.toMatchObject({
      code: 'validation',
      fieldErrors: {
        name: 'validation.required',
        currency: 'validation.invalidCurrency',
        openingBalanceMinor: 'validation.invalidAmount',
      },
    });
    expect(await db.getAll('SELECT * FROM accounts')).toHaveLength(0);
    expect(await db.getAll('SELECT * FROM sync_outbox')).toHaveLength(0);
  });

  it('partial updates leave other fields untouched and coalesce the outbox entry', async () => {
    const account = await repo.create({
      ...checking,
      creditLimitMinor: 500_000,
      notes: 'Main account',
      includeInTotals: false,
    });
    const updated = await repo.update(account.id, { name: 'Everyday' });
    expect(updated).toMatchObject({
      name: 'Everyday',
      creditLimitMinor: 500_000,
      notes: 'Main account',
      includeInTotals: false,
    });
    expect(await db.getAll('SELECT * FROM sync_outbox')).toHaveLength(1);
  });

  it('does not allow changing currency through update', async () => {
    const account = await repo.create(checking);
    await repo.update(account.id, { currency: 'EUR' } as never);
    expect((await repo.getById(account.id))?.currency).toBe('USD');
  });

  it('archives and filters archived accounts', async () => {
    const a = await repo.create(checking);
    await repo.create({ ...checking, name: 'Savings', type: 'savings' });
    await repo.setArchived(a.id, true);
    expect((await repo.list()).map((x) => x.name)).toEqual(['Savings']);
    expect(await repo.list({ includeArchived: true })).toHaveLength(2);
  });

  it('soft-deletes accounts without transactions', async () => {
    const a = await repo.create(checking);
    await repo.remove(a.id);
    expect(await repo.getById(a.id)).toBeNull();
    const row = await db.getFirst<{ deleted_at: string | null }>(
      'SELECT deleted_at FROM accounts WHERE id = ?',
      [a.id],
    );
    expect(row?.deleted_at).not.toBeNull();
    const outbox = await db.getAll<{ operation: string }>('SELECT operation FROM sync_outbox');
    expect(outbox).toEqual([{ operation: 'delete' }]);
  });

  it('refuses to delete an account that has transactions', async () => {
    const a = await repo.create(checking);
    await insertTransaction(db, a.id, -2_500);
    await expect(repo.remove(a.id)).rejects.toBeInstanceOf(AppError);
    expect(await repo.getById(a.id)).not.toBeNull();
  });

  it('throws not_found for unknown or other users’ accounts', async () => {
    const a = await repo.create(checking);
    const otherUser = new SqliteAccountRepository(
      db,
      createTestContext({ userId: 'someone-else' }),
    );
    expect(await otherUser.getById(a.id)).toBeNull();
    await expect(otherUser.update(a.id, { name: 'x' })).rejects.toMatchObject({
      code: 'not_found',
    });
  });

  it('computes balances from opening balance and non-deleted postings', async () => {
    const a = await repo.create(checking);
    const card = await repo.create({
      name: 'Visa',
      type: 'credit_card',
      currency: 'EUR',
      openingBalanceMinor: 0,
      openingBalanceDate: '2026-10-01',
    });
    await insertTransaction(db, a.id, -4_599);
    await insertTransaction(db, a.id, 250_000);
    await insertTransaction(db, a.id, -99_999, '2026-10-05T00:00:00Z');
    await insertTransaction(db, card.id, -12_000, null, 'EUR');

    const balances = await repo.getBalances();
    expect(balances).toEqual(
      expect.arrayContaining([
        { accountId: a.id, balance: { amountMinor: 395_401, currency: 'USD' } },
        { accountId: card.id, balance: { amountMinor: -12_000, currency: 'EUR' } },
      ]),
    );
  });
});

let txCounter = 0;
async function insertTransaction(
  db: TestDatabase,
  accountId: string,
  amountMinor: number,
  deletedAt: string | null = null,
  currency = 'USD',
) {
  txCounter += 1;
  await db.run(
    `INSERT INTO transactions (id, user_id, created_at, updated_at, deleted_at, account_id, type,
       amount_minor, currency, original_amount_minor, original_currency, base_currency,
       base_amount_minor, base_fx_rate_date, base_fx_source, occurred_at, local_date, time_zone)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      `tx-${txCounter}`,
      TEST_USER_ID,
      '2026-10-02T00:00:00Z',
      '2026-10-02T00:00:00Z',
      deletedAt,
      accountId,
      amountMinor < 0 ? 'expense' : 'income',
      amountMinor,
      currency,
      amountMinor,
      currency,
      currency,
      amountMinor,
      '2026-10-02',
      'identity',
      '2026-10-02T00:00:00Z',
      '2026-10-02',
      'UTC',
    ],
  );
}
