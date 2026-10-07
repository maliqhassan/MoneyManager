import * as SQLite from 'expo-sqlite';

import { createExpoSqlDatabase } from './expoAdapter';
import { migrate } from './migrations';
import type { SqlDatabase } from './types';

/**
 * Each signed-in user gets their own database file, so accounts on a shared
 * device can never see each other's data and sign-out can delete the file
 * outright.
 */
export function databaseNameForUser(userId: string): string {
  if (!/^[0-9a-f-]{36}$/i.test(userId)) throw new Error('Invalid user id for database name');
  return `ledger-${userId.toLowerCase()}.db`;
}

export interface OpenedDatabase {
  db: SqlDatabase;
  close: () => Promise<void>;
}

export async function openUserDatabase(userId: string): Promise<OpenedDatabase> {
  const native = await SQLite.openDatabaseAsync(databaseNameForUser(userId));
  await native.execAsync(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
  `);
  const db = createExpoSqlDatabase(native);
  await migrate(db);
  let closing: Promise<void> | null = null;
  return { db, close: () => (closing ??= native.closeAsync()) };
}

export async function deleteUserDatabase(userId: string): Promise<void> {
  await SQLite.deleteDatabaseAsync(databaseNameForUser(userId));
}
