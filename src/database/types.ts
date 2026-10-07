/**
 * Minimal SQL abstraction used by repositories and the sync engine.
 *
 * Production uses the expo-sqlite adapter; tests use an in-memory engine that
 * implements the same interface. Nothing outside src/database depends on
 * expo-sqlite directly.
 */

export type SqlValue = string | number | null;
export type SqlParams = readonly SqlValue[];

export interface SqlRunResult {
  changes: number;
}

export interface SqlExecutor {
  /** Executes one statement with bound parameters. */
  run(sql: string, params?: SqlParams): Promise<SqlRunResult>;
  getAll<T>(sql: string, params?: SqlParams): Promise<T[]>;
  getFirst<T>(sql: string, params?: SqlParams): Promise<T | null>;
  /** Executes one or more statements without parameters (DDL, PRAGMA). */
  exec(sql: string): Promise<void>;
}

export interface SqlDatabase extends SqlExecutor {
  /**
   * Runs `work` in an exclusive transaction. All statements must use the
   * provided `tx` executor; the transaction commits when `work` resolves and
   * rolls back when it throws.
   */
  transaction<T>(work: (tx: SqlExecutor) => Promise<T>): Promise<T>;
}
