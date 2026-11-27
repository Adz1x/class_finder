import { describe, expect, it } from "vitest";
import { isoLocal, mondayOf, weekFromArgs, weekdaysFrom } from "../../scripts/lib/week.mjs";

const at = (y: number, m: number, d: number, h = 12, min = 0) => new Date(y, m - 1, d, h, min);

describe("weekFromArgs", () => {
  it("defaults to this week's Monday", () => {
    expect(isoLocal(weekFromArgs([], at(2026, 11, 25)))).toBe("2026-11-23"); // Wednesday
    expect(isoLocal(weekFromArgs([], at(2026, 11, 23, 0, 5)))).toBe("2026-11-23"); // Monday
  });

  it("--next-week is the Monday after this week's", () => {
    expect(isoLocal(weekFromArgs(["--next-week"], at(2026, 11, 25)))).toBe("2026-11-30");
    expect(isoLocal(weekFromArgs(["--next-week"], at(2026, 11, 23)))).toBe("2026-11-30");
  });

  it("on a weekend, --next-week is the coming Monday", () => {
    expect(isoLocal(weekFromArgs(["--next-week"], at(2026, 11, 28)))).toBe("2026-11-30"); // Saturday
    expect(isoLocal(weekFromArgs(["--next-week"], at(2026, 11, 29, 18)))).toBe("2026-11-30"); // Sunday 6 PM
  });

  it("is local: Sunday 8 PM in Toronto still asks for the next morning", () => {
    // Already Monday in UTC; the week must not jump ahead to Dec 7.
    expect(isoLocal(weekFromArgs(["--next-week"], at(2026, 11, 29, 20)))).toBe("2026-11-30");
  });

  it("takes a date and starts from its Monday", () => {
    expect(isoLocal(weekFromArgs(["2026-10-19"]))).toBe("2026-10-19");
    expect(isoLocal(weekFromArgs(["2026-10-21"]))).toBe("2026-10-19");
  });

  it("refuses a date that does not exist", () => {
    expect(() => weekFromArgs(["2026-02-30"])).toThrow(/not a real date/);
  });
});

describe("week helpers", () => {
  it("finds the Monday across a month boundary", () => {
    expect(isoLocal(mondayOf(at(2026, 12, 2)))).toBe("2026-11-30");
  });

  it("lists Monday to Friday", () => {
    expect(weekdaysFrom(at(2026, 11, 30, 0)).map(isoLocal)).toEqual([
      "2026-11-30",
      "2026-12-01",
      "2026-12-02",
      "2026-12-03",
      "2026-12-04",
    ]);
  });
});
