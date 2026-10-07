import type { SqlDatabase } from '@/database/types';

import type { RepositoryContext } from './sqlite/shared';
import { SqliteAccountRepository } from './sqlite/SqliteAccountRepository';
import { SqliteAttachmentRepository } from './sqlite/SqliteAttachmentRepository';
import { SqliteCategoryRepository } from './sqlite/SqliteCategoryRepository';
import { SqliteCategoryRuleRepository } from './sqlite/SqliteCategoryRuleRepository';
import { SqliteExchangeRateRepository } from './sqlite/SqliteExchangeRateRepository';
import { SqlitePreferencesRepository } from './sqlite/SqlitePreferencesRepository';
import { SqliteTagRepository } from './sqlite/SqliteTagRepository';
import { SqliteTransactionRepository } from './sqlite/SqliteTransactionRepository';
import type { Repositories } from './types';

export type { RepositoryContext } from './sqlite/shared';
export type * from './types';

/** Builds the repository set for one signed-in user's local database. */
export function createRepositories(db: SqlDatabase, ctx: RepositoryContext): Repositories {
  return {
    accounts: new SqliteAccountRepository(db, ctx),
    preferences: new SqlitePreferencesRepository(db, ctx),
    exchangeRates: new SqliteExchangeRateRepository(db),
    categories: new SqliteCategoryRepository(db, ctx),
    categoryRules: new SqliteCategoryRuleRepository(db, ctx),
    tags: new SqliteTagRepository(db, ctx),
    transactions: new SqliteTransactionRepository(db, ctx),
    attachments: new SqliteAttachmentRepository(db, ctx),
  };
}
