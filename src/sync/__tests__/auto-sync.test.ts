import type { ErrorCode } from '@/lib/errors';
import {
  allowsAutoSync,
  AutoSyncController,
  backoffDelayMs,
  nextHold,
  SERVER_NOT_READY_BACKOFF,
  type SyncHold,
  type SyncTrigger,
  TRANSIENT_BACKOFF,
} from '@/sync/autoSync';
import { SyncEngine } from '@/sync/SyncEngine';
import type { SyncStatusSnapshot } from '@/sync/types';
import { FakeRemote } from '@/test/fakeRemote';
import { sequentialIds } from '@/test/factories';
import { createAccount, createLedger, type Ledger, TZ } from '@/test/ledger';

const ALL_TRIGGERS: SyncTrigger[] = [
  'start',
  'reconnect',
  'foreground',
  'local_change',
  'interval',
  'retry',
];
const T0 = 1_000_000;
const mid = () => 0.5; // deterministic jitter: 75 % of the exact delay

describe('backoffDelayMs', () => {
  it('doubles from the base and is capped, with 50–100 % jitter', () => {
    const max = () => 0.999999;
    expect(backoffDelayMs(1, TRANSIENT_BACKOFF, max)).toBe(4_999);
    expect(backoffDelayMs(2, TRANSIENT_BACKOFF, max)).toBe(9_999);
    expect(backoffDelayMs(1, TRANSIENT_BACKOFF, () => 0)).toBe(2_500);
    expect(backoffDelayMs(50, TRANSIENT_BACKOFF, max)).toBeLessThanOrEqual(TRANSIENT_BACKOFF.maxMs);
    expect(backoffDelayMs(50, SERVER_NOT_READY_BACKOFF, max)).toBeLessThanOrEqual(30 * 60_000);
    expect(backoffDelayMs(50, SERVER_NOT_READY_BACKOFF, () => 0)).toBe(15 * 60_000);
  });
});

describe('nextHold', () => {
  const none: SyncHold = { kind: 'none' };

  it('clears on success and waits for connectivity when offline', () => {
    expect(nextHold({ kind: 'auth' }, null, T0)).toEqual(none);
    expect(nextHold(none, 'offline', T0)).toEqual({ kind: 'offline' });
    expect(nextHold(none, 'unauthorized', T0)).toEqual({ kind: 'auth' });
  });

  it('counts consecutive failures per reason', () => {
    const first = nextHold(none, 'server_not_ready', T0, mid);
    expect(first).toEqual({
      kind: 'backoff',
      reason: 'server_not_ready',
      failures: 1,
      until: T0 + 45_000,
    });
    const second = nextHold(first, 'server_not_ready', T0, mid);
    expect(second).toMatchObject({ failures: 2, until: T0 + 90_000 });
    // A different kind of failure starts its own count.
    expect(nextHold(second, 'network', T0, mid)).toMatchObject({
      reason: 'transient',
      failures: 1,
      until: T0 + 3_750,
    });
    expect(nextHold(none, 'timeout', T0, mid)).toMatchObject({ reason: 'transient' });
    expect(nextHold(none, 'unknown', T0, mid)).toMatchObject({ reason: 'transient' });
  });
});

describe('allowsAutoSync', () => {
  it('server_not_ready blocks every automatic trigger until the cooldown ends', () => {
    const hold: SyncHold = {
      kind: 'backoff',
      reason: 'server_not_ready',
      failures: 1,
      until: T0 + 60_000,
    };
    for (const trigger of ALL_TRIGGERS) {
      expect(allowsAutoSync(hold, trigger, T0 + 59_999)).toBe(false);
      expect(allowsAutoSync(hold, trigger, T0 + 60_000)).toBe(true);
    }
  });

  it('transient failures may retry early on reconnect or foreground only', () => {
    const hold: SyncHold = { kind: 'backoff', reason: 'transient', failures: 1, until: T0 + 5_000 };
    const allowed = ALL_TRIGGERS.filter((t) => allowsAutoSync(hold, t, T0));
    expect(allowed).toEqual(['reconnect', 'foreground']);
  });

  it('offline waits for connectivity; an expired session only retries on foreground', () => {
    expect(ALL_TRIGGERS.filter((t) => allowsAutoSync({ kind: 'offline' }, t, T0))).toEqual([
      'start',
      'reconnect',
      'foreground',
    ]);
    expect(ALL_TRIGGERS.filter((t) => allowsAutoSync({ kind: 'auth' }, t, T0))).toEqual([
      'foreground',
    ]);
  });
});

describe('AutoSyncController', () => {
  beforeEach(() => jest.useFakeTimers({ now: T0 }));
  afterEach(() => jest.useRealTimers());

  const make = (refreshSession?: () => Promise<boolean>) => {
    const runs: SyncTrigger[] = [];
    const controller = new AutoSyncController({
      run: (trigger) => runs.push(trigger),
      refreshSession,
      random: mid,
    });
    return { controller, runs };
  };

  it('debounces bursts of local changes into one run', () => {
    const { controller, runs } = make();
    controller.request('local_change');
    jest.advanceTimersByTime(1_000);
    controller.request('local_change');
    controller.request('local_change');
    jest.advanceTimersByTime(1_999);
    expect(runs).toEqual([]);
    jest.advanceTimersByTime(1);
    expect(runs).toEqual(['local_change']);
  });

  it('retries a transient failure on a growing, bounded timer', () => {
    const { controller, runs } = make();
    controller.record('network');
    jest.advanceTimersByTime(3_749);
    expect(runs).toEqual([]);
    jest.advanceTimersByTime(1);
    expect(runs).toEqual(['retry']);
    controller.record('network');
    jest.advanceTimersByTime(7_500);
    expect(runs).toEqual(['retry', 'retry']);
    for (let i = 0; i < 20; i += 1) controller.record('timeout');
    const hold = controller.getHold();
    expect(hold.kind === 'backoff' && hold.until - Date.now()).toBeLessThanOrEqual(
      TRANSIENT_BACKOFF.maxMs,
    );
  });

  it('server_not_ready: ignores triggers during the cooldown, then probes once', () => {
    const { controller, runs } = make();
    controller.record('server_not_ready');
    for (const trigger of ALL_TRIGGERS) controller.request(trigger);
    jest.advanceTimersByTime(44_999);
    expect(runs).toEqual([]);
    jest.advanceTimersByTime(1);
    expect(runs).toEqual(['retry']);
  });

  it('a successful run (e.g. "Sync now") clears the hold', () => {
    const { controller, runs } = make();
    controller.record('server_not_ready');
    controller.record(null);
    controller.request('interval');
    expect(runs).toEqual(['interval']);
    jest.advanceTimersByTime(60 * 60_000);
    expect(runs).toEqual(['interval']); // no stray retry timer
  });

  it('refreshes an expired session once and retries when that works', async () => {
    const refresh = jest.fn().mockResolvedValue(true);
    const { controller, runs } = make(refresh);
    controller.record('unauthorized');
    await Promise.resolve();
    await Promise.resolve();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(runs).toEqual(['retry']);
    // Still rejected: no second refresh, no automatic loop.
    controller.record('unauthorized');
    await Promise.resolve();
    controller.request('interval');
    controller.request('local_change');
    jest.advanceTimersByTime(60 * 60_000);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(runs).toEqual(['retry']);
    expect(controller.getHold()).toEqual({ kind: 'auth' });
  });

  it('stays held when the session cannot be refreshed', async () => {
    const refresh = jest.fn().mockResolvedValue(false);
    const { controller, runs } = make(refresh);
    controller.record('unauthorized');
    await Promise.resolve();
    await Promise.resolve();
    expect(runs).toEqual([]);
    controller.request('foreground');
    expect(runs).toEqual(['foreground']);
  });

  it('offline: only reconnect / foreground start a run', () => {
    const { controller, runs } = make();
    controller.markOffline();
    controller.request('local_change');
    controller.request('interval');
    jest.advanceTimersByTime(10_000);
    expect(runs).toEqual([]);
    controller.request('reconnect');
    expect(runs).toEqual(['reconnect']);
  });

  it('does nothing after dispose', () => {
    const { controller, runs } = make();
    controller.record('network');
    controller.request('local_change');
    controller.dispose();
    jest.advanceTimersByTime(60 * 60_000);
    controller.request('start');
    expect(runs).toEqual([]);
  });
});

/**
 * End to end with the real engine and database against a server whose schema
 * is behind (every request fails with PGRST205, as PostgREST does).
 */
describe('automatic sync against a server that is not ready', () => {
  let L: Ledger;
  let remote: FakeRemote;
  let engine: SyncEngine;
  let controller: AutoSyncController;
  let lastRun: Promise<unknown> = Promise.resolve();
  let runCount = 0;
  const statuses: SyncStatusSnapshot[] = [];

  beforeEach(async () => {
    L = await createLedger();
    remote = new FakeRemote();
    engine = new SyncEngine({ db: L.db, remote, newId: sequentialIds() });
    engine.subscribe((s) => statuses.push(s));
    controller = new AutoSyncController({
      run: () => {
        runCount += 1;
        lastRun = engine.sync();
      },
      random: mid,
    });
    engine.onRunFinished((r) => controller.record(r.errorCode as ErrorCode | null));
    runCount = 0;
    statuses.length = 0;
    const chk = await createAccount(L);
    await L.repos.transactions.create({
      type: 'expense',
      accountId: chk.id,
      amountMinor: 1_250,
      localDate: '2026-10-20',
      localTime: '09:00',
      timeZone: TZ,
      categoryId: L.cat.groceries,
    });
    jest.useFakeTimers({ now: T0, doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
  });
  afterEach(() => {
    controller.dispose();
    jest.useRealTimers();
    L.db.close();
  });

  const outbox = () =>
    L.db.getAll<{ status: string }>(`SELECT status FROM sync_outbox ORDER BY rowid`);

  it('makes no requests during the cooldown, keeps the queue and the message, and resumes after the server update', async () => {
    remote.outage = 'schema_missing';
    controller.request('start');
    await lastRun;
    expect(engine.getStatus().lastErrorCode).toBe('server_not_ready');
    const callsAfterFirstRun = remote.calls.length;
    const queued = (await outbox()).length;
    expect(queued).toBeGreaterThan(0);

    // A burst of automatic triggers inside the cooldown: no request at all.
    for (const trigger of ALL_TRIGGERS) controller.request(trigger);
    await jest.advanceTimersByTimeAsync(44_000);
    expect(runCount).toBe(1);
    expect(remote.calls.length).toBe(callsAfterFirstRun);
    expect((await outbox()).every((o) => o.status === 'pending')).toBe(true);

    // The probe fails again; the explanation never disappears while it runs.
    statuses.length = 0;
    await jest.advanceTimersByTimeAsync(1_000);
    await lastRun;
    expect(runCount).toBe(2);
    expect(statuses.some((s) => s.phase === 'syncing')).toBe(true);
    expect(statuses.every((s) => s.lastErrorCode === 'server_not_ready')).toBe(true);
    // The next cooldown is longer.
    expect(controller.getHold()).toMatchObject({ reason: 'server_not_ready', failures: 2 });
    expect((await outbox()).length).toBe(queued);

    // Server updated: the next probe succeeds without any user action.
    remote.outage = null;
    await jest.advanceTimersByTimeAsync(90_000);
    await lastRun;
    expect(runCount).toBe(3);
    expect(engine.getStatus()).toMatchObject({
      lastErrorCode: null,
      phase: 'idle',
      pendingCount: 0,
    });
    expect(await outbox()).toEqual([]);
    expect(remote.tables.get('transactions')?.size).toBe(1);
    expect(controller.getHold()).toEqual({ kind: 'none' });

    // Back to normal: a local save syncs after the debounce.
    controller.request('local_change');
    await jest.advanceTimersByTimeAsync(2_000);
    expect(runCount).toBe(4);
    await lastRun;
  });

  it('never parks the queued change as failed or duplicates it across probes', async () => {
    remote.outage = 'schema_missing';
    controller.request('start');
    await lastRun;
    for (let probe = 0; probe < 6; probe += 1) {
      await jest.advanceTimersByTimeAsync(SERVER_NOT_READY_BACKOFF.maxMs);
      await lastRun;
    }
    // 3 hours: cooldowns 45 s, 90 s, 3 min … capped at 22.5 min (with this jitter),
    // so 11 probes after the first run — then about 3 per hour.
    expect(runCount).toBe(12);
    expect(engine.getStatus().failedCount).toBe(0);
    remote.outage = null;
    await jest.advanceTimersByTimeAsync(SERVER_NOT_READY_BACKOFF.maxMs);
    await lastRun;
    expect(remote.tables.get('transactions')?.size).toBe(1);
    expect(await outbox()).toEqual([]);
  });
});

describe('AutoSyncController offline transitions', () => {
  beforeEach(() => jest.useFakeTimers({ now: T0 }));
  afterEach(() => jest.useRealTimers());

  it('going offline and back does not cut a server_not_ready or auth hold short', () => {
    const runs: SyncTrigger[] = [];
    const controller = new AutoSyncController({ run: (t) => runs.push(t), random: mid });
    controller.record('server_not_ready');
    controller.markOffline();
    controller.request('reconnect');
    expect(runs).toEqual([]);
    expect(controller.getHold()).toMatchObject({ reason: 'server_not_ready' });

    controller.record('unauthorized');
    controller.markOffline();
    controller.request('reconnect');
    expect(runs).toEqual([]);
    expect(controller.getHold()).toEqual({ kind: 'auth' });
  });

  it('a transient backoff becomes "wait for connectivity" when the device goes offline', () => {
    const runs: SyncTrigger[] = [];
    const controller = new AutoSyncController({ run: (t) => runs.push(t), random: mid });
    controller.record('network');
    controller.markOffline();
    jest.advanceTimersByTime(60_000);
    expect(runs).toEqual([]); // no retry timer while offline
    controller.request('reconnect');
    expect(runs).toEqual(['reconnect']);
  });
});
