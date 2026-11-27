import { describe, expect, it } from "vitest";
import {
  cellState,
  coveredDays,
  hourColumns,
  isoDateOf,
  roomsFreeOnDay,
  shortHour,
  weekdayOfNow,
} from "@/components/lib/day-calendar";
import type { Room } from "@/components/lib/types";

/**
 * A room whose occupancy the source only partially publishes:
 * Monday full, Tuesday a gap at 9, Wednesday never captured.
 */
const room: Room = {
  room: "IB 335",
  building: "IB",
  buildingName: "Instructional Centre",
  capacity: "120",
  campusKey: "UTM",
  hoursMissing: [],
  occupancy: {
    "1": { "7": false, "8": false, "9": true, "10": true },
    "2": { "8": false, "9": true, "10": false, "12": false }, // 11 missing
  },
};

const other: Room = {
  room: "MN 2100",
  building: "MN",
  buildingName: "Mehta",
  capacity: "150",
  campusKey: "UTM",
  hoursMissing: [],
  occupancy: {
    "1": { "9": true, "10": true, "11": true, "12": true, "13": true },
  },
};

describe("coveredDays", () => {
  it("collects the weekdays any room publishes, in order", () => {
    expect(coveredDays([room, other])).toEqual([1, 2]);
  });

  it("is empty for rooms with no occupancy", () => {
    expect(coveredDays([])).toEqual([]);
  });
});

describe("hourColumns", () => {
  it("takes the union of published hours across rooms", () => {
    expect(hourColumns([room, other])).toEqual([7, 8, 9, 10, 11, 12, 13]);
  });
});

describe("cellState", () => {
  it("reads a published hour as free or busy", () => {
    expect(cellState(room, 1, 8)).toBe("free");
    expect(cellState(room, 1, 9)).toBe("busy");
  });

  it("never invents a free hour the source did not publish", () => {
    // 11:00 Tuesday is not in the data -> not free.
    expect(cellState(room, 2, 11)).toBe("unpublished");
    // 13:00 Monday is not in IB 335's data -> not free.
    expect(cellState(room, 1, 13)).toBe("unpublished");
  });

  it("a day the source never captured is entirely unpublished", () => {
    expect(cellState(room, 3, 9)).toBe("unpublished");
  });
});

describe("roomsFreeOnDay", () => {
  it("returns only the rooms with a published free hour that day", () => {
    const free = roomsFreeOnDay([room, other], 1);
    // Monday: IB 335 is free 7-8, MN 2100 has no free hour -> only IB 335.
    expect(free.map((r) => r.room)).toEqual(["IB 335"]);
  });

  it("is empty for a day no room is free on", () => {
    const free = roomsFreeOnDay([other], 1);
    expect(free).toEqual([]);
  });

  it("does not count an unpublished day as free", () => {
    expect(roomsFreeOnDay([room], 3)).toEqual([]);
  });
});

describe("isoDateOf", () => {
  it("attaches the calendar date from the week start and the weekday", () => {
    // Monday 2026-10-19 + day 2 (Tuesday) = 2026-10-20.
    expect(isoDateOf("2026-10-19", 2)).toBe("2026-10-20");
    expect(isoDateOf("2026-10-19", 1)).toBe("2026-10-19");
  });

  it("rolls across the month boundary on the local clock", () => {
    // Monday 2026-12-28 + 5 days = Friday 2027-01-01.
    expect(isoDateOf("2026-12-28", 5)).toBe("2027-01-01");
  });

  it("returns empty for a missing week start", () => {
    expect(isoDateOf("", 1)).toBe("");
  });
});

describe("weekdayOfNow", () => {
  it("maps the clock's weekday to the dataset's Monday = 1", () => {
    // 2026-10-18 is a Sunday.
    expect(weekdayOfNow(new Date(2026, 9, 18, 10))).toBe(7);
    // 2026-10-19 is a Monday.
    expect(weekdayOfNow(new Date(2026, 9, 19, 10))).toBe(1);
    // 2026-10-21 is a Wednesday.
    expect(weekdayOfNow(new Date(2026, 9, 21, 10))).toBe(3);
  });
});

describe("shortHour", () => {
  it("renders the compact column labels", () => {
    expect(shortHour(7)).toBe("7a");
    expect(shortHour(12)).toBe("12p");
    expect(shortHour(13)).toBe("1p");
    expect(shortHour(21)).toBe("9p");
  });
});
