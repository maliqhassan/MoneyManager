import type { PlannedReminder } from '@/domain/planning/reminders';
import type {
  NotificationsPort,
  PermissionState,
  ScheduledReminder,
} from '@/services/reminders/notificationsPort';
import { syncReminders } from '@/services/reminders/scheduler';
import { createAccount, createLedger, type Ledger, TZ } from '@/test/ledger';
import type { RecurringRuleInput } from '@/validation/recurring';

const TODAY = '2026-10-19';
const META = {
  source: 'frankfurter',
  attribution: 'Frankfurter',
  fetchedAt: '2026-10-19T08:00:00Z',
};

describe('upcoming cash flow (real SQLite)', () => {
  let L: Ledger;
  let chk: Awaited<ReturnType<typeof createAccount>>;
  beforeEach(async () => {
    L = await createLedger();
    chk = await createAccount(L, { openingBalanceMinor: 100_000 });
  });
  afterEach(() => L.db.close());

  const rule = (patch: Partial<RecurringRuleInput> = {}) =>
    L.repos.recurring.create({
      type: 'expense',
      accountId: chk.id,
      categoryId: L.cat.household,
      amountMinor: 120_000,
      payee: 'Rent',
      frequency: 'monthly',
      interval: 1,
      startDate: '2026-10-25',
      timeZone: TZ,
      ...patch,
    });
  const bill = (patch: Record<string, unknown> = {}) =>
    L.repos.bills.create({
      name: 'Internet',
      isSubscription: false,
      amountMinor: 6_000,
      currency: 'USD',
      accountId: chk.id,
      categoryId: L.cat.household,
      frequency: 'monthly',
      interval: 1,
      nextDueDate: '2026-10-15',
      ...patch,
    });

  it('shows expected income and expenses from rules and bills, separately from posted entries', async () => {
    await rule();
    await rule({
      type: 'income',
      categoryId: L.cat.salary,
      amountMinor: 500_000,
      payee: 'Salary',
      startDate: '2026-10-30',
    });
    await bill();
    // A posted transfer is not an expectation and is never counted.
    const sav = await createAccount(L, { name: 'Savings', type: 'savings' });
    await L.repos.transactions.createTransfer({
      fromAccountId: chk.id,
      toAccountId: sav.id,
      amountMinor: 10_000,
      localDate: '2026-10-20',
      localTime: '09:00',
      timeZone: TZ,
    });
    const cf = await L.repos.upcoming.cashflow(TODAY, 14, 'USD');
    expect(cf.from).toBe('2026-09-19');
    expect(cf.to).toBe('2026-11-01');
    expect(cf.items.map((i) => [i.source, i.name, i.date, i.state, i.type])).toEqual([
      ['bill', 'Internet', '2026-10-15', 'overdue', 'expense'],
      ['recurring', 'Rent', '2026-10-25', 'upcoming', 'expense'],
      ['recurring', 'Salary', '2026-10-30', 'upcoming', 'income'],
    ]);
    expect(cf.byCurrency).toEqual([
      {
        currency: 'USD',
        incomeMinor: 500_000,
        expenseMinor: 126_000,
        netMinor: 374_000,
        approximate: false,
      },
    ]);
    expect(cf.combined).toEqual({
      currency: 'USD',
      incomeMinor: 500_000,
      expenseMinor: 126_000,
      netMinor: 374_000,
    });
    expect(cf.fx.converted).toBe(false);
  });

  it('never counts a bill date twice once it is paid, linked or skipped, nor a handled occurrence', async () => {
    const b = await bill();
    const r = await rule({ startDate: '2026-10-05' });
    await L.repos.bills.markPaid(b.id, {
      dueDate: '2026-10-15',
      transaction: {
        type: 'expense',
        accountId: chk.id,
        amountMinor: 6_000,
        localDate: '2026-10-15',
        localTime: '09:00',
        timeZone: TZ,
        categoryId: L.cat.household,
      },
    });
    await L.repos.recurring.post(r.id, '2026-10-05', TODAY);
    const cf = await L.repos.upcoming.cashflow(TODAY, 30, 'USD');
    // Internet 15 Oct is paid → next is 15 Nov; Rent 5 Oct is posted → next is 5 Nov.
    expect(cf.items.map((i) => [i.name, i.date])).toEqual([
      ['Rent', '2026-11-05'],
      ['Internet', '2026-11-15'],
    ]);
    await L.repos.bills.skip(b.id, '2026-11-15');
    expect((await L.repos.upcoming.cashflow(TODAY, 30, 'USD')).items.map((i) => i.name)).toEqual([
      'Rent',
    ]);
  });

  it('keeps currencies apart and only combines them with known rates', async () => {
    const eur = await createAccount(L, { name: 'Euro', currency: 'EUR' });
    await rule();
    await rule({ accountId: eur.id, amountMinor: 50_000, payee: 'Gym' });
    let cf = await L.repos.upcoming.cashflow(TODAY, 14, 'USD');
    expect(cf.byCurrency.map((f) => [f.currency, f.expenseMinor])).toEqual([
      ['EUR', 50_000],
      ['USD', 120_000],
    ]);
    expect(cf.combined).toBeNull();
    expect(cf.fx.missing).toEqual(['EUR']);

    await L.repos.exchangeRates.storeProviderRates(
      [{ base: 'USD', quote: 'EUR', rateDate: TODAY, rate: '0.8' }],
      META,
    );
    cf = await L.repos.upcoming.cashflow(TODAY, 14, 'USD');
    expect(cf.combined).toEqual({
      currency: 'USD',
      incomeMinor: 0,
      expenseMinor: 182_500,
      netMinor: -182_500,
    });
    expect(cf.fx).toMatchObject({ converted: true, stale: false, missing: [] });

    // A rate that is weeks old is still used for an estimate, but labelled stale.
    const later = '2026-11-20';
    cf = await L.repos.upcoming.cashflow(later, 14, 'USD');
    expect(cf.fx.stale).toBe(true);
  });

  it('lists reminder candidates for rules and bills with their own lead times', async () => {
    await rule({ reminderDaysBefore: 2 });
    await rule({ payee: 'No reminder' });
    await bill({ reminderDaysBefore: 1, nextDueDate: '2026-10-28' });
    const c = await L.repos.upcoming.reminderCandidates(TODAY, '2026-11-02');
    expect(c.map((x) => [x.source, x.name, x.date, x.leadDays])).toEqual([
      ['recurring', 'Rent', '2026-10-25', 2],
      ['recurring', 'No reminder', '2026-10-25', null],
      ['bill', 'Internet', '2026-10-28', 1],
    ]);
  });

  describe('reminder scheduling', () => {
    class MemoryPort implements NotificationsPort {
      state: PermissionState = 'granted';
      readonly pending = new Map<string, ScheduledReminder & { title: string }>();
      failNext = false;
      permission = async () => this.state;
      requestPermission = async () => this.state;
      scheduled = async () => [...this.pending.values()];
      schedule = async (i: {
        identifier: string;
        title: string;
        fireAt: Date;
        data: Record<string, string>;
      }) => {
        if (this.failNext) throw new Error('OS refused');
        this.pending.set(i.identifier, {
          identifier: i.identifier,
          fingerprint: i.data.fp ?? null,
          fireAt: i.fireAt.getTime(),
          title: i.title,
        });
      };
      cancel = async (id: string) => {
        this.pending.delete(id);
      };
    }
    const text = (r: PlannedReminder) => ({ title: `${r.name} due`, body: `${r.amountMinor}` });
    const run = (port: MemoryPort, enabled = true) =>
      syncReminders({
        upcoming: L.repos.upcoming,
        port,
        settings: { enabled, time: '09:00' },
        today: TODAY,
        timeZone: TZ,
        now: new Date('2026-10-19T12:00:00Z'),
        text,
      });

    it('schedules once, updates on edit, cancels on pause and when turned off', async () => {
      const port = new MemoryPort();
      port.pending.set('other-app', {
        identifier: 'other-app',
        fingerprint: null,
        fireAt: null,
        title: '',
      });
      const r = await rule({ reminderDaysBefore: 1 });
      expect(await run(port)).toMatchObject({ status: 'synced', scheduled: 2 });
      expect([...port.pending.keys()].sort()).toEqual([
        'mm:rule:' + r.id + ':2026-10-25',
        'mm:rule:' + r.id + ':2026-11-25',
        'other-app',
      ]);
      // Restart / repeated run: nothing duplicated or rescheduled.
      expect(await run(port)).toMatchObject({ status: 'synced', scheduled: 0, cancelled: 0 });
      // Edit (new payee): reminders are replaced, still one per date.
      await L.repos.recurring.update(r.id, {
        type: 'expense',
        accountId: chk.id,
        categoryId: L.cat.household,
        amountMinor: 120_000,
        payee: 'Rent (new)',
        frequency: 'monthly',
        interval: 1,
        startDate: '2026-10-25',
        timeZone: TZ,
        reminderDaysBefore: 1,
      });
      expect(await run(port)).toMatchObject({ scheduled: 2, cancelled: 2 });
      expect(port.pending.get('mm:rule:' + r.id + ':2026-10-25')?.title).toBe('Rent (new) due');
      // Paused: its reminders go.
      await L.repos.recurring.pause(r.id);
      expect(await run(port)).toMatchObject({ status: 'synced', cancelled: 2, planned: 0 });
      expect([...port.pending.keys()]).toEqual(['other-app']);
      // Turned off on this device: everything of ours is cancelled.
      await L.repos.recurring.resume(r.id, TODAY);
      await run(port);
      expect(await run(port, false)).toMatchObject({ status: 'disabled', cancelled: 2 });
      expect([...port.pending.keys()]).toEqual(['other-app']);
    });

    it('keeps the app working when permission is denied or the OS fails', async () => {
      await rule({ reminderDaysBefore: 1 });
      const port = new MemoryPort();
      port.state = 'denied';
      expect(await run(port)).toEqual({ status: 'no_permission', cancelled: 0 });
      expect(port.pending.size).toBe(0);
      port.state = 'granted';
      port.failNext = true;
      expect(await run(port)).toEqual({ status: 'failed' });
      // Saving data never depends on reminders.
      expect((await L.repos.recurring.list(TODAY)).length).toBe(1);
    });
  });
});
