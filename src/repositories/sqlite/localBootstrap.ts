import { DEFAULT_CATEGORIES } from '@/domain/categories/defaults';
import type { SqlDatabase } from '@/database/types';

export interface LocalBootstrapContext {
  userId: string;
  newId: () => string;
  now: () => string;
}

export interface LocalBootstrapDefaults {
  baseCurrency: string;
  locale: string;
  timeZone: string;
  firstDayOfWeek: number;
  language: string;
  region: string | null;
}

/**
 * Creates what the server creates at sign-up — the preferences row and the
 * default category tree — for a profile that has no account (local-only
 * mode). Idempotent: does nothing for parts that already exist.
 *
 * Rows are written as never-pushed (version 0) WITHOUT outbox entries: a
 * local-only profile never syncs; when the user signs in, sync/guestMerge.ts
 * maps these defaults onto the account's own (by system key) and queues only
 * what is new.
 */
export async function bootstrapLocalProfile(
  db: SqlDatabase,
  ctx: LocalBootstrapContext,
  defaults: LocalBootstrapDefaults,
): Promise<void> {
  await db.transaction(async (tx) => {
    const now = ctx.now();
    const prefs = await tx.getFirst<{ id: string }>(
      `SELECT id FROM user_preferences WHERE user_id = ?`,
      [ctx.userId],
    );
    if (!prefs) {
      await tx.run(
        `INSERT INTO user_preferences (id, user_id, created_at, updated_at, version, sync_status,
           base_currency, locale, time_zone, first_day_of_week, month_start_day, region, language)
         VALUES (?, ?, ?, ?, 0, 'pending', ?, ?, ?, ?, 1, ?, ?)`,
        [
          ctx.userId,
          ctx.userId,
          now,
          now,
          defaults.baseCurrency,
          defaults.locale,
          defaults.timeZone,
          defaults.firstDayOfWeek,
          defaults.region,
          defaults.language,
        ],
      );
    }

    const seeded = await tx.getFirst<{ n: number }>(
      `SELECT COUNT(*) AS n FROM categories WHERE user_id = ? AND system_key IS NOT NULL`,
      [ctx.userId],
    );
    if ((seeded?.n ?? 0) > 0) return;

    const idByKey = new Map<string, string>();
    // DEFAULT_CATEGORIES lists every parent before its children.
    for (const [index, c] of DEFAULT_CATEGORIES.entries()) {
      const id = ctx.newId();
      idByKey.set(c.key, id);
      await tx.run(
        `INSERT INTO categories (id, user_id, created_at, updated_at, version, sync_status,
           parent_id, name, kind, icon, color, system_key, is_archived, sort_order)
         VALUES (?, ?, ?, ?, 0, 'pending', ?, ?, ?, ?, ?, ?, 0, ?)`,
        [
          id,
          ctx.userId,
          now,
          now,
          c.parent ? (idByKey.get(c.parent) ?? null) : null,
          c.name,
          c.kind,
          c.icon,
          c.color,
          c.key,
          index,
        ],
      );
    }
  });
}
