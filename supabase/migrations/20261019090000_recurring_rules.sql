-- Phase 7: recurring transaction rules, occurrences and duplicate prevention.
-- Additive only. Existing rows keep their values; backfills do not bump
-- versions (clients backfill the same values locally).

-- ---------------------------------------------------------------------------
-- Rules: status, effective start after a resume, reminder lead time, tags.
-- ---------------------------------------------------------------------------
alter table public.recurring_transactions
  add column status text not null default 'active'
    check (status in ('active', 'paused', 'ended')),
  add column active_from date,
  add column reminder_days_before integer
    check (reminder_days_before is null or reminder_days_before between 0 and 30),
  add column tag_names jsonb not null default '[]'::jsonb
    check (jsonb_typeof(tag_names) = 'array' and jsonb_array_length(tag_names) <= 20);

alter table public.recurring_transactions disable trigger set_sync_columns;
update public.recurring_transactions
  set status = case when is_active then 'active' else 'paused' end,
      active_from = start_date
  where active_from is null;
alter table public.recurring_transactions enable trigger set_sync_columns;
alter table public.recurring_transactions alter column active_from set not null;
alter table public.recurring_transactions
  add constraint recurring_active_from_after_start check (active_from >= start_date);

create index recurring_transactions_status_idx
  on public.recurring_transactions (user_id, status, next_occurrence_date);

-- ---------------------------------------------------------------------------
-- Generated transactions: which occurrence they belong to. One live
-- transaction per (rule, occurrence) across all devices.
-- ---------------------------------------------------------------------------
alter table public.transactions add column recurrence_date date;
alter table public.transactions
  add constraint transactions_recurrence_needs_rule
    check (recurrence_date is null or recurring_transaction_id is not null);
create unique index transactions_recurrence_unique_idx
  on public.transactions (recurring_transaction_id, recurrence_date)
  where deleted_at is null and recurring_transaction_id is not null and recurrence_date is not null;

-- ---------------------------------------------------------------------------
-- Occurrences: the user's decision for one scheduled date of a rule.
-- 'posted' (with the transaction it created) or 'skipped'. Once handled, an
-- occurrence is never due again, even if its transaction is later deleted.
-- ---------------------------------------------------------------------------
create table public.recurring_occurrences (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version integer not null default 1,
  last_mutation_id uuid,
  recurring_transaction_id uuid not null,
  occurrence_date date not null,
  status text not null check (status in ('posted', 'skipped')),
  transaction_id uuid,
  unique (id, user_id),
  check (status = 'posted' or transaction_id is null),
  foreign key (recurring_transaction_id, user_id)
    references public.recurring_transactions (id, user_id),
  foreign key (transaction_id, user_id) references public.transactions (id, user_id)
);
create unique index recurring_occurrences_unique_idx
  on public.recurring_occurrences (recurring_transaction_id, occurrence_date)
  where deleted_at is null;
create index recurring_occurrences_transaction_idx
  on public.recurring_occurrences (transaction_id);

create trigger set_sync_columns before insert or update on public.recurring_occurrences
  for each row execute function app.set_sync_columns();
create index recurring_occurrences_sync_idx
  on public.recurring_occurrences (user_id, updated_at, id);
alter table public.recurring_occurrences enable row level security;
revoke all on public.recurring_occurrences from anon;
revoke delete, truncate on public.recurring_occurrences from authenticated;
create policy "Users read own rows" on public.recurring_occurrences for select to authenticated
  using (user_id = (select auth.uid()));
create policy "Users insert own rows" on public.recurring_occurrences for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "Users update own rows" on public.recurring_occurrences for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- A rule produces income or expenses only, in its account's currency. On
-- update this is re-checked only when type, currency or account change: clients
-- PATCH whole rows, and a status-only change must not be rejected because the
-- account's currency was changed after the rule was created. search_path is
-- pinned; every object is schema-qualified.
create or replace function app.check_recurring_rule()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.type not in ('expense', 'income') then
    raise exception 'Recurring rules produce income or expenses only' using errcode = '23514';
  end if;
  if new.currency is distinct from
     (select a.currency from public.accounts a where a.id = new.account_id) then
    raise exception 'Rule currency must equal the account currency' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger check_recurring_rule_insert
  before insert on public.recurring_transactions
  for each row execute function app.check_recurring_rule();
create trigger check_recurring_rule_update
  before update of type, currency, account_id on public.recurring_transactions
  for each row
  when (old.type is distinct from new.type
        or old.currency is distinct from new.currency
        or old.account_id is distinct from new.account_id)
  execute function app.check_recurring_rule();
