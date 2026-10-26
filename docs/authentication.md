# Authentication

Supabase Auth with **email/password** and **Google OAuth**. Apple Sign-In is
planned (see "Adding Apple").

## Flows

| Flow | Implementation |
| --- | --- |
| Sign up | `signUp` with `emailRedirectTo = <scheme>://auth/callback`. If confirmation is required the screen shows "check your email". |
| Email confirmation | Link opens `/auth/callback?code=…` → PKCE code exchange → signed in. |
| Sign in | `signInWithPassword`. |
| Google | `signInWithOAuth({ skipBrowserRedirect: true })` → `WebBrowser.openAuthSessionAsync` → PKCE code exchange. |
| Forgot password | `resetPasswordForEmail` → link → `/auth/callback` → `PASSWORD_RECOVERY` event → `/reset-password` (guarded) → `updateUser({ password })`. |
| Sign out | Warns if unsynced changes exist → deletes the user's local database → `signOut({ scope: 'local' })`. Works offline. |
| Delete account | `delete-account` Edge Function (service role, server-side) → local wipe → sign out. |

All flows use **PKCE** (`flowType: 'pkce'`): redirect URLs carry one-time codes,
never tokens. Code exchanges are de-duplicated because Android can deliver the
same redirect twice (browser result + deep link).

## Sessions

- Persisted in **SecureStore** (Keychain / Keystore) via `lib/secureStorage.ts`,
  chunked because sessions exceed the ~2 KB per-item limit some platforms enforce.
  Accessibility: `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY` (not in backups).
- Tokens auto-refresh only while the app is foregrounded.
- **Offline launch**: if the access token expired and refresh fails because the
  device is offline, Supabase keeps the session but returns none. The app then
  reads the stored session's user and enters `offline` auth status — full access
  to local data; sync resumes (after a session refresh) when connectivity returns.
- The auth store holds status and user id/email only — never tokens.

## Route protection

`src/app/_layout.tsx` uses `Stack.Protected`:

| Group | Guard |
| --- | --- |
| `(app)` | (authenticated **or** local-only use) and not in password recovery |
| `(auth)` | not authenticated (also during local-only use, so "Sign in to sync" can open it) |
| `reset-password` | authenticated and in password recovery |
| `auth/callback` | always (deep-link target) |

## Accounts are optional (local-only use)

The first screen (`(auth)/welcome`) shows three intro slides, then
**Get started** (no account) or **I already have an account**.

- **Local-only:** `stores/localModeStore.ts` keeps a device-local id that
  stands in for the user id. Its data lives in its own database file, like an
  account's. `DataProvider` creates the preferences row and the default
  category tree locally (`repositories/sqlite/localBootstrap.ts`), which the
  server would otherwise create at sign-up. Nothing syncs, and messages that
  say "will sync when online" are suppressed (`syncStore.localOnly`).
- **Sign in later:** Settings → *Back up & sync* opens sign-in or sign-up.
  After sign-in, `GuestMergeScreen` first pulls the account's preferences,
  categories, tags and merchants, then `sync/guestMerge.ts` copies the
  device's data into the account in one transaction:
  - default categories map to the account's own (by system key); tags map by
    name and merchants by normalised name;
  - every other live row is copied under the account's user id and queued for
    upload;
  - the account keeps its preferences if it had finished onboarding;
    otherwise it takes the local choices.

  On success the local-only database is deleted. On failure nothing changes:
  retry, or sign out and keep using the device data without an account.
- **Erase:** in local-only use, Privacy offers *Erase data on this device*
  instead of *Delete account*.

## Supabase project setup (required)

1. **Create a project**; copy the URL and publishable (anon) key into `.env.local`.
2. **Apply the schema**: `npx supabase link --project-ref <ref>` then
   `npx supabase db push`.
3. **Deploy the Edge Function**: `npx supabase functions deploy delete-account`.
4. **Auth → URL configuration**: add redirect URLs
   - `moneymanager-dev://auth/callback`
   - `moneymanager-preview://auth/callback`
   - `moneymanager://auth/callback`
   - `exp://**` (only while using Expo Go/dev tooling)
5. **Auth → Providers → Email**: keep "Confirm email" on; set minimum password
   length ≥ 8 and enable leaked-password protection.
6. **Auth → Providers → Google**:
   - In Google Cloud Console create an OAuth client of type **Web application**;
     authorised redirect URI: `https://<project-ref>.supabase.co/auth/v1/callback`.
   - Paste its client id/secret into Supabase (the secret stays on Supabase —
     never in the app).
7. **SMTP**: configure a custom SMTP provider before launch (the built-in sender
   is rate-limited and not for production).

## Security rules

- Never store passwords; never log tokens, emails or financial data (logger redacts).
- No secrets in the client: the publishable key is public by design; RLS protects data.
- Service-role operations (account deletion, exchange-rate ingestion) run only in
  Edge Functions.

## Adding Apple Sign-In (planned)

1. `npx expo install expo-apple-authentication` (+ config plugin, iOS capability).
2. Get an identity token with `AppleAuthentication.signInAsync`.
3. `supabase.auth.signInWithIdToken({ provider: 'apple', token })` in `authService`.
4. Enable the Apple provider in Supabase. Required by App Store rules once
   Google sign-in ships on iOS.
