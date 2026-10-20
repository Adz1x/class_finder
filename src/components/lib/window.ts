/**
 * The time window: the times a student says they can do something in.
 *
 * One window serves both questions the app answers with it - "which section
 * of this course can I take?" and "which room in this building is free?" -
 * because they are the same question with a different subject.
 *
 * A window is empty when nothing has been picked, and an empty window asks
 * nothing: every class fits it, and the app keeps behaving exactly as it
 * did before the window existed.
 */

import type { ClassMeeting, Room, RoomState, RoomStatus } from "./types";
import { timeToMinutes } from "./schedule";

export interface TimeWindow {
  /** Days the user needs: 1 = Monday .. 7 = Sunday. Empty means any day. */
  days: number[];
  /** Minutes since midnight. null means unbounded. */
  startMins: number | null;
  endMins: number | null;
}

export const EMPTY_WINDOW: TimeWindow = {
  days: [],
  startMins: null,
  endMins: null,
};

export function windowIsEmpty(window: TimeWindow): boolean {
  return (
    window.days.length === 0 &&
    window.startMins === null &&
    window.endMins === null
  );
}

/**
 * The hours a window touches, or null when it does not bound them.
 *
 * The occupancy is published hour by hour, so a window of 10:00 to 12:00
 * touches the 10:00 and the 11:00 hour.
 */
function hourBounds(
  window: TimeWindow,
): { startHour: number; endHour: number } | null {
  const { startMins, endMins } = window;
  if (startMins === null && endMins === null) return null;
  const startHour = startMins === null ? 0 : Math.floor(startMins / 60);
  const endHour = endMins === null ? 23 : Math.ceil(endMins / 60) - 1;
  // The University does not schedule classes overnight, so a window whose
  // end is before its start is not an overnight window: it bounds nothing.
  if (endHour < startHour) return null;
  return { startHour, endHour };
}

/** True when the window's hours make sense and should be applied. */
function hoursAreSensible(window: TimeWindow): boolean {
  const { startMins, endMins } = window;
  if (startMins === null || endMins === null) return true;
  return endMins >= startMins;
}

/**
 * Does a class fall inside the window?
 *
 * Containment, not overlap: a class that hangs over the end of the window
 * does not fit it, because the student cannot be in two places at once.
 */
export function meetingFitsWindow(
  meeting: ClassMeeting,
  window: TimeWindow,
): boolean {
  if (window.days.length && !window.days.includes(meeting.day)) return false;

  if (!hoursAreSensible(window)) return true;

  const start = timeToMinutes(meeting.start);
  const end = timeToMinutes(meeting.end);
  if (window.startMins !== null && start < window.startMins) return false;
  if (window.endMins !== null && end > window.endMins) return false;
  return true;
}

/**
 * The classes running inside the window.
 *
 * Overlap, not containment: a class that started before the window and runs
 * into it *is* running in the window, and a student looking for somewhere
 * to be at 2 PM needs to know it.
 */
export function classesInWindow(
  meetings: ClassMeeting[],
  window: TimeWindow,
): ClassMeeting[] {
  if (windowIsEmpty(window)) return meetings;

  const { startMins, endMins } = window;
  const bounded = hoursAreSensible(window);
  const windowStart = startMins === null ? -Infinity : startMins;
  const windowEnd = endMins === null ? Infinity : endMins;

  return meetings.filter((meeting) => {
    if (window.days.length && !window.days.includes(meeting.day)) return false;
    if (!bounded) return true;
    const start = timeToMinutes(meeting.start);
    const end = timeToMinutes(meeting.end);
    return start < windowEnd && end > windowStart;
  });
}

/**
 * Is a room free across the whole window?
 *
 * On the days that were picked, the room has to be free in every hour of
 * the window: "I need it on Tuesday *and* Thursday" means both. With no
 * day picked, any published day will do.
 *
 * "Busy" wins over "unknown": a room booked in one hour of the window is
 * definitely not free for it, and that is the more useful fact. Unknown is
 * for the case where the snapshot says nothing at all about an hour of the
 * window.
 */
export function roomStateForWindow(
  room: Room,
  window: TimeWindow,
): RoomState {
  const publishedDays = Object.keys(room.occupancy ?? {}).map(Number);
  const days = window.days.length ? window.days : publishedDays;
  if (!days.length) return "unknown";
  const bounds = hourBounds(window);

  let sawFree = false;
  let sawBusy = false;
  let sawUnknown = false;

  for (const day of days) {
    const state = roomStateOnDay(room, day, bounds);
    if (state === "free") sawFree = true;
    else if (state === "busy") sawBusy = true;
    else sawUnknown = true;
  }

  if (window.days.length) {
    // Every day that was picked has to work.
    if (sawBusy) return "busy";
    if (sawUnknown) return "unknown";
    return "free";
  }

  // Any published day will do.
  if (sawFree) return "free";
  if (sawBusy) return "busy";
  return "unknown";
}

/**
 * The room's state on one day.
 *
 * When the window names hours, the room has to be free in every one of
 * them - that is what "I need it between two and four" means. When it does
 * not, any hour of the day will do: "I need a room on Wednesday" means the
 * student will take whichever hour suits.
 */
function roomStateOnDay(
  room: Room,
  day: number,
  bounds: { startHour: number; endHour: number } | null,
): RoomState {
  const hours = room.occupancy?.[String(day)];
  if (!hours) return "unknown";

  const published = Object.keys(hours)
    .map(Number)
    .filter((value) => Number.isFinite(value));
  if (!published.length) return "unknown";

  if (!bounds) {
    // Any hour will do.
    if (published.some((hour) => !hours[String(hour)])) return "free";
    return "busy";
  }

  const touched = published.filter(
    (hour) => hour >= bounds.startHour && hour <= bounds.endHour,
  );
  for (const hour of touched) {
    if (hours[String(hour)]) return "busy";
  }

  // The window needs every hour it covers; if the snapshot does not carry
  // one of them, the room cannot be called free.
  const needed = bounds.endHour - bounds.startHour + 1;
  if (touched.length < needed) return "unknown";
  return "free";
}

/**
 * The card a room shows when the student has named a window.
 *
 * The same shape the room card uses for the current hour, so the card does
 * not change: only what it says does.
 */
export function roomStatusForWindow(
  room: Room,
  window: TimeWindow,
): RoomStatus {
  const state = roomStateForWindow(room, window);
  const days = window.days.length;

  const hoursAreNamed =
    window.startMins !== null || window.endMins !== null;

  if (state === "free") {
    return {
      state,
      statusTitle: "Available",
      nextFreeText:
        days && hoursAreNamed
          ? "Free for your window"
          : "Free at some point in your window",
      subText: "The room is listed as available for the window",
      busyUntil: null,
      nextFreeAt: null,
    };
  }

  if (state === "busy") {
    return {
      state,
      statusTitle: "Occupied",
      nextFreeText: days
        ? "Busy in your window"
        : "Busy in your window on every day",
      subText: "The room is booked in part of the window",
      busyUntil: null,
      nextFreeAt: null,
    };
  }

  return {
    state,
    statusTitle: "Unknown",
    nextFreeText: "Not published for your window",
    subText: "The source does not publish every hour of the window",
    busyUntil: null,
    nextFreeAt: null,
  };
}

/** The rooms that are free for the window first, then the rest. */
export function sortRoomsByWindow(rooms: Room[], window: TimeWindow): Room[] {
  const rank: Record<RoomState, number> = { free: 0, busy: 1, unknown: 2 };
  return [...rooms].sort(
    (a, b) =>
      rank[roomStateForWindow(a, window)] - rank[roomStateForWindow(b, window)] ||
      a.room.localeCompare(b.room),
  );
}
