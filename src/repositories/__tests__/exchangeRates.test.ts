import { LATEST_SCHEMA_VERSION, MIGRATIONS, migrate } from '@/database/migrations';
import type { CurrencyCode } from '@/domain/currency/currencies';
import { addDays, compareDates } from '@/domain/dates/calendar';
import type { ProviderRate } from '@/domain/fx/frankfurter';
import { SYNC_TABLES } from '@/sync/registry';
import {
  FrankfurterProvider,
  ProviderError,
  type RateProvider,
  type RateRequest,
} from '@/services/fx/provider';
import { planRequests, refreshExchangeRates } from '@/services/fx/refresh';
import { createAccount, createLedger, type Ledger, TZ } from '@/test/ledger';
import { createTestDatabase } from '@/test/nodeSqliteDatabase';

const META = {
  source: 'frankfurter',
  attribution: 'Frankfurter',
  fetchedAt: '2026-10-08T10:00:00.000Z',
};
const usd = (quote: CurrencyCode, rate: string, rateDate = '2026-10-08'): ProviderRate => ({
  base: 'USD',
  quote,
  rate,
  rateDate,
});

describe('exchange rates (real SQLite)', () => {
  let L: Ledger;
  beforeEach(async () => {
    L = await createLedger();
  });
  afterEach(() => L.db.close());

  const expense = (accountId: string, amountMinor: number, localDate = '2026-10-08') =>
    L.repos.transactions.create({
      type: 'expense',
      accountId,
      amountMinor,
      localDate,
      localTime: '12:00',
      timeZone: TZ,
      categoryId: L.cat.groceries,
    });
  const tx = async (id: string) => (await L.repos.transactions.getById(id))!.transaction;

  describe('storage', () => {
    it('upserts provider rates without duplicates and never touches manual rates', async () => {
      const rates = L.repos.exchangeRates;
      expect(await rates.storeProviderRates([usd('EUR', '0.9'), usd('PKR', '280')], META)).toBe(2);
      // Same values again: nothing written (no duplicate rows, no needless refresh).
      expect(await rates.storeProviderRates([usd('EUR', '0.9'), usd('PKR', '280')], META)).toBe(0);
      // A revised value for the same date updates in place.
      expect(await rates.storeProviderRates([usd('EUR', '0.91')], META)).toBe(1);
      await rates.saveManualRate(
        { base: 'USD', quote: 'EUR', rate: '0.95', rateDate: '2026-10-08' },
        { today: '2026-10-08', replace: false },
      );
      const all = await L.db.getAll<{ quote_currency: string; rate: string; kind: string }>(
        `SELECT quote_currency, rate, kind FROM exchange_rates ORDER BY quote_currency, kind`,
      );
      expect(all).toEqual([
        { quote_currency: 'EUR', rate: '0.95', kind: 'manual' },
        { quote_currency: 'EUR', rate: '0.91', kind: 'provider' },
        { quote_currency: 'PKR', rate: '280', kind: 'provider' },
      ]);
      // Invalid values are rejected at the storage boundary.
      await expect(rates.storeProviderRates([usd('EUR', '0')], META)).rejects.toThrow();
      await expect(
        rates.storeProviderRates([usd('EUR', '1')], { ...META, source: 'manual' }),
      ).rejects.toThrow();
      expect(L.ctx.changes.filter((c) => c === 'exchange_rates').length).toBeGreaterThan(0);
    });

    it('validates manual rates and requires confirmation to replace one', async () => {
      const rates = L.repos.exchangeRates;
      const save = (patch: Record<string, string>, replace = false) =>
        rates.saveManualRate(
          { base: 'EUR', quote: 'PKR', rate: '310.5', rateDate: '2026-10-05', ...patch },
          { today: '2026-10-08', replace },
        );
      for (const [patch, field, message] of [
        [{ rate: '0' }, 'rate', 'validation.invalidRate'],
        [{ rate: '-2' }, 'rate', 'validation.invalidRate'],
        [{ rate: 'abc' }, 'rate', 'validation.invalidRate'],
        [{ rate: '1.1234567890123456789' }, 'rate', 'validation.ratePrecision'],
        [{ rate: '0.0000000001' }, 'rate', 'validation.rateRange'],
        [{ quote: 'EUR' }, 'quote', 'validation.sameCurrency'],
        [{ rateDate: '2026-10-09' }, 'rateDate', 'validation.dateInFuture'],
        [{ rateDate: '2026-02-30' }, 'rateDate', 'validation.invalidDate'],
        [{ base: 'XYZ' }, 'base', 'validation.invalidCurrency'],
      ] as const) {
        await expect(save(patch)).rejects.toMatchObject({
          code: 'validation',
          fieldErrors: { [field]: message },
        });
      }
      const first = await save({});
      expect(first).toMatchObject({ base: 'EUR', quote: 'PKR', rate: '310.5' });
      await expect(save({ rate: '311' })).rejects.toMatchObject({
        code: 'conflict',
        fieldErrors: { rateDate: 'exchangeRates.manual.exists' },
      });
      const replaced = await save({ rate: '311' }, true);
      expect(replaced.id).toBe(first.id);
      expect(await rates.listManualRates()).toEqual([
        expect.objectContaining({ id: first.id, rate: '311', rateDate: '2026-10-05' }),
      ]);
      // Deleting only ever removes manual rows.
      await rates.storeProviderRates([usd('EUR', '0.9')], META);
      const provider = await L.db.getFirst<{ id: string }>(
        `SELECT id FROM exchange_rates WHERE kind = 'provider'`,
      );
      await rates.deleteManualRate(provider!.id);
      await rates.deleteManualRate(first.id);
      expect(await rates.listManualRates()).toEqual([]);
      expect(await L.db.getFirst(`SELECT COUNT(*) AS n FROM exchange_rates`)).toEqual({ n: 1 });
    });
  });

  describe('resolution', () => {
    it('resolves direct, inverse and cross (via USD) rates exactly', async () => {
      const rates = L.repos.exchangeRates;
      await rates.storeProviderRates(
        [usd('EUR', '0.9'), usd('PKR', '280'), usd('KWD', '0.3093')],
        META,
      );
      expect(await rates.resolve('USD', 'EUR', '2026-10-08', 'historical')).toMatchObject({
        rate: '0.9',
        derivation: 'direct',
        source: 'frankfurter',
        rateDate: '2026-10-08',
      });
      expect(await rates.resolve('EUR', 'USD', '2026-10-08', 'historical')).toMatchObject({
        rate: '1.11111111111',
        derivation: 'inverse',
      });
      expect(await rates.resolve('PKR', 'EUR', '2026-10-08', 'historical')).toMatchObject({
        rate: '0.00321428571429',
        derivation: 'cross',
      });
      expect(await rates.resolve('KWD', 'PKR', '2026-10-08', 'historical')).toMatchObject({
        rate: '905.269964436', // 280 / 0.3093
        derivation: 'cross',
      });
      expect(await rates.resolve('JPY', 'EUR', '2026-10-08', 'historical')).toBeNull();
      expect(await rates.findRate('USD', 'USD', '2026-10-08')).toBe('1');
    });

    it('applies the lookback per kind, manual over provider on the same date, stale for old current values', async () => {
      const rates = L.repos.exchangeRates;
      await rates.storeProviderRates([usd('EUR', '0.9', '2026-10-01')], META);
      // Provider rates: at most 7 days older than the entry date.
      expect(await rates.findRate('USD', 'EUR', '2026-10-08')).toBe('0.9');
      expect(await rates.findRate('USD', 'EUR', '2026-10-09')).toBeNull();
      expect(await rates.findRate('USD', 'EUR', '2026-09-30')).toBeNull(); // never a later rate
      // Manual rates: up to 31 days, and they win on the same date.
      await rates.saveManualRate(
        { base: 'USD', quote: 'EUR', rate: '0.95', rateDate: '2026-10-01' },
        { today: '2026-10-08', replace: false },
      );
      expect(await rates.resolve('USD', 'EUR', '2026-10-01', 'historical')).toMatchObject({
        rate: '0.95',
        kind: 'manual',
      });
      expect(await rates.findRate('USD', 'EUR', '2026-10-31')).toBe('0.95');
      expect(await rates.findRate('USD', 'EUR', '2026-11-01')).toBe('0.95');
      expect(await rates.findRate('USD', 'EUR', '2026-11-02')).toBeNull();
      // A newer provider date wins over an older manual one.
      await rates.storeProviderRates([usd('EUR', '0.92', '2026-10-05')], META);
      expect(await rates.findRate('USD', 'EUR', '2026-10-06')).toBe('0.92');
      // Current values: any cached age, flagged stale past 3 days (provider).
      expect(await rates.resolve('USD', 'EUR', '2026-10-08', 'current')).toMatchObject({
        rate: '0.92',
        stale: false,
      });
      expect(await rates.resolve('USD', 'EUR', '2027-01-01', 'current')).toMatchObject({
        rate: '0.92',
        stale: true,
      });
    });
  });

  describe('snapshots', () => {
    it('records the rate, its date and source at entry and never rewrites it later', async () => {
      const eur = await createAccount(L, { name: 'Euro', currency: 'EUR' });
      await L.repos.exchangeRates.storeProviderRates([usd('EUR', '0.9', '2026-10-06')], META);
      const id = await expense(eur.id, 1_000);
      expect(await tx(id)).toMatchObject({
        amountMinor: -1_000,
        currency: 'EUR',
        baseCurrency: 'USD',
        baseAmountMinor: -1_111,
        baseFxRate: '1.11111111111',
        baseFxRateDate: '2026-10-06',
        baseFxSource: 'frankfurter:inverse',
      });
      // A revised / newer rate arrives: the stored conversion stays.
      await L.repos.exchangeRates.storeProviderRates(
        [usd('EUR', '0.8', '2026-10-06'), usd('EUR', '0.8', '2026-10-08')],
        META,
      );
      expect((await tx(id)).baseAmountMinor).toBe(-1_111);
      // Editing only the notes keeps it too.
      const input = {
        type: 'expense' as const,
        accountId: eur.id,
        amountMinor: 1_000,
        localDate: '2026-10-08',
        localTime: '12:00',
        timeZone: TZ,
        categoryId: L.cat.groceries,
      };
      await L.repos.transactions.update(id, { ...input, notes: 'Lunch' });
      expect(await tx(id)).toMatchObject({ notes: 'Lunch', baseAmountMinor: -1_111 });
      // Changing the amount is a new conversion, with the rate for that date.
      await L.repos.transactions.update(id, { ...input, amountMinor: 2_000 });
      expect(await tx(id)).toMatchObject({
        baseAmountMinor: -2_500,
        baseFxRate: '1.25',
        baseFxRateDate: '2026-10-08',
      });
    });

    it('keeps entries unconverted when no rate exists; reports convert them later', async () => {
      const eur = await createAccount(L, { name: 'Euro', currency: 'EUR' });
      const id = await expense(eur.id, 1_000);
      expect(await tx(id)).toMatchObject({ baseFxSource: 'unconverted', baseCurrency: 'EUR' });
      const range = { start: '2026-10-01', end: '2026-10-31' };
      expect((await L.repos.reports.flows(range, 'USD'))[0]?.baseMinor).toBeNull();
      expect(await L.repos.reports.conversionNote(range, 'USD')).toMatchObject({
        missing: ['EUR'],
      });
      await L.repos.exchangeRates.storeProviderRates([usd('EUR', '0.8')], META);
      expect((await L.repos.reports.flows(range, 'USD'))[0]?.baseMinor).toBe(-1_250);
      // …but the entry's own snapshot is never rewritten.
      expect(await tx(id)).toMatchObject({ baseFxSource: 'unconverted' });
    });

    it('cross-currency transfers keep the amounts the user entered', async () => {
      const eur = await createAccount(L, {
        name: 'Euro',
        currency: 'EUR',
        openingBalanceMinor: 50_000,
      });
      const chk = await createAccount(L);
      await L.repos.exchangeRates.storeProviderRates([usd('EUR', '0.5')], META);
      await L.repos.transactions.createTransfer({
        fromAccountId: eur.id,
        toAccountId: chk.id,
        amountMinor: 10_000,
        receivedAmountMinor: 10_870, // what the bank actually paid, not 10_000 / 0.5
        localDate: '2026-10-08',
        localTime: '12:00',
        timeZone: TZ,
      });
      const legs = await L.db.getAll<{
        amount_minor: number;
        currency: string;
        base_amount_minor: number;
      }>(
        `SELECT amount_minor, currency, base_amount_minor FROM transactions
         WHERE type = 'transfer' ORDER BY amount_minor`,
      );
      expect(legs).toEqual([
        { amount_minor: -10_000, currency: 'EUR', base_amount_minor: -20_000 },
        { amount_minor: 10_870, currency: 'USD', base_amount_minor: 10_870 },
      ]);
    });
  });

  describe('reports, budgets and goals', () => {
    it('converts per entry so totals reconcile with drill-down lines', async () => {
      const eur = await createAccount(L, { name: 'Euro', currency: 'EUR' });
      // Entered before any rate: unconverted, converted by the report.
      for (let i = 0; i < 3; i += 1) await expense(eur.id, 5);
      await L.repos.exchangeRates.storeProviderRates([usd('EUR', '0.9')], META);
      const range = { start: '2026-10-01', end: '2026-10-31' };
      const flows = await L.repos.reports.flows(range, 'USD');
      const total = flows.reduce((s, r) => s + (r.baseMinor ?? 0), 0);
      // 0.05 EUR × 1.11111111111 = 0.0556 → 0.06 each (one rounding per entry);
      // converting the sum (0.15 → 0.17) would not match the lines.
      expect(total).toBe(-18);
      const lines = await L.repos.reports.lines({ range, kind: 'spending', base: 'USD' });
      expect(lines).toHaveLength(3);
      expect(lines.every((l) => l.basis === 'rate' && l.baseMinor === -6)).toBe(true);
      expect(lines.reduce((s, l) => s + (l.baseMinor ?? 0), 0)).toBe(total);
      const categories = await L.repos.reports.categorySpending(range, 'USD');
      expect(categories.reduce((s, r) => s + (r.baseMinor ?? 0), 0)).toBe(total);
      const merchants = await L.repos.reports.merchantSpending(range, 'USD');
      expect(merchants.reduce((s, r) => s + (r.baseMinor ?? 0), 0)).toBe(total);
      expect(await L.repos.reports.conversionNote(range, 'USD')).toEqual({
        target: 'USD',
        converted: true,
        snapshotCount: 0,
        rates: [
          {
            currency: 'EUR',
            oldestRateDate: '2026-10-08',
            newestRateDate: '2026-10-08',
            sources: ['frankfurter'],
            manual: false,
            stale: false,
          },
        ],
        missing: [],
        stale: false,
      });
      // Snapshot entries are counted as such, native ones not at all.
      const chk = await createAccount(L);
      await expense(eur.id, 100);
      await expense(chk.id, 100);
      const note = await L.repos.reports.conversionNote(range, 'USD');
      expect(note.snapshotCount).toBe(1);
      const withSnapshot = await L.repos.reports.lines({ range, kind: 'spending', base: 'USD' });
      expect(withSnapshot.map((l) => l.basis).sort()).toEqual([
        'native',
        'rate',
        'rate',
        'rate',
        'snapshot',
      ]);
    });

    it('leaves single-currency totals untouched', async () => {
      const chk = await createAccount(L);
      await expense(chk.id, 1_234);
      const range = { start: '2026-10-01', end: '2026-10-31' };
      expect((await L.repos.reports.flows(range, 'USD'))[0]?.baseMinor).toBe(-1_234);
      expect(await L.repos.reports.conversionNote(range, 'USD')).toMatchObject({
        converted: false,
        rates: [],
        missing: [],
      });
      const lines = await L.repos.reports.lines({ range, kind: 'spending' });
      expect(lines[0]).not.toHaveProperty('baseMinor');
    });

    it('values goal contributions at the rate on each contribution date', async () => {
      await L.repos.exchangeRates.storeProviderRates([usd('EUR', '0.9')], META);
      const goal = await L.repos.goals.create({
        name: 'Trip',
        targetAmountMinor: 100_000,
        currency: 'USD',
        targetDate: null,
      });
      await L.repos.goals.addContribution(goal.id, {
        amountMinor: 10_000,
        currency: 'EUR',
        contributedOn: '2026-10-08',
      });
      await L.repos.goals.addContribution(goal.id, {
        amountMinor: 10_000,
        currency: 'EUR',
        contributedOn: '2026-09-01', // no rate within 7 days: not valued, listed
      });
      const d = (await L.repos.goals.getById(goal.id, '2026-10-08'))!;
      expect(d.progress.savedMinor).toBe(11_111);
      expect(d.missingRates).toEqual(['EUR']);
      expect(d.fx).toMatchObject({
        target: 'USD',
        converted: true,
        missing: ['EUR'],
        rates: [expect.objectContaining({ currency: 'EUR', oldestRateDate: '2026-10-08' })],
      });
    });

    it('converts budget spending per entry in the budget currency', async () => {
      const eur = await createAccount(L, { name: 'Euro', currency: 'EUR' });
      await L.repos.exchangeRates.storeProviderRates([usd('EUR', '0.9')], META);
      const budget = await L.repos.budgets.create({
        name: 'All',
        categoryId: null,
        periodType: 'monthly',
        startDate: '2026-10-01',
        currency: 'USD',
        amountMinor: 100_000,
        rolloverEnabled: false,
      });
      await expense(eur.id, 1_000);
      const view = (await L.repos.budgets.overview(budget.id, '2026-10-20'))!;
      expect(view.evaluation.current.spentMinor).toBe(1_111);
      expect(view.fx).toMatchObject({ converted: true, snapshotCount: 1, missing: [] });
    });
  });

  it('only reads the signed-in user’s data for currencies in use', async () => {
    await createAccount(L, { name: 'Euro', currency: 'EUR' });
    await L.db.run(
      `INSERT INTO accounts (id, user_id, created_at, updated_at, version, sync_status, name, type,
         currency, opening_balance_minor, opening_balance_date)
       VALUES ('other', 'someone-else', 'x', 'x', 1, 'synced', 'Theirs', 'checking', 'JPY', 0,
         '2026-01-01')`,
    );
    expect(await L.repos.exchangeRates.currenciesInUse()).toEqual(['EUR', 'USD']);
    expect(await L.repos.exchangeRates.earliestConversionDate('USD')).toBeNull();
    // Rates are reference data, never queued for sync.
    expect(SYNC_TABLES.map((t) => t.name)).not.toContain('exchange_rates');
    expect(
      await L.db.getFirst(`SELECT COUNT(*) AS n FROM sync_outbox WHERE entity = 'exchange_rates'`),
    ).toEqual({ n: 0 });
  });
});

describe('local migration 5', () => {
  it('upgrades a v4 database, keeping and backfilling existing rates', async () => {
    const db = createTestDatabase();
    for (const m of MIGRATIONS.filter((x) => x.version <= 4)) {
      await db.transaction(async (tx) => {
        for (const s of m.statements) await tx.exec(s);
        await tx.exec(`PRAGMA user_version = ${m.version}`);
      });
    }
    await db.run(
      `INSERT INTO exchange_rates (id, base_currency, quote_currency, rate, rate_date, source, created_at)
       VALUES ('a', 'EUR', 'USD', '1.08', '2026-10-01', 'ecb', '2026-10-01T00:00:00Z'),
              ('b', 'EUR', 'PKR', '310', '2026-10-01', 'manual', '2026-10-02T00:00:00Z')`,
    );
    expect(await migrate(db)).toBe(LATEST_SCHEMA_VERSION);
    expect(
      await db.getAll(`SELECT id, rate, kind, fetched_at FROM exchange_rates ORDER BY id`),
    ).toEqual([
      { id: 'a', rate: '1.08', kind: 'provider', fetched_at: '2026-10-01T00:00:00Z' },
      { id: 'b', rate: '310', kind: 'manual', fetched_at: '2026-10-02T00:00:00Z' },
    ]);
    expect(await db.getAll(`SELECT * FROM fx_fetch_log`)).toEqual([]);
    await expect(
      db.run(
        `INSERT INTO exchange_rates (id, base_currency, quote_currency, rate, rate_date, source, created_at, kind)
         VALUES ('c', 'EUR', 'USD', '1', '2026-10-01', 'x', 'x', 'other')`,
      ),
    ).rejects.toThrow();
    db.close();
  });
});

/** Answers every request with one row per day and quote (rate 1 + day/100). */
class FakeProvider implements RateProvider {
  readonly id = 'frankfurter';
  readonly attribution = 'Frankfurter';
  readonly calls: { quotes: readonly CurrencyCode[]; request: RateRequest }[] = [];
  failWith: ProviderError | null = null;

  async fetchRates(base: CurrencyCode, quotes: readonly CurrencyCode[], request: RateRequest) {
    this.calls.push({ quotes, request });
    if (this.failWith) throw this.failWith;
    const [from, to] =
      request.kind === 'range'
        ? [request.from, request.to]
        : request.kind === 'date'
          ? [request.date, request.date]
          : ['2026-10-19', '2026-10-19'];
    const out: ProviderRate[] = [];
    for (let d = from; compareDates(d, to) <= 0; d = addDays(d, 1)) {
      for (const q of quotes) out.push({ base, quote: q, rateDate: d, rate: '1.5' });
    }
    return out;
  }
}

describe('rate refresh', () => {
  let L: Ledger;
  let provider: FakeProvider;
  let clock: number;
  const TODAY = '2026-10-19';
  beforeEach(async () => {
    L = await createLedger();
    provider = new FakeProvider();
    clock = Date.parse('2026-10-19T08:00:00Z');
  });
  afterEach(() => L.db.close());
  const refresh = (force = false) =>
    refreshExchangeRates({
      rates: L.repos.exchangeRates,
      provider,
      baseCurrency: 'USD',
      today: TODAY,
      now: () => new Date(clock),
      force,
    });

  it('does nothing (no network) for single-currency users', async () => {
    await createAccount(L);
    expect(await refresh()).toEqual({ status: 'skipped', reason: 'single_currency' });
    expect(provider.calls).toHaveLength(0);
  });

  it('fills forward and backfills what entries need, then throttles', async () => {
    const eur = await createAccount(L, { name: 'Euro', currency: 'EUR' });
    await L.repos.transactions.create({
      type: 'expense',
      accountId: eur.id,
      amountMinor: 100,
      localDate: '2026-10-08',
      localTime: '12:00',
      timeZone: TZ,
      categoryId: L.cat.groceries,
    });
    const first = await refresh();
    expect(first).toMatchObject({ status: 'updated', requests: 2 });
    expect(provider.calls.map((c) => c.request)).toEqual([
      { kind: 'range', from: '2026-10-12', to: TODAY },
      { kind: 'range', from: '2026-10-01', to: '2026-10-11' },
    ]);
    // Only currency codes are requested (no amounts or other data).
    expect(provider.calls[0]!.quotes).toEqual(['EUR']);
    expect(await L.db.getFirst(`SELECT COUNT(*) AS n FROM exchange_rates`)).toEqual({ n: 19 });
    expect((await L.repos.exchangeRates.fetchLog('frankfurter')).lastSuccessAt).toBe(
      '2026-10-19T08:00:00.000Z',
    );

    // Navigating around: no new requests within 12 hours.
    clock += 60 * 60 * 1000;
    expect(await refresh()).toEqual({ status: 'skipped', reason: 'fresh' });
    expect(provider.calls).toHaveLength(2);

    // "Refresh now": only the recent days are re-checked; nothing changed.
    expect(await refresh(true)).toEqual({ status: 'up_to_date', requests: 1 });
    expect(provider.calls[2]!.request).toEqual({ kind: 'range', from: '2026-10-17', to: TODAY });
  });

  it('keeps the cache when a refresh fails and backs off', async () => {
    const eur = await createAccount(L, { name: 'Euro', currency: 'EUR' });
    await L.repos.exchangeRates.storeProviderRates([usd('EUR', '0.9', '2026-10-18')], META);
    provider.failWith = new ProviderError('offline', 'down');
    expect(await refresh()).toEqual({ status: 'failed', error: 'offline', written: 0 });
    expect(await L.repos.exchangeRates.findRate('USD', 'EUR', TODAY)).toBe('0.9');
    expect(await L.repos.exchangeRates.fetchLog('frankfurter')).toMatchObject({
      lastError: 'offline',
      lastSuccessAt: null,
    });
    clock += 5 * 60 * 1000;
    expect(await refresh()).toEqual({ status: 'skipped', reason: 'recent_failure' });
    // Invalid responses are rejected whole: nothing is stored.
    provider.failWith = new ProviderError('invalid', 'bad');
    expect(await refresh(true)).toMatchObject({ status: 'failed', error: 'invalid' });
    expect(await L.db.getFirst(`SELECT COUNT(*) AS n FROM exchange_rates`)).toEqual({ n: 1 });
    // Transaction entry never depends on the provider.
    await expect(
      L.repos.transactions.create({
        type: 'expense',
        accountId: eur.id,
        amountMinor: 100,
        localDate: TODAY,
        localTime: '12:00',
        timeZone: TZ,
        categoryId: L.cat.groceries,
      }),
    ).resolves.toEqual(expect.any(String));
  });

  it('respects the provider’s rate limit, even for "Refresh now"', async () => {
    await createAccount(L, { name: 'Euro', currency: 'EUR' });
    provider.failWith = new ProviderError('rate_limited', 'slow down', {
      status: 429,
      retryAfterSeconds: 600,
    });
    expect(await refresh(true)).toMatchObject({ status: 'failed', error: 'rate_limited' });
    expect((await L.repos.exchangeRates.fetchLog('frankfurter')).retryAfter).toBe(
      '2026-10-19T08:10:00.000Z',
    );
    provider.failWith = null;
    expect(await refresh(true)).toEqual({ status: 'skipped', reason: 'rate_limited' });
    clock += 11 * 60 * 1000;
    expect(await refresh(true)).toMatchObject({ status: 'updated' });
  });

  it('does not request dates the provider had no data for again', async () => {
    const eur = await createAccount(L, { name: 'Euro', currency: 'EUR' });
    await L.repos.transactions.create({
      type: 'expense',
      accountId: eur.id,
      amountMinor: 100,
      localDate: '2026-06-01',
      localTime: '12:00',
      timeZone: TZ,
      categoryId: L.cat.groceries,
    });
    // A provider without history: forward fill only returns recent days.
    const recentOnly: RateProvider = {
      id: 'frankfurter',
      attribution: 'Frankfurter',
      fetchRates: async (base, quotes, request) => {
        provider.calls.push({ quotes, request });
        return request.kind === 'range' && request.to === TODAY
          ? [{ base, quote: 'EUR', rateDate: TODAY, rate: '0.9' }]
          : [];
      },
    };
    const run = (force: boolean) =>
      refreshExchangeRates({
        rates: L.repos.exchangeRates,
        provider: recentOnly,
        baseCurrency: 'USD',
        today: TODAY,
        now: () => new Date(clock),
        force,
      });
    await run(false);
    const firstCalls = provider.calls.length;
    expect(firstCalls).toBe(2); // forward + one backfill chunk
    await run(true);
    // Second time: only the recent re-check, not the empty history again.
    expect(provider.calls.length - firstCalls).toBe(1);
  });

  it('plans bounded backfills newest first', () => {
    expect(
      planRequests({
        quotes: ['EUR'],
        coverage: [{ currency: 'EUR', firstDate: '2026-01-01', lastDate: '2026-10-19' }],
        earliestNeeded: '2020-01-15',
        today: TODAY,
      }),
    ).toEqual([
      { from: '2026-10-17', to: TODAY },
      // 366-day chunks, newest first, padded by the 7-day lookback at the end.
      { from: '2024-12-31', to: '2025-12-31' },
      { from: '2023-12-31', to: '2024-12-30' },
      { from: '2022-12-30', to: '2023-12-30' },
      { from: '2022-12-23', to: '2022-12-29' },
    ]);
    expect(planRequests({ quotes: [], coverage: [], earliestNeeded: null, today: TODAY })).toEqual(
      [],
    );
  });
});

describe('Frankfurter provider (no network)', () => {
  const response = (status: number, body: string, headers: Record<string, string> = {}) => ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (n: string) => headers[n.toLowerCase()] ?? null },
    text: async () => body,
  });

  it('requests USD-based quotes and validates the response', async () => {
    const urls: string[] = [];
    const p = new FrankfurterProvider(async (url) => {
      urls.push(url);
      return response(200, '[{"date":"2026-10-18","base":"USD","quote":"PKR","rate":277.33}]');
    });
    await expect(p.fetchRates('USD', ['PKR'], { kind: 'latest' }, '2026-10-19')).resolves.toEqual([
      { base: 'USD', quote: 'PKR', rateDate: '2026-10-18', rate: '277.33' },
    ]);
    expect(urls).toEqual(['https://api.frankfurter.dev/v2/rates?base=USD&quotes=PKR']);
    expect(await p.fetchRates('USD', [], { kind: 'latest' }, '2026-10-19')).toEqual([]);
  });

  it.each([
    [
      response(429, '', { 'retry-after': '120' }),
      'rate_limited',
      { status: 429, retryAfterSeconds: 120 },
    ],
    [response(422, '{"status":422,"message":"invalid currency: ABC"}'), 'http', { status: 422 }],
    [response(503, '<html>'), 'http', { status: 503 }],
    [response(200, '<html>oops</html>'), 'invalid', {}],
    [response(200, '[{"date":"2026-10-18","base":"USD","quote":"PKR","rate":-1}]'), 'invalid', {}],
  ])('maps failures (%#)', async (res, kind, details) => {
    const p = new FrankfurterProvider(async () => res);
    const error = await p
      .fetchRates('USD', ['PKR'], { kind: 'latest' }, '2026-10-19')
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderError);
    expect(error).toMatchObject({ kind, details });
  });

  it('reports offline and timeouts', async () => {
    const offline = new FrankfurterProvider(async () => {
      throw new TypeError('Network request failed');
    });
    await expect(
      offline.fetchRates('USD', ['EUR'], { kind: 'latest' }, '2026-10-19'),
    ).rejects.toMatchObject({ kind: 'offline' });
    const slow = new FrankfurterProvider(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => reject(new Error('aborted')));
        }),
      { timeoutMs: 10 },
    );
    await expect(
      slow.fetchRates(
        'USD',
        ['EUR'],
        { kind: 'range', from: '2026-10-01', to: '2026-10-02' },
        '2026-10-19',
      ),
    ).rejects.toMatchObject({ kind: 'timeout' });
  });
});
