-- Row Level Security & integrity tests. Run with: npx supabase test db
-- (requires the local Supabase stack: npx supabase start)
begin;
create extension if not exists pgtap with schema extensions;

select plan(52);

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
  51, 'sign-up seeds the default category tree');
select is(
  (select count(*)::int from public.categories
   where user_id = '22222222-2222-4222-8222-222222222222' and parent_id is not null),
  28, 'default subcategories are nested under their parents');
select app.initialize_user('22222222-2222-4222-8222-222222222222');
select is(
  (select count(*)::int from public.user_preferences where user_id = '22222222-2222-4222-8222-222222222222')
    + (select count(*)::int from public.profiles where id = '22222222-2222-4222-8222-222222222222'),
  2, 'user initialization is idempotent (one profile, one preferences row)');
select app.seed_default_categories('22222222-2222-4222-8222-222222222222');
select is(
  (select count(*)::int from public.categories where user_id = '22222222-2222-4222-8222-222222222222'),
  51, 'seeding default categories is idempotent');

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

select lives_ok($$
  update public.user_preferences
  set region = 'AE', locale = 'en-AE', date_format = 'DMY', onboarding_completed_at = now()
  where id = '11111111-1111-4111-8111-111111111111'
$$, 'user can complete onboarding on own preferences');

select throws_ok($$
  update public.user_preferences set date_format = 'DD.MM'
  where id = '11111111-1111-4111-8111-111111111111'
$$, '23514', null, 'invalid date format is rejected');

-- ---- Phase 2 integrity (user A) ----
select throws_ok($$
  insert into public.transactions (id, user_id, account_id, type, amount_minor, currency,
    original_amount_minor, original_currency, base_currency, base_amount_minor,
    base_fx_rate_date, base_fx_source, occurred_at, local_date, time_zone)
  values ('cccccccc-0000-4000-8000-000000000009', '11111111-1111-4111-8111-111111111111',
    'aaaaaaaa-0000-4000-8000-000000000001', 'expense', -100, 'EUR', -100, 'EUR', 'EUR', -100,
    '2026-10-02', 'identity', now(), '2026-10-02', 'UTC')
$$, '23514', null, 'transaction currency must equal the account currency');

select lives_ok($$
  insert into public.transactions (id, user_id, account_id, type, amount_minor, currency,
    original_amount_minor, original_currency, base_currency, base_amount_minor,
    base_fx_rate_date, base_fx_source, occurred_at, local_date, time_zone)
  values ('cccccccc-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111',
    'aaaaaaaa-0000-4000-8000-000000000001', 'expense', -500, 'USD', -500, 'USD', 'USD', -500,
    '2026-10-02', 'identity', now(), '2026-10-02', 'UTC')
$$, 'user can record an expense in the account currency');

select throws_ok($$
  update public.accounts set currency = 'EUR' where id = 'aaaaaaaa-0000-4000-8000-000000000001'
$$, '23514', null, 'account currency is locked once it has history');

select lives_ok($$
  insert into public.categories (id, user_id, parent_id, name, kind)
  select 'dddddddd-0000-4000-8000-0000000000c1', user_id, id, 'Pet food', 'expense'
  from public.categories where system_key = 'food'
$$, 'user can add a subcategory under an expense parent');

select throws_ok($$
  insert into public.categories (id, user_id, parent_id, name, kind)
  select 'dddddddd-0000-4000-8000-0000000000c2', user_id, id, 'Odd', 'income'
  from public.categories where system_key = 'food'
$$, '23514', null, 'subcategory kind must match its parent');

select throws_ok($$
  insert into public.categories (id, user_id, parent_id, name, kind)
  values ('dddddddd-0000-4000-8000-0000000000c3', '11111111-1111-4111-8111-111111111111', 'dddddddd-0000-4000-8000-0000000000c1', 'Too deep', 'expense')
$$, '23514', null, 'categories support one level of nesting');

select lives_ok($$
  update public.transactions set is_split = true, category_id = null where id = 'cccccccc-0000-4000-8000-000000000002';
  insert into public.transaction_splits (id, user_id, transaction_id, category_id, amount_minor, base_amount_minor)
  values
    ('eeeeeeee-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'cccccccc-0000-4000-8000-000000000002', 'dddddddd-0000-4000-8000-0000000000c1', -300, -300),
    ('eeeeeeee-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'cccccccc-0000-4000-8000-000000000002', 'dddddddd-0000-4000-8000-0000000000c1', -200, -200);
  insert into public.tags (id, user_id, name)
  values ('ffffffff-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Work');
  insert into public.transaction_tags (id, user_id, transaction_id, tag_id)
  values ('ffffffff-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'cccccccc-0000-4000-8000-000000000002', 'ffffffff-0000-4000-8000-000000000001');
  insert into public.category_rules (id, user_id, match_field, match_type, pattern, category_id)
  values ('ffffffff-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', 'payee', 'equals', 'walmart', 'dddddddd-0000-4000-8000-0000000000c1');
  insert into public.attachments (id, user_id, transaction_id, storage_path, mime_type, size_bytes, file_name)
  values ('ffffffff-0000-4000-8000-000000000004', '11111111-1111-4111-8111-111111111111', 'cccccccc-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111/r.jpg', 'image/jpeg', 1000, 'r.jpg')
$$, 'user can split, tag, add rules and attach receipts to own transactions');

select throws_ok($$
  insert into public.attachments (id, user_id, transaction_id, storage_path, mime_type, size_bytes, file_name)
  values ('ffffffff-0000-4000-8000-000000000005', '11111111-1111-4111-8111-111111111111', 'cccccccc-0000-4000-8000-000000000002', '22222222-2222-4222-8222-222222222222/r.jpg', 'image/jpeg', 1000, 'r.jpg')
$$, '23514', null, 'attachment paths must live in the owner''s folder');

-- ---- Phase 3 planning (user A) ----
select lives_ok($$
  insert into public.budgets (id, user_id, name, category_id, period_type, start_date, currency, amount_minor, rollover_enabled)
  values ('bbbbbbbb-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Pets', 'dddddddd-0000-4000-8000-0000000000c1', 'monthly', '2026-10-01', 'USD', 50000, true);
  insert into public.budget_revisions (id, user_id, budget_id, effective_from, amount_minor, rollover_enabled)
  values ('bbbbbbbb-0000-4000-8000-000000000011', '11111111-1111-4111-8111-111111111111', 'bbbbbbbb-0000-4000-8000-000000000001', '2026-10-01', 50000, true);
  insert into public.bills (id, user_id, name, account_id, category_id, amount_minor, currency, is_subscription,
    frequency, interval, anchor_date, next_due_date, reminder_days_before)
  values ('bbbbbbbb-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'Streaming', 'aaaaaaaa-0000-4000-8000-000000000001', 'dddddddd-0000-4000-8000-0000000000c1', 1599, 'USD', true, 'monthly', 1, '2026-10-31', '2026-10-31', 3);
  insert into public.bill_payments (id, user_id, bill_id, due_date, status, amount_minor, transaction_id)
  values ('bbbbbbbb-0000-4000-8000-000000000012', '11111111-1111-4111-8111-111111111111', 'bbbbbbbb-0000-4000-8000-000000000002', '2026-10-31', 'paid', 500, 'cccccccc-0000-4000-8000-000000000002');
  insert into public.savings_goals (id, user_id, name, target_amount_minor, currency)
  values ('bbbbbbbb-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', 'Vacation', 300000, 'USD');
  insert into public.goal_contributions (id, user_id, goal_id, amount_minor, currency, contributed_on, account_id)
  values ('bbbbbbbb-0000-4000-8000-000000000013', '11111111-1111-4111-8111-111111111111', 'bbbbbbbb-0000-4000-8000-000000000003', 50000, 'USD', '2026-10-08', 'aaaaaaaa-0000-4000-8000-000000000001')
$$, 'user can create budgets, revisions, bills, payments, goals and contributions');

select throws_ok($$
  insert into public.budgets (id, user_id, name, category_id, period_type, start_date, currency, amount_minor)
  select 'bbbbbbbb-0000-4000-8000-000000000021', user_id, 'Salary?', id, 'monthly', '2026-10-01', 'USD', 1
  from public.categories where system_key = 'salary'
$$, '23514', null, 'budgets can only target expense categories');

select throws_ok($$
  insert into public.bills (id, user_id, name, account_id, amount_minor, currency, frequency, interval, anchor_date, next_due_date)
  values ('bbbbbbbb-0000-4000-8000-000000000022', '11111111-1111-4111-8111-111111111111', 'Wrong', 'aaaaaaaa-0000-4000-8000-000000000001', 1, 'EUR', 'monthly', 1, '2026-10-01', '2026-10-01')
$$, '23514', null, 'bill currency must match its account');

select throws_ok($$
  insert into public.bills (id, user_id, name, amount_minor, currency, frequency, interval, anchor_date, next_due_date, end_date)
  values ('bbbbbbbb-0000-4000-8000-000000000023', '11111111-1111-4111-8111-111111111111', 'Bad end', 1, 'EUR', 'monthly', 1, '2026-10-01', '2026-10-01', '2026-09-01')
$$, '23514', null, 'bill end date cannot precede its anchor');

select throws_ok($$
  delete from public.budgets where id = 'bbbbbbbb-0000-4000-8000-000000000001'
$$, '42501', null, 'clients cannot hard-delete budgets');

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
$$, '23514', null, 'user cannot reference another user''s account (invisible to the currency check)');

select is_empty($$
  update public.user_preferences set region = 'US'
  where id = '11111111-1111-4111-8111-111111111111' returning id
$$, 'user cannot change another user''s preferences');

select is(
  (select count(*)::int from public.categories), 51, 'user sees only own categories');
select is_empty($$ select id from public.transaction_splits $$, 'user cannot read another user''s splits');
select is_empty($$ select id from public.transaction_tags $$, 'user cannot read another user''s tag links');
select is_empty($$ select id from public.category_rules $$, 'user cannot read another user''s rules');
select is_empty($$ select id from public.attachments $$, 'user cannot read another user''s attachments');

select throws_ok($$
  insert into public.transaction_splits (id, user_id, transaction_id, amount_minor, base_amount_minor)
  values ('eeeeeeee-0000-4000-8000-000000000009', '22222222-2222-4222-8222-222222222222', 'cccccccc-0000-4000-8000-000000000002', -1, -1)
$$, '23503', null, 'user cannot split another user''s transaction');

select throws_ok($$
  insert into public.category_rules (id, user_id, match_field, match_type, pattern, category_id)
  values ('ffffffff-0000-4000-8000-00000000000a', '22222222-2222-4222-8222-222222222222', 'payee', 'equals', 'x', 'dddddddd-0000-4000-8000-0000000000c1')
$$, '23503', null, 'user cannot use another user''s category');

select throws_ok($$
  insert into storage.objects (bucket_id, name) values ('attachments', '11111111-1111-4111-8111-111111111111/evil.jpg')
$$, '42501', null, 'user cannot upload into another user''s receipt folder');

select is_empty($$ select id from public.budgets $$, 'user cannot read another user''s budgets');
select is_empty($$ select id from public.budget_revisions $$, 'user cannot read another user''s budget revisions');
select is_empty($$ select id from public.bills $$, 'user cannot read another user''s bills or subscriptions');
select is_empty($$ select id from public.bill_payments $$, 'user cannot read another user''s bill payments');
select is_empty($$ select id from public.savings_goals $$, 'user cannot read another user''s goals');
select is_empty($$ select id from public.goal_contributions $$, 'user cannot read another user''s contributions');

select is_empty($$
  update public.budgets set amount_minor = 1 where id = 'bbbbbbbb-0000-4000-8000-000000000001' returning id
$$, 'user cannot change another user''s budget');
select is_empty($$
  update public.bills set reminder_days_before = 0 where id = 'bbbbbbbb-0000-4000-8000-000000000002' returning id
$$, 'user cannot change another user''s reminders');

select throws_ok($$
  insert into public.budget_revisions (id, user_id, budget_id, effective_from, amount_minor)
  values ('bbbbbbbb-0000-4000-8000-000000000031', '22222222-2222-4222-8222-222222222222', 'bbbbbbbb-0000-4000-8000-000000000001', '2026-11-01', 1)
$$, '23503', null, 'user cannot add a revision to another user''s budget');

select throws_ok($$
  insert into public.bill_payments (id, user_id, bill_id, due_date, status)
  values ('bbbbbbbb-0000-4000-8000-000000000032', '22222222-2222-4222-8222-222222222222', 'bbbbbbbb-0000-4000-8000-000000000002', '2026-11-30', 'paid')
$$, '23503', null, 'user cannot record a payment on another user''s bill');

select throws_ok($$
  insert into public.goal_contributions (id, user_id, goal_id, amount_minor, currency, contributed_on)
  values ('bbbbbbbb-0000-4000-8000-000000000033', '22222222-2222-4222-8222-222222222222', 'bbbbbbbb-0000-4000-8000-000000000003', 1, 'USD', '2026-10-08')
$$, '23503', null, 'user cannot contribute to another user''s goal');

select throws_ok($$
  insert into public.savings_goals (id, user_id, name, target_amount_minor, currency)
  values ('bbbbbbbb-0000-4000-8000-000000000034', '11111111-1111-4111-8111-111111111111', 'Not mine', 1, 'USD')
$$, '42501', null, 'user cannot create goals for someone else');

select throws_ok($$ select app.initialize_user('22222222-2222-4222-8222-222222222222') $$, '42501', null,
  'clients cannot call server-side user initialization');

-- ---- anonymous ----
reset role;
set local role anon;
select throws_ok($$ select * from public.accounts $$, '42501', null, 'anon has no access');

select * from finish();
rollback;
