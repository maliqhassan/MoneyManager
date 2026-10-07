# Database

Two schemas describe the same data:

- **Postgres (Supabase)** — `supabase/migrations/*.sql`: authority for integrity,
  ownership (RLS) and row versions.
- **SQLite (device)** — `src/database/migrations/*.ts`: what the app reads and
  writes; mirrors the Postgres tables plus local sync bookkeeping.

Any schema change needs **both** a Supabase migration and a local migration.
Local migrations are append-only and versioned with `PRAGMA user_version`.

## Conventions

| Concern | Postgres | SQLite |
| --- | --- | --- |
| ids | `uuid` (client-generated) | `TEXT` |
| money | `bigint` minor units, `abs ≤ 1e15` | `INTEGER` |
| exchange rates | `text` exact decimal (checked) | `TEXT` |
| timestamps | `timestamptz` | `TEXT` ISO-8601 |
| calendar dates | `date` | `TEXT` `YYYY-MM-DD` |
| booleans | `boolean` | `INTEGER 0/1` |
| JSON | `jsonb` | `TEXT` |

Rates are text because PostgREST serialises `numeric` as JSON numbers, which
would lose precision on the way to the client.

### Sync columns (every user-owned table)

| Column | Meaning |
| --- | --- |
| `user_id` | Owner; immutable (trigger). RLS: `user_id = auth.uid()` |
| `created_at` | Client creation time (kept) |
| `updated_at` | Server clock (`clock_timestamp()`), set by trigger; pull cursor |
| `deleted_at` | Soft-delete tombstone |
| `version` | Starts at 1, +1 per update (trigger); optimistic concurrency |
| `last_mutation_id` | Outbox entry id of the last client write; makes retries idempotent |
| `sync_status` | *(SQLite only)* `synced` \| `pending` \| `conflict` |

### Ownership integrity

Every parent table has `unique (id, user_id)`, and every reference is a composite
foreign key `(x_id, user_id) → parent(id, user_id)`. Foreign key checks bypass
RLS in Postgres, so without this a user could attach rows to someone else's
account by guessing its id.

## Entities

| Table | Purpose / notes |
| --- | --- |
| `profiles` | Display name, avatar. Created at sign-up. |
| `user_preferences` | Base currency, locale, time zone, first day of week, month start day. `id = user_id`; created at sign-up (server) so devices never race to create it. |
| `accounts` | cash, checking, savings, credit_card, debit_card, digital_wallet, loan, other. One currency each (immutable). Opening balance + date. Archive flag. |
| `categories` | Expense/income, one level of subcategories (`parent_id`), icon, color, `system_key` for seeded defaults (translated in-app). |
| `merchants` | Normalised payee names, default category. |
| `tags`, `transaction_tags` | Free-form labels. |
| `transactions` | One posting on one account (see below). |
| `transaction_splits` | Category breakdown; sums exactly to parent (domain-validated). |
| `transfers` | Groups the two transfer legs; supports cross-currency with actual received amount. |
| `category_rules` | contains / equals / starts_with on payee or notes (no regex — ReDoS). |
| `budgets`, `budget_allocations` | weekly / monthly / custom; overall and per-category limits; rollover flags. |
| `recurring_transactions` | Templates (daily/weekly/monthly/yearly × interval). |
| `bills`, `bill_payments` | Due dates, reminders, subscriptions; paid/unpaid per occurrence. |
| `savings_goals`, `goal_contributions` | Target, date, signed contributions. |
| `attachments` | Receipt metadata; file in private `attachments` bucket under `<user_id>/…`. |
| `import_batches`, `import_rows` | CSV import pipeline: mapping, preview, duplicates, errors. |
| `notifications` | In-app notification records. |
| `exchange_rates` | Reference data; readable by users, written only by service role. |

The "SyncEvent" concept is the local `sync_outbox` (plus `sync_cursors` and
`sync_conflicts`); see [offline-sync.md](offline-sync.md).

### Transactions and money

`amount_minor` is **signed in the account currency from the account's point of
view**: negative leaves the account, positive enters it. Balances are a plain sum:

```
balance = opening_balance_minor + Σ amount_minor (non-deleted)
```

Postgres enforces the sign per type: `expense < 0`, `income/refund > 0`,
`transfer` legs must reference a `transfer_id`.

Each transaction preserves:

| Field | Example (€20 coffee on a USD card, base AED) |
| --- | --- |
| `original_amount_minor`, `original_currency` | `-2000`, `EUR` — as entered, never overwritten |
| `amount_minor`, `currency`, `fx_rate` | `-2168`, `USD`, `1.084` — what hit the account |
| `base_amount_minor`, `base_currency` | `-7960`, `AED` |
| `base_fx_rate`, `base_fx_rate_date`, `base_fx_source` | `3.98`, `2026-10-06`, `ecb` |

Changing the base currency later never rewrites history. Reports in a new base
currency convert from the original/account amounts using `exchange_rates`;
snapshots remain the record of what was known at entry time.

`local_date` (+ `time_zone`) is fixed at entry, so budget periods and reports are
deterministic regardless of where the user travels later.

## Domain calculations (src/domain)

| Module | Provides |
| --- | --- |
| `money/money.ts` | `Money` type; add/subtract/sum/compare; `allocate` (largest remainder, never loses a cent); `multiply` by exact decimal |
| `money/decimal.ts` | BigInt decimal parsing, 5 rounding modes |
| `money/parse.ts` | Locale-aware user input → minor units (rejects extra decimals) |
| `money/conversion.ts` | Exact FX conversion across exponents; base-currency snapshots |
| `finance/balance.ts` | Account balance; total in base currency (reports missing rates) |
| `finance/cashflow.ts` | Income vs expenses (refunds net expenses, transfers excluded); savings rate |
| `finance/transfers.ts` | Balanced transfer legs; implied rate |
| `finance/splits.ts` | Split validation |
| `finance/budget.ts` | Periods (weekly/monthly with start day/custom), spending by category, rollover, progress, forecast |
| `dates/calendar.ts` | Pure `YYYY-MM-DD` arithmetic; local date in a time zone |

## Storage

Private bucket `attachments` (10 MB, jpeg/png/heic/webp/pdf). Policies only allow
objects under the caller's own `<user_id>/` folder.

## Account deletion

`delete-account` Edge Function: verifies the caller's JWT, removes their storage
folder, deletes the auth user. All tables cascade from `auth.users`.

## Verification

- `npx supabase test db` runs `supabase/tests/rls.test.sql` (pgTAP) against the
  local stack.
- The initial migration was also validated on embedded Postgres during the
  foundation phase: 29 checks covering bootstrap, RLS isolation, insert/update
  ownership, version bumps, stale-update conflict detection, no hard deletes,
  sign/rate checks, composite FKs, storage folder policies, anon denial and
  deletion cascade.
