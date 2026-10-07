-- Row Level Security & integrity tests. Run with: npx supabase test db
-- (requires the local Supabase stack: npx supabase start)
begin;
create extension if not exists pgtap with schema extensions;

select plan(12);

-- Two users; the sign-up trigger seeds profiles, preferences and categories.
insert into auth.users (id, email, raw_user_meta_data, aud, role)
values
  ('11111111-1111-4111-8111-111111111111', 'a@test.local', '{"base_currency":"EUR"}', 'authenticated', 'authenticated'),
  ('22222222-2222-4222-8222-222222222222', 'b@test.local', '{}', 'authenticated', 'authenticated');

select is(
  (select base_currency from public.user_preferences where id = '11111111-1111-4111-8111-111111111111'),
  'EUR', 'sign-up stores the requested base currency');
select is(
  (select count(*)::int from public.categories where user_id = '22222222-2222-4222-8222-222222222222'),
  21, 'sign-up seeds default categories');

-- ---- as user A ----
set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);

select lives_ok($$
  insert into public.accounts (id, user_id, name, type, currency, opening_balance_date)
  values ('aaaaaaaa-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Checking', 'checking', 'USD', '2026-10-01')
$$, 'user can insert own account');

select throws_ok($$
  insert into public.accounts (id, user_id, name, type, currency, opening_balance_date)
  values ('aaaaaaaa-0000-4000-8000-000000000002', '22222222-2222-4222-8222-222222222222', 'Evil', 'cash', 'USD', '2026-10-01')
$$, '42501', null, 'user cannot insert rows for someone else');

select is(
  (select count(*)::int from public.user_preferences), 1, 'user sees only own preferences');

update public.accounts set name = 'Everyday' where id = 'aaaaaaaa-0000-4000-8000-000000000001' and version = 1;
select is(
  (select version from public.accounts where id = 'aaaaaaaa-0000-4000-8000-000000000001'),
  2, 'updates bump the version');

select is_empty($$
  update public.accounts set name = 'Stale' where id = 'aaaaaaaa-0000-4000-8000-000000000001' and version = 1 returning id
$$, 'stale-version updates apply to no rows (conflict detection)');

select throws_ok($$
  delete from public.accounts where id = 'aaaaaaaa-0000-4000-8000-000000000001'
$$, '42501', null, 'clients cannot hard-delete');

select throws_ok($$
  insert into public.exchange_rates (base_currency, quote_currency, rate, rate_date, source)
  values ('EUR', 'USD', '1.08', '2026-10-01', 'test')
$$, '42501', null, 'clients cannot write exchange rates');

-- ---- as user B ----
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);

select is(
  (select count(*)::int from public.accounts), 0, 'user cannot read another user''s accounts');

select throws_ok($$
  insert into public.transactions (id, user_id, account_id, type, amount_minor, currency,
    original_amount_minor, original_currency, base_currency, base_amount_minor,
    base_fx_rate_date, base_fx_source, occurred_at, local_date, time_zone)
  values ('cccccccc-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222',
    'aaaaaaaa-0000-4000-8000-000000000001', 'expense', -1, 'USD', -1, 'USD', 'USD', -1,
    '2026-10-02', 'identity', now(), '2026-10-02', 'UTC')
$$, '23503', null, 'user cannot reference another user''s account');

-- ---- anonymous ----
reset role;
set local role anon;
select throws_ok($$ select * from public.accounts $$, '42501', null, 'anon has no access');

select * from finish();
rollback;
