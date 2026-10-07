import type { Weekday } from '../enums';

/**
 * Pure calendar arithmetic on "YYYY-MM-DD" strings.
 *
 * Financial periods are defined on the user's local calendar date (stored as
 * `localDate` on each transaction at entry time), so period maths never needs
 * time zones and is fully deterministic. UTC Date objects are used only as a
 * day counter.
 */

export type CalendarDate = string;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;

export class InvalidDateError extends Error {
  constructor(value: string) {
    super(`Invalid calendar date: "${value}"`);
    this.name = 'InvalidDateError';
  }
}

interface DateParts {
  year: number;
  month: number; // 1–12
  day: number;
}

export function parseCalendarDate(value: string): DateParts {
  const match = ISO_DATE.exec(value);
  if (!match) throw new InvalidDateError(value);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    throw new InvalidDateError(value);
  }
  return { year, month, day };
}

export function isCalendarDate(value: string): boolean {
  try {
    parseCalendarDate(value);
    return true;
  } catch {
    return false;
  }
}

export function formatCalendarDate({ year, month, day }: DateParts): CalendarDate {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function toDayNumber(date: CalendarDate): number {
  const { year, month, day } = parseCalendarDate(date);
  return Date.UTC(year, month - 1, day) / MS_PER_DAY;
}

function fromDayNumber(dayNumber: number): CalendarDate {
  const d = new Date(dayNumber * MS_PER_DAY);
  return formatCalendarDate({
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
  });
}

export function addDays(date: CalendarDate, days: number): CalendarDate {
  return fromDayNumber(toDayNumber(date) + days);
}

/** Adds months, clamping the day to the target month's length (Jan 31 + 1 → Feb 28/29). */
export function addMonths(date: CalendarDate, months: number): CalendarDate {
  const { year, month, day } = parseCalendarDate(date);
  const zeroBased = year * 12 + (month - 1) + months;
  const targetYear = Math.floor(zeroBased / 12);
  const targetMonth = (zeroBased % 12) + 1;
  return formatCalendarDate({
    year: targetYear,
    month: targetMonth,
    day: Math.min(day, daysInMonth(targetYear, targetMonth)),
  });
}

/** Whole days from `from` to `to` (negative if `to` is earlier). */
export function daysBetween(from: CalendarDate, to: CalendarDate): number {
  return toDayNumber(to) - toDayNumber(from);
}

export function compareDates(a: CalendarDate, b: CalendarDate): -1 | 0 | 1 {
  const diff = daysBetween(b, a);
  return diff === 0 ? 0 : diff < 0 ? -1 : 1;
}

export function isWithin(date: CalendarDate, start: CalendarDate, endInclusive: CalendarDate) {
  return compareDates(date, start) >= 0 && compareDates(date, endInclusive) <= 0;
}

export function dayOfWeek(date: CalendarDate): Weekday {
  const { year, month, day } = parseCalendarDate(date);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay() as Weekday;
}

export function startOfWeek(date: CalendarDate, firstDayOfWeek: Weekday): CalendarDate {
  const offset = (dayOfWeek(date) - firstDayOfWeek + 7) % 7;
  return addDays(date, -offset);
}

/**
 * The calendar date of `instant` as seen in `timeZone` (IANA). Used when a
 * transaction is recorded, to fix its `localDate` permanently.
 */
export function toCalendarDateInZone(instant: Date, timeZone: string): CalendarDate {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value);
  return formatCalendarDate({ year: get('year'), month: get('month'), day: get('day') });
}
