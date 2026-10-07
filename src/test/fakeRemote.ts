import type { SyncTableName } from '@/sync/registry';
import type { ChangeCursor, RemoteDataSource, RemoteRow } from '@/sync/types';

/**
 * In-memory stand-in for Supabase that mimics the server-side triggers:
 * version starts at 1 and increments on every update, updated_at is set by
 * the "server" clock. Supports fault injection for retry/idempotency tests.
 */
export class FakeRemote implements RemoteDataSource {
  readonly tables = new Map<string, Map<string, RemoteRow>>();
  private clock = Date.parse('2026-10-07T00:00:00.000Z');
  /** Throw this error on the next N write calls. */
  failNextWrites: { count: number; error: unknown } | null = null;
  /** Apply the next write but throw afterwards, simulating a lost response. */
  loseNextResponse = false;
  calls: string[] = [];

  private table(name: string): Map<string, RemoteRow> {
    let t = this.tables.get(name);
    if (!t) {
      t = new Map();
      this.tables.set(name, t);
    }
    return t;
  }

  private tick(): string {
    this.clock += 1000;
    return new Date(this.clock).toISOString();
  }

  private maybeFail(): void {
    if (this.failNextWrites && this.failNextWrites.count > 0) {
      this.failNextWrites.count -= 1;
      throw this.failNextWrites.error;
    }
  }

  private maybeLose(): void {
    if (this.loseNextResponse) {
      this.loseNextResponse = false;
      throw Object.assign(new TypeError('Network request failed'), { name: 'TypeError' });
    }
  }

  /** Simulates another device writing directly to the server. */
  serverWrite(table: SyncTableName, row: Record<string, unknown> & { id: string }): RemoteRow {
    const existing = this.table(table).get(row.id);
    const next: RemoteRow = {
      ...existing,
      ...row,
      version: existing ? existing.version + 1 : 1,
      updated_at: this.tick(),
      last_mutation_id: (row.last_mutation_id as string | undefined) ?? 'other-device',
    };
    this.table(table).set(row.id, next);
    return next;
  }

  async insert(table: SyncTableName, row: Record<string, unknown>) {
    this.calls.push(`insert:${table}`);
    this.maybeFail();
    const id = row.id as string;
    if (this.table(table).has(id)) return null;
    const stored = this.serverWrite(table, { ...row, id });
    this.maybeLose();
    return { version: stored.version, updatedAt: stored.updated_at };
  }

  async updateIfVersion(
    table: SyncTableName,
    id: string,
    row: Record<string, unknown>,
    expectedVersion: number,
  ) {
    this.calls.push(`update:${table}`);
    this.maybeFail();
    const existing = this.table(table).get(id);
    if (!existing || existing.version !== expectedVersion) return null;
    const stored = this.serverWrite(table, { ...row, id });
    this.maybeLose();
    return { version: stored.version, updatedAt: stored.updated_at };
  }

  async fetchById(table: SyncTableName, id: string) {
    return this.table(table).get(id) ?? null;
  }

  async fetchChanges(table: SyncTableName, since: ChangeCursor | null, limit: number) {
    const rows = [...this.table(table).values()].sort((a, b) =>
      a.updated_at === b.updated_at
        ? a.id.localeCompare(b.id)
        : a.updated_at < b.updated_at
          ? -1
          : 1,
    );
    return rows
      .filter(
        (r) =>
          !since ||
          r.updated_at > since.updatedAt ||
          (r.updated_at === since.updatedAt && r.id > since.id),
      )
      .slice(0, limit);
  }
}
