-- Recurring-rule trigger regression tests (migration 20261019090000).
-- Run with: npx supabase test db   (requires the local Supabase stack)
begin;
create extension if not exists pgtap with schema extensions;

select plan(13);

insert into auth.users (id, email, raw_user_meta_data, aud, role)
values ('11111111-1111-4111-8111-111111111111', 'a@test.local', '{"base_currency":"USD"}', 'authenticated', 'authenticated');

-- The validation function is pinned and both triggers replace the old one.
select is(
  (select proconfig from pg_proc where oid = 'app.check_recurring_rule()'::regprocedure),
  array['search_path=""'], 'check_recurring_rule pins an empty search_path');
select is(
  (select array_agg(tgname::text order by tgname) from pg_trigger
   where tgrelid = 'public.recurring_transactions'::regclass and tgname like 'check_recurring_rule%'),
  array['check_recurring_rule_insert', 'check_recurring_rule_update'],
  'insert and update validation triggers exist (no catch-all trigger)');

set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);

insert into public.accounts (id, user_id, name, type, currency, opening_balance_date) values
  ('aaaaaaaa-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Checking', 'checking', 'USD', '2026-10-01'),
  ('aaaaaaaa-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'Euro', 'savings', 'EUR', '2026-10-01'),
  ('aaaaaaaa-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', 'Dollar 2', 'cash', 'USD', '2026-10-01');

-- ---- inserts --------------------------------------------------------------
select lives_ok($$
  insert into public.recurring_transactions (id, user_id, account_id, type, amount_minor, currency,
    frequency, interval, start_date, time_zone, active_from)
  values ('bbbbbbbb-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111',
    'aaaaaaaa-0000-4000-8000-000000000001', 'expense', 120000, 'USD', 'monthly', 1, '2026-10-01', 'UTC', '2026-10-01')
$$, 'a rule in its account currency can be created');

select throws_ok($$
  insert into public.recurring_transactions (id, user_id, account_id, type, amount_minor, currency,
    frequency, interval, start_date, time_zone, active_from)
  values ('bbbbbbbb-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111',
    'aaaaaaaa-0000-4000-8000-000000000001', 'expense', 500, 'EUR', 'monthly', 1, '2026-10-01', 'UTC', '2026-10-01')
$$, '23514', null, 'insert: a rule in another currency than its account is rejected');

select throws_ok($$
  insert into public.recurring_transactions (id, user_id, account_id, type, amount_minor, currency,
    frequency, interval, start_date, time_zone, active_from)
  values ('bbbbbbbb-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111',
    'aaaaaaaa-0000-4000-8000-000000000001', 'refund', 500, 'USD', 'monthly', 1, '2026-10-01', 'UTC', '2026-10-01')
$$, '23514', null, 'insert: a refund rule is rejected');

-- ---- a rule that became mismatched (account currency changed, no history) --
update public.accounts set currency = 'EUR' where id = 'aaaaaaaa-0000-4000-8000-000000000001';
select is(
  (select r.currency || '/' || a.currency from public.recurring_transactions r
   join public.accounts a on a.id = r.account_id where r.id = 'bbbbbbbb-0000-4000-8000-000000000001'),
  'USD/EUR', 'setup: the existing rule no longer matches its account currency');

-- Clients PATCH the whole row: unchanged type/currency/account must not block it.
select lives_ok($$
  update public.recurring_transactions
  set status = 'paused', is_active = false, type = type, currency = currency, account_id = account_id
  where id = 'bbbbbbbb-0000-4000-8000-000000000001'
$$, 'status-only full-row update of a currency-mismatched rule succeeds');
select is(
  (select status from public.recurring_transactions where id = 'bbbbbbbb-0000-4000-8000-000000000001'),
  'paused', 'the status change was saved');
select lives_ok($$
  update public.recurring_transactions set next_occurrence_date = '2026-11-01'
  where id = 'bbbbbbbb-0000-4000-8000-000000000001'
$$, 'other updates of a mismatched rule succeed');

-- ---- actual changes are still validated -----------------------------------
select throws_ok($$
  update public.recurring_transactions set currency = 'GBP' where id = 'bbbbbbbb-0000-4000-8000-000000000001'
$$, '23514', null, 'update: changing to a currency other than the account''s is rejected');
select throws_ok($$
  update public.recurring_transactions set type = 'refund' where id = 'bbbbbbbb-0000-4000-8000-000000000001'
$$, '23514', null, 'update: changing the type to refund is rejected');
select lives_ok($$
  update public.recurring_transactions set currency = 'EUR' where id = 'bbbbbbbb-0000-4000-8000-000000000001'
$$, 'update: fixing the currency to match the account succeeds');
select throws_ok($$
  update public.recurring_transactions set account_id = 'aaaaaaaa-0000-4000-8000-000000000003'
  where id = 'bbbbbbbb-0000-4000-8000-000000000001'
$$, '23514', null, 'update: moving to an account in another currency is rejected');

select * from finish();
rollback;
