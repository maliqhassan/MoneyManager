import type { RepositoryContext } from '@/repositories/sqlite/shared';
import type { SyncTableName } from '@/sync/registry';

export const TEST_USER_ID = '7d4f4f0c-3c7e-4c1e-9a54-2f7b1d1c9a01';

/** Deterministic UUID-shaped ids: 00000000-0000-4000-8000-000000000001, … */
export function sequentialIds(): () => string {
  let n = 0;
  return () => {
    n += 1;
    return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  };
}

/** A clock that advances one second per call. */
export function steppingClock(start = '2026-10-07T09:00:00.000Z'): () => string {
  let t = Date.parse(start);
  return () => {
    t += 1000;
    return new Date(t).toISOString();
  };
}

export function createTestContext(
  overrides: Partial<RepositoryContext> = {},
): RepositoryContext & { changes: SyncTableName[] } {
  const changes: SyncTableName[] = [];
  return {
    userId: TEST_USER_ID,
    newId: sequentialIds(),
    now: steppingClock(),
    onChange: (table) => changes.push(table),
    changes,
    ...overrides,
  };
}

/**
 * Inserts the user_preferences row as the server would create it at sign-up
 * and as sync would deliver it (version 1, synced).
 */
export async function insertSyncedPreferences(
  db: { run: (sql: string, params?: readonly (string | number | null)[]) => Promise<unknown> },
  userId: string = TEST_USER_ID,
): Promise<void> {
  await db.run(
    `INSERT INTO user_preferences (id, user_id, created_at, updated_at, version, sync_status,
       base_currency, locale, time_zone, first_day_of_week, month_start_day)
     VALUES (?, ?, ?, ?, 1, 'synced', 'USD', 'en-US', 'UTC', 1, 1)`,
    [userId, userId, '2026-10-07T00:00:00.000Z', '2026-10-07T00:00:00.000Z'],
  );
}
