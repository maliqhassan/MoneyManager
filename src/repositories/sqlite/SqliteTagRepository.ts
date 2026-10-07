import type { Tag } from '@/domain/models';
import { normalizeSearchText } from '@/domain/text/search';
import type { SqlDatabase, SqlExecutor } from '@/database/types';

import type { TagRepository } from '../types';
import { type TagRow, toTag } from './mappers';
import { insertSynced, type RepositoryContext } from './shared';

export async function listTags(db: SqlExecutor, userId: string): Promise<Tag[]> {
  const rows = await db.getAll<TagRow>(
    `SELECT * FROM tags WHERE user_id = ? AND deleted_at IS NULL ORDER BY name COLLATE NOCASE`,
    [userId],
  );
  return rows.map(toTag);
}

/**
 * Resolves tag names to ids, creating missing tags. Names match
 * case/diacritic-insensitively, so "Work" and "work" are one tag. Must run
 * inside the caller's write transaction.
 */
export async function resolveTagIds(
  tx: SqlExecutor,
  ctx: RepositoryContext,
  names: readonly string[],
): Promise<string[]> {
  const existing = await listTags(tx, ctx.userId);
  const byKey = new Map(existing.map((t) => [normalizeSearchText(t.name), t.id]));
  const ids: string[] = [];
  for (const raw of names) {
    const name = raw.trim();
    const key = normalizeSearchText(name);
    if (!key) continue;
    let id = byKey.get(key);
    if (!id) {
      id = ctx.newId();
      await insertSynced(tx, ctx, 'tags', id, { name, color: null });
      byKey.set(key, id);
    }
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

export class SqliteTagRepository implements TagRepository {
  constructor(
    private readonly db: SqlDatabase,
    private readonly ctx: RepositoryContext,
  ) {}

  list(): Promise<Tag[]> {
    return listTags(this.db, this.ctx.userId);
  }
}
