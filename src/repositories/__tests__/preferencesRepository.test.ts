import { completeOnboarding } from '@/features/onboarding/completeOnboarding';
import { suggestDraft } from '@/features/onboarding/model';
import { createTestContext, insertSyncedPreferences, TEST_USER_ID } from '@/test/factories';
import {
  createMigratedTestDatabase,
  createTestDatabase,
  type TestDatabase,
} from '@/test/nodeSqliteDatabase';
import { migration001Initial } from '@/database/migrations/001_initial';
import { LATEST_SCHEMA_VERSION, migrate } from '@/database/migrations';

import { SqlitePreferencesRepository } from '../sqlite/SqlitePreferencesRepository';

describe('SqlitePreferencesRepository', () => {
  let db: TestDatabase;
  let repo: SqlitePreferencesRepository;

  beforeEach(async () => {
    db = await createMigratedTestDatabase();
    repo = new SqlitePreferencesRepository(db, createTestContext());
  });
  afterEach(() => db.close());

  it('returns null until the server-created row has synced', async () => {
    expect(await repo.get()).toBeNull();
    await expect(repo.update({ baseCurrency: 'EUR' })).rejects.toMatchObject({ code: 'not_found' });
  });

  it('reads defaults for the new regional columns', async () => {
    await insertSyncedPreferences(db);
    expect(await repo.get()).toMatchObject({
      baseCurrency: 'USD',
      region: null,
      language: 'en',
      dateFormat: 'locale',
      numberFormat: 'locale',
      onboardingCompletedAt: null,
    });
  });

  it('updates regional preferences offline and queues them for sync', async () => {
    await insertSyncedPreferences(db);
    const updated = await repo.update({
      region: 'DE',
      locale: 'en-DE',
      baseCurrency: 'EUR',
      dateFormat: 'DMY',
      numberFormat: 'period_comma',
      timeZone: 'Europe/Berlin',
      firstDayOfWeek: 1,
    });
    expect(updated).toMatchObject({
      region: 'DE',
      baseCurrency: 'EUR',
      dateFormat: 'DMY',
      numberFormat: 'period_comma',
      timeZone: 'Europe/Berlin',
      version: 1, // server version unchanged until push succeeds
    });
    const row = await db.getFirst<{ sync_status: string }>(
      'SELECT sync_status FROM user_preferences WHERE id = ?',
      [TEST_USER_ID],
    );
    expect(row?.sync_status).toBe('pending');
    expect(await db.getAll<{ entity: string }>('SELECT entity FROM sync_outbox')).toEqual([
      { entity: 'user_preferences' },
    ]);
  });

  it('rejects invalid values without writing', async () => {
    await insertSyncedPreferences(db);
    await expect(
      repo.update({
        timeZone: 'Mars/Base',
        region: 'de',
        dateFormat: 'DD.MM' as never,
        baseCurrency: 'XYZ' as never,
      }),
    ).rejects.toMatchObject({
      code: 'validation',
      fieldErrors: {
        timeZone: 'validation.invalidTimeZone',
        region: 'validation.invalidRegion',
        baseCurrency: 'validation.invalidCurrency',
      },
    });
    expect(await db.getAll('SELECT * FROM sync_outbox')).toHaveLength(0);
  });
});

describe('completeOnboarding', () => {
  let db: TestDatabase;
  let repo: SqlitePreferencesRepository;
  const draft = {
    ...suggestDraft({
      locale: 'en-US',
      language: 'en',
      region: 'US',
      numberFormat: 'locale',
      dateFormat: 'locale',
      timeZone: 'America/Chicago',
      firstDayOfWeek: 0,
      baseCurrency: 'USD',
    }),
    region: 'CA',
    currency: 'CAD' as const,
  };

  beforeEach(async () => {
    db = await createMigratedTestDatabase();
    repo = new SqlitePreferencesRepository(db, createTestContext());
  });
  afterEach(() => db.close());

  it('saves the choices and marks onboarding complete', async () => {
    await insertSyncedPreferences(db);
    const sync = jest.fn(async () => ({ errorCode: null }));
    await completeOnboarding({ preferences: repo, sync }, draft, '2026-10-08T09:00:00.000Z');
    expect(sync).not.toHaveBeenCalled();
    expect(await repo.get()).toMatchObject({
      baseCurrency: 'CAD',
      region: 'CA',
      locale: 'en-CA',
      timeZone: 'America/Chicago',
      firstDayOfWeek: 0,
      onboardingCompletedAt: '2026-10-08T09:00:00.000Z',
    });
  });

  it('syncs first when preferences have not arrived yet', async () => {
    const sync = jest.fn(async () => {
      await insertSyncedPreferences(db);
      return { errorCode: null };
    });
    await completeOnboarding({ preferences: repo, sync }, draft, '2026-10-08T09:00:00.000Z');
    expect(sync).toHaveBeenCalledTimes(1);
    expect((await repo.get())?.onboardingCompletedAt).toBe('2026-10-08T09:00:00.000Z');
  });

  it('fails with an offline error (keeping the draft) when preferences are unavailable', async () => {
    const sync = jest.fn(async () => ({ errorCode: 'network' as const }));
    await expect(
      completeOnboarding({ preferences: repo, sync }, draft, '2026-10-08T09:00:00.000Z'),
    ).rejects.toMatchObject({ code: 'offline' });
  });
});

describe('local migration v1 → v2', () => {
  it('upgrades an existing database without losing preferences', async () => {
    const db = createTestDatabase();
    await db.transaction(async (tx) => {
      for (const statement of migration001Initial.statements) await tx.exec(statement);
      await tx.exec('PRAGMA user_version = 1');
    });
    await insertSyncedPreferences(db);

    await expect(migrate(db)).resolves.toBe(LATEST_SCHEMA_VERSION);
    const repo = new SqlitePreferencesRepository(db, createTestContext());
    expect(await repo.get()).toMatchObject({
      baseCurrency: 'USD',
      language: 'en',
      dateFormat: 'locale',
      numberFormat: 'locale',
      onboardingCompletedAt: null,
    });
    db.close();
  });
});
