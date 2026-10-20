import { LATEST_SCHEMA_VERSION, MIGRATIONS, migrate } from '@/database/migrations';
import { createRepositories } from '@/repositories';
import { SyncEngine } from '@/sync/SyncEngine';
import { FakeRemote } from '@/test/fakeRemote';
import { insertSyncedPreferences, sequentialIds, TEST_USER_ID } from '@/test/factories';
import { balanceOf, createAccount, createLedger, type Ledger, TZ } from '@/test/ledger';
import { createTestDatabase } from '@/test/nodeSqliteDatabase';
import type { RecurringRuleInput } from '@/validation/recurring';

const TODAY = '2026-10-19';

describe('recurring rules (real SQLite)', () => {
  let L: Ledger;
  let chk: Awaited<ReturnType<typeof createAccount>>;
  beforeEach(async () => {
    L = await createLedger();
    chk = await createAccount(L, { openingBalanceMinor: 100_000 });
  });
  afterEach(() => L.db.close());

  const input = (patch: Partial<RecurringRuleInput> = {}): RecurringRuleInput => ({
    type: 'expense',
    accountId: chk.id,
    categoryId: L.cat.household,
    amountMinor: 120_000,
    payee: 'Rent',
    frequency: 'monthly',
    interval: 1,
    startDate: '2026-08-31',
    timeZone: TZ,
    ...patch,
  });
  const count = async (sql: string, params: (string | number)[] = []) =>
    (await L.db.getFirst<{ n: number }>(sql, params))!.n;
  const generated = (ruleId: string) =>
    count(
      `SELECT COUNT(*) AS n FROM transactions WHERE recurring_transaction_id = ? AND deleted_at IS NULL`,
      [ruleId],
    );

  it('validates the rule and takes the account currency', async () => {
    const eur = await createAccount(L, { name: 'Euro', currency: 'EUR' });
    const rule = await L.repos.recurring.create(input({ accountId: eur.id }));
    expect(rule).toMatchObject({
      currency: 'EUR',
      status: 'active',
      activeFrom: '2026-08-31',
      autoPost: false,
      tagNames: [],
    });
    for (const [patch, field, message] of [
      [{ amountMinor: 0 }, 'amountMinor', 'validation.amountMustBePositive'],
      [{ categoryId: L.cat.salary }, 'categoryId', 'recurring.errors.categoryKind'],
      [{ accountId: 'missing' }, 'accountId', 'recurring.errors.accountNotFound'],
      [{ endDate: '2026-08-01' }, 'endDate', 'recurring.errors.endBeforeStart'],
      [{ interval: 0 }, 'interval', 'recurring.errors.interval'],
      [{ reminderDaysBefore: 31 }, 'reminderDaysBefore', 'recurring.errors.reminder'],
    ] as const) {
      await expect(L.repos.recurring.create(input(patch))).rejects.toMatchObject({
        fieldErrors: { [field]: message },
      });
    }
    await L.repos.accounts.setArchived(eur.id, true);
    await expect(L.repos.recurring.create(input({ accountId: eur.id }))).rejects.toMatchObject({
      fieldErrors: { accountId: 'recurring.errors.accountArchived' },
    });
  });

  it('posts an occurrence once, however often it is confirmed', async () => {
    const rule = await L.repos.recurring.create(input());
    const first = await L.repos.recurring.post(rule.id, '2026-08-31', TODAY);
    expect(first.status).toBe('posted');
    expect(await L.repos.recurring.post(rule.id, '2026-08-31', TODAY)).toEqual({
      status: 'already_handled',
    });
    // Two confirmations at the same moment: still one transaction.
    const both = await Promise.all([
      L.repos.recurring.post(rule.id, '2026-09-30', TODAY),
      L.repos.recurring.post(rule.id, '2026-09-30', TODAY),
    ]);
    expect(both.map((r) => r.status).sort()).toEqual(['already_handled', 'posted']);
    expect(await generated(rule.id)).toBe(2);
    expect(await balanceOf(L, chk.id)).toEqual({ amountMinor: 100_000 - 240_000, currency: 'USD' });

    // After an app restart (new repositories on the same database): still handled.
    const restarted = createRepositories(L.db, L.ctx);
    expect(await restarted.recurring.post(rule.id, '2026-08-31', TODAY)).toEqual({
      status: 'already_handled',
    });
    const detail = (await restarted.recurring.getById(rule.id, TODAY))!;
    expect(detail.due).toEqual([]); // 31 Oct is still in the future
    expect(detail.next).toBe('2026-10-31');
    const tx = await L.db.getFirst<Record<string, unknown>>(
      `SELECT type, amount_minor, local_date, category_id, payee, recurrence_date FROM transactions
       WHERE id = ?`,
      [(first as { transactionId: string }).transactionId],
    );
    expect(tx).toEqual({
      type: 'expense',
      amount_minor: -120_000,
      local_date: '2026-08-31',
      category_id: L.cat.household,
      payee: 'Rent',
      recurrence_date: '2026-08-31',
    });
  });

  it('never posts future or unscheduled dates, or for paused rules', async () => {
    const rule = await L.repos.recurring.create(input());
    await expect(L.repos.recurring.post(rule.id, '2026-10-31', TODAY)).rejects.toMatchObject({
      fieldErrors: { date: 'recurring.errors.future' },
    });
    await expect(L.repos.recurring.post(rule.id, '2026-09-15', TODAY)).rejects.toMatchObject({
      fieldErrors: { date: 'recurring.errors.notAnOccurrence' },
    });
    await L.repos.recurring.pause(rule.id);
    await expect(L.repos.recurring.post(rule.id, '2026-09-30', TODAY)).rejects.toMatchObject({
      fieldErrors: { status: 'recurring.errors.notActive' },
    });
    expect(await generated(rule.id)).toBe(0);
  });

  it('skips, undoes a skip, and never recreates a deleted transaction on its own', async () => {
    const rule = await L.repos.recurring.create(input());
    await L.repos.recurring.skip(rule.id, '2026-08-31');
    const posted = await L.repos.recurring.post(rule.id, '2026-09-30', TODAY);
    let d = (await L.repos.recurring.getById(rule.id, TODAY))!;
    expect(d.due.map((o) => o.date)).toEqual([]);
    expect(d.history.map((h) => [h.date, h.status])).toEqual([
      ['2026-09-30', 'posted'],
      ['2026-08-31', 'skipped'],
    ]);
    await L.repos.recurring.unskip(rule.id, '2026-08-31');
    d = (await L.repos.recurring.getById(rule.id, TODAY))!;
    expect(d.due.map((o) => o.date)).toEqual(['2026-08-31']);

    // The user deletes the generated transaction: the date stays handled.
    await L.repos.transactions.remove((posted as { transactionId: string }).transactionId);
    d = (await L.repos.recurring.getById(rule.id, TODAY))!;
    expect(d.due.map((o) => o.date)).toEqual(['2026-08-31']);
    expect(d.history.find((h) => h.date === '2026-09-30')).toMatchObject({
      status: 'posted',
      transactionDeleted: true,
    });
    expect(await L.repos.recurring.post(rule.id, '2026-09-30', TODAY)).toEqual({
      status: 'already_handled',
    });
    expect(await L.repos.recurring.autoPostDue(TODAY)).toEqual({ posted: 0, blocked: [] });
    expect(await generated(rule.id)).toBe(0);
    // …until they explicitly add it again.
    await L.repos.recurring.postAgain(rule.id, '2026-09-30', TODAY);
    expect(await generated(rule.id)).toBe(1);
    await expect(L.repos.recurring.postAgain(rule.id, '2026-09-30', TODAY)).rejects.toMatchObject({
      fieldErrors: { date: 'recurring.errors.stillPosted' },
    });
  });

  it('editing a rule never rewrites transactions already added', async () => {
    const rule = await L.repos.recurring.create(input());
    const posted = (await L.repos.recurring.post(rule.id, '2026-08-31', TODAY)) as {
      transactionId: string;
    };
    await L.repos.recurring.update(rule.id, input({ amountMinor: 125_000, payee: 'Rent (new)' }));
    expect(
      await L.db.getFirst(`SELECT amount_minor, payee FROM transactions WHERE id = ?`, [
        posted.transactionId,
      ]),
    ).toEqual({ amount_minor: -120_000, payee: 'Rent' });
    await L.repos.recurring.post(rule.id, '2026-09-30', TODAY);
    expect(
      await L.db.getAll(
        `SELECT amount_minor FROM transactions WHERE recurring_transaction_id = ? ORDER BY local_date`,
        [rule.id],
      ),
    ).toEqual([{ amount_minor: -120_000 }, { amount_minor: -125_000 }]);
    // Moving the start date later never makes earlier dates due retroactively.
    await L.repos.recurring.update(rule.id, input({ startDate: '2026-10-05' }));
    expect((await L.repos.recurring.getById(rule.id, TODAY))!.rule.activeFrom).toBe('2026-10-05');
  });

  it('pauses, resumes from today and cancels without touching history', async () => {
    const rule = await L.repos.recurring.create(
      input({ frequency: 'weekly', startDate: '2026-09-07' }),
    );
    await L.repos.recurring.post(rule.id, '2026-09-07', '2026-09-07');
    await L.repos.recurring.pause(rule.id);
    expect((await L.repos.recurring.getById(rule.id, TODAY))!).toMatchObject({
      due: [],
      rule: { status: 'paused', isActive: false },
    });
    await L.repos.recurring.resume(rule.id, TODAY);
    const resumed = (await L.repos.recurring.getById(rule.id, TODAY))!;
    // Dates during the pause (14 Sep – 12 Oct) are not due afterwards; today's
    // weekly date (Monday 19 Oct) is.
    expect(resumed.rule).toMatchObject({ status: 'active', activeFrom: TODAY });
    expect(resumed.due.map((o) => o.date)).toEqual(['2026-10-19']);
    expect(resumed.next).toBe('2026-10-19');
    await L.repos.recurring.end(rule.id);
    const ended = (await L.repos.recurring.getById(rule.id, TODAY))!;
    expect(ended.rule).toMatchObject({ status: 'ended', nextOccurrenceDate: null });
    expect(ended.history).toHaveLength(1);
    expect(await generated(rule.id)).toBe(1);
    await expect(L.repos.recurring.update(rule.id, input())).rejects.toMatchObject({
      fieldErrors: { status: 'recurring.errors.ended' },
    });
  });

  it('auto-posts due dates since the rule was created, idempotently, and stops at problems', async () => {
    // The test clock creates the rule on 7 Oct 2026; start dates before that
    // wait for confirmation instead of being posted on their own.
    const created = L.ctx.now();
    const createdDay = created.slice(0, 10);
    const rule = await L.repos.recurring.create(
      input({ autoPost: true, frequency: 'daily', startDate: '2025-12-28' }),
    );
    const day3 = new Date(Date.parse(created) + 3 * 86_400_000).toISOString().slice(0, 10);
    const first = await L.repos.recurring.autoPostDue(day3);
    expect(first.blocked).toEqual([]);
    const dates = await L.db.getAll<{ d: string }>(
      `SELECT recurrence_date AS d FROM transactions WHERE recurring_transaction_id = ? ORDER BY d`,
      [rule.id],
    );
    expect(dates.map((r) => r.d)).toEqual(
      [0, 1, 2, 3]
        .map((n) =>
          new Date(Date.parse(`${createdDay}T00:00:00Z`) + n * 86_400_000)
            .toISOString()
            .slice(0, 10),
        )
        .filter((d) => d >= createdDay && d <= day3),
    );
    expect((await L.repos.recurring.autoPostDue(day3)).posted).toBe(0); // restart: nothing new
    // Dates before the rule existed are still offered for confirmation.
    const detail = (await L.repos.recurring.getById(rule.id, day3))!;
    expect(detail.due.every((o) => o.date < createdDay)).toBe(true);
    expect(detail.due.length).toBeGreaterThan(0);

    // Archived account: nothing is created; the rule says why.
    await L.repos.accounts.setArchived(chk.id, true);
    const day5 = new Date(Date.parse(created) + 5 * 86_400_000).toISOString().slice(0, 10);
    const before = await generated(rule.id);
    const blocked = await L.repos.recurring.autoPostDue(day5);
    expect(blocked.posted).toBe(0);
    expect(blocked.blocked[0]).toMatchObject({ ruleId: rule.id });
    expect(await generated(rule.id)).toBe(before);
    expect((await L.repos.recurring.list(day5))[0]!.problem).toBe('account_archived');
  });

  it('keeps unposted occurrences out of reports and budgets', async () => {
    await L.repos.recurring.create(input({ startDate: '2026-10-01' }));
    const range = { start: '2026-10-01', end: '2026-10-31' };
    expect(await L.repos.reports.flows(range, 'USD')).toEqual([]);
    const budget = await L.repos.budgets.create({
      name: 'All',
      categoryId: null,
      periodType: 'monthly',
      startDate: '2026-10-01',
      currency: 'USD',
      amountMinor: 200_000,
      rolloverEnabled: false,
    });
    expect((await L.repos.budgets.overview(budget.id, TODAY))!.evaluation.current.spentMinor).toBe(
      0,
    );
  });

  it('only shows the signed-in user’s rules', async () => {
    await L.repos.recurring.create(input());
    await L.db.run(
      `INSERT INTO recurring_transactions (id, user_id, created_at, updated_at, version, sync_status,
         account_id, category_id, type, amount_minor, currency, frequency, interval, start_date,
         time_zone, status, active_from)
       VALUES ('theirs', 'someone-else', 'x', 'x', 1, 'synced', 'a', 'c', 'expense', 1, 'USD',
         'monthly', 1, '2026-01-01', 'UTC', 'active', '2026-01-01')`,
    );
    expect((await L.repos.recurring.list(TODAY)).map((r) => r.rule.payee)).toEqual(['Rent']);
    expect(await L.repos.recurring.getById('theirs', TODAY)).toBeNull();
    const cf = await L.repos.upcoming.cashflow(TODAY, 30, 'USD');
    expect(cf.items.every((i) => i.sourceId !== 'theirs')).toBe(true);
  });
});

describe('recurring offline & sync', () => {
  it('works offline, syncs in order, and a second device does not post the same date again', async () => {
    const A = await createLedger();
    const remote = new FakeRemote();
    const engineA = new SyncEngine({ db: A.db, remote, newId: sequentialIds() });
    const chk = await createAccount(A);
    const rule = await A.repos.recurring.create({
      type: 'income',
      accountId: chk.id,
      categoryId: A.cat.salary,
      amountMinor: 500_000,
      payee: 'Salary',
      frequency: 'monthly',
      interval: 1,
      startDate: '2026-09-25',
      timeZone: TZ,
      tagNames: ['work'],
    });
    await A.repos.recurring.post(rule.id, '2026-09-25', TODAY);
    // Push order: rule → transaction → occurrence (the server gets parents first).
    const order = await A.db.getAll<{ entity: string }>(
      `SELECT entity FROM sync_outbox WHERE entity IN
         ('recurring_transactions', 'transactions', 'recurring_occurrences') ORDER BY rowid`,
    );
    const firstOf = (e: string) => order.findIndex((o) => o.entity === e);
    expect(firstOf('recurring_transactions')).toBeLessThan(firstOf('transactions'));
    expect(firstOf('transactions')).toBeLessThan(firstOf('recurring_occurrences'));

    expect(await engineA.sync()).toMatchObject({ errorCode: null, conflicts: 0 });
    expect(remote.tables.get('recurring_transactions')?.get(rule.id)).toMatchObject({
      status: 'active',
      tag_names: ['work'],
      auto_post: false,
    });
    expect([...(remote.tables.get('recurring_occurrences')?.values() ?? [])]).toEqual([
      expect.objectContaining({ occurrence_date: '2026-09-25', status: 'posted' }),
    ]);

    // Device B pulls everything: the September salary is handled there too.
    const B = await createLedger();
    const engineB = new SyncEngine({ db: B.db, remote, newId: sequentialIds() });
    await engineB.sync();
    const onB = (await B.repos.recurring.getById(rule.id, TODAY))!;
    expect(onB.rule).toMatchObject({ payee: 'Salary', tagNames: ['work'] });
    expect(onB.due).toEqual([]);
    expect(await B.repos.recurring.post(rule.id, '2026-09-25', TODAY)).toEqual({
      status: 'already_handled',
    });
    A.db.close();
    B.db.close();
  });
});

describe('local migration 6', () => {
  it('upgrades a v5 database and keeps existing rules and transactions', async () => {
    const db = createTestDatabase();
    for (const m of MIGRATIONS.filter((x) => x.version <= 5)) {
      await db.transaction(async (tx) => {
        for (const s of m.statements) await tx.exec(s);
        await tx.exec(`PRAGMA user_version = ${m.version}`);
      });
    }
    await insertSyncedPreferences(db);
    await db.run(
      `INSERT INTO recurring_transactions (id, user_id, created_at, updated_at, version, sync_status,
         account_id, category_id, type, amount_minor, currency, frequency, interval, start_date,
         time_zone, is_active)
       VALUES ('r1', ?, 'x', 'x', 3, 'synced', 'a', 'c', 'expense', 100, 'USD', 'monthly', 1,
         '2026-01-15', 'UTC', 0)`,
      [TEST_USER_ID],
    );
    expect(await migrate(db)).toBe(LATEST_SCHEMA_VERSION);
    expect(
      await db.getFirst(
        `SELECT status, active_from, tag_names, reminder_days_before, version FROM recurring_transactions`,
      ),
    ).toEqual({
      status: 'paused',
      active_from: '2026-01-15',
      tag_names: '[]',
      reminder_days_before: null,
      version: 3, // backfill is not a user edit
    });
    await expect(
      db.run(
        `INSERT INTO recurring_occurrences (id, user_id, created_at, updated_at, recurring_transaction_id,
           occurrence_date, status, transaction_id) VALUES ('o1', 'u', 'x', 'x', 'r1', '2026-01-15', 'skipped', 't')`,
      ),
    ).rejects.toThrow(); // a skipped occurrence has no transaction
    await db.run(
      `INSERT INTO recurring_occurrences (id, user_id, created_at, updated_at, recurring_transaction_id,
         occurrence_date, status) VALUES ('o2', 'u', 'x', 'x', 'r1', '2026-01-15', 'skipped')`,
    );
    await expect(
      db.run(
        `INSERT INTO recurring_occurrences (id, user_id, created_at, updated_at, recurring_transaction_id,
           occurrence_date, status) VALUES ('o3', 'u', 'x', 'x', 'r1', '2026-01-15', 'skipped')`,
      ),
    ).rejects.toThrow(); // one decision per (rule, date)
    db.close();
  });
});
