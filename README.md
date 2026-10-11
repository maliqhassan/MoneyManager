# MoneyManager

A global, offline-first personal finance app — **Track → Budget → Understand → Improve**.

React Native (Expo SDK 57) · TypeScript (strict) · Expo Router · SQLite · Supabase · Zustand · TanStack Query · React Hook Form + Zod

> **Status: Phase 4 complete.** Foundation, onboarding, regional preferences,
> accounts, transactions & categories, planning (budgets, bills & subscriptions,
> savings goals) and reports & analytics (cash flow, savings rate, trends,
> category/merchant spending, budget vs actual, balance history with
> drill-down). CSV import, exchange-rate feed and device notifications follow —
> see [docs/roadmap.md](docs/roadmap.md).

## Quick start

Requirements: Node ≥ 22.13, npm, a Supabase project, and a device or emulator.

```bash
npm install
cp .env.example .env.local        # then fill in your Supabase URL + publishable key
npx expo run:android              # or: npx expo run:ios (macOS)
```

The app uses native modules (SQLite, SecureStore, …), so it runs in a **development
build** (`expo run:*` or `eas build --profile development`). After the first build,
`npx expo start` is enough for day-to-day work.

Without valid environment variables the app starts and shows a configuration
screen instead of crashing.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm start` | Start the Metro dev server |
| `npm run android` / `npm run ios` | Start and open on a device/emulator |
| `npm run typecheck` | `tsc --noEmit` (strict) |
| `npm run lint` / `lint:fix` | ESLint (Expo config + Prettier) |
| `npm run format` | Prettier write |
| `npm test` / `test:coverage` | Jest (unit, repository, sync, component tests) |
| `npm run verify` | typecheck + lint + tests |
| `npm run doctor` | `expo-doctor` dependency/config checks |
| `npm run supabase:types` | Generate DB types from the linked Supabase project |

## Environment variables

See [.env.example](.env.example). All `EXPO_PUBLIC_*` values are embedded in the
app bundle — they are **public by design**. Never put secrets (service-role key,
OAuth client secrets) in the app.

| Variable | Required | Description |
| --- | --- | --- |
| `EXPO_PUBLIC_APP_ENV` | no | `development` \| `preview` \| `production` |
| `EXPO_PUBLIC_SUPABASE_URL` | yes | Supabase project URL |
| `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | yes | Supabase publishable (anon) key — access is enforced by RLS |
| `EXPO_PUBLIC_SENTRY_DSN` | no | Error reporting (reporter is pluggable; not installed yet) |

Build variants (`APP_VARIANT`, set per profile in [eas.json](eas.json)) get separate
names, bundle ids and URL schemes so dev/preview/prod can be installed side by side.

## Project layout

```
src/
  app/            Expo Router routes only (thin screens)
  components/     Reusable UI: ui/ primitives, form/ bindings, app/ shell pieces
  features/       Feature modules (auth, accounts, dashboard, settings, sync, …)
  domain/         Pure business logic: money, currency, dates, finance calculations
  database/       SQLite adapter, migrations, per-user database lifecycle
  repositories/   Repository interfaces + SQLite implementations
  sync/           Offline sync engine, outbox, Supabase remote
  services/       Supabase client, monitoring/logging
  providers/      App-level and per-user (data) providers
  stores/         Zustand stores (auth, sync status, device settings)
  hooks/          Cross-feature hooks
  lib/            Errors, ids, query client, secure storage
  validation/     Shared Zod schemas
  theme/          Design tokens, light/dark palettes, ThemeProvider
  i18n/           i18next setup, locales, exact money/date formatting
  config/         Validated environment configuration
  test/           Test harness (in-memory SQLite, fake remote, render helpers)
supabase/
  migrations/     Postgres schema, RLS, triggers, storage policies
  functions/      Edge Functions (delete-account)
  tests/          pgTAP RLS tests (npx supabase test db)
docs/             Architecture and design documentation
```

## Documentation

- [Architecture](docs/architecture.md) — layers, data flow, rules
- [Database](docs/database.md) — schema, money representation, migrations
- [Authentication](docs/authentication.md) — providers, sessions, Supabase setup
- [Offline & sync](docs/offline-sync.md) — outbox, conflicts, retries
- [Design system](docs/design-system.md) — tokens, components, accessibility
- [Roadmap](docs/roadmap.md) — phases and what's next
