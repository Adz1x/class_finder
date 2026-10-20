import { describe, expect, it } from "vitest";
import type { ClassMeeting } from "@/components/lib/types";
import {
  groupCourseSections,
  sectionFit,
  sortSectionsByFit,
} from "@/components/lib/sections";
import { EMPTY_WINDOW } from "@/components/lib/window";

function meeting(overrides: Partial<ClassMeeting> = {}): ClassMeeting {
  return {
    courseCode: "ISP100H5",
    courseTitle: "Writing for University and Beyond",
    sectionName: "LEC0101",
    sectionType: "Lecture",
    sectionNumber: "0101",
    teachMethod: "LEC",
    instructors: ["Laura Taylor"],
    campus: "University of Toronto at Mississauga",
    campusKey: "UTM",
    facultyCode: "ERIN",
    session: "F",
    sessionCode: "20269",
    day: 2,
    start: "10:00",
    end: "12:00",
    buildingCode: "MN",
    buildingName: "Maanjiwe Nendamowinan",
    room: null,
    ...overrides,
  };
}

describe("grouping a course into sections", () => {
  it("groups the meetings of one section together", () => {
    const sections = groupCourseSections([
      meeting({ sectionName: "LEC0101", day: 2 }),
      meeting({ sectionName: "LEC0101", day: 4, start: "10:00", end: "12:00" }),
      meeting({ sectionName: "LEC0102", day: 3 }),
    ]);

    expect(sections).toHaveLength(2);
    expect(sections[0].sectionName).toBe("LEC0101");
    expect(sections[0].meetings).toHaveLength(2);
    expect(sections[0].days).toEqual([2, 4]);
  });

  it("keeps the same section name apart in the two terms", () => {
    const sections = groupCourseSections([
      meeting({ sectionName: "LEC0101", sessionCode: "20269", session: "F" }),
      meeting({ sectionName: "LEC0101", sessionCode: "20271", session: "S" }),
    ]);

    expect(sections).toHaveLength(2);
    expect(sections.map((s) => s.term).sort()).toEqual(["F", "S"]);
  });

  it("collects the days, the buildings and the instructor", () => {
    const sections = groupCourseSections([
      meeting({ day: 4, buildingCode: "MS" }),
      meeting({ day: 2, buildingCode: "MN" }),
      meeting({ buildingCode: "MN" }),
    ]);

    expect(sections[0].days).toEqual([2, 4]);
    expect(sections[0].buildings).toEqual(["MN", "MS"]);
    expect(sections[0].instructor).toBe("Laura Taylor");
  });

  it("has no instructor when the source names none", () => {
    const sections = groupCourseSections([meeting({ instructors: [] })]);
    expect(sections[0].instructor).toBeNull();
  });
});

describe("whether a section fits a window", () => {
  it("fits an empty window", () => {
    const [section] = groupCourseSections([meeting()]);
    expect(sectionFit(section, EMPTY_WINDOW).fit).toBe("fits");
  });

  it("fits when every one of its meetings fits", () => {
    const [section] = groupCourseSections([
      meeting({ day: 2, start: "10:00", end: "12:00" }),
      meeting({ day: 4, start: "10:00", end: "12:00" }),
    ]);
    const result = sectionFit(section, {
      days: [2, 4],
      startMins: 600,
      endMins: 720,
    });
    expect(result.fit).toBe("fits");
    expect(result.meetings.every((m) => m.fits)).toBe(true);
  });

  it("is only partly fitting when a section meets on two days with different times", () => {
    // Wednesday 10:00-12:00 and Friday 10:00-11:00: the Wednesday one fits
    // a Wednesday window, the Friday one does not.
    const [section] = groupCourseSections([
      meeting({ day: 3, start: "10:00", end: "12:00" }),
      meeting({ day: 5, start: "10:00", end: "11:00" }),
    ]);
    const result = sectionFit(section, {
      days: [3],
      startMins: 600,
      endMins: 720,
    });

    expect(result.fit).toBe("partial");
    expect(result.meetings[0].fits).toBe(true);
    expect(result.meetings[1].fits).toBe(false);
  });

  it("does not fit when none of its meetings fit", () => {
    const [section] = groupCourseSections([
      meeting({ day: 3, start: "09:00", end: "11:00" }),
    ]);
    expect(
      sectionFit(section, { days: [2], startMins: 600, endMins: 720 }).fit,
    ).toBe("none");
  });

  it("says why a meeting does not fit", () => {
    const [section] = groupCourseSections([
      meeting({ day: 3, start: "09:00", end: "11:00" }),
      meeting({ day: 2, start: "08:00", end: "10:00" }),
    ]);
    const result = sectionFit(section, {
      days: [2],
      startMins: 600,
      endMins: 720,
    });

    expect(result.meetings[0].reason).toMatch(/Wednesday/);
    expect(result.meetings[0].reason).toMatch(/did not pick/i);
    expect(result.meetings[1].reason).toMatch(/8:00 AM/);
    expect(result.meetings[1].reason).toMatch(/before 10:00 AM/);
  });
});

describe("ordering the sections", () => {
  it("puts the fitting sections first, then the partial ones, then the rest", () => {
    const [fits, partial, none] = groupCourseSections([
      meeting({ sectionName: "LEC0301", day: 2, start: "10:00", end: "12:00" }),
      meeting({ sectionName: "LEC0101", day: 2, start: "10:00", end: "12:00" }),
      meeting({ sectionName: "LEC0101", day: 3, start: "10:00", end: "12:00" }),
      meeting({ sectionName: "LEC0201", day: 2, start: "13:00", end: "15:00" }),
    ]);
    const window = { days: [2], startMins: 600, endMins: 720 };

    // LEC0301 fits; LEC0101 has one meeting that fits and one that does
    // not; LEC0201 does not fit at all.
    const sorted = sortSectionsByFit([none, partial, fits], window);
    expect(sorted.map((s) => s.sectionName)).toEqual([
      "LEC0301",
      "LEC0101",
      "LEC0201",
    ]);
  });

  it("orders the fitting sections by when they meet", () => {
    const [late, early] = groupCourseSections([
      meeting({ sectionName: "LEC0201", day: 2, start: "14:00", end: "16:00" }),
      meeting({ sectionName: "LEC0101", day: 2, start: "09:00", end: "11:00" }),
    ]);

    const sorted = sortSectionsByFit([late, early], EMPTY_WINDOW);
    expect(sorted.map((s) => s.sectionName)).toEqual(["LEC0101", "LEC0201"]);
  });
});
