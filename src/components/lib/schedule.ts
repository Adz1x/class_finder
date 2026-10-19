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
 * Availability of a room at a given hour.
 *
 * The UTM space database publishes a per-hour snapshot, and omits the 13:00
 * hour entirely. An omitted hour is **unknown**, never "free".
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
      nextFreeText: "Availability not published for this hour",
      subText: "The UTM space database does not publish this hour",
      busyUntil: null,
    };
  }

  if (state === "busy") {
    const busyUntil = minutesToTime((hour + 1) * 60);
    return {
      state,
      statusTitle: "Occupied",
      nextFreeText: `Booked until ${format12Hour(busyUntil)}`,
      subText: "The room is not listed as available in this hour",
      busyUntil,
    };
  }

  return {
    state,
    statusTitle: "Available",
    nextFreeText: "Free in this hour",
    subText: "The room is listed as available in this hour",
    busyUntil: null,
  };
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
