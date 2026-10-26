import type { SqlDatabase, SqlExecutor, SqlValue } from '@/database/types';
import { normalizeSearchText } from '@/domain/text/search';

import { enqueueChange } from './outbox';
import { getSyncTable, SYNC_TABLES, type SyncTableName } from './registry';

/**
 * Moves the data of a local-only profile (no account) into the account the
 * user just signed in to, on the same device. Runs in ONE transaction on the
 * account's database: either everything is copied and queued for upload, or
 * nothing changes and the local-only database is left untouched.
 *
 * Before calling, pull the account's preferences, categories, tags and
 * merchants (SyncEngine.pullOnly) so defaults can be matched instead of
 * duplicated:
 * - default categories map onto the account's by system key; custom ones are
 *   copied (their parent remapped);
 * - tags map by name, merchants by normalised name;
 * - preferences: the account keeps its own when it has finished onboarding
 *   (used elsewhere already); otherwise it takes the local-only choices;
 * - every other live row is copied with the account's user id, references to
 *   mapped rows rewritten, and queued like a new local write. Soft-deleted
 *   rows were never uploaded and are dropped.
 */
export interface GuestMergeInput {
  source: SqlDatabase;
  target: SqlDatabase;
  guestId: string;
  userId: string;
  newId: () => string;
  now: () => string;
}

export interface GuestMergeResult {
  /** Rows copied (and queued) per table. */
  copied: Partial<Record<SyncTableName, number>>;
  /** Rows matched to the account's existing ones instead of copied. */
  matched: { categories: number; tags: number; merchants: number };
  preferences: 'kept_account' | 'took_local' | 'none';
}

type Row = Record<string, SqlValue>;

/** Columns that point at rows that may be matched rather than copied. */
const CATEGORY_REFS = ['category_id', 'default_category_id'] as const;

export class GuestMergeError extends Error {
  constructor(
    message: string,
    readonly reason: 'account_not_ready',
  ) {
    super(message);
  }
}

export async function mergeGuestData(input: GuestMergeInput): Promise<GuestMergeResult> {
  const { source, target, guestId, userId } = input;
  const result: GuestMergeResult = {
    copied: {},
    matched: { categories: 0, tags: 0, merchants: 0 },
    preferences: 'none',
  };
  const live = (table: SyncTableName) =>
    source.getAll<Row>(`SELECT * FROM ${table} WHERE user_id = ? AND deleted_at IS NULL`, [
      guestId,
    ]);

  // Read everything first: the source is a different database/connection.
  const sourceRows = new Map<SyncTableName, Row[]>();
  for (const table of SYNC_TABLES) sourceRows.set(table.name, await live(table.name));
  const manualRates = await source
    .getAll<Row>(`SELECT * FROM exchange_rates WHERE kind = 'manual'`)
    .catch(() => [] as Row[]);

  await target.transaction(async (tx) => {
    const now = input.now();
    const categoryMap = new Map<string, string>();
    const tagMap = new Map<string, string>();
    const merchantMap = new Map<string, string>();

    const queue = (table: SyncTableName, id: string) =>
      enqueueChange(tx, {
        mutationId: input.newId(),
        entity: table,
        entityId: id,
        operation: 'upsert',
        now,
      });

    // ---- preferences
    const localPrefs = sourceRows.get('user_preferences')?.[0];
    if (localPrefs) {
      const accountPrefs = await tx.getFirst<{
        id: string;
        onboarding_completed_at: string | null;
      }>(
        `SELECT id, onboarding_completed_at FROM user_preferences WHERE user_id = ? AND deleted_at IS NULL`,
        [userId],
      );
      if (!accountPrefs) {
        throw new GuestMergeError('Account preferences have not synced yet', 'account_not_ready');
      }
      if (accountPrefs.onboarding_completed_at || !localPrefs.onboarding_completed_at) {
        result.preferences = 'kept_account';
      } else {
        const values = dataColumns('user_preferences', localPrefs);
        const columns = Object.keys(values);
        await tx.run(
          `UPDATE user_preferences SET ${columns.map((c) => `${c} = ?`).join(', ')},
             updated_at = ?, sync_status = 'pending' WHERE id = ?`,
          [...columns.map((c) => values[c] ?? null), now, accountPrefs.id],
        );
        await queue('user_preferences', accountPrefs.id);
        result.preferences = 'took_local';
      }
    }

    // ---- categories (parents first)
    // The server keeps (user, system key) unique even for deleted rows.
    const accountKeyRows = await tx.getAll<{
      id: string;
      system_key: string;
      deleted_at: string | null;
    }>(
      `SELECT id, system_key, deleted_at FROM categories
       WHERE user_id = ? AND system_key IS NOT NULL`,
      [userId],
    );
    const liveKeys = new Map(
      accountKeyRows.filter((c) => c.deleted_at === null).map((c) => [c.system_key, c.id]),
    );
    const takenKeys = new Set(accountKeyRows.map((c) => c.system_key));
    const categories = [...(sourceRows.get('categories') ?? [])].sort(
      (a, b) => Number(a.parent_id !== null) - Number(b.parent_id !== null),
    );
    for (const c of categories) {
      const match = typeof c.system_key === 'string' ? liveKeys.get(c.system_key) : undefined;
      if (match) {
        categoryMap.set(String(c.id), match);
        result.matched.categories += 1;
      }
    }
    // Unmatched defaults are copied only when something uses them (or a
    // child of theirs): defaults the account removed are not brought back.
    const used = usedCategoryIds(sourceRows, categories);
    for (const c of categories) {
      const id = String(c.id);
      if (categoryMap.has(id)) continue;
      const isDefault = typeof c.system_key === 'string';
      if (isDefault && !used.has(id)) continue;
      await copyRow(tx, 'categories', {
        ...c,
        parent_id: remap(c.parent_id, categoryMap),
        system_key:
          isDefault && takenKeys.has(String(c.system_key)) ? null : (c.system_key ?? null),
      });
      await queue('categories', id);
      result.copied.categories = (result.copied.categories ?? 0) + 1;
    }

    // ---- tags by name, merchants by normalised name
    const accountTags = new Map(
      (
        await tx.getAll<{ id: string; name: string }>(
          `SELECT id, name FROM tags WHERE user_id = ? AND deleted_at IS NULL`,
          [userId],
        )
      ).map((t) => [normalizeSearchText(t.name), t.id]),
    );
    for (const tag of sourceRows.get('tags') ?? []) {
      const match = accountTags.get(normalizeSearchText(String(tag.name)));
      if (match) {
        tagMap.set(String(tag.id), match);
        result.matched.tags += 1;
      }
    }
    const accountMerchants = new Map(
      (
        await tx.getAll<{ id: string; normalized_name: string }>(
          `SELECT id, normalized_name FROM merchants WHERE user_id = ? AND deleted_at IS NULL`,
          [userId],
        )
      ).map((m) => [m.normalized_name, m.id]),
    );
    for (const m of sourceRows.get('merchants') ?? []) {
      const match = accountMerchants.get(String(m.normalized_name));
      if (match) {
        merchantMap.set(String(m.id), match);
        result.matched.merchants += 1;
      }
    }

    // ---- everything else, in dependency order
    for (const { name: table } of SYNC_TABLES) {
      if (table === 'user_preferences' || table === 'categories') continue;
      for (const row of sourceRows.get(table) ?? []) {
        const id = String(row.id);
        if (table === 'tags' && tagMap.has(id)) continue;
        if (table === 'merchants' && merchantMap.has(id)) continue;
        const next: Row = { ...row };
        for (const col of CATEGORY_REFS) if (col in next) next[col] = remap(next[col], categoryMap);
        if ('tag_id' in next) next.tag_id = remap(next.tag_id, tagMap);
        if ('merchant_id' in next) next.merchant_id = remap(next.merchant_id, merchantMap);
        if (table === 'attachments' && typeof next.storage_path === 'string') {
          next.storage_path = next.storage_path.replace(`${guestId}/`, `${userId}/`);
        }
        await copyRow(tx, table, next);
        await queue(table, id);
        result.copied[table] = (result.copied[table] ?? 0) + 1;
      }
    }

    // Manual exchange rates are device data the user typed; keep them.
    for (const rate of manualRates) {
      const columns = Object.keys(rate);
      await tx.run(
        `INSERT OR IGNORE INTO exchange_rates (${columns.join(', ')})
         VALUES (${columns.map(() => '?').join(', ')})`,
        columns.map((c) => rate[c] ?? null),
      );
    }

    async function copyRow(exec: SqlExecutor, table: SyncTableName, row: Row) {
      const values: Row = {
        ...row,
        user_id: userId,
        version: 0,
        sync_status: 'pending',
      };
      const columns = Object.keys(values);
      await exec.run(
        `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
        columns.map((c) => values[c] ?? null),
      );
    }
  });

  return result;
}

/** Categories referenced by any row, plus their ancestors. */
function usedCategoryIds(rows: ReadonlyMap<SyncTableName, Row[]>, categories: Row[]): Set<string> {
  const used = new Set<string>();
  for (const [table, list] of rows) {
    for (const row of list) {
      for (const col of CATEGORY_REFS) {
        if (typeof row[col] === 'string') used.add(row[col]);
      }
      if (table === 'categories' && row.system_key === null) used.add(String(row.id));
    }
  }
  const parentOf = new Map(categories.map((c) => [String(c.id), c.parent_id]));
  for (const id of [...used]) {
    let parent = parentOf.get(id);
    while (typeof parent === 'string' && !used.has(parent)) {
      used.add(parent);
      parent = parentOf.get(parent);
    }
  }
  return used;
}

function remap(value: SqlValue | undefined, map: ReadonlyMap<string, string>): SqlValue {
  if (typeof value !== 'string') return value ?? null;
  return map.get(value) ?? value;
}

/** A row's data columns (no identity or sync bookkeeping). */
function dataColumns(table: SyncTableName, row: Row): Row {
  const skip = new Set([
    'id',
    'user_id',
    'created_at',
    'updated_at',
    'deleted_at',
    'version',
    'sync_status',
    ...(getSyncTable(table).localOnlyColumns ?? []),
  ]);
  return Object.fromEntries(Object.entries(row).filter(([k]) => !skip.has(k)));
}
