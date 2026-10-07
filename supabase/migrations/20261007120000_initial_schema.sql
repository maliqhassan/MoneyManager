-- =============================================================================
-- Initial schema — personal finance core
--
-- Conventions (mirrored by the local SQLite schema in src/database/migrations):
--   * ids are client-generated UUIDs (offline creation, idempotent sync)
--   * money is BIGINT minor units; exchange rates are exact decimal TEXT
--   * every user-owned table has: user_id, created_at, updated_at, deleted_at
--     (soft delete), version (optimistic concurrency), last_mutation_id
--     (idempotent client retries)
--   * updated_at / version are maintained by trigger — never trusted from clients
--   * Row Level Security on every user-owned table; clients can never hard-delete
--   * cross-table references are composite (id, user_id) foreign keys, so a row
--     can only reference rows owned by the same user
-- =============================================================================

create schema if not exists app;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function app.is_decimal(value text)
returns boolean
language sql
immutable
as $$
  select value ~ '^[0-9]+(\.[0-9]{1,18})?$'
$$;

create or replace function app.is_currency(value text)
returns boolean
language sql
immutable
as $$
  select value ~ '^[A-Z]{3}$'
$$;

-- Maintains sync columns. Runs BEFORE INSERT OR UPDATE on every synced table.
create or replace function app.set_sync_columns()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    new.version := 1;
    new.created_at := coalesce(new.created_at, now());
  else
    -- Identity and ownership are immutable.
    new.id := old.id;
    new.user_id := old.user_id;
    new.created_at := old.created_at;
    new.version := old.version + 1;
  end if;
  -- clock_timestamp(): distinct, increasing values even within one transaction,
  -- which keeps the sync pull cursor (updated_at, id) well ordered.
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Profiles & preferences
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text check (char_length(display_name) <= 100),
  avatar_path text check (char_length(avatar_path) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.user_preferences (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version integer not null default 1,
  last_mutation_id uuid,
  base_currency text not null default 'USD' check (app.is_currency(base_currency)),
  locale text not null default 'en-US' check (char_length(locale) between 2 and 35),
  time_zone text not null default 'UTC' check (char_length(time_zone) between 1 and 64),
  first_day_of_week smallint not null default 1 check (first_day_of_week between 0 and 6),
  month_start_day smallint not null default 1 check (month_start_day between 1 and 28),
  -- Exactly one preferences row per user, sharing the user's id.
  constraint user_preferences_id_is_user check (id = user_id),
  unique (user_id)
);

-- ---------------------------------------------------------------------------
-- Accounts, categories, merchants, tags
-- ---------------------------------------------------------------------------

create table public.accounts (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version integer not null default 1,
  last_mutation_id uuid,
  name text not null check (char_length(name) between 1 and 100),
  type text not null check (type in ('cash', 'checking', 'savings', 'credit_card', 'debit_card', 'digital_wallet', 'loan', 'other')),
  currency text not null check (app.is_currency(currency)),
  opening_balance_minor bigint not null default 0 check (abs(opening_balance_minor) <= 1000000000000000),
  opening_balance_date date not null,
  credit_limit_minor bigint check (credit_limit_minor is null or credit_limit_minor between 0 and 1000000000000000),
  institution text check (char_length(institution) <= 100),
  color text check (color ~ '^#[0-9A-Fa-f]{6}$'),
  icon text check (char_length(icon) <= 64),
  notes text check (char_length(notes) <= 1000),
  include_in_totals boolean not null default true,
  is_archived boolean not null default false,
  sort_order integer not null default 0 check (sort_order >= 0),
  unique (id, user_id)
);

create table public.categories (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version integer not null default 1,
  last_mutation_id uuid,
  parent_id uuid,
  name text not null check (char_length(name) between 1 and 100),
  kind text not null check (kind in ('expense', 'income')),
  icon text check (char_length(icon) <= 64),
  color text check (color ~ '^#[0-9A-Fa-f]{6}$'),
  system_key text check (char_length(system_key) <= 64),
  is_archived boolean not null default false,
  sort_order integer not null default 0 check (sort_order >= 0),
  unique (id, user_id),
  foreign key (parent_id, user_id) references public.categories (id, user_id),
  check (parent_id is null or parent_id <> id)
);
create unique index categories_system_key_idx on public.categories (user_id, system_key) where system_key is not null;

create table public.merchants (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version integer not null default 1,
  last_mutation_id uuid,
  name text not null check (char_length(name) between 1 and 200),
  normalized_name text not null check (char_length(normalized_name) between 1 and 200),
  default_category_id uuid,
  unique (id, user_id),
  foreign key (default_category_id, user_id) references public.categories (id, user_id)
);

create table public.tags (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version integer not null default 1,
  last_mutation_id uuid,
  name text not null check (char_length(name) between 1 and 50),
  color text check (color ~ '^#[0-9A-Fa-f]{6}$'),
  unique (id, user_id)
);

-- ---------------------------------------------------------------------------
-- Transfers, recurring templates, imports (parents of transactions)
-- ---------------------------------------------------------------------------

create table public.transfers (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version integer not null default 1,
  last_mutation_id uuid,
  from_account_id uuid not null,
  to_account_id uuid not null,
  from_amount_minor bigint not null check (from_amount_minor between 1 and 1000000000000000),
  from_currency text not null check (app.is_currency(from_currency)),
  to_amount_minor bigint not null check (to_amount_minor between 1 and 1000000000000000),
  to_currency text not null check (app.is_currency(to_currency)),
  fx_rate text not null default '1' check (app.is_decimal(fx_rate)),
  occurred_at timestamptz not null,
  local_date date not null,
  notes text check (char_length(notes) <= 1000),
  unique (id, user_id),
  check (from_account_id <> to_account_id),
  foreign key (from_account_id, user_id) references public.accounts (id, user_id),
  foreign key (to_account_id, user_id) references public.accounts (id, user_id)
);

create table public.recurring_transactions (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version integer not null default 1,
  last_mutation_id uuid,
  account_id uuid not null,
  category_id uuid,
  type text not null check (type in ('expense', 'income', 'refund')),
  amount_minor bigint not null check (amount_minor <> 0 and abs(amount_minor) <= 1000000000000000),
  currency text not null check (app.is_currency(currency)),
  payee text check (char_length(payee) <= 200),
  notes text check (char_length(notes) <= 1000),
  frequency text not null check (frequency in ('daily', 'weekly', 'monthly', 'yearly')),
  interval integer not null default 1 check (interval between 1 and 365),
  start_date date not null,
  end_date date check (end_date is null or end_date >= start_date),
  next_occurrence_date date,
  auto_post boolean not null default false,
  time_zone text not null check (char_length(time_zone) between 1 and 64),
  is_active boolean not null default true,
  unique (id, user_id),
  foreign key (account_id, user_id) references public.accounts (id, user_id),
  foreign key (category_id, user_id) references public.categories (id, user_id)
);

create table public.import_batches (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version integer not null default 1,
  last_mutation_id uuid,
  source text not null default 'csv' check (source in ('csv')),
  file_name text not null check (char_length(file_name) between 1 and 255),
  account_id uuid,
  status text not null default 'draft' check (status in ('draft', 'mapped', 'previewed', 'committed', 'failed', 'reverted')),
  column_mapping jsonb,
  row_count integer not null default 0 check (row_count >= 0),
  imported_count integer not null default 0 check (imported_count >= 0),
  duplicate_count integer not null default 0 check (duplicate_count >= 0),
  error_count integer not null default 0 check (error_count >= 0),
  committed_at timestamptz,
  unique (id, user_id),
  foreign key (account_id, user_id) references public.accounts (id, user_id)
);

-- ---------------------------------------------------------------------------
-- Transactions
-- amount_minor is SIGNED in the account currency from the account's point of
-- view (negative = outflow). Original amount/currency and the base-currency
-- conversion snapshot are stored alongside and never overwritten.
-- ---------------------------------------------------------------------------

create table public.transactions (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version integer not null default 1,
  last_mutation_id uuid,
  account_id uuid not null,
  type text not null check (type in ('expense', 'income', 'transfer', 'refund')),
  amount_minor bigint not null check (amount_minor <> 0 and abs(amount_minor) <= 1000000000000000),
  currency text not null check (app.is_currency(currency)),
  original_amount_minor bigint not null check (abs(original_amount_minor) <= 1000000000000000),
  original_currency text not null check (app.is_currency(original_currency)),
  fx_rate text not null default '1' check (app.is_decimal(fx_rate)),
  base_currency text not null check (app.is_currency(base_currency)),
  base_amount_minor bigint not null check (abs(base_amount_minor) <= 1000000000000000),
  base_fx_rate text not null default '1' check (app.is_decimal(base_fx_rate)),
  base_fx_rate_date date not null,
  base_fx_source text not null check (char_length(base_fx_source) between 1 and 64),
  category_id uuid,
  merchant_id uuid,
  payee text check (char_length(payee) <= 200),
  notes text check (char_length(notes) <= 1000),
  occurred_at timestamptz not null,
  local_date date not null,
  time_zone text not null check (char_length(time_zone) between 1 and 64),
  is_split boolean not null default false,
  transfer_id uuid,
  refund_of_transaction_id uuid,
  recurring_transaction_id uuid,
  import_batch_id uuid,
  import_hash text check (char_length(import_hash) <= 128),
  unique (id, user_id),
  -- Sign rules: expenses leave the account, income and refunds enter it.
  check (
    (type = 'expense' and amount_minor < 0)
    or (type in ('income', 'refund') and amount_minor > 0)
    or (type = 'transfer' and transfer_id is not null)
  ),
  foreign key (account_id, user_id) references public.accounts (id, user_id),
  foreign key (category_id, user_id) references public.categories (id, user_id),
  foreign key (merchant_id, user_id) references public.merchants (id, user_id),
  foreign key (transfer_id, user_id) references public.transfers (id, user_id),
  foreign key (refund_of_transaction_id, user_id) references public.transactions (id, user_id),
  foreign key (recurring_transaction_id, user_id) references public.recurring_transactions (id, user_id),
  foreign key (import_batch_id, user_id) references public.import_batches (id, user_id)
);
create index transactions_user_date_idx on public.transactions (user_id, local_date desc);
create index transactions_account_idx on public.transactions (account_id, local_date desc);
create index transactions_category_idx on public.transactions (category_id);
create index transactions_transfer_idx on public.transactions (transfer_id) where transfer_id is not null;
create index transactions_import_hash_idx on public.transactions (user_id, import_hash) where import_hash is not null;

create table public.transaction_splits (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version integer not null default 1,
  last_mutation_id uuid,
  transaction_id uuid not null,
  category_id uuid,
  amount_minor bigint not null check (amount_minor <> 0 and abs(amount_minor) <= 1000000000000000),
  base_amount_minor bigint not null check (abs(base_amount_minor) <= 1000000000000000),
  notes text check (char_length(notes) <= 500),
  sort_order integer not null default 0 check (sort_order >= 0),
  unique (id, user_id),
  foreign key (transaction_id, user_id) references public.transactions (id, user_id),
  foreign key (category_id, user_id) references public.categories (id, user_id)
);
create index transaction_splits_transaction_idx on public.transaction_splits (transaction_id);

create table public.transaction_tags (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version integer not null default 1,
  last_mutation_id uuid,
  transaction_id uuid not null,
  tag_id uuid not null,
  unique (id, user_id),
  foreign key (transaction_id, user_id) references public.transactions (id, user_id),
  foreign key (tag_id, user_id) references public.tags (id, user_id)
);
create unique index transaction_tags_unique_idx on public.transaction_tags (transaction_id, tag_id) where deleted_at is null;

-- ---------------------------------------------------------------------------
-- Rules, budgets, bills, goals
-- ---------------------------------------------------------------------------

create table public.category_rules (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version integer not null default 1,
  last_mutation_id uuid,
  name text check (char_length(name) <= 100),
  match_field text not null check (match_field in ('payee', 'notes')),
  -- No regex matching: user-supplied patterns must not enable ReDoS.
  match_type text not null check (match_type in ('contains', 'equals', 'starts_with')),
  pattern text not null check (char_length(pattern) between 1 and 200),
  category_id uuid not null,
  merchant_id uuid,
  priority integer not null default 0,
  is_enabled boolean not null default true,
  unique (id, user_id),
  foreign key (category_id, user_id) references public.categories (id, user_id),
  foreign key (merchant_id, user_id) references public.merchants (id, user_id)
);

create table public.budgets (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version integer not null default 1,
  last_mutation_id uuid,
  name text not null check (char_length(name) between 1 and 100),
  period_type text not null check (period_type in ('weekly', 'monthly', 'custom')),
  start_date date not null,
  end_date date,
  currency text not null check (app.is_currency(currency)),
  amount_minor bigint check (amount_minor is null or amount_minor between 0 and 1000000000000000),
  rollover_enabled boolean not null default false,
  is_archived boolean not null default false,
  unique (id, user_id),
  check ((period_type = 'custom') = (end_date is not null)),
  check (end_date is null or end_date >= start_date)
);

create table public.budget_allocations (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version integer not null default 1,
  last_mutation_id uuid,
  budget_id uuid not null,
  category_id uuid not null,
  amount_minor bigint not null check (amount_minor between 0 and 1000000000000000),
  rollover_enabled boolean not null default false,
  unique (id, user_id),
  foreign key (budget_id, user_id) references public.budgets (id, user_id),
  foreign key (category_id, user_id) references public.categories (id, user_id)
);
create unique index budget_allocations_unique_idx on public.budget_allocations (budget_id, category_id) where deleted_at is null;

create table public.bills (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version integer not null default 1,
  last_mutation_id uuid,
  name text not null check (char_length(name) between 1 and 100),
  account_id uuid,
  category_id uuid,
  amount_minor bigint not null check (amount_minor between 0 and 1000000000000000),
  currency text not null check (app.is_currency(currency)),
  is_variable_amount boolean not null default false,
  is_subscription boolean not null default false,
  frequency text not null check (frequency in ('daily', 'weekly', 'monthly', 'yearly')),
  interval integer not null default 1 check (interval between 1 and 365),
  next_due_date date not null,
  reminder_days_before smallint check (reminder_days_before is null or reminder_days_before between 0 and 60),
  recurring_transaction_id uuid,
  notes text check (char_length(notes) <= 1000),
  is_active boolean not null default true,
  unique (id, user_id),
  foreign key (account_id, user_id) references public.accounts (id, user_id),
  foreign key (category_id, user_id) references public.categories (id, user_id),
  foreign key (recurring_transaction_id, user_id) references public.recurring_transactions (id, user_id)
);
create index bills_due_idx on public.bills (user_id, is_active, next_due_date);

create table public.bill_payments (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version integer not null default 1,
  last_mutation_id uuid,
  bill_id uuid not null,
  due_date date not null,
  status text not null default 'unpaid' check (status in ('unpaid', 'paid', 'skipped')),
  paid_at timestamptz,
  amount_minor bigint check (amount_minor is null or amount_minor between 0 and 1000000000000000),
  transaction_id uuid,
  unique (id, user_id),
  foreign key (bill_id, user_id) references public.bills (id, user_id),
  foreign key (transaction_id, user_id) references public.transactions (id, user_id)
);
create unique index bill_payments_unique_idx on public.bill_payments (bill_id, due_date) where deleted_at is null;

create table public.savings_goals (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version integer not null default 1,
  last_mutation_id uuid,
  name text not null check (char_length(name) between 1 and 100),
  target_amount_minor bigint not null check (target_amount_minor between 1 and 1000000000000000),
  currency text not null check (app.is_currency(currency)),
  target_date date,
  account_id uuid,
  icon text check (char_length(icon) <= 64),
  color text check (color ~ '^#[0-9A-Fa-f]{6}$'),
  status text not null default 'active' check (status in ('active', 'achieved', 'archived')),
  unique (id, user_id),
  foreign key (account_id, user_id) references public.accounts (id, user_id)
);

create table public.goal_contributions (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version integer not null default 1,
  last_mutation_id uuid,
  goal_id uuid not null,
  amount_minor bigint not null check (amount_minor <> 0 and abs(amount_minor) <= 1000000000000000),
  contributed_on date not null,
  transaction_id uuid,
  notes text check (char_length(notes) <= 500),
  unique (id, user_id),
  foreign key (goal_id, user_id) references public.savings_goals (id, user_id),
  foreign key (transaction_id, user_id) references public.transactions (id, user_id)
);

-- ---------------------------------------------------------------------------
-- Attachments, import rows, notifications
-- ---------------------------------------------------------------------------

create table public.attachments (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version integer not null default 1,
  last_mutation_id uuid,
  transaction_id uuid not null,
  -- Object path in the private "attachments" bucket: <user_id>/<attachment_id>.<ext>
  storage_path text not null check (char_length(storage_path) <= 500),
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/heic', 'image/webp', 'application/pdf')),
  size_bytes integer not null check (size_bytes between 1 and 10485760),
  file_name text not null check (char_length(file_name) between 1 and 255),
  unique (id, user_id),
  check (storage_path like user_id::text || '/%'),
  foreign key (transaction_id, user_id) references public.transactions (id, user_id)
);

create table public.import_rows (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version integer not null default 1,
  last_mutation_id uuid,
  batch_id uuid not null,
  row_index integer not null check (row_index >= 0),
  raw jsonb not null,
  local_date date,
  amount_minor bigint check (amount_minor is null or abs(amount_minor) <= 1000000000000000),
  currency text check (currency is null or app.is_currency(currency)),
  payee text check (char_length(payee) <= 200),
  notes text check (char_length(notes) <= 1000),
  category_id uuid,
  status text not null default 'pending' check (status in ('pending', 'duplicate', 'imported', 'skipped', 'error')),
  error text check (char_length(error) <= 200),
  import_hash text check (char_length(import_hash) <= 128),
  transaction_id uuid,
  duplicate_of_transaction_id uuid,
  unique (id, user_id),
  foreign key (batch_id, user_id) references public.import_batches (id, user_id),
  foreign key (category_id, user_id) references public.categories (id, user_id),
  foreign key (transaction_id, user_id) references public.transactions (id, user_id),
  foreign key (duplicate_of_transaction_id, user_id) references public.transactions (id, user_id)
);
create index import_rows_batch_idx on public.import_rows (batch_id, row_index);

create table public.notifications (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version integer not null default 1,
  last_mutation_id uuid,
  type text not null check (type in ('bill_due', 'budget_threshold', 'budget_exceeded', 'goal_milestone', 'sync_issue', 'system')),
  title text not null check (char_length(title) between 1 and 200),
  body text check (char_length(body) <= 1000),
  entity_type text check (char_length(entity_type) <= 64),
  entity_id uuid,
  scheduled_for timestamptz,
  read_at timestamptz,
  unique (id, user_id)
);

-- ---------------------------------------------------------------------------
-- Reference data: exchange rates (read-only for clients; written by an Edge
-- Function using the service role)
-- ---------------------------------------------------------------------------

create table public.exchange_rates (
  id uuid primary key default gen_random_uuid(),
  base_currency text not null check (app.is_currency(base_currency)),
  quote_currency text not null check (app.is_currency(quote_currency)),
  rate text not null check (app.is_decimal(rate) and rate !~ '^0+(\.0+)?$'),
  rate_date date not null,
  source text not null check (char_length(source) between 1 and 64),
  created_at timestamptz not null default now(),
  unique (base_currency, quote_currency, rate_date, source),
  check (base_currency <> quote_currency)
);
create index exchange_rates_lookup_idx on public.exchange_rates (base_currency, quote_currency, rate_date desc);

-- ---------------------------------------------------------------------------
-- Sync triggers, sync indexes and Row Level Security for every synced table
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
  synced_tables text[] := array[
    'user_preferences', 'accounts', 'categories', 'merchants', 'tags', 'transfers',
    'recurring_transactions', 'import_batches', 'transactions', 'transaction_splits',
    'transaction_tags', 'category_rules', 'budgets', 'budget_allocations', 'bills',
    'bill_payments', 'savings_goals', 'goal_contributions', 'attachments',
    'import_rows', 'notifications'
  ];
begin
  foreach t in array synced_tables loop
    execute format(
      'create trigger set_sync_columns before insert or update on public.%I
         for each row execute function app.set_sync_columns()', t);
    -- Incremental pull: WHERE user_id = ? AND (updated_at, id) > cursor ORDER BY updated_at, id
    execute format('create index %I on public.%I (user_id, updated_at, id)', t || '_sync_idx', t);

    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke delete, truncate on public.%I from authenticated', t);

    execute format(
      'create policy "Users read own rows" on public.%I for select to authenticated
         using (user_id = (select auth.uid()))', t);
    execute format(
      'create policy "Users insert own rows" on public.%I for insert to authenticated
         with check (user_id = (select auth.uid()))', t);
    execute format(
      'create policy "Users update own rows" on public.%I for update to authenticated
         using (user_id = (select auth.uid()))
         with check (user_id = (select auth.uid()))', t);
    -- No DELETE policy: clients soft-delete (deleted_at) so deletions sync.
  end loop;
end;
$$;

-- Profiles
alter table public.profiles enable row level security;
revoke all on public.profiles from anon;
revoke insert, delete, truncate on public.profiles from authenticated;
create policy "Users read own profile" on public.profiles
  for select to authenticated using (id = (select auth.uid()));
create policy "Users update own profile" on public.profiles
  for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

create or replace function app.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.id := old.id;
  new.created_at := old.created_at;
  new.updated_at := now();
  return new;
end;
$$;
create trigger touch_profiles_updated_at before update on public.profiles
  for each row execute function app.touch_updated_at();

-- Exchange rates: readable by signed-in users, writable only by service role.
alter table public.exchange_rates enable row level security;
revoke all on public.exchange_rates from anon;
revoke insert, update, delete, truncate on public.exchange_rates from authenticated;
create policy "Signed-in users read exchange rates" on public.exchange_rates
  for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- New-user bootstrap: profile, preferences and default categories.
-- Seeded server-side (not per device) so multiple devices never create
-- duplicate defaults. Category names are English fallbacks; the app shows a
-- translated name when system_key is set.
-- ---------------------------------------------------------------------------

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

  insert into public.categories (id, user_id, name, kind, icon, color, system_key, sort_order)
  select gen_random_uuid(), new.id, d.name, d.kind, d.icon, d.color, d.system_key, d.sort_order
  from (values
    ('Housing',          'expense', 'home-outline',           '#5B6CF0', 'housing',          0),
    ('Utilities',        'expense', 'flash-outline',          '#F2A93B', 'utilities',        1),
    ('Groceries',        'expense', 'cart-outline',           '#2FA36B', 'groceries',        2),
    ('Dining out',       'expense', 'restaurant-outline',     '#E8664A', 'dining',           3),
    ('Transport',        'expense', 'car-outline',            '#3A8DDE', 'transport',        4),
    ('Health',           'expense', 'medkit-outline',         '#D94C73', 'health',           5),
    ('Insurance',        'expense', 'shield-checkmark-outline','#6B7A90', 'insurance',       6),
    ('Shopping',         'expense', 'bag-handle-outline',     '#A65BD9', 'shopping',         7),
    ('Entertainment',    'expense', 'film-outline',           '#E04FA3', 'entertainment',    8),
    ('Subscriptions',    'expense', 'repeat-outline',         '#4FB3C7', 'subscriptions',    9),
    ('Travel',           'expense', 'airplane-outline',       '#1F9BD1', 'travel',          10),
    ('Education',        'expense', 'school-outline',         '#7F67D6', 'education',       11),
    ('Personal care',    'expense', 'sparkles-outline',       '#D97C4C', 'personal_care',   12),
    ('Gifts & donations','expense', 'gift-outline',           '#C9485B', 'gifts_donations', 13),
    ('Fees & charges',   'expense', 'receipt-outline',        '#8A94A6', 'fees',            14),
    ('Other expenses',   'expense', 'ellipsis-horizontal',    '#8A94A6', 'other_expense',   15),
    ('Salary',           'income',  'briefcase-outline',      '#2FA36B', 'salary',          16),
    ('Business',         'income',  'storefront-outline',     '#3A8DDE', 'business',        17),
    ('Investments',      'income',  'trending-up-outline',    '#5B6CF0', 'investment_income',18),
    ('Gifts received',   'income',  'gift-outline',           '#E04FA3', 'gifts_received',  19),
    ('Other income',     'income',  'ellipsis-horizontal',    '#8A94A6', 'other_income',    20)
  ) as d(name, kind, icon, color, system_key, sort_order);

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function app.handle_new_user();

-- ---------------------------------------------------------------------------
-- Storage: private "attachments" bucket (receipts). Objects live under a
-- folder named after the owner's user id; size and type are enforced here.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'attachments',
  'attachments',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/heic', 'image/webp', 'application/pdf']
)
on conflict (id) do nothing;

create policy "Users read own attachments" on storage.objects
  for select to authenticated
  using (bucket_id = 'attachments' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "Users upload own attachments" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'attachments' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "Users update own attachments" on storage.objects
  for update to authenticated
  using (bucket_id = 'attachments' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'attachments' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "Users delete own attachments" on storage.objects
  for delete to authenticated
  using (bucket_id = 'attachments' and (storage.foldername(name))[1] = (select auth.uid())::text);
