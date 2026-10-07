import type { CategoryRule } from '@/domain/models';
import type { SqlDatabase } from '@/database/types';
import { AppError } from '@/lib/errors';

import type { CategoryRuleRepository } from '../types';
import { type RuleRow, toRule } from './mappers';
import { insertSynced, type RepositoryContext, updateSynced } from './shared';

/** Deterministic merchant → category rules (see domain/categorization). */
export class SqliteCategoryRuleRepository implements CategoryRuleRepository {
  constructor(
    private readonly db: SqlDatabase,
    private readonly ctx: RepositoryContext,
  ) {}

  async list(): Promise<CategoryRule[]> {
    const rows = await this.db.getAll<RuleRow>(
      `SELECT * FROM category_rules WHERE user_id = ? AND deleted_at IS NULL
       ORDER BY priority DESC, created_at`,
      [this.ctx.userId],
    );
    return rows.map(toRule);
  }

  async upsertMerchantRule(merchantKey: string, categoryId: string): Promise<CategoryRule> {
    const pattern = merchantKey.trim();
    if (!pattern) throw new AppError('validation', 'Empty merchant');
    let id = '';
    await this.db.transaction(async (tx) => {
      const category = await tx.getFirst<{ id: string }>(
        `SELECT id FROM categories WHERE id = ? AND user_id = ? AND deleted_at IS NULL AND is_archived = 0`,
        [categoryId, this.ctx.userId],
      );
      if (!category) {
        throw new AppError('validation', 'Category unavailable', {
          fieldErrors: { categoryId: 'transactions.errors.categoryUnavailable' },
        });
      }
      const existing = await tx.getFirst<{ id: string }>(
        `SELECT id FROM category_rules
         WHERE user_id = ? AND deleted_at IS NULL AND match_field = 'payee'
           AND match_type = 'equals' AND pattern = ?`,
        [this.ctx.userId, pattern],
      );
      if (existing) {
        id = existing.id;
        await updateSynced(tx, this.ctx, 'category_rules', id, {
          category_id: categoryId,
          is_enabled: 1,
        });
      } else {
        id = this.ctx.newId();
        await insertSynced(tx, this.ctx, 'category_rules', id, {
          name: null,
          match_field: 'payee',
          match_type: 'equals',
          pattern,
          category_id: categoryId,
          merchant_id: null,
          // Exact merchant rules outrank broader "contains" rules.
          priority: 100,
          is_enabled: 1,
        });
      }
    });
    this.ctx.onChange('category_rules');
    const row = await this.db.getFirst<RuleRow>(`SELECT * FROM category_rules WHERE id = ?`, [id]);
    return toRule(row!);
  }

  async remove(id: string): Promise<void> {
    await this.db.transaction((tx) =>
      updateSynced(tx, this.ctx, 'category_rules', id, { deleted_at: this.ctx.now() }, 'delete'),
    );
    this.ctx.onChange('category_rules');
  }
}
