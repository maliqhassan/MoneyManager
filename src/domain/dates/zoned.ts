import { getUtcOffsetMinutes } from '../regional/timeZones';
import { type CalendarDate, parseCalendarDate } from './calendar';

/** "HH:mm" 24-hour local time. */
export type LocalTime = string;

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isLocalTime(value: string): boolean {
  return TIME.test(value);
}

/**
 * The UTC instant for a wall-clock date/time in an IANA time zone.
 *
 * DST handling:
 * - ambiguous times (clocks fall back, 01:30 happens twice) resolve to the
 *   FIRST occurrence;
 * - non-existent times (clocks spring forward, 02:30) resolve to the
 *   equivalent instant after the gap (03:30), like most calendars do.
 * The local DATE is always preserved — that is what financial grouping uses.
 */
export function zonedDateTimeToInstant(
  date: CalendarDate,
  time: LocalTime,
  timeZone: string,
): Date {
  const { year, month, day } = parseCalendarDate(date);
  const match = TIME.exec(time);
  if (!match) throw new RangeError(`Invalid local time "${time}"`);
  const wallClockAsUtc = Date.UTC(year, month - 1, day, Number(match[1]), Number(match[2]));

  // Candidate instants from the offsets around the wall-clock time. Offsets
  // change at most once near any instant, so two candidates suffice.
  const firstOffset = getUtcOffsetMinutes(timeZone, new Date(wallClockAsUtc));
  const first = wallClockAsUtc - firstOffset * 60_000;
  const secondOffset = getUtcOffsetMinutes(timeZone, new Date(first));
  const second = wallClockAsUtc - secondOffset * 60_000;

  const mapsBack = (instant: number) =>
    instant + getUtcOffsetMinutes(timeZone, new Date(instant)) * 60_000 === wallClockAsUtc;
  const exact = [first, second].filter(mapsBack).sort((a, b) => a - b);
  // Ambiguous → earliest exact match; non-existent (DST gap) → pre-gap offset.
  return new Date(exact[0] ?? first);
}

/** Wall-clock "HH:mm" of an instant in a time zone. */
export function localTimeInZone(instant: Date, timeZone: string): LocalTime {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(instant);
  const hh = parts.find((p) => p.type === 'hour')?.value ?? '00';
  const mm = parts.find((p) => p.type === 'minute')?.value ?? '00';
  return `${hh.padStart(2, '0')}:${mm.padStart(2, '0')}`;
}
