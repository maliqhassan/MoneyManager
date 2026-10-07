import { todayInZone, toCalendarDateInZone } from '../../dates/calendar';
import { currentBudgetPeriod } from '../budget';

const monthly = { periodType: 'monthly', startDate: '2020-01-01', endDate: null } as const;
const weekly = { periodType: 'weekly', startDate: '2020-01-01', endDate: null } as const;
const settings = { firstDayOfWeek: 1, monthStartDay: 1 } as const;

describe('local date in the user time zone', () => {
  it('resolves the calendar day around midnight', () => {
    const instant = new Date('2026-11-01T03:30:00Z');
    expect(todayInZone('America/New_York', instant)).toBe('2026-10-31'); // 23:30 EDT
    expect(todayInZone('UTC', instant)).toBe('2026-11-01');
    expect(todayInZone('Asia/Kolkata', instant)).toBe('2026-11-01');
  });

  it('handles the extreme offsets (+14 / -11)', () => {
    const instant = new Date('2026-06-30T11:00:00Z');
    expect(toCalendarDateInZone(instant, 'Pacific/Kiritimati')).toBe('2026-07-01');
    expect(toCalendarDateInZone(instant, 'Pacific/Pago_Pago')).toBe('2026-06-30');
  });

  it('is stable across DST transitions', () => {
    // US DST ends 2026-11-01 at 02:00 local: 01:30 happens twice.
    expect(toCalendarDateInZone(new Date('2026-11-01T05:30:00Z'), 'America/New_York')).toBe(
      '2026-11-01',
    );
    expect(toCalendarDateInZone(new Date('2026-11-01T06:30:00Z'), 'America/New_York')).toBe(
      '2026-11-01',
    );
    // US DST starts 2026-03-08: 02:00–03:00 does not exist.
    expect(toCalendarDateInZone(new Date('2026-03-08T07:30:00Z'), 'America/New_York')).toBe(
      '2026-03-08',
    );
    // Lord Howe Island (+10:30, 30-minute DST shift): 13:45Z is 00:15 local.
    expect(toCalendarDateInZone(new Date('2026-10-03T13:45:00Z'), 'Australia/Lord_Howe')).toBe(
      '2026-10-04',
    );
  });
});

describe('budget periods use the configured time zone', () => {
  const lateOctoberInNewYork = new Date('2026-11-01T03:30:00Z');

  it('monthly budget is still October in New York while UTC is in November', () => {
    expect(
      currentBudgetPeriod(monthly, lateOctoberInNewYork, 'America/New_York', settings),
    ).toEqual({
      start: '2026-10-01',
      end: '2026-10-31',
    });
    expect(currentBudgetPeriod(monthly, lateOctoberInNewYork, 'UTC', settings)).toEqual({
      start: '2026-11-01',
      end: '2026-11-30',
    });
  });

  it('weekly budget week boundary follows the local day and first day of week', () => {
    // Sunday 23:30 in Dubai = Sunday 19:30 UTC; Monday 00:30 Dubai = Sunday 20:30 UTC.
    const sundayNight = new Date('2026-10-11T19:30:00Z');
    const mondayMorning = new Date('2026-10-11T20:30:00Z');
    expect(currentBudgetPeriod(weekly, sundayNight, 'Asia/Dubai', settings)).toEqual({
      start: '2026-10-05',
      end: '2026-10-11',
    });
    expect(currentBudgetPeriod(weekly, mondayMorning, 'Asia/Dubai', settings)).toEqual({
      start: '2026-10-12',
      end: '2026-10-18',
    });
    // With Sunday as first day the same instant is mid-week.
    expect(
      currentBudgetPeriod(weekly, mondayMorning, 'Asia/Dubai', { ...settings, firstDayOfWeek: 0 }),
    ).toEqual({ start: '2026-10-11', end: '2026-10-17' });
  });

  it('daily boundary: the same instant belongs to different days per zone', () => {
    const instant = new Date('2026-12-31T22:00:00Z');
    expect(todayInZone('Asia/Tokyo', instant)).toBe('2027-01-01');
    expect(todayInZone('Europe/London', instant)).toBe('2026-12-31');
    expect(todayInZone('America/Los_Angeles', instant)).toBe('2026-12-31');
  });
});
