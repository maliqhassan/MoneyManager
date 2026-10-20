# Roadmap

## Phase 0 — Foundation ✅ (2026-10-07)

Project setup (Expo SDK 57, strict TS, lint/format), Expo Router shell with
guarded groups, design system (light/dark, AA contrast), i18n + exact
formatting, domain money/FX/budget calculations (100% tested), Postgres schema
with RLS + pgTAP tests, SQLite schema + migrations, repository pattern, offline
sync engine (tested), Supabase Auth (email, Google, recovery, offline session),
SecureStore sessions, account deletion Edge Function, documentation.

## Phase 1 — Onboarding, regional preferences & accounts ✅ (2026-10-08)

- Six-step onboarding (welcome → currency → region → preferences → first
  account → ready); progress persisted per user, completion synced
  (`user_preferences.onboarding_completed_at`).
- Regional preferences: region, base currency, language, date format, number
  format, first day of week, time zone — applied app-wide via `FormatProvider`.
- Accounts: list (grouped, per-currency totals, archived section), detail,
  create, edit (currency locked once history exists), archive/restore,
  delete-if-empty; credit cards stored as negative balances with limit and
  available credit.
- Home on real data; Settings hub (appearance, regional, sync, privacy, about).
- Migration 2 (Supabase + local) for regional preference columns.

## Phase 2 — Transactions & categories ✅

- Expense / income / refund forms (React Hook Form + Zod; locale-aware amount
  entry; account, category, merchant, date + time in the user's time zone,
  notes, tags, receipts). Refunds can link to the original expense.
- Transfers written as one transfer row + two legs in a single SQLite
  transaction; cross-currency transfers record the amount received. Credit
  card payments are transfers, so they never count as spending.
- Exact split transactions (≥ 2 lines, must sum to the total; editor shows
  allocated / remaining). Edit, duplicate (transfers as a pair) and delete
  (with confirmation; transfers delete both legs).
- Transactions list: date-grouped, keyset pagination, locale-safe search
  (merchant, notes, category, tag), filters (accounts, types, categories incl.
  subcategories and split lines, tags, date range, amount range).
- Categories: server-seeded default tree (51, one nesting level), custom
  categories/subcategories, reorder, archive/restore (cascades to children),
  delete only when unused; translated system names until renamed.
- Merchant normalisation + deterministic categorisation (merchant rules →
  last category used for that merchant). No AI.
- Receipts: picked from camera/library, copied into app storage, uploaded to
  the private `attachments` bucket after sync with retry.
- Home on real data: cash flow for the current budget period, top spending
  categories, recent transactions, quick add actions.
- Migration 3 (Supabase + local): merchant keys, search column, list indexes,
  default category tree, integrity triggers (category parent, transaction
  currency = account currency, account currency locked once used).

Deferred: undo after delete (confirmation dialog instead); removing storage
objects for deleted receipts before account deletion.

## Phase 3 — Budgets, bills/subscriptions & savings goals ✅

- Budgets: overall or one expense category (including subcategories);
  weekly (user's first day of week), monthly (user's month start day) or
  custom dates; explicit currency; spending derived from transactions
  (refunds reduce it; transfers, card payments and income never count; split
  lines count toward their own category). Linear pace, deterministic status
  (on track / watch spending / over), optional rollover of unspent money.
  Amount and rollover are stored as revisions with an effective date, so
  completed periods keep their numbers. Archive/restore, duplicate
  prevention, transaction drill-down, category breakdown, period history.
- Bills & subscriptions: weekly / every 2 weeks / monthly / quarterly / yearly
  / custom interval; month-end safe (31 Jan → 28/29 Feb → 31 Mar); upcoming,
  overdue, paid, archived. "Mark as paid" records a normal expense (or links
  an existing one) in the same write as the payment record; deleting that
  transaction makes the due date unpaid again. Skip and undo. Monthly and
  yearly subscription costs (exact or marked approximate).
- Reminders: stored per bill and shown in the UI. Device notifications are
  NOT implemented yet (`expo-notifications` is not installed).
- Savings goals: target, currency, optional target date and account, icon and
  colour; contributions (add/edit/remove) in any currency, converted with
  known rates only; optional transfer recorded or linked with the
  contribution (balances move only through the transfer); progress,
  completion, overfunding, suggested monthly amount.
- Home: budgets closest to their limit, upcoming commitments (14 days),
  goals, and savings rate as a labelled metric.
- Migration 4 (Supabase + local): `budgets.category_id`, `budget_revisions`,
  `bills.anchor_date/end_date/autopay`, contribution currency/account/transfer,
  integrity triggers (budget category kind, bill currency = account currency).

## Phase 4 — Reports, analytics & insights ✅

- Reports tab (existing destination; no new tabs): period selector (this/last
  week, this/last month, last 3 months, this/last year, custom), income vs
  spending with previous-period comparison, savings rate (historical
  measurement), 12-month trend, spending by category (with subcategories) and
  by merchant, budget vs actual (from the budget engine), account balance
  history derived from the ledger, drill-down to the exact transactions.
- Reporting layer: `domain/reports` (periods + aggregation, pure and exact)
  over `SqliteReportRepository` (date-range SQL aggregation, base-currency
  resolution with known rates only).
- Charts drawn with plain React Native views (no chart dependency, no native
  module); validated CVD-safe income/spending colours; table view and written
  values for every chart.
- No migration: the existing indexes cover the report queries.

## Phase 5 — CSV import & data portability ✅

- More → Your data: guided CSV import (file → columns → formats → accounts &
  categories → review → confirm → progress → summary) and data export.
- Robust CSV reading, explicit date-format and amount rules, exact minor
  units, idempotent identities (bank ID or fingerprint), possible-duplicate
  review, chunked resumable import through the repositories and outbox.
- Never creates one-legged transfers, never invents refund links, never
  infers splits.
- Export: filtered transactions CSV, or a ZIP of every entity with README and
  manifest; formula-injection protection; shared via the system share sheet.
- New dependencies: `expo-document-picker`, `expo-sharing`, `fflate` (ZIP,
  pure JS). No migration.

## Phase 6 — Exchange rates & multi-currency ✅

- Provider interface (`services/fx`) with Frankfurter v2 (no key; blended
  central-bank reference rates; all 94 app currencies; history). Foreground,
  throttled refresh (12 h; 15 min after failure; Retry-After), forward fill +
  bounded backfill of the dates entries need.
- Exact conversion: rates validated decimal strings read from the raw JSON;
  derived (inverse / cross via USD) rates rounded once to 12 significant
  digits; amounts converted per entry, rounded once (half away from zero).
- Historical policy (rate on the entry date, ≤ 7 days old; manual ≤ 31) for
  snapshots, reports, budgets and goals; current policy (latest, labelled
  stale) for combined balances and subscription estimates.
- Snapshots are never rewritten by later rates; editing non-financial fields
  keeps them; transfers keep the amounts entered.
- More → Exchange rates: per-currency value, source, date, staleness, refresh
  status and attribution; manual rates with review step. Every converted total
  shows its basis; drill-downs reconcile in the base currency.
- CSV export format v2 (`base_fx_rate`, `base_fx_rate_date`,
  `exchange_rates.csv`). Local migration 5 only — no Supabase migration.

## Next — Exchange-rate follow-ups

- Sync manual rates across devices (`user_exchange_rates` table with RLS —
  needs a Supabase migration; proposed, not applied).
- Optional server-side cache (scheduled Edge Function writing
  `exchange_rates`) to reduce per-device downloads.

## Phase 7 — Recurring transactions, reminders & upcoming cash flow ✅

- Recurring income/expense rules (daily, weekly, every 2 weeks, monthly,
  every 3 months, yearly, custom interval; end date; pause / resume /
  cancel) on the shared anchor-based recurrence engine (no month-end drift).
- Occurrences confirmed by default (or added automatically when the app
  opens); idempotent per (rule, date) locally and on the server; deleted
  generated transactions are never recreated without "Add again".
- Planning → Upcoming: expected income/expenses for 7/14/30 days from rules
  and unpaid bills, per currency, combined only with known rates.
- Local reminders (`expo-notifications`) for rules and bills: permission
  asked when turned on, deterministic identifiers, reconciled on start,
  foreground and changes.
- Supabase migration `20261019090000_recurring_rules.sql` (needs approval to
  apply) + local migration 6.

## Later — Notifications follow-ups

- Budget threshold alerts; notification actions (add / skip from the
  notification itself).

## Later — Reports & dashboard

- Choose and add a chart library (evaluate `victory-native` vs
  `react-native-gifted-charts` against SDK 57 at that time).
- Income vs expenses, by category/merchant, trends, cash flow, budget vs
  actual, balance history, period comparison, custom ranges.

## Later — Import follow-ups

- Rule-based auto-categorisation, OFX/QIF, saved column mappings per bank,
  pairing transfer rows across two imported accounts.

## Cross-cutting backlog

- Sync: conflict review screen; tombstone purge; failed-entry retry UI.
- Server-side data export (Edge Function) for GDPR-style requests; restorable
  backups.
- Sentry integration via `setErrorReporter` (install `@sentry/react-native`).
- Apple Sign-In (required on iOS once Google sign-in ships).
- Optional SQLCipher encryption for the local database.
- Additional languages (and RTL QA with Arabic for UAE).
- CI: run `npm run verify` and `supabase test db` on every PR.
