import type { Migration } from './index';

/**
 * Local schema v2 — mirrors supabase/migrations/20261008090000_regional_preferences.sql.
 * Regional formatting preferences and onboarding completion on user_preferences.
 */
export const migration002RegionalPreferences: Migration = {
  version: 2,
  name: 'regional_preferences',
  statements: [
    `ALTER TABLE user_preferences ADD COLUMN region TEXT`,
    `ALTER TABLE user_preferences ADD COLUMN language TEXT NOT NULL DEFAULT 'en'`,
    `ALTER TABLE user_preferences ADD COLUMN date_format TEXT NOT NULL DEFAULT 'locale'
       CHECK (date_format IN ('locale', 'MDY', 'DMY', 'YMD'))`,
    `ALTER TABLE user_preferences ADD COLUMN number_format TEXT NOT NULL DEFAULT 'locale'
       CHECK (number_format IN ('locale', 'comma_period', 'period_comma', 'space_comma', 'apostrophe_period'))`,
    `ALTER TABLE user_preferences ADD COLUMN onboarding_completed_at TEXT`,
  ],
};
