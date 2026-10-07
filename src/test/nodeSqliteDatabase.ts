/* eslint-disable @typescript-eslint/no-require-imports */
import { migrate } from '@/database/migrations';
import type { SqlDatabase, SqlExecutor, SqlParams } from '@/database/types';

/**
 * In-memory SQLite for tests, built on Node's `node:sqlite` (Node ≥ 22.13).
 * Implements the same SqlDatabase interface as the expo-sqlite adapter, so
 * repositories and the sync engine are tested against real SQL semantics.
 *
 * Like the production adapter, transactions are exclusive: calls made on the
 * database object (not the `tx` executor) while a transaction is open wait
 * for it to finish. Code that wrongly uses `db` inside a transaction will
 * therefore deadlock and time out in tests instead of passing silently.
 */

interface StatementSync {
  run(...params: unknown[]): { changes: number | bigint };
  all(...params: unknown[]): unknown[];
  get(...params: unknown[]): unknown;
}
interface DatabaseSync {
  prepare(sql: string): StatementSync;
  exec(sql: string): void;
  close(): void;
}

function loadDatabaseSync(): new (path: string) => DatabaseSync {
  return (require('node:sqlite') as { DatabaseSync: new (path: string) => DatabaseSync })
    .DatabaseSync;
}

/** node:sqlite returns null-prototype objects; normalise for toEqual(). */
const plain = <T>(row: unknown): T => ({ ...(row as object) }) as T;

export interface TestDatabase extends SqlDatabase {
  close(): void;
}

export function createTestDatabase(): TestDatabase {
  const DatabaseSyncCtor = loadDatabaseSync();
  const raw = new DatabaseSyncCtor(':memory:');
  raw.exec('PRAGMA foreign_keys = ON;');

  const executor: SqlExecutor = {
    async run(sql: string, params: SqlParams = []) {
      const result = raw.prepare(sql).run(...params);
      return { changes: Number(result.changes) };
    },
    async getAll<T>(sql: string, params: SqlParams = []) {
      return raw
        .prepare(sql)
        .all(...params)
        .map((r) => plain<T>(r));
    },
    async getFirst<T>(sql: string, params: SqlParams = []) {
      const row = raw.prepare(sql).get(...params);
      return row === undefined ? null : plain<T>(row);
    },
    async exec(sql: string) {
      raw.exec(sql);
    },
  };

  let lock: Promise<void> = Promise.resolve();
  const exclusive = async <T>(work: () => Promise<T>): Promise<T> => {
    const previous = lock;
    let release!: () => void;
    lock = new Promise((resolve) => (release = resolve));
    await previous;
    try {
      return await work();
    } finally {
      release();
    }
  };

  return {
    run: (sql, params) => exclusive(() => executor.run(sql, params)),
    getAll: (sql, params) => exclusive(() => executor.getAll(sql, params)),
    getFirst: (sql, params) => exclusive(() => executor.getFirst(sql, params)),
    exec: (sql) => exclusive(() => executor.exec(sql)),
    transaction: (work) =>
      exclusive(async () => {
        raw.exec('BEGIN IMMEDIATE');
        try {
          const result = await work(executor);
          raw.exec('COMMIT');
          return result;
        } catch (error) {
          raw.exec('ROLLBACK');
          throw error;
        }
      }),
    close: () => raw.close(),
  };
}

export async function createMigratedTestDatabase(): Promise<TestDatabase> {
  const db = createTestDatabase();
  await migrate(db);
  return db;
}
