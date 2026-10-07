# Architecture

## Goals

Correctness of financial data, security, offline-first behaviour, global
readiness (currencies, locales, time zones, RTL) and maintainability. Speed of
delivering screens is secondary to those.

## Layers

```
┌──────────────────────────────────────────────────────────────┐
│ src/app (routes)         thin screens: compose hooks + UI    │
├──────────────────────────────────────────────────────────────┤
│ src/features/*           feature hooks, components, services │
│ src/components           design-system primitives            │
├──────────────────────────────────────────────────────────────┤
│ src/repositories         validated reads/writes (interfaces) │
│ src/domain               PURE money/date/finance logic       │
├──────────────────────────────────────────────────────────────┤
│ src/database (SQLite)    src/sync (outbox, engine)           │
│ src/services (Supabase client, logging)                      │
└──────────────────────────────────────────────────────────────┘
```

Dependency rules:

- **Routes and components never import `expo-sqlite` or `@supabase/supabase-js`.**
  Enforced by ESLint (`no-restricted-imports` in `eslint.config.js`).
- **`src/domain` is pure**: no React, no I/O, no platform APIs (except `Intl` for
  time-zone date resolution). It is where every financial calculation lives and
  has ~100% test coverage (enforced threshold).
- Repositories depend on the `SqlDatabase` interface, not on expo-sqlite, so they
  are tested against real SQLite in Node (`node:sqlite`).
- The sync engine depends on a `RemoteDataSource` interface; Supabase is one
  implementation, an in-memory fake is another (tests).
- Only `features/auth/services/authService.ts` talks to Supabase Auth.

## Data flow

**Write (works offline)**

```
Screen → hook (TanStack mutation) → Repository.create/update
       → Zod validation → SQLite transaction { row + sync_outbox entry }
       → onChange(table) → query invalidation + debounced sync
```

**Read**

```
Screen → hook (TanStack useQuery, networkMode 'always') → Repository → SQLite
```

Local queries never wait for the network. Remote-only queries (none yet) must
opt in to `networkMode: 'online'`.

**Sync** — see [offline-sync.md](offline-sync.md).

## Composition roots

- `src/app/_layout.tsx` — validates env, mounts `AppProviders` (SafeArea, i18n,
  TanStack Query, theme, navigation theme), restores the session, and guards
  route groups with `Stack.Protected`.
- `src/app/(app)/_layout.tsx` — mounts `DataProvider` keyed by user id: opens
  that user's SQLite file, runs migrations, builds repositories and the
  `SyncEngine`, and starts the sync scheduler.

## State management

| Kind of state | Where |
| --- | --- |
| Financial records | SQLite (source of truth on device) → read via TanStack Query |
| Server data | Synced into SQLite; never read directly by screens |
| Auth status / user | Zustand `authStore` (no tokens) |
| Sync status | Zustand `syncStore` (mirrors `SyncEngine`) |
| Device UI settings (theme) | Zustand `settingsStore`, persisted to `expo-sqlite/kv-store` |
| Form state | React Hook Form + Zod |
| Secrets (session tokens) | SecureStore (chunked adapter) |

## Money and numbers

- Amounts are integers in **minor units** with an ISO-4217 exponent table
  (`domain/currency/currencies.ts`). No floats in arithmetic, ever.
- Exchange rates are **exact decimal strings**; conversion uses BigInt.
- Display formatting is also exact: the integer part goes through `Intl`, the
  fraction digits are spliced in as text (`i18n/format.ts`).
- Every transaction stores the original amount/currency, the account-currency
  amount, and a base-currency snapshot (rate, date, source) — see
  [database.md](database.md).

## Errors

All thrown values are normalised to `AppError` with a stable `code`
(`lib/errors.ts`). UI shows `t('errors.<code>')`; stack traces and server
messages are never shown. Route render errors hit `RouteErrorBoundary`.

## Logging and monitoring

`services/monitoring/logger.ts` is the only logging entry point. It redacts
sensitive keys (amounts, names, notes, emails, tokens) and token-like strings,
and forwards warnings/errors to a pluggable `ErrorReporter`. Sentry plugs in via
`setErrorReporter` without touching call sites.

## Internationalisation

- i18next with typed keys (`i18n/locales/en.ts` is the source of truth).
- Zod error messages are i18n keys, translated at the form boundary.
- Locale-aware number/date formatting via `Intl`; calendar dates formatted in
  UTC to avoid day shifts.
- RTL-ready: layouts use logical properties (`start`/`end`); `I18nManager.allowRTL(true)`.

## Key decisions

| Decision | Why |
| --- | --- |
| Per-user SQLite file (`ledger-<userId>.db`) | Shared devices can't leak data across accounts; sign-out deletes the file. |
| Client-generated UUIDs | Offline creation; idempotent sync; no id remapping. |
| Soft deletes everywhere | Deletions must sync; clients cannot hard-delete (RLS). |
| No local foreign keys on synced tables | Pull pages can deliver children before parents; Postgres enforces integrity. |
| Default categories seeded server-side | Avoids duplicate defaults when several devices sign in. |
| Theme mode is per device (not synced) | Users often want different themes per device. |
| JS tabs + native form sheet for "Add" | Custom centre button; accessible native sheet. |
| Charts library deferred to Reports phase | Avoids an unused dependency now. |

## Signed-in gate & onboarding (Phase 1)

`src/app/(app)/_layout.tsx` mounts `DataProvider` → `FormatProvider` → sync
scheduler, then decides with the pure `resolveAppGate`
(`features/onboarding/model.ts`):

| Preferences row | Online / first sync | Result |
| --- | --- | --- |
| loading | — | setting-up screen |
| exists, `onboarding_completed_at` set | — | app (tabs) |
| exists, not completed | — | onboarding |
| missing | online, first sync not finished | setting-up screen (never flash onboarding at a returning user) |
| missing | offline / sync failed | onboarding (completion waits for the row) |

- **Progress** (current step + draft choices + id of the first account) is
  persisted per user on the device (`features/onboarding/store.ts`), so a
  restart resumes at the same step. It is cleared on completion and on sign-out.
- **Completion** lives only in the synced `user_preferences` row, so other
  devices skip onboarding. The final step writes all choices in one
  preferences update (`completeOnboarding`), which works offline once the
  server-created row has synced.
- The first account is created through the normal `AccountRepository` (outbox).

## Formatting pipeline

```
user_preferences ──► FormatProvider ──► createFormatter(settings) ──► useFormatter()
 (or device defaults)                    money / number / date / dateTime / today
```

- One `Formatter` per settings object; screens never call `Intl` directly.
- `numberFormat` maps to a representative locale (en-US, de-DE, fr-FR, de-CH) so
  grouping and separators always come from Intl; `dateFormat` controls numeric
  date order (MDY / DMY / YMD) or follows the locale.
- Amount **entry** is parsed with `parseAmountEntry`, which tolerates the device
  keyboard's decimal separator (e.g. "12,50" on an en-US profile = 12.50, not
  1 250) — a safeguard against 100× errors.
- During onboarding the layout provides a formatter built from the *draft*, so
  previews and amount entry match choices immediately.

## Time zones

The user's configured time zone (not the device clock's UTC date) decides
"today" (`formatter.today()`, `todayInZone`) and the current budget period
(`currentBudgetPeriod`). Transactions store `local_date` + `time_zone` at entry,
so later changes of time zone never move past transactions between days. Bill
due dates and recurrences are calendar dates, computed with pure calendar
arithmetic (no UTC conversion).
