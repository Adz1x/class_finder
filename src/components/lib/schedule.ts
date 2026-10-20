/**
 * Pure logic for the class + room finder.
 *
 * Nothing in this module touches `window`, `document` or the DOM, so every
 * function here is directly unit-testable.
 */

import type {
  ClassMeeting,
  Room,
  RoomState,
  RoomStatus,
  Term,
  TimeContext,
} from "./types";

export const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

/** The weekly grid runs from 8:00 to 22:00. */
export const GRID_START_HOUR = 8;
export const GRID_END_HOUR = 22;

/** Session code -> term. 20269 is Fall, 20271 is Winter. */
export const SESSION_TERMS: Record<string, Term> = {
  "20269": "F",
  "20271": "S",
};

export const CAMPUS_ORDER = ["UTM", "UTSG", "UTSC"] as const;

export const CAMPUS_LABELS: Record<string, string> = {
  UTM: "UTM",
  UTSG: "St. George",
  UTSC: "Scarborough",
};

// ---------------------------------------------------------------- time utils

export function timeToMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

export function minutesToTime(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

export function format12Hour(time: string): string {
  const [hours, minutes] = time.split(":").map(Number);
  const suffix = hours >= 12 ? "PM" : "AM";
  const hour12 = hours % 12 || 12;
  return `${hour12}:${String(minutes).padStart(2, "0")} ${suffix}`;
}

export function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours > 0 && rest > 0) return `${hours}h ${rest}m`;
  if (hours > 0) return `${hours}h`;
  return `${rest}m`;
}

export function normalizeCode(value: string | null | undefined): string {
  return (value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** The current day/time, in the vocabulary the dataset uses. */
export function getLiveTimeContext(now: Date = new Date()): TimeContext {
  const jsDay = now.getDay();
  const uoftDay = jsDay === 0 ? 7 : jsDay;
  const hours = now.getHours();
  const minutes = now.getMinutes();
  const nowMins = hours * 60 + minutes;
  const month = now.getMonth() + 1;
  const term: Term = month >= 1 && month <= 4 ? "S" : "F";
  const suffix = hours >= 12 ? "PM" : "AM";
  const hour12 = hours % 12 || 12;

  return {
    uoftDay,
    nowMins,
    time12: `${hour12}:${String(minutes).padStart(2, "0")} ${suffix}`,
    dayName: DAY_NAMES[jsDay],
    term,
    termLabel: term === "F" ? "Fall Term" : "Winter Term",
  };
}

// ------------------------------------------------------------------- terms

export function termOfSession(sessionCode: string): Term | null {
  return SESSION_TERMS[sessionCode] ?? null;
}

/** A meeting belongs to a term when its session says so. */
export function matchesTerm(meeting: ClassMeeting, term: Term): boolean {
  const session = termOfSession(meeting.sessionCode);
  if (session === null) return true;
  return session === term;
}

export function filterByTerm(
  meetings: ClassMeeting[],
  term: Term,
): ClassMeeting[] {
  return meetings.filter((meeting) => matchesTerm(meeting, term));
}

// ---------------------------------------------------------------- buildings

/** A building with no published name is reported as such rather than guessed. */
export function buildingLabel(code: string, name?: string | null): string {
  if (!name || name === `${code} Building`) return "Name not listed";
  return name;
}

export interface BuildingSummary {
  code: string;
  name: string;
  meetingCount: number;
}

export function groupByBuilding(
  meetings: ClassMeeting[],
): Map<string, ClassMeeting[]> {
  const grouped = new Map<string, ClassMeeting[]>();
  for (const meeting of meetings) {
    const bucket = grouped.get(meeting.buildingCode);
    if (bucket) bucket.push(meeting);
    else grouped.set(meeting.buildingCode, [meeting]);
  }
  return grouped;
}

export function buildingSummaries(meetings: ClassMeeting[]): BuildingSummary[] {
  const grouped = groupByBuilding(meetings);
  const summaries: BuildingSummary[] = [];
  for (const [code, group] of grouped) {
    summaries.push({
      code,
      name: buildingLabel(code, group[0]?.buildingName),
      meetingCount: group.length,
    });
  }
  return summaries.sort((a, b) => a.code.localeCompare(b.code));
}

// ------------------------------------------------------------------ courses

/** Every meeting of a course, matched on the course code students type. */
export function findCourseMeetings(
  classes: ClassMeeting[],
  courseCode: string,
): ClassMeeting[] {
  const wanted = normalizeCode(courseCode);
  if (!wanted) return [];
  return classes.filter(
    (meeting) => normalizeCode(meeting.courseCode) === wanted,
  );
}

/** Course codes matching a search term, best matches first. */
export function searchCourseCodes(
  classes: ClassMeeting[],
  query: string,
  limit = 25,
): string[] {
  const wanted = normalizeCode(query);
  if (!wanted) return [];
  const scores = new Map<string, number>();
  for (const meeting of classes) {
    const code = meeting.courseCode;
    const normalized = normalizeCode(code);
    let score = -1;
    if (normalized === wanted) score = 0;
    else if (normalized.startsWith(wanted)) score = 1;
    else if (normalized.includes(wanted)) score = 2;
    if (score >= 0 && (!scores.has(code) || scores.get(code)! > score)) {
      scores.set(code, score);
    }
  }
  return [...scores.entries()]
    .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([code]) => code);
}

// -------------------------------------------------------------------- rooms

/**
 * The hours the space database publishes at all, sorted.
 *
 * The snapshot covers a band of hours - 07:00 to 20:00 - so "the current
 * hour" is often simply not in the data. Knowing the published band lets the
 * UI say so once, instead of repeating "unknown" on every room card.
 */
export function publishedHours(rooms: Room[]): number[] {
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

/** "7:00 AM" for a whole hour. */
export function formatHour(hour: number): string {
  const suffix = hour >= 12 ? "PM" : "AM";
  const h12 = hour % 12 || 12;
  return `${h12}:00 ${suffix}`;
}

/**
 * "7:00 AM – 8:00 PM" for a list of whole hours.
 *
 * The published hours are not always continuous - a capture that skipped an
 * hour would leave a gap - so each run of consecutive hours is described
 * separately. A single range would claim an hour the data does not have.
 */
export function formatHourRange(hours: number[]): string {
  if (!hours.length) return "";

  const runs: number[][] = [];
  let start = hours[0];
  let previous = hours[0];
  for (const hour of hours.slice(1)) {
    if (hour !== previous + 1) {
      runs.push([start, previous]);
      start = hour;
    }
    previous = hour;
  }
  runs.push([start, previous]);

  return runs
    .map(([from, to]) => `${formatHour(from)} – ${formatHour(to)}`)
    .join(" and ");
}

/** The next published hour at or after the given hour, or null. */
export function nextPublishedHour(hours: number[], hour: number): number | null {
  for (const candidate of hours) {
    if (candidate >= hour) return candidate;
  }
  return null;
}

/**
 * Availability of a room at a given hour.
 *
 * The UTM space database publishes a per-hour snapshot. An hour the snapshot
 * does not carry is **unknown**, never "free" - the two are different facts.
 */
export function roomStateAt(
  room: Room,
  day: number,
  hour: number,
): RoomState {
  const hours = room.occupancy?.[String(day)];
  if (!hours) return "unknown";
  const busy = hours[String(hour)];
  if (busy === undefined) return "unknown";
  return busy ? "busy" : "free";
}

/**
 * The next hour, at or after `hour`, in which the room is known to be free.
 *
 * The occupancy is published hour by hour, so a room that is not listed as
 * free in an hour is booked in it. The scan stays inside the day the
 * snapshot covers, and it steps over hours the snapshot does not carry:
 * an hour the source says nothing about is unknown, and unknown is never
 * free.
 */
export function nextFreeHourAt(
  room: Room,
  day: number,
  hour: number,
): number | null {
  const hours = room.occupancy?.[String(day)];
  if (!hours) return null;
  const published = Object.keys(hours)
    .map(Number)
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);
  for (const candidate of published) {
    if (candidate < hour) continue;
    if (hours[String(candidate)] === false) return candidate;
  }
  return null;
}

export function roomStatusAt(
  room: Room,
  ctx: TimeContext,
): RoomStatus {
  const hour = Math.floor(ctx.nowMins / 60);
  const state = roomStateAt(room, ctx.uoftDay, hour);

  if (state === "unknown") {
    return {
      state,
      statusTitle: "Unknown",
      nextFreeText: "Not published",
      subText: "This hour is outside the space database snapshot",
      busyUntil: null,
      nextFreeAt: null,
    };
  }

  if (state === "busy") {
    // The hour ending is not the same thing as the room becoming free: a
    // room booked from nine to one is not free at ten. The time the room
    // is actually free again is the useful one.
    const freeHour = nextFreeHourAt(room, ctx.uoftDay, hour);
    if (freeHour === null) {
      return {
        state,
        statusTitle: "Occupied",
        nextFreeText: "No free hour left today",
        subText: "The room is booked for every hour the source publishes today",
        busyUntil: null,
        nextFreeAt: null,
      };
    }
    const freeAt = minutesToTime(freeHour * 60);
    return {
      state,
      statusTitle: "Occupied",
      nextFreeText: `Free next at ${format12Hour(freeAt)}`,
      subText: "The room is not listed as available in this hour",
      busyUntil: freeAt,
      nextFreeAt: freeHour * 60,
    };
  }

  return {
    state,
    statusTitle: "Available",
    nextFreeText: "Free in this hour",
    subText: "The room is listed as available in this hour",
    busyUntil: null,
    nextFreeAt: hour * 60,
  };
}

/**
 * The rooms, the one that frees soonest first.
 *
 * A room that is free now comes first, then the room that becomes free
 * soonest, then the rooms with no known free hour left in the day. The
 * sort is stable, so rooms that free at the same time keep their order.
 */
export function sortRoomsByNextFree(rooms: Room[], ctx: TimeContext): Room[] {
  return [...rooms].sort((a, b) => {
    const left = roomStatusAt(a, ctx).nextFreeAt;
    const right = roomStatusAt(b, ctx).nextFreeAt;
    if (left === null && right === null) return 0;
    if (left === null) return 1;
    if (right === null) return -1;
    return left - right;
  });
}

/** The next class scheduled in a building, for the given day. */
export function nextClassInBuilding(
  meetings: ClassMeeting[],
  day: number,
  nowMins: number,
): ClassMeeting | null {
  const todays = meetings
    .filter((meeting) => meeting.day === day)
    .sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start));
  for (const meeting of todays) {
    if (timeToMinutes(meeting.end) > nowMins) return meeting;
  }
  return null;
}

/** Classes still running at the given time, in a building. */
export function classesInProgress(
  meetings: ClassMeeting[],
  day: number,
  nowMins: number,
): ClassMeeting[] {
  return meetings.filter(
    (meeting) =>
      meeting.day === day &&
      timeToMinutes(meeting.start) <= nowMins &&
      timeToMinutes(meeting.end) > nowMins,
  );
}

// ------------------------------------------------------------------ layout

/**
 * Place overlapping blocks side by side.
 *
 * Blocks are grouped per day, then into clusters of mutually overlapping
 * blocks. Each block in a cluster is given a lane, so two classes that
 * overlap share the column instead of hiding each other.
 */
export function layoutLanes<
  T extends { day: number; start: string; end: string },
>(blocks: T[]): (T & { lane: number; lanes: number })[] {
  const out: (T & { lane: number; lanes: number })[] = [];

  const byDay = new Map<number, T[]>();
  for (const block of blocks) {
    const bucket = byDay.get(block.day);
    if (bucket) bucket.push(block);
    else byDay.set(block.day, [block]);
  }

  for (const [, dayBlocks] of byDay) {
    let cluster: { s: number; e: number; b: T }[] = [];
    let clusterEnd = -1;

    const flush = () => {
      if (!cluster.length) return;
      const laneEnds: number[] = [];
      const lanes = new Map<T, number>();
      cluster.forEach((item) => {
        let lane = laneEnds.findIndex((end) => end <= item.s);
        if (lane === -1) {
          lane = laneEnds.length;
          laneEnds.push(item.e);
        } else {
          laneEnds[lane] = item.e;
        }
        lanes.set(item.b, lane);
      });
      cluster.forEach((item) => {
        out.push({
          ...item.b,
          lane: lanes.get(item.b) ?? 0,
          lanes: laneEnds.length,
        });
      });
      cluster = [];
    };

    const items = dayBlocks
      .map((block) => ({
        s: timeToMinutes(block.start),
        e: timeToMinutes(block.end),
        b: block,
      }))
      .sort((a, b) => a.s - b.s || b.e - a.e);

    items.forEach((item) => {
      if (cluster.length && item.s >= clusterEnd) {
        flush();
        clusterEnd = -1;
      }
      cluster.push(item);
      clusterEnd = Math.max(clusterEnd, item.e);
    });
    flush();
  }

  return out;
}
