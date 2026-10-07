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

## Phase 3 — Multi-currency rates (next)

- `exchange-rates` Edge Function (scheduled) populating `exchange_rates`.
- Local rate cache + lookup; base-currency snapshots on entry; manual rate override.
- Totals across currencies on Home.

## Phase 4 — Budgets

- Monthly / weekly / custom, overall + category allocations, rollover,
  progress, overspending alerts, forecast (domain logic already done).

## Phase 5 — Bills, subscriptions & notifications

- Recurring transactions engine, bills & payments, reminders with
  `expo-notifications` (install at this phase).

## Phase 6 — Goals

- Savings goals, contributions, suggested monthly contribution.

## Phase 7 — Reports & dashboard

- Choose and add a chart library (evaluate `victory-native` vs
  `react-native-gifted-charts` against SDK 57 at that time).
- Income vs expenses, by category/merchant, trends, cash flow, savings rate,
  budget vs actual, balance history, period comparison, custom ranges.
- Full Home dashboard with progressive disclosure.

## Phase 8 — CSV import

- `expo-document-picker`, column detection/mapping, preview, duplicate
  detection (`import_hash`), auto-categorisation, uncategorised review.

## Phase 9 — Attachments

- Receipt capture/upload to the private bucket with type/size validation,
  offline upload queue.

## Cross-cutting backlog

- Sync: conflict review screen; tombstone purge; failed-entry retry UI.
- Data export (CSV/JSON) Edge Function — required for GDPR-style requests.
- Sentry integration via `setErrorReporter` (install `@sentry/react-native`).
- Apple Sign-In (required on iOS once Google sign-in ships).
- Optional SQLCipher encryption for the local database.
- Additional languages (and RTL QA with Arabic for UAE).
- CI: run `npm run verify` and `supabase test db` on every PR.
