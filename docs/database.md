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
| `user_preferences` | Base currency, region, language, locale (formatting), date format, number format, time zone, first day of week, month start day, `onboarding_completed_at`. `id = user_id`; created at sign-up (server) so devices never race to create it. Region is only ever user-confirmed (never IP-derived). |
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
| `exchange_rates` | Server: reference data, readable by users, written only by service role (no writer yet). Local: the device's rate cache — provider rows and the user's manual rates (see [exchange-rates.md](exchange-rates.md)); not synced. |

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
| `base_fx_rate`, `base_fx_rate_date`, `base_fx_source` | `3.98`, `2026-10-06`, `frankfurter:cross` — the rate used, its own date and source |

Changing the base currency later never rewrites history. Reports in a new base
currency convert from the original/account amounts using `exchange_rates`
(the rate for each entry's date — see [exchange-rates.md](exchange-rates.md));
snapshots remain the record of what was known at entry time, and a later rate
never rewrites one.

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
| `dates/zoned.ts` | Wall-clock date + time in an IANA zone → UTC instant (DST gaps move forward, repeated times take the first occurrence) |
| `transactions/transactions.ts` | Signs by entry type, split base allocation and remaining, day grouping, amount-filter bounds per currency exponent |
| `transactions/insights.ts` | Period cash flow and top categories in the base currency (missing rates reported, never guessed) |
| `merchants/normalize.ts` | Merchant key ("WALMART #1234", "Wal-Mart" → `walmart`) |
| `categorization/suggest.ts` | Deterministic category suggestion: rules by priority, then the merchant's last category |
| `text/search.ts` | Locale-safe search normalisation (case, diacritics, ß) and LIKE escaping |
| `planning/budgets.ts` | Budget periods, revisions, rollover chain, linear pace and status |
| `planning/recurrence.ts` | Bill/subscription schedules from an anchor (month-end safe), monthly/yearly cost (exact or flagged approximate) |
| `planning/bills.ts` | Due status (overdue / due today / upcoming) in local days, next due date after payment |
| `planning/goals.ts` | Goal progress, overfunding, suggested monthly contribution |

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
  deletion cascade. Phase 2 extended it (category tree seed + backfill of
  existing users, idempotent re-seed, integrity triggers, RLS for splits, tags,
  rules and attachments).
- `rls.test.sql` itself (50 assertions, incl. Phase 3 planning tables) was
  executed on embedded Postgres with a minimal pgTAP shim and Supabase
  auth/storage stubs; it has not yet been run against a real Supabase stack.
- The Phase 3 migration was also applied on top of a Phase 2 database with
  existing bills, budgets and contributions (backfills checked, no version
  bumps).

## Migrations

| # | Supabase | Local | Change |
| --- | --- | --- | --- |
| 1 | `20261007120000_initial_schema.sql` | `001_initial.ts` | Core schema, RLS, triggers, storage |
| 2 | `20261008090000_regional_preferences.sql` | `002_regional_preferences.ts` | `region`, `language`, `date_format`, `number_format`, `onboarding_completed_at`; locale/time-zone format checks |
| 3 | `20261009090000_transactions_categories.sql` | `003_transactions.ts` | `transactions.merchant_key`; local-only `search_text`; list/filter indexes; default category tree (`app.default_categories`, `app.seed_default_categories`, backfill); triggers for category parents, transaction currency and account-currency lock |
| 4 | `20261010090000_budgets_bills_goals.sql` | `004_planning.ts` | `budgets.category_id`; `budget_revisions` (amount + rollover from an effective date); `bills.anchor_date`, `end_date`, `autopay`; `goal_contributions.currency`, `account_id`, `transfer_id`; triggers for budget category kind and bill currency; backfills without version bumps |
| 6 | `20261019090000_recurring_rules.sql` | `006_recurring.ts` | `recurring_transactions.status`, `active_from`, `reminder_days_before`, `tag_names`; `transactions.recurrence_date` with unique (rule, date) for live rows; synced `recurring_occurrences` (posted/skipped, unique per rule and date, RLS); trigger: rules are income/expense in the account currency. See [recurring.md](recurring.md). |
| 5 | — (local only) | `005_exchange_rates.ts` | Device rate cache: `exchange_rates.kind` (provider/manual), `fetched_at`, `attribution`; local `fx_fetch_log` (refresh throttling, requested ranges). No synced schema changes. |

Deploy order: **apply the Supabase migration before shipping an app build that
uses it** — the app pushes the new columns, and PostgREST rejects unknown
columns (such pushes are retried, then parked as failed).

## Accounts: rules

- Balance = opening balance + Σ non-deleted postings (SQL `SUM` of integers;
  opening balance added in the domain layer).
- Liabilities (credit cards, loans) hold negative balances; users enter the
  amount *owed* and `domain/accounts.openingBalanceFromEntry` stores it negated.
- A card payment is a **transfer** (two legs), never a second expense — see
  `domain/accounts/__tests__/accounts.test.ts`.
- Currency is immutable once any transaction or transfer references the
  account (`AccountRepository.changeCurrency` enforces it); history is never
  converted.
- Accounts with history can only be archived. Archived accounts keep their
  history and balances, disappear from active lists and totals, and must be
  restored before receiving transactions (`canReceiveTransactions`).
- Totals are per currency; a combined base-currency total is shown only when
  every needed rate exists in `exchange_rates` (direct, inverse or via USD;
  the latest cached rate, labelled stale when old). Missing rates are
  reported, never guessed.

## Transactions & categories: rules

- Entry types: `expense` (negative), `income` and `refund` (positive),
  `transfer` legs (one negative, one positive, sharing a `transfers` row).
  Forms take positive magnitudes; `domain/transactions.signedAmount` applies the
  sign. A refund may link to the expense it reverses (`refund_of_transaction_id`).
- A transfer is written as the `transfers` row plus both legs in one SQLite
  transaction; editing or deleting one leg edits/deletes the pair. Cross-currency
  transfers record the amount received; there is no guessed rate.
- `transactions.currency` always equals the account currency (trigger). Account
  currency cannot change once the account has transactions or transfers.
- Archived accounts cannot receive new transactions; existing ones stay
  editable. Archived categories cannot be chosen for new entries (except the one
  already on an entry being edited).
- Splits: at least two lines that sum **exactly** to the total; base amounts are
  allocated with largest remainder so the split base total equals the parent's.
  Category spending and filters read split lines, never the parent.
- Base-currency snapshot at entry: identity when currencies match, otherwise the
  latest rate on or before the entry date (direct or inverse). With no rate the
  amount is stored with `base_fx_source = 'unconverted'` and excluded from
  base totals, which then say they are incomplete.
- `local_date` + `time_zone` are set at entry; `occurred_at` is derived from the
  wall-clock time in that zone. Lists group and paginate by
  `(local_date, occurred_at, id)` (keyset).
- Categories: one nesting level, parent and child share the kind. Defaults are
  created **only on the server** (sign-up trigger + backfill), so devices cannot
  create duplicates; `system_key` drives translation while the seeded name is
  unchanged. Archiving a parent archives its children; restoring a child needs
  an active parent. Delete is allowed only when no transaction, split, budget
  allocation or rule uses the category and it has no subcategories.
- Search uses the local-only `search_text` column (normalised merchant + notes,
  derived again on pull) plus category and tag names.

## Budgets, bills & goals: rules

- **Budget scope**: one expense category including its subcategories, or all
  spending (`category_id` NULL). One active budget per scope, period type and
  currency (custom budgets: per exact date range); budgets with different
  scopes may overlap and each counts its own spending.
- **Budget spending** is derived from transactions: expenses add, refunds
  subtract; income, transfers and credit-card payments (transfers) never
  count. Split transactions contribute their split lines. Other currencies use
  the transaction's base snapshot when it is in the budget currency, else a
  known rate on the transaction date; with no rate the amount is excluded and
  the result marked incomplete.
- **Periods** use the user's first day of week and month start day; dates are
  local calendar dates (`local_date`), so time zones and DST never move a
  transaction between periods. Recurring budgets start on a period boundary.
- **Revisions**: amount and rollover are stored per effective date. Once a
  period has completed, scope/period/currency are locked and edits apply from
  the current period; past periods are reproducible. A budget pulled before
  its revisions uses its own amount until they arrive.
- **Rollover**: `carryOut = rollover ? max(0, available − spent) : 0`;
  overspending is absorbed, never carried as a negative.
- **Status**: over if spent > available; warning if ≥ 80% used or more than
  10% of the budget ahead of a linear pace; otherwise on track. A measurement,
  not advice.
- **Bills** are expected commitments, never transactions. Occurrences are
  computed from `anchor_date` (31st → last day of shorter months). Paying
  records a normal expense + `bill_payments` row in one write (transaction
  queued first) and advances `next_due_date` past already-settled dates.
  Deleting the paying transaction removes the payment and reopens that due
  date. A bill whose schedule ends becomes inactive after its last payment.
  A bill with an account must use the account's currency.
- **Reminders** (`reminder_days_before`) are stored only; no device
  notifications are scheduled yet.
- **Goals**: a contribution records money set aside (any currency, converted
  with known rates). It never changes a balance; a transfer recorded with it
  (or linked later) does. Removing a contribution keeps its transfer. Goal
  currency is fixed once contributions exist. Completion is derived
  (saved ≥ target); overfunding is shown, not capped.

## Reports: rules

- **Source**: the local SQLite database (works offline; unsynced entries are
  included once — sync never duplicates rows, which are keyed by id).
- **Periods** (`domain/reports/periods.ts`): inclusive `local_date` ranges in
  the user's time zone and first day of week. Periods containing today run
  to today and are compared with the same elapsed span of the previous
  period (month-ends clamp); completed periods compare with the previous
  completed period; custom ranges with the equal-length range before them.
- **Income** = income entries. **Spending** = expenses − refunds (refunds
  reduce the spending of their own category/merchant; never income).
  Transfers — including credit-card payments and goal transfers — are never
  income or spending; goal contributions are planning records.
- **Splits**: category reports use split lines; totals and merchant reports
  use the parent once.
- **Savings rate** = (income − spending) ÷ income; not shown when income ≤ 0
  or when totals are incomplete. Negative values are shown as they are.
- **Currency**: totals are in the base currency using each entry's recorded
  base snapshot, else a known rate on the entry date (direct or inverse).
  Without a rate the amount is excluded, listed in its own currency, and the
  total is labelled incomplete; comparisons are only shown when both periods
  are complete.
- **Merchants**: grouped by the existing `merchant_key` normalisation only;
  entries without a merchant form a labelled "No merchant recorded" group.
- **Budget vs actual**: budget periods from the budget engine that overlap the
  report range, shown whole (never prorated) and labelled when they extend
  beyond it.
- **Balance history**: opening balance + recorded postings (the same ledger as
  the current balance), per account in its own currency; nothing is shown
  before an account's opening-balance date. No snapshot table is needed.
- **Indexes**: `idx_transactions_date`, `idx_transaction_splits_transaction`
  and `idx_transactions_account_date` serve the report queries (verified with
  EXPLAIN QUERY PLAN in `reports-performance.test.ts`).

## CSV import & export: rules

No migration: the foundation schema already has `import_batches`,
`import_rows` and `transactions.import_batch_id` / `import_hash` (synced, RLS,
composite `(id, user_id)` foreign keys). `import_rows` is not used yet — the
source CSV is never stored.

**Import** (`domain/csv`, `domain/imports`, `features/data/importPlanner.ts`,
`SqliteImportRepository`):

- **Reading**: RFC 4180 (quotes, `""`, line breaks inside quotes, CRLF/LF/CR),
  UTF-8 with or without BOM, delimiter detected among `,` `;` tab `|`. Lines
  that can't be read (unclosed quote, text after a closing quote, too many
  fields) are listed with their line number and never imported. Max 10 MB.
- **Dates**: the user chooses year-month-day, day/month/year or
  month/day/year (detected when only one fits). Two-digit years are rejected;
  every date is validated as a real calendar date. ISO instants with `Z` or an
  offset are converted to the user's time zone. Imported entries get 12:00
  local time.
- **Amounts**: decimal text → integer minor units with the account currency's
  exponent (no floats); more decimals than the currency allows is an error,
  never rounded. Parentheses, leading/trailing minus and `−` mean negative.
  Modes: one signed column (the user says whether negative is money out or
  in), separate debit/credit columns (exactly one must have a value), or
  amount + type column (`expense`/`debit`/`dr`…, `income`/`credit`/`cr`…,
  `refund`). Zero amounts are rejected.
- **Currency**: a currency column must match the target account's currency;
  there is no conversion on import.
- **Identity** (idempotency): with a transaction-ID column,
  `x:` + FNV-1a-64(`account | external id`); otherwise `f:` +
  FNV-1a-64(`account | date | type | amount | currency | normalised merchant #
  n`), where _n_ is the occurrence within the file (two identical coffees in
  one file are two transactions). Rows whose identity is already stored (not
  deleted) are skipped — re-importing a file, or retrying after a crash, never
  duplicates. Deleting an imported transaction and importing again restores
  it.
- **Possible duplicates**: rows matching an existing transaction on account,
  date, signed amount and currency (multiset, so two existing ones match at
  most two rows) are skipped unless the user includes them one by one.
- **Transfers, refunds, splits**: a CSV row is one side of a transfer, so it
  is never imported as a transfer (skipped, or imported as income/expense by
  sign if the user chooses). Refund rows are imported unlinked (no invented
  original). Splits are never inferred.
- **Accounts & categories**: labels are matched to existing active
  accounts/categories by normalised name only; the user confirms every match.
  Unmatched categories fall back to the chosen "other spending / other
  income" category. Archived accounts can't receive imports.
- **Writing**: `import_batches` row (`previewed`) → chunks of 200 rows, each in
  one SQLite transaction through
  `SqliteTransactionRepository.createInTransaction` (same Zod validation,
  balances and outbox as manual entries) → `committed` (or `failed` with the
  rows saved so far). An unfinished batch is shown on the import screen;
  choosing the file again finishes it.

**Export** (`domain/exports`, `features/data/exportBuilder.ts`,
`SqliteExportRepository`, `services/data/dataFiles.ts`), format version 2:

- UTF-8 with BOM, CRLF, RFC 4180 quoting. Amounts are exact decimal strings
  plus the currency code and `amount_minor`; dates are ISO `YYYY-MM-DD` plus a
  display column in the user's format.
- v2 adds `base_fx_rate` and `base_fx_rate_date` next to `base_amount` /
  `base_conversion`, so each recorded conversion can be reproduced.
- Free-text cells starting with `=` `+` `-` `@`, tab or CR are prefixed with
  `'` (formula-injection protection). Numeric and ID columns are not altered.
- Transactions only → one CSV (a ZIP when split details exist). Everything →
  ZIP with `transactions.csv`, `transaction_splits.csv`, `accounts.csv`,
  `categories.csv`, `budgets.csv`, `budget_revisions.csv`, `bills.csv`,
  `bill_payments.csv`, `savings_goals.csv`, `goal_contributions.csv`,
  `exchange_rates.csv` (your manual rates), `README.txt`
  and `manifest.json` (format version, app version, time zone, base
  currency, filters, row counts, unsynced-change count).
- Transfers keep both legs with `transfer_id` and `transfer_other_account`; refunds
  keep `refund_of_transaction_id`. Attachments, tokens and keys are never exported. It is
  an export, not a restorable backup.
