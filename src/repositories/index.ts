import type { SqlDatabase } from '@/database/types';

import type { RepositoryContext } from './sqlite/shared';
import { SqliteAccountRepository } from './sqlite/SqliteAccountRepository';
import { SqlitePreferencesRepository } from './sqlite/SqlitePreferencesRepository';
import type { Repositories } from './types';

export type { RepositoryContext } from './sqlite/shared';
export type * from './types';

/** Builds the repository set for one signed-in user's local database. */
export function createRepositories(db: SqlDatabase, ctx: RepositoryContext): Repositories {
  return {
    accounts: new SqliteAccountRepository(db, ctx),
    preferences: new SqlitePreferencesRepository(db, ctx),
  };
}
