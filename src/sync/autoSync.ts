import type { ErrorCode } from '@/lib/errors';

/**
 * Automatic sync policy: decides whether an automatic trigger may start a
 * sync run, given how the previous run ended. Manual syncs ("Sync now",
 * pull-to-refresh) call the engine directly and are never held back; their
 * outcome still feeds this policy (SyncEngine.onRunFinished).
 *
 * - success            → no hold.
 * - offline            → wait for connectivity (reconnect / foreground).
 * - unauthorized       → one token refresh is attempted; after that only
 *                        returning to the app (or signing in again) retries.
 * - server_not_ready   → the server schema is older than this app: every
 *                        request would fail the same way, so all automatic
 *                        triggers wait for a growing cooldown (1 → 30 min);
 *                        a timer then probes once, and normal sync resumes
 *                        by itself as soon as the server has been updated.
 * - anything else      → transient: bounded exponential backoff (5 s → 5 min)
 *                        with a retry timer; reconnect / foreground may retry
 *                        sooner because they often fix the cause.
 *
 * Queued changes are never touched here — the engine keeps them pending.
 */

export type SyncTrigger =
  'start' | 'reconnect' | 'foreground' | 'local_change' | 'interval' | 'retry';

export type SyncHold =
  | { kind: 'none' }
  | { kind: 'offline' }
  | { kind: 'auth' }
  | { kind: 'backoff'; reason: 'transient' | 'server_not_ready'; failures: number; until: number };

export const TRANSIENT_BACKOFF = { baseMs: 5_000, maxMs: 5 * 60_000 } as const;
export const SERVER_NOT_READY_BACKOFF = { baseMs: 60_000, maxMs: 30 * 60_000 } as const;
export const LOCAL_CHANGE_DEBOUNCE_MS = 2_000;

const NO_HOLD: SyncHold = { kind: 'none' };

/** Delay before retry `failures` (1-based): base · 2^(n-1), capped, with 50–100 % jitter. */
export function backoffDelayMs(
  failures: number,
  policy: { baseMs: number; maxMs: number },
  random: () => number = Math.random,
): number {
  const exact = Math.min(
    policy.baseMs * 2 ** Math.min(Math.max(failures - 1, 0), 16),
    policy.maxMs,
  );
  return Math.floor(exact * (0.5 + random() / 2));
}

/** The hold after a run that ended with `errorCode` (null = success). */
export function nextHold(
  previous: SyncHold,
  errorCode: ErrorCode | null,
  now: number,
  random: () => number = Math.random,
): SyncHold {
  if (errorCode === null) return NO_HOLD;
  if (errorCode === 'offline') return { kind: 'offline' };
  if (errorCode === 'unauthorized') return { kind: 'auth' };
  const reason = errorCode === 'server_not_ready' ? 'server_not_ready' : 'transient';
  const failures =
    previous.kind === 'backoff' && previous.reason === reason ? previous.failures + 1 : 1;
  const policy = reason === 'server_not_ready' ? SERVER_NOT_READY_BACKOFF : TRANSIENT_BACKOFF;
  return {
    kind: 'backoff',
    reason,
    failures,
    until: now + backoffDelayMs(failures, policy, random),
  };
}

/** Whether an automatic `trigger` may start a run under `hold`. */
export function allowsAutoSync(hold: SyncHold, trigger: SyncTrigger, now: number): boolean {
  switch (hold.kind) {
    case 'none':
      return true;
    case 'offline':
      return trigger === 'reconnect' || trigger === 'foreground' || trigger === 'start';
    case 'auth':
      // Returning to the app restarts Supabase's token refresh; one attempt
      // then shows whether the session works again.
      return trigger === 'foreground';
    case 'backoff':
      if (now >= hold.until) return true;
      // A missing server schema is not fixed by reconnecting: wait it out.
      if (hold.reason === 'server_not_ready') return false;
      return trigger === 'reconnect' || trigger === 'foreground';
  }
}

type Timer = ReturnType<typeof setTimeout>;

export interface AutoSyncControllerOptions {
  /** Starts one sync attempt (the engine merges overlapping runs). */
  run: (trigger: SyncTrigger) => void;
  /**
   * Called once when the server first rejects the session; resolves true if
   * the session was refreshed (sync is retried right away).
   */
  refreshSession?: () => Promise<boolean>;
  now?: () => number;
  random?: () => number;
  debounceMs?: number;
}

/** Holds the policy state, the local-change debounce and the retry timer. */
export class AutoSyncController {
  private hold: SyncHold = NO_HOLD;
  private retryTimer: Timer | null = null;
  private debounceTimer: Timer | null = null;
  private refreshTried = false;
  private disposed = false;
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly debounceMs: number;

  constructor(private readonly options: AutoSyncControllerOptions) {
    this.now = options.now ?? (() => Date.now());
    this.random = options.random ?? (() => Math.random());
    this.debounceMs = options.debounceMs ?? LOCAL_CHANGE_DEBOUNCE_MS;
  }

  getHold(): SyncHold {
    return this.hold;
  }

  /** An automatic trigger fired. Local changes are debounced. */
  request(trigger: SyncTrigger): void {
    if (this.disposed) return;
    if (trigger === 'local_change') {
      if (this.debounceTimer) clearTimeout(this.debounceTimer);
      this.debounceTimer = setTimeout(() => {
        this.debounceTimer = null;
        this.fire('local_change');
      }, this.debounceMs);
      return;
    }
    this.fire(trigger);
  }

  /**
   * The device went offline: wait for reconnect instead of retrying. A held
   * server schema or rejected session is kept — reconnecting fixes neither,
   * so a flapping network must not turn into requests that will fail.
   */
  markOffline(): void {
    const keep =
      this.hold.kind === 'auth' ||
      (this.hold.kind === 'backoff' && this.hold.reason === 'server_not_ready');
    if (!keep) this.setHold({ kind: 'offline' });
  }

  /** A sync run finished (from any caller). */
  record(errorCode: ErrorCode | null): void {
    if (this.disposed) return;
    if (errorCode === null) this.refreshTried = false;
    this.setHold(nextHold(this.hold, errorCode, this.now(), this.random));
    if (errorCode === 'unauthorized' && !this.refreshTried && this.options.refreshSession) {
      this.refreshTried = true;
      void this.options.refreshSession().then(
        (refreshed) => {
          if (!refreshed || this.disposed || this.hold.kind !== 'auth') return;
          this.setHold(NO_HOLD);
          this.fire('retry');
        },
        () => undefined,
      );
    }
  }

  dispose(): void {
    this.disposed = true;
    this.clearRetry();
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = null;
  }

  private fire(trigger: SyncTrigger): void {
    if (this.disposed || !allowsAutoSync(this.hold, trigger, this.now())) return;
    this.options.run(trigger);
  }

  private setHold(hold: SyncHold): void {
    this.hold = hold;
    this.clearRetry();
    if (hold.kind === 'backoff') {
      this.retryTimer = setTimeout(
        () => {
          this.retryTimer = null;
          this.fire('retry');
        },
        Math.max(hold.until - this.now(), 0),
      );
    }
  }

  private clearRetry(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }
}
