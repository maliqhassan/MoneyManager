# Recurring transactions, reminders & upcoming cash flow

Phase 7. Rules for genuinely repeating income and expenses, a safe
confirm-or-auto-post flow, an upcoming cash-flow view and optional local
reminders.

## Feature boundary (plan)

**Reused, not duplicated**

- `domain/planning/recurrence.ts` — anchor-based schedules (frequency ×
  interval), the same engine bills use. Presets: daily, weekly, biweekly
  (weekly × 2), monthly, quarterly (monthly × 3), yearly, plus a custom
  interval (it is just `interval`).
- `domain/planning/bills.ts` — `dueInfo` (overdue / due today / upcoming) and
  `reminderDate`.
- Bills & subscriptions stay as they are (their own table, payments and
  status). The upcoming view reads them; it does not copy them into rules.
- `SqliteTransactionRepository.createInTransaction` posts occurrences, so
  every account, category, currency, archived-account and Zod rule applies,
  and each post goes through the outbox in the same SQLite transaction.
- Phase 6 `Converter` (current mode) for combined projections.
- The foundation's synced `recurring_transactions` table (RLS, composite
  `(id, user_id)` FKs, `auto_post`, `next_occurrence_date`, `time_zone`) and
  `transactions.recurring_transaction_id`.

**Schema (Supabase `20261019090000_recurring_rules.sql` + local `006_recurring.ts`)**

- `recurring_transactions`: `status` (`active` | `paused` | `ended`),
  `active_from` (occurrences before it are never due — set at creation and on
  resume), `reminder_days_before` (null = no reminder), `tag_names` (JSON
  array). `is_active` is kept in step (`status = 'active'`).
- `transactions.recurrence_date`: the occurrence a generated transaction
  belongs to; unique `(recurring_transaction_id, recurrence_date)` for
  non-deleted rows on the server and locally.
- New synced table `recurring_occurrences` (`recurring_transaction_id`,
  `occurrence_date`, `status` `posted` | `skipped`, `transaction_id`), unique
  `(recurring_transaction_id, occurrence_date)` for non-deleted rows, RLS per
  user like every synced table.

**Notifications** — `expo-notifications` (installed with `npx expo install`
for SDK 57; config plugin; new native build). Local notifications only: no
push service, no backend. Permission is asked only when the user turns
reminders on. Android: a "Reminders" channel; POST_NOTIFICATIONS prompt on
Android 13+; no exact-alarm permission, so Android may deliver a reminder
late (Doze). iOS keeps at most 64 pending notifications; we schedule at most
50, nearest first.

**Offline & sync** — rules, occurrences and generated transactions are
ordinary synced rows (outbox, rowid order: rule → transaction →
occurrence). Everything works offline. Reminders and their settings are
per device.

**Tests** — recurrence edge cases, idempotent posting, pause/resume/cancel,
deleted transactions, archived accounts, offline + sync, reminders planning
and reconciliation, permission denial, cash-flow totals (transfers, bills,
currencies, missing rates), reports ignoring unposted occurrences, migration
upgrade, RLS.

## Schedules

Occurrence _n_ is computed from the start date (the anchor), never from the
previous occurrence: a monthly rule from 31 Jan gives 31 Jan, 28/29 Feb,
31 Mar, 30 Apr …; a yearly rule from 29 Feb gives 28 Feb in non-leap years
and 29 Feb again in leap years. Dates are calendar dates in the rule's time
zone, so DST changes never move them.

## Occurrences and duplicate prevention

- An occurrence is identified by **(rule, scheduled date)**.
- It is _handled_ when a `recurring_occurrences` row exists for it:
  `posted` (with the transaction) or `skipped`. Handled occurrences are never
  due again — retries, restarts and sync cannot post them twice.
- Posting runs in one SQLite transaction: re-check that the occurrence is not
  handled → create the transaction (`recurring_transaction_id`,
  `recurrence_date`) → insert the occurrence row. The local unique indexes
  make a concurrent second attempt fail and roll back.
- Across devices: the server's unique index on
  `transactions (recurring_transaction_id, recurrence_date)` rejects a second
  device's copy of the same occurrence (it is reported as a sync conflict;
  the server keeps one).
- **Confirm by default.** `auto_post = false` shows due occurrences for the
  user to confirm or skip; `auto_post = true` posts due occurrences when the
  app opens (at most 90 days of backlog per rule). Future occurrences are
  never posted — reports and budgets only ever see posted transactions.
- Occurrences that cannot be posted (archived account, archived category,
  currency changed) stay due and are flagged; nothing is posted.

## Editing, pausing, cancelling

- Editing a rule changes only occurrences that are not handled yet; posted
  transactions are never rewritten.
- Pause: nothing becomes due. Resume: `active_from` = today, so the paused
  window is not posted retroactively.
- Cancel (`ended`): no more occurrences; history stays.
- Deleting a generated transaction keeps its occurrence handled; the rule
  offers "Post again" as an explicit choice.

## Upcoming cash flow

Planning → Upcoming, horizon 7 / 14 / 30 days. Items: unhandled rule
occurrences and unpaid bill/subscription occurrences from up to 30 days
overdue through the horizon. A bill occurrence with a payment (paid, linked
or skipped) is not counted. Transfers never appear (rules are income or
expense; bills are expenses). Totals per currency; a combined total in the
base currency uses the latest cached rates (Phase 6 current policy) and is
shown only when every rate is known, otherwise it is marked incomplete. It is
a projection of scheduled items — not a balance.

## Reminders

Device setting (More → Reminders): on/off, default lead time, time of day.
Rules have their own lead time; bills already have one. The app reconciles
scheduled notifications with what should exist (deterministic identifiers
`mm:rule:<id>:<date>` / `mm:bill:<id>:<date>`): it cancels reminders for
paused, cancelled, deleted, paid or handled occurrences and schedules
missing ones — on start, on foreground and after relevant changes. A
notification failure never affects saved data.
