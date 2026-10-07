import { dueDateAfter, dueInfo, compareDue, reminderDate } from '../bills';
import {
  InvalidRecurrenceError,
  isOccurrence,
  monthlyCost,
  nextOccurrenceAfter,
  nextOccurrenceOnOrAfter,
  occurrenceAt,
  occurrencesBetween,
  PRESET_RECURRENCE,
  presetOf,
  yearlyCost,
} from '../recurrence';

const { weekly, biweekly, monthly, quarterly, yearly } = PRESET_RECURRENCE;

describe('recurrence occurrences', () => {
  it('weekly and biweekly step by 7 and 14 days', () => {
    expect(occurrencesBetween('2026-10-05', weekly, '2026-10-01', '2026-10-31')).toEqual([
      '2026-10-05',
      '2026-10-12',
      '2026-10-19',
      '2026-10-26',
    ]);
    expect(occurrencesBetween('2026-10-05', biweekly, '2026-10-06', '2026-11-30')).toEqual([
      '2026-10-19',
      '2026-11-02',
      '2026-11-16',
      '2026-11-30',
    ]);
  });

  it('monthly on the 31st uses the last valid day and never drifts', () => {
    expect(occurrencesBetween('2026-01-31', monthly, '2026-01-01', '2026-06-30')).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
      '2026-05-31',
      '2026-06-30',
    ]);
  });

  it('handles leap-year Februaries', () => {
    expect(occurrenceAt('2028-01-31', monthly, 1)).toBe('2028-02-29');
    expect(occurrenceAt('2028-02-29', yearly, 1)).toBe('2029-02-28');
    expect(occurrenceAt('2028-02-29', yearly, 4)).toBe('2032-02-29');
  });

  it('quarterly and yearly', () => {
    expect(occurrencesBetween('2026-11-30', quarterly, '2026-11-01', '2027-12-31')).toEqual([
      '2026-11-30',
      '2027-02-28',
      '2027-05-30',
      '2027-08-30',
      '2027-11-30',
    ]);
    expect(occurrencesBetween('2026-03-15', yearly, '2026-01-01', '2028-12-31')).toEqual([
      '2026-03-15',
      '2027-03-15',
      '2028-03-15',
    ]);
  });

  it('daily and custom intervals', () => {
    const everyThreeDays = { frequency: 'daily', interval: 3 } as const;
    expect(occurrencesBetween('2026-10-01', everyThreeDays, '2026-10-02', '2026-10-10')).toEqual([
      '2026-10-04',
      '2026-10-07',
      '2026-10-10',
    ]);
    expect(occurrenceAt('2026-10-01', { frequency: 'monthly', interval: 2 }, 3)).toBe('2027-04-01');
  });

  it('finds the next occurrence on/after and strictly after a date', () => {
    expect(nextOccurrenceOnOrAfter('2026-01-31', monthly, '2026-02-28')).toBe('2026-02-28');
    expect(nextOccurrenceAfter('2026-01-31', monthly, '2026-02-28')).toBe('2026-03-31');
    expect(nextOccurrenceOnOrAfter('2026-01-31', monthly, '2025-12-01')).toBe('2026-01-31');
    expect(nextOccurrenceOnOrAfter('2026-01-15', monthly, '2026-03-20')).toBe('2026-04-15');
    expect(nextOccurrenceOnOrAfter('2026-01-15', monthly, '2026-03-10')).toBe('2026-03-15');
  });

  it('respects the end date', () => {
    expect(nextOccurrenceAfter('2026-01-10', monthly, '2026-03-10', '2026-03-31')).toBeNull();
    expect(nextOccurrenceAfter('2026-01-10', monthly, '2026-02-10', '2026-03-10')).toBe(
      '2026-03-10',
    );
    expect(
      occurrencesBetween('2026-01-10', monthly, '2026-01-01', '2026-12-31', '2026-04-01'),
    ).toHaveLength(3);
    expect(occurrencesBetween('2026-01-01', weekly, '2026-01-01', '2026-12-31', null, 2)).toEqual([
      '2026-01-01',
      '2026-01-08',
    ]);
  });

  it('identifies occurrences and presets', () => {
    expect(isOccurrence('2026-01-31', monthly, '2026-02-28')).toBe(true);
    expect(isOccurrence('2026-01-31', monthly, '2026-02-27')).toBe(false);
    expect(presetOf({ frequency: 'monthly', interval: 3 })).toBe('quarterly');
    expect(presetOf({ frequency: 'weekly', interval: 2 })).toBe('biweekly');
    expect(presetOf({ frequency: 'monthly', interval: 5 })).toBe('custom');
    expect(presetOf({ frequency: 'daily', interval: 1 })).toBe('custom');
  });

  it('rejects invalid intervals and indexes', () => {
    expect(() => occurrenceAt('2026-01-01', { frequency: 'weekly', interval: 0 }, 0)).toThrow(
      InvalidRecurrenceError,
    );
    expect(() => occurrenceAt('2026-01-01', { frequency: 'weekly', interval: 1.5 }, 0)).toThrow(
      InvalidRecurrenceError,
    );
    expect(() => occurrenceAt('2026-01-01', weekly, -1)).toThrow(InvalidRecurrenceError);
  });
});

describe('annualised costs (exact where possible)', () => {
  it('monthly $10 → $120/year exactly; quarterly $30 → $120/year, $10/month', () => {
    expect(yearlyCost(1_000, monthly)).toEqual({ amountMinor: 12_000, approximate: false });
    expect(yearlyCost(3_000, quarterly)).toEqual({ amountMinor: 12_000, approximate: false });
    expect(monthlyCost(3_000, quarterly)).toEqual({ amountMinor: 1_000, approximate: false });
    expect(monthlyCost(1_599, monthly)).toEqual({ amountMinor: 1_599, approximate: false });
  });

  it('yearly plans spread over months, flagging remainders', () => {
    expect(monthlyCost(12_000, yearly)).toEqual({ amountMinor: 1_000, approximate: false });
    expect(monthlyCost(9_999, yearly)).toEqual({ amountMinor: 833, approximate: true });
    expect(yearlyCost(9_999, yearly)).toEqual({ amountMinor: 9_999, approximate: false });
    expect(yearlyCost(10_000, { frequency: 'yearly', interval: 3 })).toEqual({
      amountMinor: 3_333,
      approximate: true,
    });
  });

  it('week and day based schedules are always marked approximate', () => {
    expect(yearlyCost(1_000, weekly)).toEqual({ amountMinor: 52_000, approximate: true });
    expect(yearlyCost(1_000, biweekly)).toEqual({ amountMinor: 26_000, approximate: true });
    expect(monthlyCost(1_200, weekly)).toEqual({ amountMinor: 5_200, approximate: true });
    expect(yearlyCost(100, { frequency: 'daily', interval: 1 })).toEqual({
      amountMinor: 36_500,
      approximate: true,
    });
    expect(monthlyCost(1_200, { frequency: 'daily', interval: 1 })).toEqual({
      amountMinor: 36_500,
      approximate: true,
    });
  });

  it('rounds half-even and works for zero-decimal currencies (amounts are minor units)', () => {
    expect(monthlyCost(5, { frequency: 'monthly', interval: 2 })).toEqual({
      amountMinor: 2,
      approximate: true,
    });
    expect(monthlyCost(7, { frequency: 'monthly', interval: 2 })).toEqual({
      amountMinor: 4,
      approximate: true,
    });
  });

  it('refuses results beyond the supported amount range', () => {
    expect(() => yearlyCost(1_000_000_000_000_000, monthly)).toThrow(/range/i);
  });
});

describe('bill due dates', () => {
  it('classifies overdue, due today and upcoming in local calendar days', () => {
    expect(dueInfo('2026-10-05', '2026-10-07')).toEqual({ status: 'overdue', daysUntil: -2 });
    expect(dueInfo('2026-10-07', '2026-10-07')).toEqual({ status: 'due_today', daysUntil: 0 });
    expect(dueInfo('2026-10-10', '2026-10-07')).toEqual({ status: 'upcoming', daysUntil: 3 });
  });

  it('advances after payment from the anchor (month-end safe) and stops at the end date', () => {
    const schedule = { ...monthly, anchorDate: '2026-01-31', endDate: null };
    expect(dueDateAfter(schedule, '2026-02-28')).toBe('2026-03-31');
    expect(dueDateAfter({ ...schedule, endDate: '2026-03-30' }, '2026-02-28')).toBeNull();
  });

  it('computes reminder dates and sorts by due date then name', () => {
    expect(reminderDate('2026-10-03', 3)).toBe('2026-09-30');
    expect(reminderDate('2026-10-03', null)).toBeNull();
    const list = [
      { nextDueDate: '2026-10-10', name: 'Rent' },
      { nextDueDate: '2026-10-01', name: 'Water' },
      { nextDueDate: '2026-10-10', name: 'Internet' },
    ].sort(compareDue);
    expect(list.map((b) => b.name)).toEqual(['Water', 'Internet', 'Rent']);
  });
});
