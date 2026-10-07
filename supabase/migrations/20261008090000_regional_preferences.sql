-- =============================================================================
-- Regional preferences + onboarding completion
-- Mirrors src/database/migrations/002_regional_preferences.ts.
-- Additive only: no existing data is changed. RLS policies on
-- user_preferences already cover the new columns.
-- =============================================================================

alter table public.user_preferences
  add column region text
    check (region is null or region ~ '^[A-Z]{2}$'),
  add column language text not null default 'en'
    check (language ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$'),
  add column date_format text not null default 'locale'
    check (date_format in ('locale', 'MDY', 'DMY', 'YMD')),
  add column number_format text not null default 'locale'
    check (number_format in ('locale', 'comma_period', 'period_comma', 'space_comma', 'apostrophe_period')),
  add column onboarding_completed_at timestamptz;

-- Locale tags are BCP-47 (e.g. en-GB, zh-Hant-TW); tighten the old length-only check.
alter table public.user_preferences
  add constraint user_preferences_locale_format
    check (locale ~ '^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$');

alter table public.user_preferences
  add constraint user_preferences_time_zone_format
    check (time_zone ~ '^[A-Za-z0-9_+\-/]+$');
