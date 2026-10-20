import {
  billOccurrences,
  type BillPlan,
  compareExpected,
  type ExpectedItem,
  horizonRange,
  stateOf,
  summarizeExpected,
} from '../cashflow';
import {
  dueOccurrences,
  isBillPreset,
  isFinished,
  MAX_BACKLOG_DAYS,
  nextUnhandled,
  pendingOccurrences,
  previewOccurrences,
  RULE_SCHEDULE_RECURRENCE,
  RULE_SCHEDULES,
  type RuleSchedulePlan,
  scheduleOf,
  scheduledBetween,
} from '../recurring';
import {
  isOwnReminder,
  MAX_SCHEDULED_REMINDERS,
  planReminders,
  type ReminderCandidate,
  reconcileReminders,
  reminderIdentifier,
} from '../reminders';

const rule = (patch: Partial<RuleSchedulePlan> = {}): RuleSchedulePlan => ({
  frequency: 'monthly',
  interval: 1,
  startDate: '2026-01-31',
  endDate: null,
  activeFrom: '2026-01-31',
  status: 'active',
  ...patch,
});
const every = (schedule: (typeof RULE_SCHEDULES)[number]) => RULE_SCHEDULE_RECURRENCE[schedule];

describe('recurring rule schedules', () => {
  it('maps every supported schedule and recognises custom intervals', () => {
    expect(RULE_SCHEDULES.map((s) => scheduleOf(every(s)))).toEqual([...RULE_SCHEDULES]);
    expect(scheduleOf({ frequency: 'weekly', interval: 3 })).toBe('custom');
    expect(scheduleOf({ frequency: 'daily', interval: 10 })).toBe('custom');
    expect(isBillPreset('daily')).toBe(false);
    expect(isBillPreset('quarterly')).toBe(true);
  });

  it.each([
    ['daily', '2026-03-30', ['2026-03-30', '2026-03-31', '2026-04-01', '2026-04-02']],
    ['weekly', '2026-03-30', ['2026-03-30', '2026-04-06', '2026-04-13', '2026-04-20']],
    ['biweekly', '2026-03-30', ['2026-03-30', '2026-04-13', '2026-04-27', '2026-05-11']],
    ['monthly', '2026-01-31', ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']],
    ['quarterly', '2025-11-30', ['2025-11-30', '2026-02-28', '2026-05-30', '2026-08-30']],
    ['yearly', '2024-02-29', ['2024-02-29', '2025-02-28', '2026-02-28', '2027-02-28']],
  ] as const)('%s from %s never drifts', (schedule, start, expected) => {
    expect(
      previewOccurrences({ ...every(schedule), startDate: start, endDate: null }, start, 4),
    ).toEqual(expected);
  });

  it('keeps month-end and leap-day anchors on later cycles', () => {
    const monthly = rule();
    expect(scheduledBetween(monthly, '2026-01-01', '2026-12-31')).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
      '2026-05-31',
      '2026-06-30',
      '2026-07-31',
      '2026-08-31',
      '2026-09-30',
      '2026-10-31',
      '2026-11-30',
      '2026-12-31',
    ]);
    // Leap year: the 29th of February returns.
    const leap = rule({ startDate: '2027-01-31', activeFrom: '2027-01-31' });
    expect(scheduledBetween(leap, '2028-02-01', '2028-03-31')).toEqual([
      '2028-02-29',
      '2028-03-31',
    ]);
    const yearly = rule({ ...every('yearly'), startDate: '2024-02-29', activeFrom: '2024-02-29' });
    expect(scheduledBetween(yearly, '2024-01-01', '2028-12-31')).toEqual([
      '2024-02-29',
      '2025-02-28',
      '2026-02-28',
      '2027-02-28',
      '2028-02-29',
    ]);
  });

  it('uses calendar dates, so DST changes never move an occurrence', () => {
    // US DST starts 8 Mar 2026 and ends 1 Nov 2026: daily dates stay contiguous.
    const daily = rule({ ...every('daily'), startDate: '2026-03-07', activeFrom: '2026-03-07' });
    expect(scheduledBetween(daily, '2026-03-07', '2026-03-09')).toEqual([
      '2026-03-07',
      '2026-03-08',
      '2026-03-09',
    ]);
    const weekly = rule({ ...every('weekly'), startDate: '2026-10-25', activeFrom: '2026-10-25' });
    expect(scheduledBetween(weekly, '2026-10-25', '2026-11-08')).toEqual([
      '2026-10-25',
      '2026-11-01',
      '2026-11-08',
    ]);
  });

  it('respects end dates, the effective start and custom intervals', () => {
    const r = rule({ endDate: '2026-04-15' });
    expect(scheduledBetween(r, '2026-01-01', '2026-12-31')).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
    ]);
    // After a resume on 15 Mar, earlier dates are never due.
    expect(
      scheduledBetween(rule({ activeFrom: '2026-03-15' }), '2026-01-01', '2026-04-30'),
    ).toEqual(['2026-03-31', '2026-04-30']);
    const custom = rule({
      frequency: 'daily',
      interval: 10,
      startDate: '2026-01-01',
      activeFrom: '2026-01-01',
    });
    expect(scheduledBetween(custom, '2026-01-01', '2026-01-31')).toEqual([
      '2026-01-01',
      '2026-01-11',
      '2026-01-21',
      '2026-01-31',
    ]);
    expect(scheduledBetween(rule(), '2026-05-01', '2026-04-01')).toEqual([]);
  });
});

describe('pending and due occurrences', () => {
  const today = '2026-04-10';

  it('lists unhandled occurrences with their state; handled ones never come back', () => {
    const r = rule();
    const handled = new Set(['2026-02-28']);
    expect(pendingOccurrences(r, handled, today, '2026-05-31')).toEqual([
      { date: '2026-01-31', state: 'overdue' },
      { date: '2026-03-31', state: 'overdue' },
      { date: '2026-04-30', state: 'upcoming' },
      { date: '2026-05-31', state: 'upcoming' },
    ]);
    // Only past/today dates can be posted.
    expect(dueOccurrences(r, handled, today)).toEqual(['2026-01-31', '2026-03-31']);
    expect(dueOccurrences(r, handled, '2026-04-30')).toEqual([
      '2026-01-31',
      '2026-03-31',
      '2026-04-30',
    ]);
    expect(stateOf('2026-04-10', today)).toBe('due_today');
  });

  it('caps the backlog and ignores paused or ended rules', () => {
    const daily = rule({ ...every('daily'), startDate: '2025-01-01', activeFrom: '2025-01-01' });
    const due = dueOccurrences(daily, new Set(), today);
    expect(due).toHaveLength(MAX_BACKLOG_DAYS + 1);
    expect(due[0]).toBe('2026-01-10');
    expect(pendingOccurrences(rule({ status: 'paused' }), new Set(), today, today)).toEqual([]);
    expect(pendingOccurrences(rule({ status: 'ended' }), new Set(), today, today)).toEqual([]);
  });

  it('finds the next unhandled date and when a schedule is finished', () => {
    const r = rule({ endDate: '2026-03-31' });
    expect(nextUnhandled(r, new Set(), today)).toBe('2026-01-31');
    expect(nextUnhandled(r, new Set(['2026-01-31', '2026-02-28']), today)).toBe('2026-03-31');
    const all = new Set(['2026-01-31', '2026-02-28', '2026-03-31']);
    expect(nextUnhandled(r, all, today)).toBeNull();
    expect(isFinished(r, all, today)).toBe(true);
    expect(isFinished(rule(), all, today)).toBe(false);
    expect(nextUnhandled(rule({ status: 'ended' }), new Set(), today)).toBeNull();
  });
});

describe('upcoming cash flow', () => {
  const today = '2026-10-19';
  const bill = (patch: Partial<BillPlan> = {}): BillPlan => ({
    id: 'b1',
    name: 'Rent',
    frequency: 'monthly',
    interval: 1,
    anchorDate: '2026-01-31',
    endDate: null,
    nextDueDate: '2026-09-30',
    amountMinor: 120_000,
    currency: 'USD',
    accountName: 'Checking',
    isVariableAmount: false,
    isSubscription: false,
    ...patch,
  });

  it('projects unpaid bill dates once, never ones already settled', () => {
    const { from, to } = horizonRange(today, 30);
    expect({ from, to }).toEqual({ from: '2026-09-19', to: '2026-11-17' });
    const items = billOccurrences(bill(), new Set(), from, to, today);
    expect(items.map((i) => [i.date, i.state])).toEqual([
      ['2026-09-30', 'overdue'],
      ['2026-10-31', 'upcoming'],
    ]);
    // A payment (paid, linked or skipped) for a date removes it.
    expect(
      billOccurrences(bill(), new Set(['2026-09-30']), from, to, today).map((i) => i.date),
    ).toEqual(['2026-10-31']);
    // Dates before the next unpaid due date are already paid.
    expect(
      billOccurrences(bill({ nextDueDate: '2026-10-31' }), new Set(), from, to, today).map(
        (i) => i.date,
      ),
    ).toEqual(['2026-10-31']);
  });

  const item = (patch: Partial<ExpectedItem>): ExpectedItem => ({
    key: 'k',
    source: 'recurring',
    sourceId: 'r',
    name: 'x',
    date: today,
    type: 'expense',
    amountMinor: 100,
    currency: 'USD',
    accountName: null,
    state: 'due_today',
    approximate: false,
    isSubscription: false,
    ...patch,
  });

  it('sums income and expenses per currency exactly', () => {
    expect(
      summarizeExpected([
        item({ type: 'income', amountMinor: 500_000 }),
        item({ amountMinor: 120_001 }),
        item({ amountMinor: 1 }),
        item({ currency: 'JPY', amountMinor: 1_500, approximate: true }),
        item({ currency: 'KWD', type: 'income', amountMinor: 1_234 }),
      ]),
    ).toEqual([
      { currency: 'JPY', incomeMinor: 0, expenseMinor: 1_500, netMinor: -1_500, approximate: true },
      { currency: 'KWD', incomeMinor: 1_234, expenseMinor: 0, netMinor: 1_234, approximate: false },
      {
        currency: 'USD',
        incomeMinor: 500_000,
        expenseMinor: 120_002,
        netMinor: 379_998,
        approximate: false,
      },
    ]);
    expect(summarizeExpected([])).toEqual([]);
    const sorted = [
      item({ date: '2026-10-21', key: 'b' }),
      item({ date: '2026-10-20', key: 'a' }),
    ].sort(compareExpected);
    expect(sorted.map((i) => i.key)).toEqual(['a', 'b']);
  });
});

describe('reminder planning', () => {
  const candidate = (patch: Partial<ReminderCandidate> = {}): ReminderCandidate => ({
    source: 'bill',
    sourceId: 'b1',
    date: '2026-11-02',
    leadDays: 1,
    name: 'Rent',
    type: 'expense',
    amountMinor: 120_000,
    currency: 'USD',
    ...patch,
  });
  const opts = {
    timeZone: 'America/New_York',
    time: '09:00',
    now: new Date('2026-10-19T12:00:00Z'),
  };

  it('schedules at the local time on (date − lead), across a DST change', () => {
    const [r] = planReminders([candidate()], opts);
    expect(r).toMatchObject({ identifier: 'mm:bill:b1:2026-11-02', remindOn: '2026-11-01' });
    // 1 Nov 2026 is after the fall-back: 09:00 EST = 14:00 UTC.
    expect(r!.fireAt.toISOString()).toBe('2026-11-01T14:00:00.000Z');
    const [summer] = planReminders([candidate({ date: '2026-10-25', leadDays: 0 })], opts);
    expect(summer!.fireAt.toISOString()).toBe('2026-10-25T13:00:00.000Z'); // EDT
  });

  it('skips items without a reminder, past moments and duplicates; caps the total', () => {
    expect(planReminders([candidate({ leadDays: null })], opts)).toEqual([]);
    const today = [candidate({ date: '2026-10-19', leadDays: 0 })];
    expect(planReminders(today, opts)).toHaveLength(1); // 08:00 in New York: 09:00 still ahead
    expect(planReminders(today, { ...opts, now: new Date('2026-10-19T13:30:00Z') })).toEqual([]); // passed
    expect(planReminders([candidate(), candidate()], opts)).toHaveLength(1);
    const many = Array.from({ length: 80 }, (_, i) =>
      candidate({ sourceId: `r${i}`, source: 'recurring', date: '2026-11-02' }),
    );
    const planned = planReminders(many, opts);
    expect(planned).toHaveLength(MAX_SCHEDULED_REMINDERS);
    expect(planned[0]!.identifier.startsWith('mm:rule:')).toBe(true);
    expect(reminderIdentifier({ source: 'recurring', sourceId: 'x', date: '2026-01-01' })).toBe(
      'mm:rule:x:2026-01-01',
    );
    expect(isOwnReminder('expo-other')).toBe(false);
  });

  it('reconciles idempotently: keeps unchanged, replaces changed, cancels unwanted', () => {
    const planned = planReminders(
      [candidate(), candidate({ sourceId: 'b2', date: '2026-11-05' })],
      opts,
    );
    const fp = (p: (typeof planned)[number]) => `${p.fireAt.getTime()}|${p.name}`;
    const first = reconcileReminders(planned, [], fp);
    expect(first.cancel).toEqual([]);
    expect(first.schedule.map((p) => p.identifier)).toEqual([
      'mm:bill:b1:2026-11-02',
      'mm:bill:b2:2026-11-05',
    ]);
    const scheduled = planned.map((p) => ({
      identifier: p.identifier,
      fireAt: p.fireAt.getTime(),
      fingerprint: fp(p),
    }));
    // Same data again: nothing to do (no duplicates after restarts).
    expect(reconcileReminders(planned, scheduled, fp)).toEqual({ cancel: [], schedule: [] });
    // b2 paid (gone), b1 renamed (changed), a foreign notification untouched.
    const next = planReminders([candidate({ name: 'Rent (new)' })], opts);
    const r = reconcileReminders(
      next,
      [...scheduled, { identifier: 'someone-else', fireAt: null, fingerprint: null }],
      fp,
    );
    expect(r.cancel).toEqual(['mm:bill:b1:2026-11-02', 'mm:bill:b2:2026-11-05']);
    expect(r.schedule.map((p) => p.name)).toEqual(['Rent (new)']);
  });
});
