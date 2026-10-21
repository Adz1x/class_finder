import { describe, expect, it } from "vitest";
import {
  buildingLabel,
  buildingSummaries,
  classesInProgress,
  classroomKey,
  filterByTerm,
  findCourseMeetings,
  format12Hour,
  formatDuration,
  formatHourRange,
  getLiveTimeContext,
  groupByBuilding,
  layoutLanes,
  minutesToTime,
  nextClassInBuilding,
  normalizeCode,
  publishedHours,
  roomStateAt,
  roomStatusAt,
  searchCourseCodes,
  sortRoomsByNextFree,
  termOfSession,
  timeToMinutes,
} from "@/components/lib/schedule";
import { makeRoom, sampleClasses, sampleRooms } from "../fixtures/sample-dataset";

describe("time helpers", () => {
  it("converts a clock time to minutes", () => {
    expect(timeToMinutes("00:00")).toBe(0);
    expect(timeToMinutes("09:00")).toBe(540);
    expect(timeToMinutes("12:00")).toBe(720);
    expect(timeToMinutes("15:30")).toBe(930);
  });

  it("converts minutes back to a clock time", () => {
    expect(minutesToTime(0)).toBe("00:00");
    expect(minutesToTime(720)).toBe("12:00");
    expect(minutesToTime(1290)).toBe("21:30");
  });

  it("formats a 24h time as 12h", () => {
    expect(format12Hour("00:00")).toBe("12:00 AM");
    expect(format12Hour("09:00")).toBe("9:00 AM");
    expect(format12Hour("12:00")).toBe("12:00 PM");
    expect(format12Hour("13:30")).toBe("1:30 PM");
    expect(format12Hour("21:00")).toBe("9:00 PM");
  });

  it("formats a duration", () => {
    expect(formatDuration(45)).toBe("45m");
    expect(formatDuration(60)).toBe("1h");
    expect(formatDuration(90)).toBe("1h 30m");
    expect(formatDuration(180)).toBe("3h");
  });
});

describe("normalizeCode", () => {
  it("strips punctuation and case so searches match", () => {
    expect(normalizeCode("ISP100H5")).toBe("isp100h5");
    expect(normalizeCode("isp 100 h5")).toBe("isp100h5");
    expect(normalizeCode("MN-2100")).toBe("mn2100");
    expect(normalizeCode(null)).toBe("");
  });
});

describe("live time context", () => {
  it("maps Sunday to 7 and Monday to 1", () => {
    expect(getLiveTimeContext(new Date(2026, 9, 18, 10, 0)).uoftDay).toBe(7);
    expect(getLiveTimeContext(new Date(2026, 9, 19, 10, 0)).uoftDay).toBe(1);
    expect(getLiveTimeContext(new Date(2026, 9, 20, 10, 0)).uoftDay).toBe(2);
  });

  it("names the current day", () => {
    expect(getLiveTimeContext(new Date(2026, 9, 19, 10, 0)).dayName).toBe("Monday");
  });

  it("picks the term from the month", () => {
    expect(getLiveTimeContext(new Date(2026, 0, 15)).term).toBe("S");
    expect(getLiveTimeContext(new Date(2026, 8, 15)).term).toBe("F");
  });

  it("reports the current time in 12h form", () => {
    expect(getLiveTimeContext(new Date(2026, 9, 19, 13, 30)).time12).toBe("1:30 PM");
  });
});

describe("terms", () => {
  it("maps a session code onto a term", () => {
    expect(termOfSession("20269")).toBe("F");
    expect(termOfSession("20271")).toBe("S");
    expect(termOfSession("99999")).toBeNull();
  });

  it("filters meetings by the session's term", () => {
    const fall = filterByTerm(sampleClasses, "F");
    const winter = filterByTerm(sampleClasses, "S");

    expect(fall.every((m) => m.sessionCode === "20269")).toBe(true);
    expect(winter.every((m) => m.sessionCode === "20271")).toBe(true);
    expect(fall.length + winter.length).toBe(sampleClasses.length);
  });
});

describe("buildings", () => {
  it("reports an unpublished building name as such", () => {
    expect(buildingLabel("MN", "Maanjiwe Nendamowinan")).toBe(
      "Maanjiwe Nendamowinan",
    );
    expect(buildingLabel("ZZ", "ZZ Building")).toBe("Name not listed");
    expect(buildingLabel("ZZ", null)).toBe("Name not listed");
  });

  it("groups meetings by building", () => {
    const grouped = groupByBuilding(sampleClasses);
    expect(grouped.get("MN")?.length).toBe(3);
    expect(grouped.get("BA")?.length).toBe(1);
  });

  it("summarises buildings, sorted by code", () => {
    const summaries = buildingSummaries(sampleClasses);
    expect(summaries.map((b) => b.code)).toEqual(["AA", "BA", "IB", "MN"]);
    expect(summaries[3].meetingCount).toBe(3);
  });

  it("gives a room one key across the shapes its sources use", () => {
    expect(classroomKey("AP", "124")).toBe("ap124");
    expect(classroomKey("AP", "AP 124")).toBe("ap124");
    expect(classroomKey("AA", "AA-112")).toBe("aa112");
    expect(classroomKey("AA", "AA112")).toBe("aa112");
  });
});

describe("courses", () => {
  it("finds a course by its code, ignoring case and spacing", () => {
    const found = findCourseMeetings(sampleClasses, "isp100h5");
    expect(found.length).toBe(3);
    expect(found.every((m) => m.courseCode === "ISP100H5")).toBe(true);
  });

  it("does not match a course by its section code", () => {
    // The old dataset produced "ISP100H5F" labels, which nobody can search for.
    expect(findCourseMeetings(sampleClasses, "ISP100H5F")).toHaveLength(0);
  });

  it("ranks exact matches first", () => {
    const codes = searchCourseCodes(sampleClasses, "isp100");
    expect(codes[0]).toBe("ISP100H5");
  });

  it("returns nothing for an empty query", () => {
    expect(searchCourseCodes(sampleClasses, "")).toHaveLength(0);
  });
});

describe("room availability", () => {
  it("reports a listed room as free", () => {
    const mn2100 = sampleRooms[0];
    expect(roomStateAt(mn2100, 1, 8)).toBe("free");
  });

  it("reports an unlisted room as booked", () => {
    const mn2100 = sampleRooms[0];
    expect(roomStateAt(mn2100, 1, 9)).toBe("busy");
  });

  it("publishes 13:00, which the first capture left out", () => {
    const mn2100 = sampleRooms[0];
    // The space database's own time selector omits 13:00, and the first
    // capture copied that list. The source publishes 1 PM quite happily.
    expect(roomStateAt(mn2100, 1, 13)).toBe("busy");
  });

  it("treats an hour outside the published band as unknown, never free", () => {
    const mn2100 = sampleRooms[0];
    expect(roomStateAt(mn2100, 1, 6)).toBe("unknown");
    expect(roomStateAt(mn2100, 1, 21)).toBe("unknown");
  });

  it("treats a day the snapshot does not cover as unknown", () => {
    const mn2100 = sampleRooms[0];
    expect(roomStateAt(mn2100, 5, 9)).toBe("unknown");
  });

  it("describes the current status of a room", () => {
    // Monday 09:00: MN 2100 is listed as booked in the snapshot.
    const status = roomStatusAt(
      sampleRooms[0],
      getLiveTimeContext(new Date(2026, 9, 19, 9, 0)),
    );
    expect(status.state).toBe("busy");
    expect(status.statusTitle).toBe("Occupied");
    expect(status.busyUntil).toBe("10:00");
  });

  it("describes an available room", () => {
    const status = roomStatusAt(
      sampleRooms[1],
      getLiveTimeContext(new Date(2026, 9, 19, 9, 0)),
    );
    expect(status.state).toBe("free");
    expect(status.statusTitle).toBe("Available");
  });

  it("describes an unknown hour honestly", () => {
    // 06:05 is before the published band, so the source has nothing to say
    // about it and the room reads as unknown rather than free.
    const status = roomStatusAt(sampleRooms[0], getLiveTimeContext(new Date(2026, 9, 19, 6, 5)));
    expect(status.state).toBe("unknown");
    expect(status.statusTitle).toBe("Unknown");
    expect(status.nextFreeText).toMatch(/not published/i);
  });

  it("says when a busy room is free next, not merely when the hour ends", () => {
    // Booked from 09:00 through 13:00, free from 14:00.
    const booked = makeRoom({
      occupancy: {
        1: { 9: true, 10: true, 11: true, 12: true, 13: true, 14: false },
      },
    });
    const status = roomStatusAt(
      booked,
      getLiveTimeContext(new Date(2026, 9, 19, 9, 0)),
    );
    expect(status.state).toBe("busy");
    expect(status.nextFreeText).toBe("Free next at 2:00 PM");
    expect(status.nextFreeAt).toBe(14 * 60);
  });

  it("says so when a busy room has no free hour left in the day", () => {
    const booked = makeRoom({
      occupancy: { 1: { 9: true, 10: true, 11: true } },
    });
    const status = roomStatusAt(
      booked,
      getLiveTimeContext(new Date(2026, 9, 19, 9, 0)),
    );
    expect(status.nextFreeText).toMatch(/no free hour/i);
    expect(status.nextFreeAt).toBeNull();
  });

  it("puts the room that frees soonest first", () => {
    const rooms = [
      makeRoom({ room: "MN 3000", occupancy: { 1: { 9: true, 10: true, 16: false } } }),
      makeRoom({ room: "MN 2000", occupancy: { 1: { 9: true, 10: false } } }),
      makeRoom({ room: "MN 4000", occupancy: { 1: { 9: false, 10: false } } }),
    ];
    const sorted = sortRoomsByNextFree(
      rooms,
      getLiveTimeContext(new Date(2026, 9, 19, 9, 0)),
    );
    // Free now, then free at 10:00, then free at 16:00.
    expect(sorted.map((room) => room.room)).toEqual([
      "MN 4000",
      "MN 2000",
      "MN 3000",
    ]);
  });

  it("puts a room with no known free hour last", () => {
    const rooms = [
      makeRoom({ room: "MN 3000", occupancy: { 1: { 9: true, 10: true } } }),
      makeRoom({ room: "MN 2000", occupancy: { 1: { 9: false, 10: false } } }),
    ];
    const sorted = sortRoomsByNextFree(
      rooms,
      getLiveTimeContext(new Date(2026, 9, 19, 9, 0)),
    );
    expect(sorted.map((room) => room.room)).toEqual(["MN 2000", "MN 3000"]);
  });
});

describe("classes in a building", () => {
  const mnClasses = sampleClasses.filter((c) => c.buildingCode === "MN");

  it("finds the next class of the day", () => {
    const next = nextClassInBuilding(mnClasses, 1, 0);
    expect(next?.start).toBe("12:00");
  });

  it("skips classes that have already finished", () => {
    // The Monday class runs 12:00-15:00, so by 16:00 it is over.
    const next = nextClassInBuilding(mnClasses, 1, 16 * 60);
    expect(next).toBeNull();
  });

  it("returns a class that is still running", () => {
    const next = nextClassInBuilding(mnClasses, 1, 13 * 60);
    expect(next?.start).toBe("12:00");
  });

  it("finds the classes running right now", () => {
    const running = classesInProgress(mnClasses, 1, 13 * 60);
    expect(running.length).toBe(3);
    expect(running.every((c) => c.courseCode === "ISP100H5")).toBe(true);
  });
});

describe("layoutLanes", () => {
  it("puts overlapping blocks in separate lanes", () => {
    const laid = layoutLanes([
      { day: 1, start: "10:00", end: "11:00" },
      { day: 1, start: "10:30", end: "11:30" },
    ]);

    expect(laid).toHaveLength(2);
    expect(laid[0].lanes).toBe(2);
    expect(laid[0].lane).not.toBe(laid[1].lane);
  });

  it("keeps non-overlapping blocks in one lane", () => {
    const laid = layoutLanes([
      { day: 1, start: "09:00", end: "10:00" },
      { day: 1, start: "10:00", end: "11:00" },
    ]);

    expect(laid[0].lanes).toBe(1);
    expect(laid[1].lanes).toBe(1);
  });

  it("handles blocks on different days independently", () => {
    const laid = layoutLanes([
      { day: 1, start: "10:00", end: "11:00" },
      { day: 2, start: "10:00", end: "11:00" },
    ]);

    expect(laid.every((b) => b.lanes === 1)).toBe(true);
  });
});

describe("the hours the space database publishes", () => {
  const hours = [7, 8, 9, 10, 11, 12, 14, 15, 16, 17, 18, 19, 20];

  it("describes the gap in the band rather than hiding it", () => {
    // A single range would claim the 13:00 hour, which the database omits.
    expect(formatHourRange(hours)).toBe("7:00 AM – 12:00 PM and 2:00 PM – 8:00 PM");
  });

  it("describes a continuous band", () => {
    expect(formatHourRange([7, 8, 9])).toBe("7:00 AM – 9:00 AM");
  });

  it("finds the hours a set of rooms publishes", () => {
    const rooms = [
      { occupancy: { "1": { "7": false, "9": true } } },
      { occupancy: { "2": { "12": false } } },
    ] as never;

    expect(publishedHours(rooms)).toEqual([7, 9, 12]);
  });
});
