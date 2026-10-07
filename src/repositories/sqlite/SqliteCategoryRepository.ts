import type { Category } from '@/domain/models';
import type { CategoryKind } from '@/domain/enums';
import type { SqlDatabase, SqlExecutor, SqlValue } from '@/database/types';
import { AppError } from '@/lib/errors';
import {
  type CategoryInput,
  categoryInputSchema,
  type CategoryUpdate,
  categoryUpdateSchema,
} from '@/validation/entities';

import type { CategoryRepository, CategoryUsage } from '../types';
import { type CategoryRow, toCategory } from './mappers';
import { fromBool, insertSynced, type RepositoryContext, updateSynced, validate } from './shared';

const invalid = (field: string, key: string, message = key) =>
  new AppError('validation', message, { fieldErrors: { [field]: key } });

async function readCategory(db: SqlExecutor, userId: string, id: string): Promise<Category | null> {
  const row = await db.getFirst<CategoryRow>(
    `SELECT * FROM categories WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
    [id, userId],
  );
  return row ? toCategory(row) : null;
}

async function readUsage(db: SqlExecutor, id: string): Promise<CategoryUsage> {
  const row = await db.getFirst<{ tx: number; children: number; rules: number }>(
    `SELECT
       (SELECT COUNT(*) FROM transactions WHERE category_id = ? AND deleted_at IS NULL)
       + (SELECT COUNT(*) FROM transaction_splits WHERE category_id = ? AND deleted_at IS NULL)
       + (SELECT COUNT(*) FROM budget_allocations WHERE category_id = ? AND deleted_at IS NULL) AS tx,
       (SELECT COUNT(*) FROM categories WHERE parent_id = ? AND deleted_at IS NULL AND is_archived = 0) AS children,
       (SELECT COUNT(*) FROM category_rules WHERE category_id = ? AND deleted_at IS NULL) AS rules`,
    [id, id, id, id, id],
  );
  return {
    transactionCount: row?.tx ?? 0,
    activeChildCount: row?.children ?? 0,
    ruleCount: row?.rules ?? 0,
  };
}

/**
 * Validates a parent for a (new or moved) category: must exist, be active,
 * be top-level, and have the same kind. Mirrors the server trigger.
 */
async function checkParent(
  db: SqlExecutor,
  userId: string,
  parentId: string,
  kind: CategoryKind,
  selfId: string | null,
): Promise<void> {
  if (selfId && parentId === selfId) throw invalid('parentId', 'categories.errors.selfParent');
  const parent = await readCategory(db, userId, parentId);
  if (!parent) throw invalid('parentId', 'categories.errors.parentNotFound');
  if (parent.isArchived) throw invalid('parentId', 'categories.errors.parentArchived');
  if (parent.parentId) throw invalid('parentId', 'categories.errors.tooDeep');
  if (parent.kind !== kind) throw invalid('parentId', 'categories.errors.kindMismatch');
  if (selfId) {
    const children = await db.getFirst<{ n: number }>(
      `SELECT COUNT(*) AS n FROM categories WHERE parent_id = ? AND deleted_at IS NULL`,
      [selfId],
    );
    if ((children?.n ?? 0) > 0) throw invalid('parentId', 'categories.errors.hasChildren');
  }
}

export class SqliteCategoryRepository implements CategoryRepository {
  constructor(
    private readonly db: SqlDatabase,
    private readonly ctx: RepositoryContext,
  ) {}

  async list(
    options: { kind?: CategoryKind; includeArchived?: boolean } = {},
  ): Promise<Category[]> {
    const where = ['user_id = ?', 'deleted_at IS NULL'];
    const params: SqlValue[] = [this.ctx.userId];
    if (options.kind) {
      where.push('kind = ?');
      params.push(options.kind);
    }
    if (!options.includeArchived) where.push('is_archived = 0');
    const rows = await this.db.getAll<CategoryRow>(
      `SELECT * FROM categories WHERE ${where.join(' AND ')}
       ORDER BY kind, sort_order, name COLLATE NOCASE`,
      params,
    );
    return rows.map(toCategory);
  }

  getById(id: string): Promise<Category | null> {
    return readCategory(this.db, this.ctx.userId, id);
  }

  async create(input: CategoryInput): Promise<Category> {
    const valid = validate(categoryInputSchema, input);
    const id = this.ctx.newId();
    await this.db.transaction(async (tx) => {
      if (valid.parentId) await checkParent(tx, this.ctx.userId, valid.parentId, valid.kind, null);
      const max = await tx.getFirst<{ m: number | null }>(
        `SELECT MAX(sort_order) AS m FROM categories
         WHERE user_id = ? AND kind = ? AND deleted_at IS NULL AND parent_id IS ?`,
        [this.ctx.userId, valid.kind, valid.parentId],
      );
      await insertSynced(tx, this.ctx, 'categories', id, {
        parent_id: valid.parentId,
        name: valid.name,
        kind: valid.kind,
        icon: valid.icon,
        color: valid.color,
        system_key: null,
        is_archived: 0,
        sort_order: input.sortOrder ?? (max?.m ?? -1) + 1,
      });
    });
    this.ctx.onChange('categories');
    return this.require(id);
  }

  async update(id: string, patch: CategoryUpdate): Promise<Category> {
    const valid = validate(categoryUpdateSchema, patch);
    await this.db.transaction(async (tx) => {
      const current = await readCategory(tx, this.ctx.userId, id);
      if (!current) throw new AppError('not_found', `Category ${id} not found`);
      if (valid.kind !== undefined && valid.kind !== current.kind) {
        throw invalid('kind', 'categories.errors.kindLocked');
      }
      if (valid.parentId !== undefined && valid.parentId !== current.parentId && valid.parentId) {
        await checkParent(tx, this.ctx.userId, valid.parentId, current.kind, id);
      }
      const values: Record<string, SqlValue> = {};
      if (valid.name !== undefined) values.name = valid.name;
      if (valid.icon !== undefined) values.icon = valid.icon;
      if (valid.color !== undefined) values.color = valid.color;
      if (valid.sortOrder !== undefined) values.sort_order = valid.sortOrder;
      if (valid.parentId !== undefined) values.parent_id = valid.parentId;
      if (valid.isArchived !== undefined) values.is_archived = fromBool(valid.isArchived);
      if (Object.keys(values).length > 0) {
        await updateSynced(tx, this.ctx, 'categories', id, values);
      }
    });
    this.ctx.onChange('categories');
    return this.require(id);
  }

  async setArchived(id: string, archived: boolean): Promise<Category> {
    await this.db.transaction(async (tx) => {
      const current = await readCategory(tx, this.ctx.userId, id);
      if (!current) throw new AppError('not_found', `Category ${id} not found`);
      if (!archived && current.parentId) {
        const parent = await readCategory(tx, this.ctx.userId, current.parentId);
        if (parent?.isArchived) throw invalid('_root', 'categories.errors.restoreParentFirst');
      }
      await updateSynced(tx, this.ctx, 'categories', id, { is_archived: fromBool(archived) });
      if (archived) {
        // Subcategories of an archived parent would be orphaned choices: archive them too.
        const children = await tx.getAll<{ id: string }>(
          `SELECT id FROM categories WHERE parent_id = ? AND deleted_at IS NULL AND is_archived = 0`,
          [id],
        );
        for (const child of children) {
          await updateSynced(tx, this.ctx, 'categories', child.id, { is_archived: 1 });
        }
      }
    });
    this.ctx.onChange('categories');
    return this.require(id);
  }

  async remove(id: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const usage = await readUsage(tx, id);
      const anyChildren = await tx.getFirst<{ n: number }>(
        `SELECT COUNT(*) AS n FROM categories WHERE parent_id = ? AND deleted_at IS NULL`,
        [id],
      );
      if (usage.transactionCount + usage.ruleCount > 0) {
        throw invalid('_root', 'categories.errors.inUse');
      }
      if ((anyChildren?.n ?? 0) > 0) throw invalid('_root', 'categories.errors.hasChildren');
      await updateSynced(tx, this.ctx, 'categories', id, { deleted_at: this.ctx.now() }, 'delete');
    });
    this.ctx.onChange('categories');
  }

  getUsage(id: string): Promise<CategoryUsage> {
    return readUsage(this.db, id);
  }

  async move(id: string, direction: 'up' | 'down'): Promise<void> {
    await this.db.transaction(async (tx) => {
      const current = await readCategory(tx, this.ctx.userId, id);
      if (!current) throw new AppError('not_found', `Category ${id} not found`);
      const siblings = (
        await tx.getAll<CategoryRow>(
          `SELECT * FROM categories
           WHERE user_id = ? AND kind = ? AND parent_id IS ? AND deleted_at IS NULL
           ORDER BY sort_order, name COLLATE NOCASE`,
          [this.ctx.userId, current.kind, current.parentId],
        )
      ).map(toCategory);
      const index = siblings.findIndex((s) => s.id === id);
      const target = direction === 'up' ? index - 1 : index + 1;
      if (index < 0 || target < 0 || target >= siblings.length) return;
      // Renumber siblings densely so equal sort orders cannot block a move.
      const reordered = [...siblings];
      const [moved] = reordered.splice(index, 1);
      reordered.splice(target, 0, moved!);
      for (const [order, category] of reordered.entries()) {
        if (category.sortOrder !== order) {
          await updateSynced(tx, this.ctx, 'categories', category.id, { sort_order: order });
        }
      }
    });
    this.ctx.onChange('categories');
  }

  private async require(id: string): Promise<Category> {
    const category = await this.getById(id);
    if (!category) throw new AppError('not_found', `Category ${id} not found`);
    return category;
  }
}
