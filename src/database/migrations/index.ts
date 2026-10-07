import type { SqlDatabase } from '../types';
import { migration001Initial } from './001_initial';
import { migration002RegionalPreferences } from './002_regional_preferences';

export interface Migration {
  version: number;
  name: string;
  statements: readonly string[];
}

/**
 * Ordered list of local schema migrations. Append only — never edit a
 * migration that has shipped. The current version is tracked with
 * `PRAGMA user_version`.
 */
export const MIGRATIONS: readonly Migration[] = [
  migration001Initial,
  migration002RegionalPreferences,
];

export const LATEST_SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1]?.version ?? 0;

export class MigrationError extends Error {
  constructor(version: number, cause: unknown) {
    super(`Local database migration ${version} failed`, { cause });
    this.name = 'MigrationError';
  }
}

/**
 * Applies pending migrations. Each migration runs in its own transaction
 * together with the user_version bump, so a failure leaves the database at
 * the last fully applied version.
 */
export async function migrate(db: SqlDatabase): Promise<number> {
  const row = await db.getFirst<{ user_version: number }>('PRAGMA user_version');
  const current = row?.user_version ?? 0;

  if (current > LATEST_SCHEMA_VERSION) {
    throw new MigrationError(
      current,
      new Error('Database was created by a newer app version; downgrade is not supported'),
    );
  }

  for (const migration of MIGRATIONS) {
    if (migration.version <= current) continue;
    try {
      await db.transaction(async (tx) => {
        for (const statement of migration.statements) {
          await tx.exec(statement);
        }
        // PRAGMA does not accept bound parameters; version is a trusted integer.
        await tx.exec(`PRAGMA user_version = ${Math.trunc(migration.version)}`);
      });
    } catch (error) {
      throw new MigrationError(migration.version, error);
    }
  }
  return LATEST_SCHEMA_VERSION;
}
