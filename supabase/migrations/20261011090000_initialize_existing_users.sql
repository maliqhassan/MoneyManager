-- =============================================================================
-- Idempotent user initialization + backfill for users created before the
-- schema existed.
--
-- New users get their profile, preferences and default categories from the
-- sign-up trigger (app.handle_new_user). A user who signed up BEFORE these
-- migrations were applied never fired that trigger, so they had no
-- preferences row and the app could not finish onboarding. This migration:
--   1. adds app.initialize_user(user_id) — creates whatever is missing and
--      never duplicates (safe to run any number of times);
--   2. makes the sign-up trigger use it;
--   3. runs it once for every existing auth user.
-- No user data is modified; existing rows are left untouched.
-- =============================================================================

create or replace function app.initialize_user(target_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested_currency text;
begin
  select upper(coalesce(u.raw_user_meta_data ->> 'base_currency', ''))
    into requested_currency
    from auth.users u
    where u.id = target_user;
  if not found then
    return;
  end if;

  insert into public.profiles (id)
  values (target_user)
  on conflict (id) do nothing;

  insert into public.user_preferences (id, user_id, base_currency)
  values (
    target_user,
    target_user,
    case when requested_currency ~ '^[A-Z]{3}$' then requested_currency else 'USD' end
  )
  on conflict (id) do nothing;

  perform app.seed_default_categories(target_user);
end;
$$;

-- Server-side only: clients cannot call it (RLS-protected tables are written
-- as the definer, so it must not be exposed through the API).
revoke all on function app.initialize_user(uuid) from public, anon, authenticated;

create or replace function app.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.initialize_user(new.id);
  return new;
end;
$$;

-- Backfill: users who signed up before the schema existed.
select app.initialize_user(u.id) from auth.users u;
