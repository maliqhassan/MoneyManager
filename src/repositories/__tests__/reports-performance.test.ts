import { categorySpending, summarizeFlows } from '@/domain/reports/aggregate';
import { addDays } from '@/domain/dates/calendar';
import { createAccount, createLedger, type Ledger } from '@/test/ledger';

/**
 * Representative volume: 10,000 entries over two years. Checks that report
 * queries use the existing date/split indexes (no full scans), return the
 * same totals as a direct sum, and stay fast. Timings are measured in this
 * Node/SQLite test environment, not on a phone.
 */
const N = 10_000;

describe('report performance with a large local history', () => {
  let L: Ledger;
  let accountId: string;

  beforeAll(async () => {
    L = await createLedger();
    accountId = (await createAccount(L)).id;
    await L.db.transaction(async (tx) => {
      for (let i = 0; i < N; i += 1) {
        const date = addDays('2025-01-01', i % 730);
        const expense = i % 5 !== 0;
        const amount = expense ? -(100 + (i % 900)) : 50_000;
        await tx.run(
          `INSERT INTO transactions (id, user_id, created_at, updated_at, version, sync_status,
             account_id, type, amount_minor, currency, original_amount_minor, original_currency,
             fx_rate, base_currency, base_amount_minor, base_fx_rate, base_fx_rate_date,
             base_fx_source, category_id, merchant_key, occurred_at, local_date, time_zone, is_split)
           VALUES (?, ?, 'x', 'x', 1, 'synced', ?, ?, ?, 'USD', ?, 'USD', '1', 'USD', ?, '1', ?,
             'identity', ?, ?, ?, ?, 'UTC', 0)`,
          [
            `t${i}`,
            L.ctx.userId,
            accountId,
            expense ? 'expense' : 'income',
            amount,
            amount,
            amount,
            date,
            expense ? L.cat.groceries : L.cat.salary,
            expense ? `m${i % 50}` : null,
            `${date}T12:00:00Z`,
            date,
          ],
        );
      }
    });
  });
  afterAll(() => L.db.close());

  it('uses indexes for the date-range report queries', async () => {
    const plan = async (sql: string) =>
      (
        await L.db.getAll<{ detail: string }>(`EXPLAIN QUERY PLAN ${sql}`, [
          'u',
          '2026-01-01',
          '2026-01-31',
        ])
      )
        .map((r) => r.detail)
        .join(' | ');
    const flows = await plan(
      `SELECT local_date, SUM(amount_minor) FROM transactions
       WHERE user_id = ? AND deleted_at IS NULL AND local_date >= ? AND local_date <= ?
       GROUP BY local_date`,
    );
    expect(flows).toMatch(/USING (COVERING )?INDEX idx_transactions_(date|list)/);
    const splits = await plan(
      `SELECT t.id FROM transactions t
       LEFT JOIN transaction_splits s ON s.transaction_id = t.id AND s.deleted_at IS NULL
       WHERE t.user_id = ? AND t.local_date >= ? AND t.local_date <= ?`,
    );
    expect(splits).toMatch(/idx_transaction_splits_transaction/);
  });

  it('returns exact totals and stays fast for a month and for a year', async () => {
    const expected = await L.db.getFirst<{ spent: number; income: number }>(
      `SELECT -SUM(CASE WHEN type = 'expense' THEN amount_minor ELSE 0 END) AS spent,
              SUM(CASE WHEN type = 'income' THEN amount_minor ELSE 0 END) AS income
       FROM transactions WHERE local_date >= '2026-01-01' AND local_date <= '2026-12-31'`,
    );
    const year = { start: '2026-01-01', end: '2026-12-31' };
    const t0 = Date.now();
    const summary = summarizeFlows(await L.repos.reports.flows(year, 'USD'), 'USD');
    const flowMs = Date.now() - t0;
    const t1 = Date.now();
    const categories = categorySpending(
      await L.repos.reports.categorySpending(year, 'USD'),
      new Map(
        (await L.repos.categories.list({ includeArchived: true })).map((c) => [c.id, c.parentId]),
      ),
    );
    const categoryMs = Date.now() - t1;
    const t2 = Date.now();
    await L.repos.reports.flows({ start: '2026-03-01', end: '2026-03-31' }, 'USD');
    const monthMs = Date.now() - t2;

    expect(summary.spendingMinor).toBe(expected?.spent);
    expect(summary.incomeMinor).toBe(expected?.income);
    expect(categories.totalMinor).toBe(expected?.spent);
    // Generous ceilings (CI machines vary); the measured values are logged.
    expect(flowMs).toBeLessThan(2_000);
    expect(categoryMs).toBeLessThan(2_000);
    expect(monthMs).toBeLessThan(500);
    process.stdout.write(
      `[report-perf] ${N} rows: year flows ${flowMs} ms, year categories ${categoryMs} ms, month flows ${monthMs} ms\n`,
    );
  });
});
