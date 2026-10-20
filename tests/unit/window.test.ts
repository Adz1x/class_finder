import { describe, expect, it } from "vitest";
import type { ClassMeeting, Room } from "@/components/lib/types";
import {
  EMPTY_WINDOW,
  classesInWindow,
  meetingFitsWindow,
  roomStateForWindow,
  roomStatusForWindow,
  sortRoomsByWindow,
  windowIsEmpty,
} from "@/components/lib/window";

/** A Tuesday 10:00-12:00 meeting, unless the test says otherwise. */
function meeting(overrides: Partial<ClassMeeting> = {}): ClassMeeting {
  return {
    courseCode: "ISP100H5",
    courseTitle: "Writing for University and Beyond",
    sectionName: "LEC0101",
    sectionType: "Lecture",
    sectionNumber: "0101",
    teachMethod: "LEC",
    instructors: ["Kathryn Franklin"],
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

function room(occupancy: Record<string, Record<string, boolean>>): Room {
  return {
    room: "MN 2100",
    building: "MN",
    buildingName: "Maanjiwe Nendamowinan",
    capacity: "60",
    campusKey: "UTM",
    occupancy,
    hoursMissing: [],
  };
}

describe("the time window", () => {
  it("is empty when nothing is picked", () => {
    expect(windowIsEmpty(EMPTY_WINDOW)).toBe(true);
    expect(windowIsEmpty({ days: [2], startMins: null, endMins: null })).toBe(
      false,
    );
    expect(windowIsEmpty({ days: [], startMins: 600, endMins: null })).toBe(
      false,
    );
  });
});

describe("a class against a window", () => {
  const tuesday = { days: [2], startMins: 600, endMins: 720 };

  it("fits an empty window, because nothing was asked for", () => {
    expect(meetingFitsWindow(meeting(), EMPTY_WINDOW)).toBe(true);
  });

  it("fits a window it sits inside", () => {
    expect(meetingFitsWindow(meeting({ start: "10:00", end: "12:00" }), tuesday)).toBe(
      true,
    );
  });

  it("does not fit a window it starts before", () => {
    expect(
      meetingFitsWindow(meeting({ start: "09:00", end: "11:00" }), tuesday),
    ).toBe(false);
  });

  it("does not fit a window it ends after", () => {
    expect(
      meetingFitsWindow(meeting({ start: "11:00", end: "13:00" }), tuesday),
    ).toBe(false);
  });

  it("does not fit a window on a day that was not picked", () => {
    expect(
      meetingFitsWindow(meeting({ day: 3, start: "10:00", end: "12:00" }), tuesday),
    ).toBe(false);
  });

  it("fits when the window picks days but the hours make no sense", () => {
    // The University does not schedule classes overnight, so a window whose
    // end is before its start is not an overnight window - it is no window.
    expect(
      meetingFitsWindow(
        meeting({ start: "09:00", end: "11:00" }),
        { days: [2], startMins: 600, endMins: 480 },
      ),
    ).toBe(true);
  });
});

describe("the classes running in a window", () => {
  it("returns the classes that overlap it", () => {
    const classes = [
      meeting({ sectionName: "A", start: "09:00", end: "10:00" }),
      meeting({ sectionName: "B", start: "11:00", end: "13:00" }),
      meeting({ sectionName: "C", start: "10:00", end: "12:00" }),
    ];
    const inWindow = classesInWindow(classes, {
      days: [],
      startMins: 600,
      endMins: 720,
    });
    expect(inWindow.map((m) => m.sectionName)).toEqual(["B", "C"]);
  });

  it("returns everything when the window is empty", () => {
    const classes = [meeting({ sectionName: "A" }), meeting({ sectionName: "B" })];
    expect(classesInWindow(classes, EMPTY_WINDOW)).toHaveLength(2);
  });
});

describe("a room against a window", () => {
  it("is free when it is free in every hour of the window", () => {
    const mn2100 = room({ 2: { 10: false, 11: false, 12: false } });
    expect(
      roomStateForWindow(mn2100, { days: [2], startMins: 600, endMins: 720 }),
    ).toBe("free");
  });

  it("is busy when it is booked in one hour of the window", () => {
    const mn2100 = room({ 2: { 10: false, 11: true, 12: false } });
    expect(
      roomStateForWindow(mn2100, { days: [2], startMins: 600, endMins: 720 }),
    ).toBe("busy");
  });

  it("is unknown, never free, when the snapshot does not carry an hour", () => {
    // The snapshot has hour 10 but not hour 11, and the window needs both.
    const mn2100 = room({ 2: { 10: false } });
    expect(
      roomStateForWindow(mn2100, { days: [2], startMins: 600, endMins: 720 }),
    ).toBe("unknown");
  });

  it("is unknown when the window is on a day the snapshot does not carry", () => {
    const mn2100 = room({ 2: { 10: false, 11: false } });
    expect(
      roomStateForWindow(mn2100, { days: [3], startMins: 600, endMins: 720 }),
    ).toBe("unknown");
  });

  it("is busy when it is booked in one of the days that were picked", () => {
    const mn2100 = room({ 2: { 10: false, 11: false }, 3: { 10: true } });
    expect(
      roomStateForWindow(mn2100, { days: [2, 3], startMins: 600, endMins: 720 }),
    ).toBe("busy");
  });

  it("is free when it is free on every day that was picked", () => {
    const mn2100 = room({ 2: { 10: false, 11: false }, 3: { 10: false, 11: false } });
    expect(
      roomStateForWindow(mn2100, { days: [2, 3], startMins: 600, endMins: 720 }),
    ).toBe("free");
  });

  it("is free on some day when no day was picked", () => {
    // No day picked means any published day will do, so a room that is
    // free on Tuesday and busy on Wednesday is free for the window.
    const mn2100 = room({ 2: { 10: false, 11: false }, 3: { 10: true } });
    expect(
      roomStateForWindow(mn2100, { days: [], startMins: 600, endMins: 720 }),
    ).toBe("free");
  });

  it("is busy on every day when no day was picked and it is booked in all of them", () => {
    const mn2100 = room({ 2: { 10: true }, 3: { 10: true } });
    expect(
      roomStateForWindow(mn2100, { days: [], startMins: 600, endMins: 720 }),
    ).toBe("busy");
  });

  it("is free when it is free at some point and no hours were picked", () => {
    // "I need a room on Wednesday" means any hour of Wednesday will do.
    const mn2100 = room({ 2: { 10: false, 11: true, 12: true } });
    expect(
      roomStateForWindow(mn2100, { days: [2], startMins: null, endMins: null }),
    ).toBe("free");
  });

  it("is busy when every published hour is booked and no hours were picked", () => {
    const mn2100 = room({ 2: { 10: true, 11: true } });
    expect(
      roomStateForWindow(mn2100, { days: [2], startMins: null, endMins: null }),
    ).toBe("busy");
  });

  it("is busy rather than unknown when it is booked in part of the window", () => {
    // The snapshot has hour 10 but not hour 11, and the room is booked in
    // hour 10: it is definitely not free for the window.
    const mn2100 = room({ 2: { 10: true } });
    expect(
      roomStateForWindow(mn2100, { days: [2], startMins: 600, endMins: 720 }),
    ).toBe("busy");
  });
});

describe("a room's status over a window", () => {
  it("says the room is free for the window", () => {
    const mn2100 = room({ 2: { 10: false, 11: false } });
    const status = roomStatusForWindow(mn2100, {
      days: [2],
      startMins: 600,
      endMins: 720,
    });
    expect(status.state).toBe("free");
    expect(status.nextFreeText).toBe("Free for your window");
  });

  it("says the room is busy in the window", () => {
    const mn2100 = room({ 2: { 10: false, 11: true } });
    const status = roomStatusForWindow(mn2100, {
      days: [2],
      startMins: 600,
      endMins: 720,
    });
    expect(status.state).toBe("busy");
    expect(status.nextFreeText).toMatch(/busy/i);
  });

  it("says the room is not published for the window", () => {
    const mn2100 = room({ 2: { 10: false } });
    const status = roomStatusForWindow(mn2100, {
      days: [2],
      startMins: 600,
      endMins: 720,
    });
    expect(status.state).toBe("unknown");
    expect(status.nextFreeText).toMatch(/not published/i);
  });
});

describe("ordering the rooms over a window", () => {
  it("puts the free rooms first", () => {
    const busy = room({ 2: { 10: true, 11: false } });
    const free = room({ 2: { 10: false, 11: false } });
    const sorted = sortRoomsByWindow(
      [
        { ...busy, room: "MN 1000" },
        { ...free, room: "MN 2000" },
      ],
      { days: [2], startMins: 600, endMins: 720 },
    );
    expect(sorted.map((r) => r.room)).toEqual(["MN 2000", "MN 1000"]);
  });
});
