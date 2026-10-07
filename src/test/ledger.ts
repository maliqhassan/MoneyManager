import { createRepositories, type Repositories } from '@/repositories';

import { createTestContext, insertSyncedPreferences, TEST_USER_ID } from './factories';
import { createMigratedTestDatabase, type TestDatabase } from './nodeSqliteDatabase';

/**
 * A ready-to-use local ledger: synced preferences (base USD), a small
 * two-level category tree as the server would seed it, and repositories.
 */
export interface Ledger {
  db: TestDatabase;
  repos: Repositories;
  ctx: ReturnType<typeof createTestContext>;
  cat: Record<
    | 'food'
    | 'groceries'
    | 'restaurants'
    | 'household'
    | 'personalCare'
    | 'subscriptions'
    | 'salary'
    | 'other',
    string
  >;
}

export const TZ = 'America/New_York';
export const at = { localDate: '2026-10-08', localTime: '12:00', timeZone: TZ };

export async function createLedger(userId: string = TEST_USER_ID): Promise<Ledger> {
  const db = await createMigratedTestDatabase();
  const ctx = createTestContext({ userId });
  await insertSyncedPreferences(db, userId);
  const cat = {
    food: '00000000-0000-4000-8000-0000000000c1',
    groceries: '00000000-0000-4000-8000-0000000000c2',
    restaurants: '00000000-0000-4000-8000-0000000000c3',
    household: '00000000-0000-4000-8000-0000000000c4',
    personalCare: '00000000-0000-4000-8000-0000000000c5',
    subscriptions: '00000000-0000-4000-8000-0000000000c6',
    salary: '00000000-0000-4000-8000-0000000000c7',
    other: '00000000-0000-4000-8000-0000000000c8',
  };
  const insert = (
    id: string,
    name: string,
    kind: 'expense' | 'income',
    parent: string | null,
    order: number,
    systemKey: string | null = null,
  ) =>
    db.run(
      `INSERT INTO categories (id, user_id, created_at, updated_at, version, sync_status,
         parent_id, name, kind, system_key, sort_order)
       VALUES (?, ?, '2026-10-01T00:00:00Z', '2026-10-01T00:00:00Z', 1, 'synced', ?, ?, ?, ?, ?)`,
      [id, userId, parent, name, kind, systemKey, order],
    );
  await insert(cat.food, 'Food', 'expense', null, 0, 'food');
  await insert(cat.groceries, 'Groceries', 'expense', cat.food, 0, 'groceries');
  await insert(cat.restaurants, 'Restaurants', 'expense', cat.food, 1, 'dining');
  await insert(cat.household, 'Household', 'expense', null, 1);
  await insert(cat.personalCare, 'Personal care', 'expense', null, 2, 'personal_care');
  await insert(cat.subscriptions, 'Subscriptions', 'expense', null, 3, 'subscriptions');
  await insert(cat.salary, 'Salary', 'income', null, 0, 'salary');
  await insert(cat.other, 'Other', 'income', null, 1, 'other_income');
  return { db, repos: createRepositories(db, ctx), ctx, cat };
}

export async function createAccount(
  ledger: Ledger,
  patch: Partial<{
    name: string;
    type: 'checking' | 'savings' | 'credit_card' | 'cash';
    currency: 'USD' | 'EUR' | 'JPY' | 'GBP';
    openingBalanceMinor: number;
  }> = {},
) {
  return ledger.repos.accounts.create({
    name: patch.name ?? 'Checking',
    type: patch.type ?? 'checking',
    currency: patch.currency ?? 'USD',
    openingBalanceMinor: patch.openingBalanceMinor ?? 0,
    openingBalanceDate: '2026-10-01',
  });
}

export async function balanceOf(ledger: Ledger, accountId: string) {
  return (await ledger.repos.accounts.getBalances()).find((b) => b.accountId === accountId)
    ?.balance;
}
