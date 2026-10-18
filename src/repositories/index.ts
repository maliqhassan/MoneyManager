import type { SqlDatabase } from '@/database/types';

import type { RepositoryContext } from './sqlite/shared';
import { SqliteAccountRepository } from './sqlite/SqliteAccountRepository';
import { SqliteAttachmentRepository } from './sqlite/SqliteAttachmentRepository';
import { SqliteBillRepository } from './sqlite/SqliteBillRepository';
import { SqliteBudgetRepository } from './sqlite/SqliteBudgetRepository';
import { SqliteCategoryRepository } from './sqlite/SqliteCategoryRepository';
import { SqliteCategoryRuleRepository } from './sqlite/SqliteCategoryRuleRepository';
import { SqliteExchangeRateRepository } from './sqlite/SqliteExchangeRateRepository';
import { SqliteGoalRepository } from './sqlite/SqliteGoalRepository';
import { SqliteExportRepository } from './sqlite/SqliteExportRepository';
import { SqliteImportRepository } from './sqlite/SqliteImportRepository';
import { SqliteReportRepository } from './sqlite/SqliteReportRepository';
import { SqlitePreferencesRepository } from './sqlite/SqlitePreferencesRepository';
import { SqliteTagRepository } from './sqlite/SqliteTagRepository';
import { SqliteTransactionRepository } from './sqlite/SqliteTransactionRepository';
import type { Repositories } from './types';

export type { RepositoryContext } from './sqlite/shared';
export type * from './types';

/** Builds the repository set for one signed-in user's local database. */
export function createRepositories(db: SqlDatabase, ctx: RepositoryContext): Repositories {
  // Bills and goals write normal transactions/transfers inside their own
  // atomic writes, through the one transaction repository.
  const transactions = new SqliteTransactionRepository(db, ctx);
  return {
    accounts: new SqliteAccountRepository(db, ctx),
    preferences: new SqlitePreferencesRepository(db, ctx),
    exchangeRates: new SqliteExchangeRateRepository(db, ctx),
    categories: new SqliteCategoryRepository(db, ctx),
    categoryRules: new SqliteCategoryRuleRepository(db, ctx),
    tags: new SqliteTagRepository(db, ctx),
    transactions,
    attachments: new SqliteAttachmentRepository(db, ctx),
    budgets: new SqliteBudgetRepository(db, ctx),
    bills: new SqliteBillRepository(db, ctx, transactions),
    goals: new SqliteGoalRepository(db, ctx, transactions),
    reports: new SqliteReportRepository(db, ctx.userId),
    imports: new SqliteImportRepository(db, ctx, transactions),
    exports: new SqliteExportRepository(db, ctx.userId),
  };
}
