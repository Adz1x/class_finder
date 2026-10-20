"use client";

import { useMemo } from "react";
import WindowControl from "./WindowControl";
import {
  groupCourseSections,
  sectionFit,
  sortSectionsByFit,
  type SectionFit,
} from "./lib/sections";
import { DAY_NAMES, format12Hour } from "./lib/schedule";
import type { ClassMeeting } from "./lib/types";
import type { TimeWindow } from "./lib/window";

/**
 * Every way of taking a course, and which of them fit the times the
 * student can attend.
 *
 * The University publishes every section of every course, so the answer to
 * "I need MAT223 and my section clashes" is in the data: MAT223H1 has
 * seventy-six of them. A section can meet on two days with different times
 * each day, so whether it fits is decided per meeting - and the row says
 * which meeting does not fit, rather than implying it.
 */

export interface SectionFinderProps {
  campus: string;
  courseCode: string;
  /** The class meetings of the campus, for the term on screen. */
  classes: ClassMeeting[];
  window: TimeWindow;
  onWindowChange: (window: TimeWindow) => void;
  onOpenSection: (
    courseCode: string,
    sessionCode: string,
    sectionName: string,
  ) => void;
  onOpenCourse: (courseCode: string) => void;
}

const FIT_LABELS: Record<SectionFit, string> = {
  fits: "Fits your window",
  partial: "Partly fits",
  none: "Doesn't fit",
};

const FIT_STYLES: Record<SectionFit, string> = {
  fits: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  partial: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  none: "bg-slate-900 text-slate-400 border-slate-800",
};

export default function SectionFinder({
  campus,
  courseCode,
  classes,
  window,
  onWindowChange,
  onOpenSection,
  onOpenCourse,
}: SectionFinderProps) {
  const sections = useMemo(() => {
    const meetings = classes.filter(
      (meeting) => meeting.courseCode === courseCode,
    );
    return sortSectionsByFit(groupCourseSections(meetings), window);
  }, [classes, courseCode, window]);

  const title = sections[0]?.courseTitle ?? courseCode;

  if (!sections.length) {
    return (
      <div className="bg-slate-900/40 border border-slate-800/90 rounded-2xl p-6 shadow-md">
        <h2 className="font-bold text-white text-base">Find another section</h2>
        <p className="text-xs text-slate-400 mt-2">
          No sections of {courseCode} are listed on {campus}.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="bg-slate-900/40 border border-slate-800/90 rounded-2xl p-4 space-y-3 shadow-md">
        <div className="flex items-center gap-2.5 flex-wrap">
          <i className="fa-solid fa-book-open text-blue-400 text-xs" />
          <h2 className="font-bold text-white text-base">Find another section</h2>
          <span className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-800 text-slate-300">
            {sections.length} sections
          </span>
        </div>

        <p className="text-xs text-slate-400">
          {title} • {courseCode}
        </p>

        <WindowControl
          window={window}
          onChange={onWindowChange}
          label="When do you need it?"
        />

        <p className="text-xs">
          <button
            type="button"
            onClick={() => onOpenCourse(courseCode)}
            className="text-blue-400 hover:text-blue-300 font-semibold"
          >
            the whole course&apos;s timetable →
          </button>
        </p>
      </div>

      <div className="space-y-2">
        {sections.map((section) => {
          const fit = sectionFit(section, window);
          return (
            <button
              key={`${section.sessionCode}:${section.sectionName}`}
              type="button"
              onClick={() =>
                onOpenSection(
                  section.courseCode,
                  section.sessionCode,
                  section.sectionName,
                )
              }
              className="group block w-full text-left bg-slate-900 hover:bg-slate-800/90 border border-slate-800 hover:border-blue-500/50 border-l-4 border-l-blue-500 rounded-xl px-4 py-3 transition-all shadow-sm"
            >
              <div className="flex items-center gap-2.5 flex-wrap">
                <span className="text-sm font-bold text-white group-hover:text-blue-400 transition">
                  {section.sectionName}
                </span>
                {section.sectionType ? (
                  <span className="text-xs text-slate-400">{section.sectionType}</span>
                ) : null}
                <span
                  className={`text-[11px] font-semibold px-2 py-0.5 rounded-lg border ${FIT_STYLES[fit.fit]}`}
                >
                  {FIT_LABELS[fit.fit]}
                </span>
              </div>

              <div className="mt-1.5 space-y-0.5">
                {fit.meetings.map((entry) => (
                  <p
                    key={`${entry.meeting.day}-${entry.meeting.start}`}
                    className="text-xs"
                  >
                    <span
                      className={
                        entry.fits ? "text-emerald-300" : "text-slate-400"
                      }
                    >
                      {DAY_NAMES[entry.meeting.day % 7]}{" "}
                      {format12Hour(entry.meeting.start)} –{" "}
                      {format12Hour(entry.meeting.end)}
                    </span>
                    {entry.reason ? (
                      <span className="text-slate-500"> · {entry.reason}</span>
                    ) : null}
                  </p>
                ))}
              </div>

              <p className="text-xs text-slate-400 mt-1">
                {section.buildings.join(", ") || "building not listed"} •{" "}
                {section.instructor ?? "no instructor listed"}
              </p>
            </button>
          );
        })}
      </div>
    </div>
  );
}
