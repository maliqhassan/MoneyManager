import { balanceOf, createAccount, createLedger, type Ledger, TZ } from '@/test/ledger';
import type { ContributionInput, GoalInput } from '@/validation/planning';

const TODAY = '2026-10-07';

describe('savings goals', () => {
  let L: Ledger;
  let chk: Awaited<ReturnType<typeof createAccount>>;
  let sav: Awaited<ReturnType<typeof createAccount>>;

  beforeEach(async () => {
    L = await createLedger();
    chk = await createAccount(L, { openingBalanceMinor: 500_000 });
    sav = await createAccount(L, { name: 'Savings', type: 'savings' });
  });
  afterEach(() => L.db.close());

  const goalInput = (patch: Partial<GoalInput> = {}): GoalInput => ({
    name: 'Vacation',
    targetAmountMinor: 300_000,
    currency: 'USD',
    targetDate: '2027-04-07',
    ...patch,
  });
  const contribution = (patch: Partial<ContributionInput> = {}): ContributionInput => ({
    amountMinor: 50_000,
    currency: 'USD',
    contributedOn: TODAY,
    ...patch,
  });
  const detail = async (id: string) => (await L.repos.goals.getById(id, TODAY))!;

  it('creates, edits, archives and restores', async () => {
    const g = await L.repos.goals.create(
      goalInput({ accountId: sav.id, icon: 'airplane-outline', color: '#1F9BD1' }),
    );
    expect(g).toMatchObject({ status: 'active', accountId: sav.id });
    await L.repos.goals.update(g.id, goalInput({ name: 'Japan trip', targetAmountMinor: 350_000 }));
    expect((await detail(g.id)).goal).toMatchObject({
      name: 'Japan trip',
      targetAmountMinor: 350_000,
      accountId: null,
    });

    await L.repos.goals.setArchived(g.id, true);
    expect(await L.repos.goals.list('active', TODAY)).toEqual([]);
    expect((await L.repos.goals.list('archived', TODAY)).map((i) => i.goal.id)).toEqual([g.id]);
    await expect(L.repos.goals.addContribution(g.id, contribution())).rejects.toMatchObject({
      fieldErrors: { goalId: 'goals.errors.archived' },
    });
    await L.repos.goals.setArchived(g.id, false);
    expect((await L.repos.goals.list('active', TODAY)).map((i) => i.goal.id)).toEqual([g.id]);
    expect(L.ctx.changes).toContain('savings_goals');
  });

  it('tracks contributions, history and progress (workflow: goal → contribution → progress)', async () => {
    const g = await L.repos.goals.create(goalInput());
    await L.repos.goals.addContribution(
      g.id,
      contribution({ amountMinor: 100_000, contributedOn: '2026-09-01' }),
    );
    const second = await L.repos.goals.addContribution(g.id, contribution({ notes: 'Bonus' }));
    const d = await detail(g.id);
    expect(d.progress).toMatchObject({
      savedMinor: 150_000,
      remainingMinor: 150_000,
      progressBasisPoints: 5_000,
      completed: false,
      suggestion: { kind: 'monthly', months: 6, amountMinor: 25_000 },
    });
    expect(d.contributions.map((c) => [c.contributedOn, c.amountMinor, c.notes])).toEqual([
      [TODAY, 50_000, 'Bonus'],
      ['2026-09-01', 100_000, null],
    ]);

    await L.repos.goals.updateContribution(second, contribution({ amountMinor: 60_000 }));
    expect((await detail(g.id)).progress.savedMinor).toBe(160_000);
    await L.repos.goals.removeContribution(second);
    expect((await detail(g.id)).progress.savedMinor).toBe(100_000);
    // A contribution is planning only: no balance moved.
    expect((await balanceOf(L, chk.id))?.amountMinor).toBe(500_000);
  });

  it('completes at the target and shows overfunding without capping', async () => {
    const g = await L.repos.goals.create(
      goalInput({ targetAmountMinor: 100_000, targetDate: null }),
    );
    await L.repos.goals.addContribution(g.id, contribution({ amountMinor: 100_000 }));
    expect((await L.repos.goals.list('completed', TODAY)).map((i) => i.goal.id)).toEqual([g.id]);
    expect(await L.repos.goals.list('active', TODAY)).toEqual([]);
    await L.repos.goals.addContribution(g.id, contribution({ amountMinor: 7_000 }));
    expect((await detail(g.id)).progress).toMatchObject({
      savedMinor: 107_000,
      overMinor: 7_000,
      progressBasisPoints: 10_700,
      suggestion: { kind: 'completed' },
    });
  });

  it('handles passed and missing target dates', async () => {
    const passed = await L.repos.goals.create(goalInput({ targetDate: '2026-09-30' }));
    const open = await L.repos.goals.create(goalInput({ name: 'Rainy day', targetDate: null }));
    expect((await detail(passed.id)).progress.suggestion).toEqual({ kind: 'target_passed' });
    expect((await detail(open.id)).progress.suggestion).toEqual({ kind: 'no_target_date' });
  });

  it('converts other-currency contributions with known rates; reports missing ones', async () => {
    const g = await L.repos.goals.create(
      goalInput({ currency: 'EUR', targetAmountMinor: 100_000 }),
    );
    await L.repos.goals.addContribution(
      g.id,
      contribution({ currency: 'EUR', amountMinor: 10_000 }),
    );
    await L.repos.goals.addContribution(
      g.id,
      contribution({ currency: 'USD', amountMinor: 11_000 }),
    );
    let d = await detail(g.id);
    expect(d.progress.savedMinor).toBe(10_000);
    expect(d.missingRates).toEqual(['USD']);

    await L.db.run(
      `INSERT INTO exchange_rates (id, base_currency, quote_currency, rate, rate_date, source, created_at)
       VALUES ('r1', 'EUR', 'USD', '1.1', '2026-10-01', 'test', '2026-10-01T00:00:00Z')`,
    );
    d = await detail(g.id);
    expect(d.progress.savedMinor).toBe(20_000);
    expect(d.missingRates).toEqual([]);

    await expect(L.repos.goals.update(g.id, goalInput({ currency: 'USD' }))).rejects.toMatchObject({
      fieldErrors: { currency: 'goals.errors.currencyLocked' },
    });
  });

  it('records the transfer with the contribution: balances move once, no spending (workflow 6)', async () => {
    const budget = await L.repos.budgets.create({
      name: 'Total',
      categoryId: null,
      periodType: 'monthly',
      startDate: TODAY,
      currency: 'USD',
      amountMinor: 100_000,
    });
    const g = await L.repos.goals.create(goalInput());
    await L.db.run(`DELETE FROM sync_outbox`);
    await L.repos.goals.addContribution(
      g.id,
      contribution({
        newTransfer: {
          fromAccountId: chk.id,
          toAccountId: sav.id,
          localTime: '10:00',
          timeZone: TZ,
        },
      }),
    );
    expect((await balanceOf(L, chk.id))?.amountMinor).toBe(450_000);
    expect((await balanceOf(L, sav.id))?.amountMinor).toBe(50_000);
    const d = await detail(g.id);
    expect(d.progress.savedMinor).toBe(50_000);
    expect(d.contributions[0]).toMatchObject({
      accountId: sav.id,
      accountName: 'Savings',
      transfer: expect.objectContaining({
        fromAccountName: 'Checking',
        toAccountName: 'Savings',
        amountMinor: 50_000,
      }),
    });
    const budgetView = (await L.repos.budgets.overview(budget.id, TODAY))!;
    expect(budgetView.evaluation.current.spentMinor).toBe(0);
    const flow = await L.repos.transactions.cashFlow('2026-10-01', '2026-10-31');
    expect(flow).toEqual([]);

    const outbox = await L.db.getAll<{ entity: string }>(
      `SELECT entity FROM sync_outbox ORDER BY rowid`,
    );
    expect(outbox.map((o) => o.entity)).toEqual([
      'transfers',
      'transactions',
      'transactions',
      'goal_contributions',
    ]);

    // Removing the contribution keeps the transfer (money did move).
    await L.repos.goals.removeContribution(d.contributions[0]!.id);
    expect((await balanceOf(L, sav.id))?.amountMinor).toBe(50_000);
    expect((await detail(g.id)).progress.savedMinor).toBe(0);
  });

  it('links an existing transfer once', async () => {
    const g = await L.repos.goals.create(goalInput());
    await L.repos.transactions.createTransfer({
      fromAccountId: chk.id,
      toAccountId: sav.id,
      amountMinor: 20_000,
      localDate: '2026-10-05',
      localTime: '10:00',
      timeZone: TZ,
    });
    const [candidate] = await L.repos.goals.transferCandidates(10);
    expect(candidate).toMatchObject({
      fromAccountName: 'Checking',
      toAccountName: 'Savings',
      amountMinor: 20_000,
    });
    const id = await L.repos.goals.addContribution(
      g.id,
      contribution({ amountMinor: 20_000, transferId: candidate!.id }),
    );
    expect(await L.repos.goals.transferCandidates(10)).toEqual([]);
    await expect(
      L.repos.goals.addContribution(g.id, contribution({ transferId: candidate!.id })),
    ).rejects.toMatchObject({ fieldErrors: { transferId: 'goals.errors.transferLinked' } });
    await expect(
      L.repos.goals.addContribution(g.id, contribution({ transferId: 'missing' })),
    ).rejects.toMatchObject({ fieldErrors: { transferId: 'goals.errors.transferNotFound' } });
    // Re-saving the same contribution with its own link is fine.
    await expect(
      L.repos.goals.updateContribution(
        id,
        contribution({ amountMinor: 20_000, transferId: candidate!.id }),
      ),
    ).resolves.toBeUndefined();
  });

  it('validates accounts and transfer currencies', async () => {
    const eur = await createAccount(L, { name: 'Euro', currency: 'EUR' });
    const g = await L.repos.goals.create(goalInput());
    await expect(
      L.repos.goals.addContribution(
        g.id,
        contribution({
          newTransfer: {
            fromAccountId: chk.id,
            toAccountId: eur.id,
            localTime: '10:00',
            timeZone: TZ,
          },
        }),
      ),
    ).rejects.toMatchObject({ fieldErrors: { newTransfer: 'goals.errors.transferCurrency' } });
    await expect(
      L.repos.goals.addContribution(
        g.id,
        contribution({
          transferId: 'x',
          newTransfer: {
            fromAccountId: chk.id,
            toAccountId: sav.id,
            localTime: '10:00',
            timeZone: TZ,
          },
        }),
      ),
    ).rejects.toMatchObject({ fieldErrors: { transferId: 'goals.errors.oneTransfer' } });
    await expect(
      L.repos.goals.addContribution(g.id, contribution({ accountId: 'missing' })),
    ).rejects.toMatchObject({ fieldErrors: { accountId: 'goals.errors.accountNotFound' } });
    await L.repos.accounts.setArchived(eur.id, true);
    await expect(L.repos.goals.create(goalInput({ accountId: eur.id }))).rejects.toMatchObject({
      fieldErrors: { accountId: 'goals.errors.accountArchived' },
    });
    const c = await L.repos.goals.addContribution(g.id, contribution());
    await expect(
      L.repos.goals.updateContribution(
        c,
        contribution({
          newTransfer: {
            fromAccountId: chk.id,
            toAccountId: sav.id,
            localTime: '10:00',
            timeZone: TZ,
          },
        }),
      ),
    ).rejects.toMatchObject({ fieldErrors: { newTransfer: 'goals.errors.transferOnCreateOnly' } });
    await expect(L.repos.goals.updateContribution('missing', contribution())).rejects.toMatchObject(
      {
        code: 'not_found',
      },
    );
    await expect(L.repos.goals.update('missing', goalInput())).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(L.repos.goals.setArchived('missing', true)).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(L.repos.goals.addContribution('missing', contribution())).rejects.toMatchObject({
      code: 'not_found',
    });
    expect(await L.repos.goals.getById('missing', TODAY)).toBeNull();
  });
});
