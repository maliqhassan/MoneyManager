import {
  addDays,
  addMonths,
  type CalendarDate,
  compareDates,
  daysBetween,
  formatCalendarDate,
  parseCalendarDate,
  startOfWeek,
} from '../dates/calendar';
import type { Weekday } from '../enums';

/**
 * Reporting periods. Every report uses these semantics:
 *
 * - Ranges are INCLUSIVE calendar dates (`YYYY-MM-DD`) in the user's
 *   configured time zone. Transactions are matched on their stored
 *   `local_date`, so DST transitions and UTC offsets never move a
 *   transaction between periods.
 * - Periods that contain today ("this week", "this month", "this year") run
 *   to TODAY, and are compared with the same elapsed span of the previous
 *   period (e.g. 1–11 Oct vs 1–11 Sep), never a partial period against a
 *   full one. Month-end days clamp (31 Mar → 28/29 Feb).
 * - Completed periods (last week/month/3 months/year) are compared with the
 *   equivalent completed period before them.
 * - A custom range is compared with the range of equal length just before it.
 * - Weeks start on the user's chosen first day of the week.
 */

export const REPORT_PERIODS = [
  'this_week',
  'last_week',
  'this_month',
  'last_month',
  'last_3_months',
  'this_year',
  'last_year',
  'custom',
] as const;
export type ReportPeriodPreset = (typeof REPORT_PERIODS)[number];

export interface DateRange {
  start: CalendarDate;
  /** Inclusive. */
  end: CalendarDate;
}

export interface ResolvedPeriod {
  preset: ReportPeriodPreset;
  range: DateRange;
  previous: DateRange;
  /** The range ends today (data for the rest of the period does not exist yet). */
  toDate: boolean;
}

/** Orders two dates into a range (a reversed custom range is never possible). */
export function normalizeRange(a: CalendarDate, b: CalendarDate): DateRange {
  return compareDates(a, b) <= 0 ? { start: a, end: b } : { start: b, end: a };
}

export function rangeLengthDays(range: DateRange): number {
  return daysBetween(range.start, range.end) + 1;
}

function startOfMonth(date: CalendarDate): CalendarDate {
  const { year, month } = parseCalendarDate(date);
  return formatCalendarDate({ year, month, day: 1 });
}

function startOfYear(date: CalendarDate): CalendarDate {
  return formatCalendarDate({ year: parseCalendarDate(date).year, month: 1, day: 1 });
}

/** The same elapsed span, one step (`months` back, or `days` back) earlier. */
function shiftMonths(range: DateRange, months: number): DateRange {
  return { start: addMonths(range.start, -months), end: addMonths(range.end, -months) };
}

function shiftDays(range: DateRange, days: number): DateRange {
  return { start: addDays(range.start, -days), end: addDays(range.end, -days) };
}

export function resolveReportPeriod(
  preset: ReportPeriodPreset,
  today: CalendarDate,
  firstDayOfWeek: Weekday,
  custom: DateRange | null = null,
): ResolvedPeriod {
  const weekStart = startOfWeek(today, firstDayOfWeek);
  const monthStart = startOfMonth(today);
  const yearStart = startOfYear(today);
  switch (preset) {
    case 'this_week': {
      const range = { start: weekStart, end: today };
      return { preset, range, previous: shiftDays(range, 7), toDate: true };
    }
    case 'last_week': {
      const range = { start: addDays(weekStart, -7), end: addDays(weekStart, -1) };
      return { preset, range, previous: shiftDays(range, 7), toDate: false };
    }
    case 'this_month': {
      const range = { start: monthStart, end: today };
      return { preset, range, previous: shiftMonths(range, 1), toDate: true };
    }
    case 'last_month': {
      const start = addMonths(monthStart, -1);
      const range = { start, end: addDays(monthStart, -1) };
      return {
        preset,
        range,
        previous: { start: addMonths(start, -1), end: addDays(start, -1) },
        toDate: false,
      };
    }
    case 'last_3_months': {
      const start = addMonths(monthStart, -3);
      const range = { start, end: addDays(monthStart, -1) };
      return {
        preset,
        range,
        previous: { start: addMonths(start, -3), end: addDays(start, -1) },
        toDate: false,
      };
    }
    case 'this_year': {
      const range = { start: yearStart, end: today };
      return { preset, range, previous: shiftMonths(range, 12), toDate: true };
    }
    case 'last_year': {
      const start = addMonths(yearStart, -12);
      const range = { start, end: addDays(yearStart, -1) };
      return {
        preset,
        range,
        previous: { start: addMonths(start, -12), end: addDays(start, -1) },
        toDate: false,
      };
    }
    case 'custom': {
      const range = custom
        ? normalizeRange(custom.start, custom.end)
        : { start: monthStart, end: today };
      const length = rangeLengthDays(range);
      return {
        preset,
        range,
        previous: { start: addDays(range.start, -length), end: addDays(range.start, -1) },
        toDate: compareDates(range.end, today) === 0,
      };
    }
  }
}

/**
 * Dates at which to sample a balance over a range (always ending on the
 * range end): every day up to 31 days, every 7th day up to 92 days, then the
 * end of each month.
 */
export function balanceSampleDates(range: DateRange): CalendarDate[] {
  const length = rangeLengthDays(range);
  const dates: CalendarDate[] = [];
  if (length <= 92) {
    const step = length <= 31 ? 1 : 7;
    for (let d = range.end; compareDates(d, range.start) >= 0; d = addDays(d, -step)) dates.push(d);
    return dates.reverse();
  }
  for (let m = startOfMonth(range.start); compareDates(m, range.end) <= 0; m = addMonths(m, 1)) {
    const monthEnd = addDays(addMonths(m, 1), -1);
    dates.push(compareDates(monthEnd, range.end) > 0 ? range.end : monthEnd);
  }
  return dates;
}

export interface MonthBucket extends DateRange {
  /** `YYYY-MM`. */
  month: string;
}

/** The `count` calendar months ending with the month containing `end` (oldest first). */
export function trailingMonths(end: CalendarDate, count: number): MonthBucket[] {
  const lastStart = startOfMonth(end);
  const out: MonthBucket[] = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const start = addMonths(lastStart, -i);
    out.push({ month: start.slice(0, 7), start, end: addDays(addMonths(start, 1), -1) });
  }
  return out;
}
