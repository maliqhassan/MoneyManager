import { createRepositories } from '@/repositories';
import { bootstrapLocalProfile } from '@/repositories/sqlite/localBootstrap';
import { mergeGuestData } from '@/sync/guestMerge';
import { createTestContext, sequentialIds, steppingClock } from '@/test/factories';
import { createLedger, type Ledger, TZ } from '@/test/ledger';
import { createMigratedTestDatabase, type TestDatabase } from '@/test/nodeSqliteDatabase';

const GUEST = 'a1b2c3d4-0000-4000-8000-00000000aaaa';
const ACCOUNT = 'b1b2c3d4-0000-4000-8000-00000000bbbb';

const DEFAULTS = {
  baseCurrency: 'PKR',
  locale: 'en-PK',
  timeZone: 'Asia/Karachi',
  firstDayOfWeek: 1,
  language: 'en',
  region: 'PK',
};

/** A local-only profile: bootstrapped like the app does, then used. */
async function createGuest() {
  const db = await createMigratedTestDatabase();
  let n = 0;
  const ctx = createTestContext({
    userId: GUEST,
    newId: () => `c0ffee00-0000-4000-8000-${String((n += 1)).padStart(12, '0')}`,
    now: steppingClock('2026-10-20T09:00:00.000Z'),
  });
  await bootstrapLocalProfile(db, ctx, DEFAULTS);
  return { db, ctx, repos: createRepositories(db, ctx) };
}

const key = (db: TestDatabase, systemKey: string) =>
  db.getFirst<{ id: string }>(`SELECT id FROM categories WHERE system_key = ?`, [systemKey]);

describe('local-only profile bootstrap', () => {
  it('creates preferences and the full default category tree once, without queuing sync', async () => {
    const guest = await createGuest();
    const prefs = await guest.repos.preferences.get();
    expect(prefs).toMatchObject({ baseCurrency: 'PKR', timeZone: 'Asia/Karachi' });
    const count = await guest.db.getFirst<{ n: number }>(`SELECT COUNT(*) AS n FROM categories`);
    expect(count?.n).toBe(51);
    const groceries = await guest.db.getFirst<{ parent: string }>(
      `SELECT p.system_key AS parent FROM categories c JOIN categories p ON p.id = c.parent_id
       WHERE c.system_key = 'groceries'`,
    );
    expect(groceries?.parent).toBe('food');
    expect(await guest.db.getAll(`SELECT * FROM sync_outbox`)).toEqual([]);

    await bootstrapLocalProfile(guest.db, guest.ctx, DEFAULTS); // idempotent
    const again = await guest.db.getFirst<{ n: number }>(`SELECT COUNT(*) AS n FROM categories`);
    expect(again?.n).toBe(51);
  });
});

describe('mergeGuestData', () => {
  let guest: Awaited<ReturnType<typeof createGuest>>;
  let account: Ledger;

  beforeEach(async () => {
    guest = await createGuest();
    account = await createLedger(ACCOUNT); // prefs + some server-seeded defaults, synced
  });
  afterEach(() => {
    guest.db.close();
    account.db.close();
  });

  const merge = () =>
    mergeGuestData({
      source: guest.db,
      target: account.db,
      guestId: GUEST,
      userId: ACCOUNT,
      newId: sequentialIds(),
      now: steppingClock('2026-10-21T09:00:00.000Z'),
    });

  async function useGuest() {
    const cash = await guest.repos.accounts.create({
      name: 'Cash',
      type: 'cash',
      currency: 'PKR',
      openingBalanceMinor: 500_00,
      openingBalanceDate: '2026-10-01',
    });
    const groceries = (await key(guest.db, 'groceries'))!.id;
    const food = (await key(guest.db, 'food'))!.id;
    const snacks = await guest.repos.categories.create({
      name: 'Snacks',
      kind: 'expense',
      parentId: food,
    });
    const at = { localDate: '2026-10-20', localTime: '09:00', timeZone: TZ };
    const t1 = await guest.repos.transactions.create({
      type: 'expense',
      accountId: cash.id,
      amountMinor: 250_00,
      categoryId: groceries,
      tagNames: ['Trip', 'Work'],
      ...at,
    });
    const t2 = await guest.repos.transactions.create({
      type: 'expense',
      accountId: cash.id,
      amountMinor: 75_50,
      categoryId: snacks.id,
      ...at,
    });
    const gone = await guest.repos.transactions.create({
      type: 'expense',
      accountId: cash.id,
      amountMinor: 1_00,
      categoryId: groceries,
      ...at,
    });
    await guest.repos.transactions.remove(gone);
    await guest.db.run(`UPDATE user_preferences SET onboarding_completed_at = ?`, [
      '2026-10-20T09:00:00.000Z',
    ]);
    return { cash, groceries, snacks, t1, t2, gone };
  }

  it('copies the data under the account, mapping defaults and tags instead of duplicating them', async () => {
    const g = await useGuest();
    // The account already has a "trip" tag.
    await account.db.run(
      `INSERT INTO tags (id, user_id, created_at, updated_at, version, sync_status, name)
       VALUES ('00000000-0000-4000-8000-0000000000f1', ?, 'x', 'x', 1, 'synced', 'trip')`,
      [ACCOUNT],
    );

    const result = await merge();

    // Every copied row belongs to the account.
    for (const table of ['accounts', 'transactions', 'transaction_tags', 'categories', 'tags']) {
      const foreign = await account.db.getFirst<{ n: number }>(
        `SELECT COUNT(*) AS n FROM ${table} WHERE user_id <> ?`,
        [ACCOUNT],
      );
      expect(foreign?.n).toBe(0);
    }
    // Default category → the account's own; custom category copied under the mapped parent.
    const tx1 = await account.repos.transactions.getById(g.t1);
    expect(tx1?.transaction.categoryId).toBe(account.cat.groceries);
    expect(tx1?.transaction.amountMinor).toBe(-250_00);
    const snacks = await account.db.getFirst<{ parent_id: string }>(
      `SELECT parent_id FROM categories WHERE id = ?`,
      [g.snacks.id],
    );
    expect(snacks?.parent_id).toBe(account.cat.food);
    expect((await account.repos.transactions.getById(g.t2))?.transaction.categoryId).toBe(
      g.snacks.id,
    );
    // Tags: "Trip" matched "trip"; "Work" copied.
    const tags = await account.db.getAll<{ name: string }>(
      `SELECT name FROM tags WHERE deleted_at IS NULL ORDER BY lower(name)`,
    );
    expect(tags.map((t) => t.name)).toEqual(['trip', 'Work']);
    expect(result.matched.tags).toBe(1);
    const links = await account.db.getAll<{ tag_id: string }>(
      `SELECT tag_id FROM transaction_tags WHERE transaction_id = ?`,
      [g.t1],
    );
    expect(links.map((l) => l.tag_id)).toContain('00000000-0000-4000-8000-0000000000f1');
    // Unused defaults the account lacks are not copied; deleted rows are dropped.
    expect(await key(account.db, 'housing')).toBeNull();
    expect(await account.repos.transactions.getById(g.gone)).toBeNull();
    // Balances carry over exactly (integer minor units).
    const balance = (await account.repos.accounts.getBalances()).find(
      (b) => b.accountId === g.cash.id,
    );
    expect(balance?.balance).toEqual({ amountMinor: 500_00 - 250_00 - 75_50, currency: 'PKR' });
  });

  it('queues every copied row for upload as a new row', async () => {
    const g = await useGuest();
    await merge();
    const queued = await account.db.getAll<{ entity: string; entity_id: string }>(
      `SELECT entity, entity_id FROM sync_outbox WHERE status = 'pending'`,
    );
    const ids = new Set(queued.map((q) => q.entity_id));
    for (const id of [g.cash.id, g.snacks.id, g.t1, g.t2]) expect(ids.has(id)).toBe(true);
    const versions = await account.db.getAll<{ version: number; sync_status: string }>(
      `SELECT version, sync_status FROM transactions`,
    );
    expect(versions.every((v) => v.version === 0 && v.sync_status === 'pending')).toBe(true);
  });

  it('a new account takes the choices made during local onboarding', async () => {
    await useGuest();
    const result = await merge();
    expect(result.preferences).toBe('took_local');
    expect(await account.repos.preferences.get()).toMatchObject({
      baseCurrency: 'PKR',
      timeZone: 'Asia/Karachi',
      onboardingCompletedAt: '2026-10-20T09:00:00.000Z',
    });
    const queued = await account.db.getFirst<{ n: number }>(
      `SELECT COUNT(*) AS n FROM sync_outbox WHERE entity = 'user_preferences'`,
    );
    expect(queued?.n).toBe(1);
  });

  it('an account already set up elsewhere keeps its own preferences', async () => {
    await account.db.run(`UPDATE user_preferences SET onboarding_completed_at = '2026-10-01'`);
    await useGuest();
    const result = await merge();
    expect(result.preferences).toBe('kept_account');
    expect(await account.repos.preferences.get()).toMatchObject({ baseCurrency: 'USD' });
  });

  it('a default the account deleted becomes a custom category when it is used', async () => {
    const g = await useGuest();
    await account.db.run(`UPDATE categories SET deleted_at = 'x' WHERE id = ?`, [
      account.cat.groceries,
    ]);
    await merge();
    const copied = await account.db.getFirst<{ system_key: string | null; user_id: string }>(
      `SELECT system_key, user_id FROM categories WHERE id = ?`,
      [g.groceries],
    );
    expect(copied).toEqual({ system_key: null, user_id: ACCOUNT });
  });

  it('nothing is written when the account has not synced its preferences yet', async () => {
    await useGuest();
    await account.db.run(`DELETE FROM user_preferences`);
    await expect(merge()).rejects.toThrow('Account preferences have not synced yet');
    const accounts = await account.db.getFirst<{ n: number }>(`SELECT COUNT(*) AS n FROM accounts`);
    expect(accounts?.n).toBe(0);
    // The local-only data is untouched.
    const local = await guest.db.getFirst<{ n: number }>(`SELECT COUNT(*) AS n FROM transactions`);
    expect(local?.n).toBe(3);
  });

  it('an unused local-only profile adds nothing', async () => {
    const result = await merge();
    expect(result.copied).toEqual({});
    expect(await account.db.getAll(`SELECT * FROM sync_outbox`)).toEqual([]);
  });
});
