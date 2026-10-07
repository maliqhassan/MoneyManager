# Roadmap

## Phase 0 — Foundation ✅ (2026-10-07)

Project setup (Expo SDK 57, strict TS, lint/format), Expo Router shell with
guarded groups, design system (light/dark, AA contrast), i18n + exact
formatting, domain money/FX/budget calculations (100% tested), Postgres schema
with RLS + pgTAP tests, SQLite schema + migrations, repository pattern, offline
sync engine (tested), Supabase Auth (email, Google, recovery, offline session),
SecureStore sessions, account deletion Edge Function, documentation.

## Phase 1 — Onboarding & accounts (next)

- Onboarding: confirm base currency, locale, first day of week, month start day
  (writes `user_preferences`).
- Accounts: list (balances, archived section), create/edit (type, currency,
  opening balance, credit limit), archive, delete-if-empty.
- Settings: base currency / regional preferences screen.
- Use `user_preferences.locale` for formatting (`useFormatLocale`).

## Phase 2 — Transactions & categories

- Expense / income / refund forms (amount input with locale separators,
  account, category, payee, date, notes, tags).
- Transfers (paired legs, cross-currency with received amount).
- Split transactions; duplicate; soft delete with undo.
- Transactions list: keyset pagination, search, filters.
- Categories management (custom, subcategories, archive; translated system names).
- Merchants + category rules, automatic categorisation.

## Phase 3 — Multi-currency rates

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
