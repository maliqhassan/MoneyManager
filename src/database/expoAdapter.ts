import type { SQLiteDatabase } from 'expo-sqlite';

import type { SqlDatabase, SqlExecutor, SqlParams } from './types';

type ExpoExecutor = Pick<
  SQLiteDatabase,
  'runAsync' | 'getAllAsync' | 'getFirstAsync' | 'execAsync'
>;

function wrapExecutor(db: ExpoExecutor): SqlExecutor {
  return {
    async run(sql: string, params: SqlParams = []) {
      const result = await db.runAsync(sql, [...params]);
      return { changes: result.changes };
    },
    getAll: <T>(sql: string, params: SqlParams = []) => db.getAllAsync<T>(sql, [...params]),
    getFirst: <T>(sql: string, params: SqlParams = []) => db.getFirstAsync<T>(sql, [...params]),
    exec: (sql: string) => db.execAsync(sql),
  };
}

/** Adapts an expo-sqlite database to the app's SqlDatabase interface. */
export function createExpoSqlDatabase(db: SQLiteDatabase): SqlDatabase {
  return {
    ...wrapExecutor(db),
    async transaction<T>(work: (tx: SqlExecutor) => Promise<T>): Promise<T> {
      let result: T | undefined;
      // Exclusive transactions get their own connection-scoped executor, so
      // queries issued elsewhere cannot interleave with this unit of work.
      await db.withExclusiveTransactionAsync(async (txn) => {
        result = await work(wrapExecutor(txn));
      });
      return result as T;
    },
  };
}
