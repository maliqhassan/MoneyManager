import { LATEST_SCHEMA_VERSION, migrate, MIGRATIONS } from '@/database/migrations';
import { createRepositories } from '@/repositories';
import { SyncEngine } from '@/sync/SyncEngine';
import { FakeRemote } from '@/test/fakeRemote';
import {
  createTestContext,
  insertSyncedPreferences,
  sequentialIds,
  TEST_USER_ID,
} from '@/test/factories';
import { createAccount, createLedger, type Ledger, TZ } from '@/test/ledger';
import { createTestDatabase } from '@/test/nodeSqliteDatabase';

const offline = () => Object.assign(new TypeError('Network request failed'), { name: 'TypeError' });

describe('Phase 2 → Phase 3 local migration', () => {
  it('upgrades an existing v3 database without data loss and backfills new columns', async () => {
    const db = createTestDatabase();
    // Bring the database to the Phase 2 schema (v3) the way an installed app had it.
    for (const m of MIGRATIONS.filter((x) => x.version <= 3)) {
      await db.transaction(async (tx) => {
        for (const s of m.statements) await tx.exec(s);
        await tx.exec(`PRAGMA user_version = ${m.version}`);
      });
    }
    const row = (table: string, extra: string, values: string) =>
      db.run(
        `INSERT INTO ${table} (id, user_id, created_at, updated_at, version, sync_status, ${extra})
         VALUES (${values})`,
      );
    await insertSyncedPreferences(db);
    await row(
      'accounts',
      'name, type, currency, opening_balance_minor, opening_balance_date',
      `'acc', '${TEST_USER_ID}', 'x', 'x', 1, 'synced', 'Checking', 'checking', 'EUR', 0, '2026-01-01'`,
    );
    await row(
      'bills',
      'name, amount_minor, currency, frequency, interval, next_due_date',
      `'bill', '${TEST_USER_ID}', 'x', 'x', 1, 'synced', 'Rent', 100, 'EUR', 'monthly', 1, '2026-10-31'`,
    );
    await row(
      'savings_goals',
      'name, target_amount_minor, currency',
      `'goal', '${TEST_USER_ID}', 'x', 'x', 1, 'synced', 'Car', 500, 'EUR'`,
    );
    await row(
      'goal_contributions',
      'goal_id, amount_minor, contributed_on',
      `'gc', '${TEST_USER_ID}', 'x', 'x', 1, 'synced', 'goal', 50, '2026-10-01'`,
    );
    await row(
      'budgets',
      'name, period_type, start_date, currency, amount_minor',
      `'bud', '${TEST_USER_ID}', 'x', 'x', 1, 'synced', 'All', 'monthly', '2026-10-01', 'EUR', 9000`,
    );

    expect(await migrate(db)).toBe(LATEST_SCHEMA_VERSION);
    expect(await db.getFirst(`PRAGMA user_version`)).toEqual({ user_version: 4 });
    expect(await db.getFirst(`SELECT anchor_date, end_date, autopay FROM bills`)).toEqual({
      anchor_date: '2026-10-31',
      end_date: null,
      autopay: 0,
    });
    expect(await db.getFirst(`SELECT currency, transfer_id FROM goal_contributions`)).toEqual({
      currency: 'EUR',
      transfer_id: null,
    });
    expect(await db.getFirst(`SELECT category_id, amount_minor FROM budgets`)).toEqual({
      category_id: null,
      amount_minor: 9000,
    });

    // Pre-existing rows work through the new repositories.
    const repos = createRepositories(db, createTestContext());
    expect((await repos.bills.getById('bill'))?.bill).toMatchObject({
      anchorDate: '2026-10-31',
      nextDueDate: '2026-10-31',
    });
    expect((await repos.goals.getById('goal', '2026-10-07'))?.progress.savedMinor).toBe(50);
    expect((await repos.budgets.overview('bud', '2026-10-07'))?.evaluation.current.limitMinor).toBe(
      9000,
    );
    db.close();
  });
});

describe('planning offline & sync', () => {
  let L: Ledger;
  let remote: FakeRemote;
  let engine: SyncEngine;

  beforeEach(async () => {
    L = await createLedger();
    remote = new FakeRemote();
    engine = new SyncEngine({ db: L.db, remote, newId: sequentialIds() });
  });
  afterEach(() => L.db.close());

  it('works offline and pushes budgets, bills, payments and goals once online', async () => {
    const chk = await createAccount(L);
    const sav = await createAccount(L, { name: 'Savings', type: 'savings' });
    const budget = await L.repos.budgets.create({
      name: 'Total',
      categoryId: null,
      periodType: 'monthly',
      startDate: '2026-10-01',
      currency: 'USD',
      amountMinor: 100_000,
      rolloverEnabled: true,
    });
    const bill = await L.repos.bills.create({
      name: 'Internet',
      isSubscription: false,
      amountMinor: 6_000,
      currency: 'USD',
      accountId: chk.id,
      categoryId: L.cat.household,
      frequency: 'monthly',
      interval: 1,
      nextDueDate: '2026-10-05',
      reminderDaysBefore: 3,
    });
    const txId = await L.repos.bills.markPaid(bill.id, {
      dueDate: '2026-10-05',
      transaction: {
        type: 'expense',
        accountId: chk.id,
        amountMinor: 6_000,
        localDate: '2026-10-05',
        localTime: '08:00',
        timeZone: TZ,
        categoryId: L.cat.household,
      },
    });
    const goal = await L.repos.goals.create({
      name: 'Emergency fund',
      targetAmountMinor: 1_000_000,
      currency: 'USD',
    });
    await L.repos.goals.addContribution(goal.id, {
      amountMinor: 25_000,
      currency: 'USD',
      contributedOn: '2026-10-06',
      newTransfer: { fromAccountId: chk.id, toAccountId: sav.id, localTime: '09:00', timeZone: TZ },
    });

    remote.failNextWrites = { count: 1, error: offline() };
    expect((await engine.sync()).errorCode).toBe('network');
    // Offline: everything is readable locally.
    expect(
      (await L.repos.budgets.overview(budget.id, '2026-10-07'))!.evaluation.current.spentMinor,
    ).toBe(6_000);

    expect(await engine.sync()).toMatchObject({ errorCode: null, conflicts: 0 });
    expect(remote.tables.get('budgets')?.get(budget.id)).toMatchObject({
      category_id: null,
      rollover_enabled: true,
    });
    expect([...(remote.tables.get('budget_revisions')?.values() ?? [])]).toEqual([
      expect.objectContaining({
        budget_id: budget.id,
        amount_minor: 100_000,
        rollover_enabled: true,
      }),
    ]);
    expect(remote.tables.get('bills')?.get(bill.id)).toMatchObject({
      next_due_date: '2026-11-05',
      anchor_date: '2026-10-05',
      autopay: false,
      reminder_days_before: 3,
    });
    expect([...(remote.tables.get('bill_payments')?.values() ?? [])]).toEqual([
      expect.objectContaining({ transaction_id: txId, status: 'paid' }),
    ]);
    const [contribution] = [...(remote.tables.get('goal_contributions')?.values() ?? [])];
    expect(contribution).toMatchObject({ currency: 'USD', account_id: sav.id });
    expect(remote.tables.get('transfers')?.has(String(contribution!.transfer_id))).toBe(true);
    expect(await L.db.getAll(`SELECT * FROM sync_outbox`)).toEqual([]);
  });

  it('pulls planning rows from another device', async () => {
    remote.serverWrite('budgets', {
      id: 'b-remote',
      user_id: TEST_USER_ID,
      created_at: '2026-10-06T00:00:00Z',
      name: 'Food',
      category_id: L.cat.food,
      period_type: 'monthly',
      start_date: '2026-10-01',
      end_date: null,
      currency: 'USD',
      amount_minor: 50_000,
      rollover_enabled: false,
      is_archived: false,
      deleted_at: null,
    });
    remote.serverWrite('budget_revisions', {
      id: 'r-remote',
      user_id: TEST_USER_ID,
      created_at: '2026-10-06T00:00:00Z',
      budget_id: 'b-remote',
      effective_from: '2026-10-01',
      amount_minor: 45_000,
      rollover_enabled: false,
      deleted_at: null,
    });
    await engine.sync();
    const view = await L.repos.budgets.overview('b-remote', '2026-10-07');
    expect(view?.evaluation.current.limitMinor).toBe(45_000);
    expect(view?.category?.name).toBe('Food');
  });
});
