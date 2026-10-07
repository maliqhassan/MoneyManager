-- =============================================================================
-- Phase 2 — transactions & categories
-- Mirrors src/database/migrations/003_transactions.ts. Additive and
-- idempotent for existing users: no data is removed.
--
-- 1. transactions.merchant_key (normalised merchant for rules/history)
-- 2. hierarchical default categories (seed table + idempotent seeding,
--    backfilled for existing users; legacy flat defaults are nested)
-- 3. integrity triggers that cannot be expressed as constraints:
--    - subcategories: same kind as parent, one level deep
--    - a transaction's currency equals its account's currency
--    - an account's currency is immutable once it has history
-- RLS on all tables is unchanged (covers the new column automatically).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Merchant key
-- ---------------------------------------------------------------------------

alter table public.transactions
  add column merchant_key text check (char_length(merchant_key) <= 200);

create index transactions_merchant_idx
  on public.transactions (user_id, merchant_key, local_date desc)
  where merchant_key is not null;

create index transaction_splits_category_idx on public.transaction_splits (category_id);
create index transaction_tags_tag_idx on public.transaction_tags (tag_id);
create index category_rules_category_idx on public.category_rules (category_id);

-- ---------------------------------------------------------------------------
-- 2. Default categories
-- Keep in sync with src/domain/categories/defaults.ts (client translations).
-- ---------------------------------------------------------------------------

create table app.default_categories (
  key text primary key,
  parent_key text references app.default_categories (key),
  kind text not null check (kind in ('expense', 'income')),
  name text not null,
  icon text not null,
  color text not null,
  sort_order integer not null
);

insert into app.default_categories (key, parent_key, kind, name, icon, color, sort_order) values
  ('housing', null, 'expense', 'Housing', 'home-outline', '#2F55D4', 0),
  ('rent', 'housing', 'expense', 'Rent', 'key-outline', '#2F55D4', 1),
  ('mortgage', 'housing', 'expense', 'Mortgage', 'business-outline', '#2F55D4', 2),
  ('home_maintenance', 'housing', 'expense', 'Home maintenance', 'hammer-outline', '#2F55D4', 3),
  ('food', null, 'expense', 'Food', 'restaurant-outline', '#13774F', 4),
  ('groceries', 'food', 'expense', 'Groceries', 'cart-outline', '#13774F', 5),
  ('dining', 'food', 'expense', 'Restaurants', 'fast-food-outline', '#13774F', 6),
  ('coffee', 'food', 'expense', 'Coffee', 'cafe-outline', '#13774F', 7),
  ('transport', null, 'expense', 'Transportation', 'car-outline', '#0E7490', 8),
  ('fuel', 'transport', 'expense', 'Fuel', 'speedometer-outline', '#0E7490', 9),
  ('public_transport', 'transport', 'expense', 'Public transport', 'bus-outline', '#0E7490', 10),
  ('taxi_rideshare', 'transport', 'expense', 'Taxi & rideshare', 'car-sport-outline', '#0E7490', 11),
  ('car_maintenance', 'transport', 'expense', 'Car maintenance', 'construct-outline', '#0E7490', 12),
  ('utilities', null, 'expense', 'Bills & utilities', 'flash-outline', '#B45309', 13),
  ('electricity', 'utilities', 'expense', 'Electricity', 'bulb-outline', '#B45309', 14),
  ('water', 'utilities', 'expense', 'Water', 'water-outline', '#B45309', 15),
  ('internet', 'utilities', 'expense', 'Internet', 'wifi-outline', '#B45309', 16),
  ('mobile_phone', 'utilities', 'expense', 'Mobile phone', 'phone-portrait-outline', '#B45309', 17),
  ('shopping', null, 'expense', 'Shopping', 'bag-handle-outline', '#6B46C1', 18),
  ('clothing', 'shopping', 'expense', 'Clothing', 'shirt-outline', '#6B46C1', 19),
  ('electronics', 'shopping', 'expense', 'Electronics', 'laptop-outline', '#6B46C1', 20),
  ('personal_care', 'shopping', 'expense', 'Personal care', 'sparkles-outline', '#6B46C1', 21),
  ('health', null, 'expense', 'Health', 'medkit-outline', '#C02A35', 22),
  ('medical', 'health', 'expense', 'Medical', 'pulse-outline', '#C02A35', 23),
  ('pharmacy', 'health', 'expense', 'Pharmacy', 'bandage-outline', '#C02A35', 24),
  ('insurance', 'health', 'expense', 'Insurance', 'shield-checkmark-outline', '#C02A35', 25),
  ('entertainment', null, 'expense', 'Entertainment', 'film-outline', '#BE185D', 26),
  ('movies', 'entertainment', 'expense', 'Movies', 'videocam-outline', '#BE185D', 27),
  ('games', 'entertainment', 'expense', 'Games', 'game-controller-outline', '#BE185D', 28),
  ('events', 'entertainment', 'expense', 'Events', 'ticket-outline', '#BE185D', 29),
  ('travel', null, 'expense', 'Travel', 'airplane-outline', '#1E3A8A', 30),
  ('flights', 'travel', 'expense', 'Flights', 'airplane-outline', '#1E3A8A', 31),
  ('hotels', 'travel', 'expense', 'Hotels', 'bed-outline', '#1E3A8A', 32),
  ('travel_other', 'travel', 'expense', 'Other travel', 'map-outline', '#1E3A8A', 33),
  ('education', null, 'expense', 'Education', 'school-outline', '#2F55D4', 34),
  ('subscriptions', null, 'expense', 'Subscriptions', 'repeat-outline', '#0E7490', 35),
  ('financial', null, 'expense', 'Financial', 'card-outline', '#4D5868', 36),
  ('fees', 'financial', 'expense', 'Bank fees', 'receipt-outline', '#4D5868', 37),
  ('interest_paid', 'financial', 'expense', 'Interest', 'trending-down-outline', '#4D5868', 38),
  ('family', null, 'expense', 'Family', 'people-outline', '#B45309', 39),
  ('gifts_donations', null, 'expense', 'Gifts & donations', 'gift-outline', '#BE185D', 40),
  ('other_expense', null, 'expense', 'Other', 'ellipsis-horizontal', '#4D5868', 41),
  ('salary', null, 'income', 'Salary', 'briefcase-outline', '#13774F', 42),
  ('freelance', null, 'income', 'Freelance', 'laptop-outline', '#13774F', 43),
  ('business', null, 'income', 'Business', 'storefront-outline', '#0E7490', 44),
  ('investment_income', null, 'income', 'Investment income', 'trending-up-outline', '#2F55D4', 45),
  ('interest_income', null, 'income', 'Interest', 'cash-outline', '#2F55D4', 46),
  ('rental_income', null, 'income', 'Rental income', 'home-outline', '#6B46C1', 47),
  ('refunds_income', null, 'income', 'Refunds', 'arrow-undo-outline', '#4D5868', 48),
  ('gifts_received', null, 'income', 'Gifts', 'gift-outline', '#BE185D', 49),
  ('other_income', null, 'income', 'Other', 'ellipsis-horizontal', '#4D5868', 50);

-- Inserts any missing default categories for a user, then nests legacy flat
-- defaults (from the initial schema) under their new parents and renames
-- them only if the user has not renamed them. Safe to run repeatedly.
create or replace function app.seed_default_categories(target_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.categories (id, user_id, name, kind, icon, color, system_key, sort_order)
  select gen_random_uuid(), target_user, d.name, d.kind, d.icon, d.color, d.key, d.sort_order
  from app.default_categories d
  where d.parent_key is null
    and not exists (
      select 1 from public.categories c where c.user_id = target_user and c.system_key = d.key
    );

  insert into public.categories (id, user_id, parent_id, name, kind, icon, color, system_key, sort_order)
  select gen_random_uuid(), target_user, p.id, d.name, d.kind, d.icon, d.color, d.key, d.sort_order
  from app.default_categories d
  join public.categories p on p.user_id = target_user and p.system_key = d.parent_key
  where d.parent_key is not null
    and not exists (
      select 1 from public.categories c where c.user_id = target_user and c.system_key = d.key
    );

  -- Legacy flat defaults (groceries, dining, insurance, personal_care, fees)
  -- become subcategories, unless the user already nested them elsewhere.
  update public.categories c
  set parent_id = p.id
  from app.default_categories d
  join public.categories p on p.system_key = d.parent_key
  where c.user_id = target_user
    and p.user_id = target_user
    and c.system_key = d.key
    and d.parent_key is not null
    and c.parent_id is null
    and c.deleted_at is null
    and not exists (select 1 from public.categories ch where ch.parent_id = c.id);

  -- Rename legacy defaults only where the original seeded name is untouched.
  update public.categories c
  set name = d.name, sort_order = d.sort_order
  from app.default_categories d,
       (values
         ('dining', 'Dining out'),
         ('transport', 'Transport'),
         ('utilities', 'Utilities'),
         ('fees', 'Fees & charges'),
         ('other_expense', 'Other expenses'),
         ('investment_income', 'Investments'),
         ('gifts_received', 'Gifts received'),
         ('other_income', 'Other income')
       ) as legacy(key, old_name)
  where c.user_id = target_user
    and c.system_key = legacy.key
    and d.key = legacy.key
    and c.name = legacy.old_name;
end;
$$;

-- New users: profile, preferences, then the default category tree.
create or replace function app.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested_currency text := upper(coalesce(new.raw_user_meta_data ->> 'base_currency', ''));
begin
  insert into public.profiles (id) values (new.id);

  insert into public.user_preferences (id, user_id, base_currency)
  values (
    new.id,
    new.id,
    case when requested_currency ~ '^[A-Z]{3}$' then requested_currency else 'USD' end
  );

  perform app.seed_default_categories(new.id);
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Integrity triggers
-- ---------------------------------------------------------------------------

create or replace function app.check_category_parent()
returns trigger
language plpgsql
as $$
declare
  parent record;
begin
  if new.parent_id is null then
    return new;
  end if;
  select kind, parent_id into parent from public.categories where id = new.parent_id;
  if parent.kind is distinct from new.kind then
    raise exception 'Subcategory kind must match its parent' using errcode = '23514';
  end if;
  if parent.parent_id is not null then
    raise exception 'Categories support one level of nesting' using errcode = '23514';
  end if;
  if exists (
    select 1 from public.categories ch
    where ch.parent_id = new.id and ch.deleted_at is null
  ) then
    raise exception 'A category with subcategories cannot become a subcategory' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger check_category_parent
  before insert or update of parent_id, kind on public.categories
  for each row execute function app.check_category_parent();

create or replace function app.check_transaction_currency()
returns trigger
language plpgsql
as $$
begin
  if new.currency is distinct from (select a.currency from public.accounts a where a.id = new.account_id) then
    raise exception 'Transaction currency must equal the account currency' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger check_transaction_currency
  before insert or update of currency, account_id on public.transactions
  for each row execute function app.check_transaction_currency();

create or replace function app.check_account_currency_change()
returns trigger
language plpgsql
as $$
begin
  if new.currency is distinct from old.currency and (
    exists (select 1 from public.transactions t where t.account_id = old.id and t.deleted_at is null)
    or exists (
      select 1 from public.transfers tr
      where (tr.from_account_id = old.id or tr.to_account_id = old.id) and tr.deleted_at is null
    )
  ) then
    raise exception 'Account currency cannot change once it has history' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger check_account_currency_change
  before update of currency on public.accounts
  for each row execute function app.check_account_currency_change();

-- ---------------------------------------------------------------------------
-- Backfill existing users with the expanded default categories.
-- ---------------------------------------------------------------------------

select app.seed_default_categories(u.id) from auth.users u;
