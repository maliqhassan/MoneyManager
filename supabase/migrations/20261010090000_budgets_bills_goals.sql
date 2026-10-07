-- =============================================================================
-- Phase 3 — budgets, bills/subscriptions, savings goals
--
-- Builds on the planning tables created by the initial schema (budgets, bills,
-- bill_payments, savings_goals, goal_contributions). Additive; existing rows
-- are backfilled. Mirrored locally by src/database/migrations/004_planning.ts.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Budgets: scope + amount revisions
-- ---------------------------------------------------------------------------

-- NULL = overall budget (all spending); otherwise one expense category,
-- including its subcategories.
alter table public.budgets add column category_id uuid;
alter table public.budgets
  add constraint budgets_category_fk
  foreign key (category_id, user_id) references public.categories (id, user_id);
create index budgets_scope_idx on public.budgets (user_id, is_archived, category_id)
  where deleted_at is null;

-- Amount and rollover per period, effective from a period start. Editing a
-- budget appends/updates a revision for the current period instead of
-- rewriting the limit of periods that already happened.
create table public.budget_revisions (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version integer not null default 1,
  last_mutation_id uuid,
  budget_id uuid not null,
  effective_from date not null,
  amount_minor bigint not null check (amount_minor between 0 and 1000000000000000),
  rollover_enabled boolean not null default false,
  unique (id, user_id),
  foreign key (budget_id, user_id) references public.budgets (id, user_id)
);
create index budget_revisions_budget_idx on public.budget_revisions (budget_id, effective_from);

create trigger set_sync_columns before insert or update on public.budget_revisions
  for each row execute function app.set_sync_columns();
create index budget_revisions_sync_idx on public.budget_revisions (user_id, updated_at, id);
alter table public.budget_revisions enable row level security;
revoke all on public.budget_revisions from anon;
revoke delete, truncate on public.budget_revisions from authenticated;
create policy "Users read own rows" on public.budget_revisions for select to authenticated
  using (user_id = (select auth.uid()));
create policy "Users insert own rows" on public.budget_revisions for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "Users update own rows" on public.budget_revisions for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Existing budgets get their first revision.
insert into public.budget_revisions (id, user_id, budget_id, effective_from, amount_minor, rollover_enabled)
select gen_random_uuid(), b.user_id, b.id, b.start_date, b.amount_minor, b.rollover_enabled
from public.budgets b
where b.amount_minor is not null and b.deleted_at is null;

-- A budget's category must be an expense category.
create or replace function app.check_budget_category()
returns trigger
language plpgsql
as $$
begin
  if new.category_id is not null and not exists (
    select 1 from public.categories c where c.id = new.category_id and c.kind = 'expense'
  ) then
    raise exception 'Budgets can only target expense categories' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger check_budget_category
  before insert or update of category_id on public.budgets
  for each row execute function app.check_budget_category();

-- ---------------------------------------------------------------------------
-- Bills & subscriptions: schedule anchor, end date, autopay
-- ---------------------------------------------------------------------------

-- Backfills below must not bump versions (clients backfill the same values
-- locally), so the sync trigger is paused for them.
alter table public.bills add column anchor_date date;
alter table public.bills disable trigger set_sync_columns;
update public.bills set anchor_date = next_due_date where anchor_date is null;
alter table public.bills enable trigger set_sync_columns;
alter table public.bills alter column anchor_date set not null;
alter table public.bills add column end_date date;
alter table public.bills add column autopay boolean not null default false;
alter table public.bills
  add constraint bills_end_after_anchor check (end_date is null or end_date >= anchor_date);
create index bills_account_idx on public.bills (account_id);
create index bill_payments_transaction_idx on public.bill_payments (transaction_id);

-- When a bill names an account, it must be in that account's currency.
create or replace function app.check_bill_currency()
returns trigger
language plpgsql
as $$
begin
  if new.account_id is not null and new.currency is distinct from
     (select a.currency from public.accounts a where a.id = new.account_id) then
    raise exception 'Bill currency must equal the account currency' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger check_bill_currency
  before insert or update of currency, account_id on public.bills
  for each row execute function app.check_bill_currency();

-- ---------------------------------------------------------------------------
-- Savings goals: contribution currency, account and transfer link
-- ---------------------------------------------------------------------------

alter table public.goal_contributions add column currency text;
alter table public.goal_contributions disable trigger set_sync_columns;
update public.goal_contributions gc
  set currency = g.currency
  from public.savings_goals g
  where g.id = gc.goal_id and gc.currency is null;
alter table public.goal_contributions enable trigger set_sync_columns;
alter table public.goal_contributions alter column currency set not null;
alter table public.goal_contributions
  add constraint goal_contributions_currency_check check (app.is_currency(currency));
alter table public.goal_contributions add column account_id uuid;
alter table public.goal_contributions add column transfer_id uuid;
alter table public.goal_contributions
  add constraint goal_contributions_account_fk
  foreign key (account_id, user_id) references public.accounts (id, user_id);
alter table public.goal_contributions
  add constraint goal_contributions_transfer_fk
  foreign key (transfer_id, user_id) references public.transfers (id, user_id);
create index goal_contributions_goal_idx on public.goal_contributions (goal_id, contributed_on);
create index goal_contributions_transfer_idx on public.goal_contributions (transfer_id);
create index savings_goals_status_idx on public.savings_goals (user_id, status, target_date)
  where deleted_at is null;
