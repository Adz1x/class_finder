/**
 * Pure helpers for the per-campus day calendar: one grid of every room
 * against every published hour of a day.
 *
 * The occupancy of a room is keyed by weekday (1 = Monday), so the grid
 * asks "which rooms are free on Tuesday" rather than on a date. The dates
 * are attached from the snapshot's week start.
 */

import type { Room } from "./types";

export type CellState = "free" | "busy" | "unpublished";

/**
 * The weekdays (1 = Monday) whose occupancy any of the rooms publishes.
 *
 * The campus snapshots do not all cover the same days: a capture that
 * missed a day leaves it out, and a weekday a source does not publish at
 * all must not become a calendar column.
 */
export function coveredDays(rooms: Room[]): number[] {
  const days = new Set<number>();
  for (const room of rooms) {
    for (const day of Object.keys(room.occupancy ?? {})) {
      const value = Number(day);
      if (Number.isFinite(value)) days.add(value);
    }
  }
  return [...days].sort((a, b) => a - b);
}

/**
 * The published hours, across all rooms: the calendar's column set.
 *
 * A snapshot whose capture skipped an hour leaves a gap, so the columns
 * come from the data, not from a fixed 7 AM - 9 PM band.
 */
export function hourColumns(rooms: Room[]): number[] {
  const hours = new Set<number>();
  for (const room of rooms) {
    for (const dayHours of Object.values(room.occupancy ?? {})) {
      for (const hour of Object.keys(dayHours)) {
        const value = Number(hour);
        if (Number.isFinite(value)) hours.add(value);
      }
    }
  }
  return [...hours].sort((a, b) => a - b);
}

/**
 * One cell of the grid.
 *
 * An hour the source publishes is a fact (free or booked). An hour it does
 * not publish is unknown, and unknown renders as "not published" rather
 * than as free: the grid must never claim a room is empty where the data
 * says nothing.
 */
export function cellState(room: Room, day: number, hour: number): CellState {
  const hours = room.occupancy?.[String(day)];
  if (!hours) return "unpublished";
  const value = hours[String(hour)];
  if (value === undefined) return "unpublished";
  return value ? "busy" : "free";
}

/**
 * The rooms that have at least one published free hour on the day.
 *
 * "Free that day" is the calendar's question, and it is not the same as
 * "free in a particular hour": a room that is busy until 6 PM but free
 * until 9 PM is free that day.
 */
export function roomsFreeOnDay(rooms: Room[], day: number): Room[] {
  return rooms.filter((room) => {
    const hours = room.occupancy?.[String(day)];
    if (!hours) return false;
    return Object.values(hours).some((value) => value === false);
  });
}

/**
 * The calendar date of a covered weekday, from the snapshot's week start.
 *
 * weekStart is a Monday in local time; the day is 1-based over it. The
 * arithmetic is on local date parts, so it does not shift across the
 * time zone the way `toISOString` would.
 */
export function isoDateOf(weekStart: string, day: number): string {
  const [year, month, offset] = weekStart.split("-").map(Number);
  if (!year || !month || !offset) return "";
  const date = new Date(year, month - 1, offset + (day - 1));
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** The weekday the clock is on, in the dataset's vocabulary (1 = Monday). */
export function weekdayOfNow(now: Date): number {
  const jsDay = now.getDay();
  return jsDay === 0 ? 7 : jsDay;
}

/** "7a" / "12p" / "9p" - the short labels the column headers use. */
export function shortHour(hour: number): string {
  const suffix = hour >= 12 ? "p" : "a";
  return `${hour % 12 || 12}${suffix}`;
}
