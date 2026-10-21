import { describe, expect, it } from "vitest";
import {
  hourOf,
  parseTable,
  parseWeek,
  toHourly,
} from "../../scripts/lib/utsc-registrar.mjs";

/**
 * A cut-down version of the table the Registrar's service returns: two
 * days, three half-hour rows, and a booking that spans two of them.
 */
const TABLE = [
  "<table class='caltable'><thead><tr><th></th><th>Mon, Oct 19</th><th>Tue, Oct 20</th></tr></thead>",
  "<tbody>",
  "<tr><td>09:00</td><td rowspan='2' class='booked'>WSTA01H3-F-L01<br/>A. Talahite-Moodley</td><td></td></tr>",
  "<tr><td>09:30</td><td></td></tr>",
  "<tr><td>10:00</td><td></td><td rowspan='2' class='booked'>MATA29H3-F-L02<br/>P. Glynn-Adey</td></tr>",
  "<tr><td>10:30</td><td></td></tr>",
  "</tbody></table>",
].join("");

describe("the Registrar's answer", () => {
  it("is JSONP wrapped", () => {
    const week = parseWeek('cb({"AA-112":"<table></table>"});');
    expect(Object.keys(week)).toEqual(["AA-112"]);
  });

  it("is not silently accepted when it is not JSONP", () => {
    expect(() => parseWeek("<html>Sign in to your account</html>")).toThrow();
  });
});

describe("a room's table", () => {
  it("reads the days it publishes", () => {
    expect(parseTable(TABLE).days).toEqual(["Mon, Oct 19", "Tue, Oct 20"]);
  });

  it("keeps a booking for every half hour it spans", () => {
    const { grid } = parseTable(TABLE);
    expect(grid[0].map((slot) => slot.booked)).toEqual([true, true, false, false]);
    expect(grid[1].map((slot) => slot.booked)).toEqual([false, false, true, true]);
  });

  it("keeps the time each slot starts at", () => {
    const { grid } = parseTable(TABLE);
    expect(grid[0].map((slot) => slot.label)).toEqual([
      "09:00",
      "09:30",
      "10:00",
      "10:30",
    ]);
  });
});

describe("the hours the app stores", () => {
  it("reads the hour a half hour starts in", () => {
    expect(hourOf("09:00")).toBe(9);
    expect(hourOf("09:30")).toBe(9.5);
  });

  it("makes an hour booked when any half hour in it is", () => {
    const { grid } = parseTable(TABLE);
    expect(toHourly(grid)).toEqual({
      1: { 9: true, 10: false },
      2: { 9: false, 10: true },
    });
  });
});
