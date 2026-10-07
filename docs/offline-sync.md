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

For each due entry, oldest first (preserves causal order, parents before children):

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
server's.

## Scheduling (`hooks/useSyncScheduler.ts`)

Sync runs on: database ready, connectivity regained, app foregrounded, local
writes (2 s debounce), and every 5 minutes while foregrounded. Overlapping calls
share one run (single flight). In `offline` auth status the scheduler first
restores the session when the network returns.

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
- Attachments upload pipeline (files are not in the row sync).
- Realtime (push notifications of remote changes) is optional; polling triggers suffice for now.
- Initial sync of large histories: consider a bulk snapshot endpoint.
