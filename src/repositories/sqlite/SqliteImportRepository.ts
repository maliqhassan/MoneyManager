import type { CurrencyCode } from '@/domain/currency/currencies';
import { matchKey } from '@/domain/imports/plan';
import type { SqlDatabase } from '@/database/types';
import type { TransactionInput } from '@/validation/transactions';

import type {
  ImportBatchSummary,
  ImportProgress,
  ImportRepository,
  ImportRunResult,
} from '../types';
import { insertSynced, type RepositoryContext, updateSynced } from './shared';
import type { SqliteTransactionRepository } from './SqliteTransactionRepository';

const placeholders = (n: number) => Array.from({ length: n }, () => '?').join(', ');
const SQL_CHUNK = 400;
export const IMPORT_CHUNK_SIZE = 200;

/** Lets the UI render between chunks so a large import never freezes it. */
const yieldToUi = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/**
 * CSV import persistence.
 *
 * Every imported row becomes a NORMAL transaction through the transaction
 * repository (same validation, base snapshot, merchant key and outbox), with
 * its stable identity in `import_hash` and its batch in `import_batch_id`.
 *
 * Commit is chunked: each chunk of rows is one SQLite transaction (all or
 * nothing). Before inserting, every row's identity is checked again inside
 * the chunk transaction, so retrying — or re-running after the app was
 * closed mid-import — never creates a duplicate. The import as a whole is
 * therefore NOT atomic: completed chunks stay, and the batch record tells
 * how far it got. Raw CSV contents are never stored or synced.
 */
export class SqliteImportRepository implements ImportRepository {
  constructor(
    private readonly db: SqlDatabase,
    private readonly ctx: RepositoryContext,
    private readonly transactions: SqliteTransactionRepository,
  ) {}

  async existingHashes(hashes: readonly string[]): Promise<Set<string>> {
    const found = new Set<string>();
    for (let i = 0; i < hashes.length; i += SQL_CHUNK) {
      const part = hashes.slice(i, i + SQL_CHUNK);
      const rows = await this.db.getAll<{ import_hash: string }>(
        `SELECT import_hash FROM transactions
         WHERE user_id = ? AND deleted_at IS NULL AND import_hash IN (${placeholders(part.length)})`,
        [this.ctx.userId, ...part],
      );
      for (const r of rows) found.add(r.import_hash);
    }
    return found;
  }

  async existingMatches(
    accountIds: readonly string[],
    from: string,
    to: string,
  ): Promise<Map<string, number>> {
    if (accountIds.length === 0) return new Map();
    const rows = await this.db.getAll<{
      account_id: string;
      local_date: string;
      amount_minor: number;
      currency: CurrencyCode;
      n: number;
    }>(
      `SELECT account_id, local_date, amount_minor, currency, COUNT(*) AS n FROM transactions
       WHERE user_id = ? AND deleted_at IS NULL AND local_date >= ? AND local_date <= ?
         AND account_id IN (${placeholders(accountIds.length)})
       GROUP BY account_id, local_date, amount_minor, currency`,
      [this.ctx.userId, from, to, ...accountIds],
    );
    return new Map(
      rows.map((r) => [matchKey(r.account_id, r.local_date, r.amount_minor, r.currency), r.n]),
    );
  }

  async run(
    meta: {
      fileName: string;
      accountId: string | null;
      rowCount: number;
      duplicateCount: number;
      errorCount: number;
      columnMapping: Record<string, unknown>;
    },
    rows: readonly { hash: string; input: TransactionInput }[],
    onProgress?: (p: ImportProgress) => void,
  ): Promise<ImportRunResult> {
    const batchId = this.ctx.newId();
    await this.db.transaction(async (tx) => {
      await insertSynced(tx, this.ctx, 'import_batches', batchId, {
        source: 'csv',
        file_name: meta.fileName.slice(0, 255) || 'import.csv',
        account_id: meta.accountId,
        status: 'previewed',
        column_mapping: JSON.stringify(meta.columnMapping),
        row_count: meta.rowCount,
        imported_count: 0,
        duplicate_count: meta.duplicateCount,
        error_count: meta.errorCount,
        committed_at: null,
      });
    });
    this.ctx.onChange('import_batches');

    let imported = 0;
    let skipped = 0;
    try {
      for (let i = 0; i < rows.length; i += IMPORT_CHUNK_SIZE) {
        const chunk = rows.slice(i, i + IMPORT_CHUNK_SIZE);
        const result = await this.db.transaction(async (tx) => {
          let added = 0;
          let already = 0;
          for (const row of chunk) {
            const exists = await tx.getFirst(
              `SELECT 1 FROM transactions
               WHERE user_id = ? AND deleted_at IS NULL AND import_hash = ? LIMIT 1`,
              [this.ctx.userId, row.hash],
            );
            if (exists) {
              already += 1;
              continue;
            }
            await this.transactions.createInTransaction(tx, row.input, {
              batchId,
              hash: row.hash,
            });
            added += 1;
          }
          await updateSynced(tx, this.ctx, 'import_batches', batchId, {
            imported_count: imported + added,
          });
          return { added, already };
        });
        imported += result.added;
        skipped += result.already;
        this.notify();
        onProgress?.({ done: Math.min(i + chunk.length, rows.length), total: rows.length });
        await yieldToUi();
      }
    } catch (error) {
      await this.finish(batchId, 'failed', imported);
      return { batchId, status: 'failed', imported, skipped, error };
    }
    await this.finish(batchId, 'committed', imported);
    return { batchId, status: 'committed', imported, skipped, error: null };
  }

  /** Imports that started but never finished (e.g. the app was closed). */
  async incompleteBatches(): Promise<ImportBatchSummary[]> {
    const rows = await this.db.getAll<{
      id: string;
      file_name: string;
      created_at: string;
      row_count: number;
      imported: number;
    }>(
      `SELECT b.id, b.file_name, b.created_at, b.row_count,
              (SELECT COUNT(*) FROM transactions t
               WHERE t.import_batch_id = b.id AND t.deleted_at IS NULL) AS imported
       FROM import_batches b
       WHERE b.user_id = ? AND b.deleted_at IS NULL AND b.status = 'previewed'
       ORDER BY b.created_at DESC`,
      [this.ctx.userId],
    );
    return rows.map((r) => ({
      id: r.id,
      fileName: r.file_name,
      createdAt: r.created_at,
      rowCount: r.row_count,
      importedCount: r.imported,
    }));
  }

  /** Marks an unfinished import as acknowledged (its imported rows stay). */
  async dismissBatch(id: string): Promise<void> {
    const imported = await this.db.getFirst<{ n: number }>(
      `SELECT COUNT(*) AS n FROM transactions WHERE import_batch_id = ? AND deleted_at IS NULL`,
      [id],
    );
    await this.finish(id, 'failed', imported?.n ?? 0);
  }

  private async finish(batchId: string, status: 'committed' | 'failed', imported: number) {
    await this.db.transaction(async (tx) => {
      await updateSynced(tx, this.ctx, 'import_batches', batchId, {
        status,
        imported_count: imported,
        committed_at: status === 'committed' ? this.ctx.now() : null,
      });
    });
    this.ctx.onChange('import_batches');
  }

  private notify(): void {
    this.ctx.onChange('transactions');
    this.ctx.onChange('accounts');
  }
}
