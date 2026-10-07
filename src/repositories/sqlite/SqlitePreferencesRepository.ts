import type { CurrencyCode } from '@/domain/currency/currencies';
import type { DateFormat, NumberFormat, Weekday } from '@/domain/enums';
import type { UserPreferences } from '@/domain/models';
import type { SqlDatabase, SqlValue } from '@/database/types';
import { AppError } from '@/lib/errors';
import { type PreferencesUpdate, preferencesUpdateSchema } from '@/validation/preferences';

import type { PreferencesRepository } from '../types';
import { type RepositoryContext, updateSynced, validate } from './shared';

interface PreferencesRow {
  id: string;
  user_id: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  version: number;
  base_currency: CurrencyCode;
  locale: string;
  time_zone: string;
  first_day_of_week: number;
  month_start_day: number;
  region: string | null;
  language: string;
  date_format: DateFormat;
  number_format: NumberFormat;
  onboarding_completed_at: string | null;
}

const COLUMN_FOR: Record<keyof PreferencesUpdate, string> = {
  baseCurrency: 'base_currency',
  locale: 'locale',
  language: 'language',
  region: 'region',
  timeZone: 'time_zone',
  firstDayOfWeek: 'first_day_of_week',
  monthStartDay: 'month_start_day',
  dateFormat: 'date_format',
  numberFormat: 'number_format',
  onboardingCompletedAt: 'onboarding_completed_at',
};

function toPreferences(row: PreferencesRow): UserPreferences {
  return {
    id: row.id,
    userId: row.user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    version: row.version,
    baseCurrency: row.base_currency,
    locale: row.locale,
    timeZone: row.time_zone,
    firstDayOfWeek: row.first_day_of_week as Weekday,
    monthStartDay: row.month_start_day,
    region: row.region,
    language: row.language,
    dateFormat: row.date_format,
    numberFormat: row.number_format,
    onboardingCompletedAt: row.onboarding_completed_at,
  };
}

/**
 * User preferences. The row is created server-side at sign-up (id = user id)
 * and arrives via sync, so the client only ever updates it — this avoids two
 * devices creating competing preference rows. Updates work offline: they are
 * written locally and queued in the outbox like any other synced change.
 */
export class SqlitePreferencesRepository implements PreferencesRepository {
  constructor(
    private readonly db: SqlDatabase,
    private readonly ctx: RepositoryContext,
  ) {}

  async get(): Promise<UserPreferences | null> {
    const row = await this.db.getFirst<PreferencesRow>(
      `SELECT * FROM user_preferences WHERE user_id = ? AND deleted_at IS NULL`,
      [this.ctx.userId],
    );
    return row ? toPreferences(row) : null;
  }

  async update(patch: PreferencesUpdate): Promise<UserPreferences> {
    const valid = validate(preferencesUpdateSchema, patch);
    const values: Record<string, SqlValue> = {};
    for (const [field, value] of Object.entries(valid)) {
      if (value !== undefined) values[COLUMN_FOR[field as keyof PreferencesUpdate]] = value;
    }
    const current = await this.get();
    if (!current) throw new AppError('not_found', 'Preferences have not synced yet');
    if (Object.keys(values).length > 0) {
      await this.db.transaction((tx) =>
        updateSynced(tx, this.ctx, 'user_preferences', current.id, values),
      );
      this.ctx.onChange('user_preferences');
    }
    return (await this.get()) ?? current;
  }
}
