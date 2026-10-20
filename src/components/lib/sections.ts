/**
 * The sections of a course, and whether they fit a time window.
 *
 * A section is the group of meetings that make up one way of taking a
 * course: `LEC0101` on Tuesday and Thursday is one section, not two. A
 * section can meet on two days with different times each day, so whether it
 * fits is decided per meeting and rolled up afterwards.
 */

import type { ClassMeeting, Term } from "./types";
import { DAY_NAMES, SESSION_TERMS, format12Hour, minutesToTime, timeToMinutes } from "./schedule";
import { meetingFitsWindow, type TimeWindow } from "./window";

export type SectionFit = "fits" | "partial" | "none";

export interface CourseSection {
  courseCode: string;
  courseTitle: string;
  sectionName: string;
  sectionType: string;
  sectionNumber: string;
  sessionCode: string;
  term: Term;
  /** Every meeting of the section. */
  meetings: ClassMeeting[];
  /** The weekdays it meets on, sorted. */
  days: number[];
  /** The buildings it meets in, sorted. The source publishes no room. */
  buildings: string[];
  /** The first instructor the source names, or null when it names none. */
  instructor: string | null;
}

export interface MeetingFit {
  meeting: ClassMeeting;
  fits: boolean;
  /** Why it does not fit, when it does not. Empty when it fits. */
  reason: string;
}

/**
 * The sections of a course.
 *
 * Meetings are grouped by their section name and their session: the same
 * section name in the two terms is two different sections.
 */
export function groupCourseSections(meetings: ClassMeeting[]): CourseSection[] {
  const groups = new Map<string, ClassMeeting[]>();
  for (const meeting of meetings) {
    const key = `${meeting.sessionCode}:${meeting.sectionName}`;
    const group = groups.get(key);
    if (group) group.push(meeting);
    else groups.set(key, [meeting]);
  }

  const sections: CourseSection[] = [];
  for (const group of groups.values()) {
    const first = group[0];
    sections.push({
      courseCode: first.courseCode,
      courseTitle: first.courseTitle,
      sectionName: first.sectionName,
      sectionType: first.sectionType,
      sectionNumber: first.sectionNumber,
      sessionCode: first.sessionCode,
      term: SESSION_TERMS[first.sessionCode] ?? (first.session === "S" ? "S" : "F"),
      meetings: group,
      days: [...new Set(group.map((m) => m.day))].sort((a, b) => a - b),
      buildings: [...new Set(group.map((m) => m.buildingCode))].sort(),
      instructor:
        group.find((m) => m.instructors.length > 0)?.instructors[0] ?? null,
    });
  }
  return sections;
}

/**
 * Does the section fit the window?
 *
 * The verdict is per meeting, because a section can meet on two days with
 * different times and only one of them may fit.
 */
export function sectionFit(
  section: CourseSection,
  window: TimeWindow,
): { fit: SectionFit; meetings: MeetingFit[] } {
  const meetings = section.meetings.map((meeting) => {
    const fits = meetingFitsWindow(meeting, window);
    return { meeting, fits, reason: fits ? "" : whyNot(meeting, window) };
  });

  const fitting = meetings.filter((m) => m.fits).length;
  const fit: SectionFit =
    fitting === meetings.length ? "fits" : fitting === 0 ? "none" : "partial";
  return { fit, meetings };
}

/** Why a meeting does not fit, in the user's terms. */
function whyNot(meeting: ClassMeeting, window: TimeWindow): string {
  const reasons: string[] = [];

  if (window.days.length && !window.days.includes(meeting.day)) {
    reasons.push(`on ${DAY_NAMES[meeting.day % 7]}, which you did not pick`);
  }

  const start = timeToMinutes(meeting.start);
  const end = timeToMinutes(meeting.end);
  if (window.startMins !== null && start < window.startMins) {
    reasons.push(
      `it starts at ${format12Hour(meeting.start)}, before ${format12Hour(
        minutesToTime(window.startMins),
      )}`,
    );
  }
  if (window.endMins !== null && end > window.endMins) {
    reasons.push(
      `it ends at ${format12Hour(meeting.end)}, after ${format12Hour(
        minutesToTime(window.endMins),
      )}`,
    );
  }

  return reasons.join(" and ");
}

/**
 * The sections, the ones that fit first.
 *
 * Within a group, the section that meets earliest comes first, so the
 * list reads like a timetable.
 */
export function sortSectionsByFit(
  sections: CourseSection[],
  window: TimeWindow,
): CourseSection[] {
  const rank: Record<SectionFit, number> = { fits: 0, partial: 1, none: 2 };

  return [...sections].sort((a, b) => {
    const byFit =
      rank[sectionFit(a, window).fit] - rank[sectionFit(b, window).fit];
    if (byFit !== 0) return byFit;

    const first = earliestMeeting(a);
    const second = earliestMeeting(b);
    if (first.day !== second.day) return first.day - second.day;
    const byStart =
      timeToMinutes(first.start) - timeToMinutes(second.start);
    if (byStart !== 0) return byStart;
    return a.sectionName.localeCompare(b.sectionName);
  });
}

/** The meeting of a section that comes first in the week. */
function earliestMeeting(section: CourseSection): ClassMeeting {
  return [...section.meetings].sort(
    (a, b) =>
      a.day - b.day || timeToMinutes(a.start) - timeToMinutes(b.start),
  )[0];
}
