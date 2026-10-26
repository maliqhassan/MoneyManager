# Offline-first & synchronisation

The device's SQLite database is what the UI reads and writes. Supabase is the
durable, multi-device copy. Screens never wait on the network.

```
UI → Repository → SQLite (row + outbox entry, one transaction)
                       │ push                ▲ pull
                       ▼                     │
                   SyncEngine  ⇄  RemoteDataSource (Supabase / PostgREST)
```

## Local bookkeeping tables

| Table | Role |
| --- | --- |
| `sync_outbox` | One entry per changed row awaiting push (`id` = mutation id). Status: `pending`, `in_flight`, `failed`, `conflict`. Attempts, backoff time, last error code. |
| `sync_cursors` | Per table: last pulled `(updated_at, id)`. |
| `sync_conflicts` | Local snapshot + server snapshot of every detected conflict, for review. |

## Writing

Repositories write the row (`sync_status = 'pending'`) and call
`enqueueChange` **in the same SQLite transaction**. Coalescing: if a not-yet-sent
entry exists for the row, it is reused (push always sends the row's *latest*
state). If the only entry is in flight, a new one is added so the later edit is
not lost. A delete supersedes an upsert.

## Push

For each due entry, in insertion order (`rowid`), which preserves causal order: a
transfer row is pushed before its legs, a transaction before its splits:

1. Mark `in_flight`, read the current local row.
2. `version = 0` (never synced) → **insert** if absent (`ON CONFLICT DO NOTHING`).
   Otherwise → **update where `version` = local version**.
3. Applied → delete the outbox entry; store the server version; mark the row
   `synced` (or keep `pending` if edited again meanwhile).
4. Not applied → fetch the server row:
   - `last_mutation_id` equals this entry → our earlier attempt landed but the
     response was lost; re-apply on top of the server version (idempotent).
   - otherwise → **conflict**.

## Conflicts

Detected by optimistic concurrency (`version`), never by comparing clocks.
Policy is pluggable (`resolveConflict`); the default is **server wins**: the
server row replaces the local one, the row is flagged `sync_status = 'conflict'`,
and both versions are saved in `sync_conflicts` so nothing is silently lost.
`keep_local` overwrites the server based on the version just observed.

For a single-user finance app conflicts need two devices editing the same record
offline; a review screen is planned (see roadmap).

## Errors & retries

| Error | Behaviour |
| --- | --- |
| network / offline / timeout / unauthorized | Stop the run; entry back to `pending` without using an attempt. |
| 5xx / rate limited (retryable) | Backoff: 5 s · 2^n, full jitter, capped at 30 min. Never parked. |
| validation / forbidden (non-retryable) | Retried with backoff (covers e.g. a parent not yet pushed); after 5 attempts parked as `failed` and surfaced in Settings → Sync. |
| crash mid-push | `in_flight` entries are reset to `pending` at the next run (idempotent). |

## Pull

Per table in dependency order, rows with `(updated_at, id) > cursor`, paged
(500). Each run first re-reads a **2-minute overlap window** to catch server
transactions that committed late with an earlier timestamp; re-applying is
harmless. A pulled row is skipped if the local row has unsent changes (push
reconciles it via version check) or if the local version is already ≥ the
server's. Local-only derived columns (e.g. `transactions.search_text`) are
recomputed from the pulled row via the registry's `derive` hook.

## Recurring rules

Posting an occurrence queues the generated transaction and then its
`recurring_occurrences` row in one SQLite transaction (after the rule, which
was queued when it was created), so the server always receives parents first.
Another device that pulls the occurrence never offers that date again. If two
devices post the same date while both are offline, the server's unique index
on `transactions (recurring_transaction_id, recurrence_date)` rejects the
second copy; it is reported in Settings → Sync, not silently duplicated.

## Planning writes

Budgets (+ revision), bills, bill payments and goal contributions use the same
outbox. Paying a bill queues `transactions` (+ splits) → `bill_payments` →
`bills`; a contribution with a transfer queues `transfers` → two
`transactions` → `goal_contributions`, so the server always receives the
referenced row first. Queries that are derived from other tables are
invalidated through `providers/queryDependencies.ts` (e.g. a new expense
refreshes budgets, bills and goals).

Known edge: two devices paying the same bill due date offline both create an
expense; the second payment row is rejected by the server's unique
(bill, due date) index and parked as failed (visible in Settings → Sync).

## CSV import

Imported transactions are ordinary local writes: the `import_batches` row is
queued first, then each chunk of 200 rows commits the transactions and their
outbox entries (plus the batch's `imported_count`) in one SQLite transaction.
Imports work fully offline and sync later like manual entries; nothing is
sent to the server directly and RLS applies as usual. A failed chunk rolls
back alone; earlier chunks stay committed and a repeat import skips them by
`import_hash`. The CSV file itself never leaves the device.

## Exchange rates

Rates are reference data, not user records: they live in the device's local
`exchange_rates` cache and never enter the outbox. A foreground refresh
(app start, foreground, reconnect; throttled) downloads them from the
provider; offline, the cache is used and its dates are shown. Snapshots on
transactions (which do sync) carry the rate actually used, so other devices
never need the same cache to show the same recorded values. Manual rates are
device-local for now. See [exchange-rates.md](exchange-rates.md).

## Receipts (files)

Receipt **rows** (`attachments`) sync through the outbox like any other table.
Files do not: the picked image/PDF is copied into the app's document directory
and the row carries `local_uri` + `upload_status = 'pending'` (local-only
columns). After a successful sync run, `services/receipts/uploader.ts` uploads
pending files to the private `attachments` bucket at `<user_id>/<id>.<ext>`
(single flight, `upsert`); failures stay queued and retry after the next sync.
The transaction never depends on the upload. Viewing a receipt uses the local
file when present, otherwise a 10-minute signed URL.

## Scheduling (`hooks/useSyncScheduler.ts`)

Sync runs on: database ready, connectivity regained, app foregrounded, local
writes (2 s debounce), and every 5 minutes while foregrounded. Overlapping calls
share one run (single flight). In `offline` auth status the scheduler first
restores the session when the network returns.

Whether an **automatic** trigger may start a run is decided by
`sync/autoSync.ts` from how the last run ended. Every run reports through
`SyncEngine.onRunFinished`, including "Sync now" and pull-to-refresh, which are
never held back.

| Last run | Automatic sync |
| --- | --- |
| success | normal |
| offline | waits for reconnect / foreground |
| transient (network, timeout, 5xx, unknown) | retry timer 5 s · 2^(n−1), capped at 5 min, 50–100 % jitter; reconnect / foreground may retry sooner |
| `server_not_ready` (server schema behind the app) | **all** automatic triggers wait, reconnect included (going offline does not reset this); a timer probes after ~1 min, doubling up to 30 min (with jitter); the first successful probe resumes normal sync |
| `unauthorized` | one token refresh (`refreshAuthSession`); if it works, retry at once, otherwise only foregrounding retries. If Supabase ends the session the user signs in again; the device database and its queue are kept |

Queued changes are never dropped or marked failed by any of these. The last
error stays in the status until a run settles, so the server-update message
does not flicker while a probe runs. The UI status (`features/sync/syncDisplay.ts`)
is one of: syncing, waiting to sync, up to date, offline, sign-in needs
renewing, server update needed.

## Guarantees (tested in `src/sync/__tests__`)

- New rows push with correct type conversion; sync columns never sent.
- Lost responses don't duplicate rows.
- Conflicts are recorded with both versions; both policies work.
- Pull applies remote rows, advances the cursor, ignores unknown columns.
- Pull never overwrites unsent local edits.
- Permanent failures park after 5 attempts; network errors don't burn attempts.
- Concurrent `sync()` calls merge.

## Known limits / next steps

- Tombstones are kept indefinitely; add server-side purge (e.g. 90 days after
  `deleted_at`) and local purge of synced tombstones.
- Conflict review UI.
- Storage objects of deleted receipts are only removed by account deletion;
  add a cleanup job.
- Realtime (push notifications of remote changes) is optional; polling triggers suffice for now.
- Initial sync of large histories: consider a bulk snapshot endpoint.
