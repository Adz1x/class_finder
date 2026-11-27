import { describe, expect, it } from "vitest";
import {
  parseMetisData,
  parseMetisRow,
  validateHeaders,
  buildByDateAndHour,
} from "../../scripts/lib/metis-parser.mjs";

/** @typedef {{val: string, text: string}} MetisDate */
/** @typedef {{dates: MetisDate[], headers: string[], byDateAndHour: object}} MetisData */
/** @typedef {{date: string, availFrom: string, availTo: string, building: string, room: string, capacity: string, image: string}} ParsedMetisRow */

const SAMPLE_METIS_DATA = {
  dates: [
    { val: "2026-10-19", text: "Monday, Oct 19, 2026" },
    { val: "2026-10-20", text: "Tuesday, Oct 20, 2026" },
  ],
  headers: [
    "Date",
    "Avail from",
    "Avail to",
    "Building",
    "Room",
    "Capacity",
    "Image",
  ],
  byDateAndHour: {
    "2026-10-19": {
      "07": [
        [
          "Monday, Oct 19, 2026",
          "07:00 AM",
          "8:00 AM",
          "CCIT",
          "CC 1080",
          "500",
          "See image",
        ],
        [
          "Monday, Oct 19, 2026",
          "07:00 AM",
          "8:00 AM",
          "CCIT",
          "CC 1140",
          "150",
          "See image",
        ],
      ],
      "08": [
        [
          "Monday, Oct 19, 2026",
          "08:00 AM",
          "9:00 AM",
          "DH",
          "DH 2060",
          "100",
          "See image",
        ],
      ],
    },
  },
};

describe("Metis data parsing", () => {
  it("accepts valid Metis data", () => {
    const result = parseMetisData(SAMPLE_METIS_DATA);
    expect(result.dates).toHaveLength(2);
    expect(result.headers).toHaveLength(7);
    expect(Object.keys(result.byDateAndHour)).toContain("2026-10-19");
  });

  it("rejects non-object input", () => {
    // @ts-expect-error testing invalid input
    expect(() => parseMetisData(null)).toThrow();
    // @ts-expect-error testing invalid input
    expect(() => parseMetisData("not an object")).toThrow();
    // @ts-expect-error testing invalid input
    expect(() => parseMetisData(123)).toThrow();
  });

  it("rejects data missing required fields", () => {
    // @ts-expect-error testing with empty object
    expect(() => parseMetisData({})).not.toThrow(); // Empty object is valid, just has empty arrays
    // @ts-expect-error testing invalid input
    expect(() => parseMetisData({ dates: "not array" })).toThrow(); // dates must be array
    // @ts-expect-error testing invalid input
    expect(() => parseMetisData({ dates: [{ val: "2026-10-19" }] })).toThrow(); // date missing text
    // @ts-expect-error testing invalid input
    expect(() => parseMetisData({ dates: [{ text: "Monday, Oct 19, 2026" }] })).toThrow(); // date missing val
  });

  it("validates row structure", () => {
    const validRow = SAMPLE_METIS_DATA.byDateAndHour["2026-10-19"]["07"][0];
    const parsed = parseMetisRow(validRow);
    expect(parsed.date).toBe("Monday, Oct 19, 2026");
    expect(parsed.availFrom).toBe("07:00 AM");
    expect(parsed.availTo).toBe("8:00 AM");
    expect(parsed.building).toBe("CCIT");
    expect(parsed.room).toBe("CC 1080");
    expect(parsed.capacity).toBe("500");
    expect(parsed.image).toBe("See image");
  });

  it("rejects rows with fewer than 7 cells", () => {
    expect(() => parseMetisRow(["a", "b", "c", "d", "e", "f"])).toThrow();
    expect(() => parseMetisRow(["a", "b", "c"])).toThrow();
    // @ts-expect-error testing invalid input
    expect(() => parseMetisRow(null)).toThrow();
  });

  it("validates expected headers", () => {
    expect(validateHeaders(SAMPLE_METIS_DATA.headers)).toBe(true);
    expect(validateHeaders(["Date", "Avail from", "Avail to", "Building", "Room", "Capacity", "Image"])).toBe(true);
  });

  it("rejects mismatched headers", () => {
    expect(validateHeaders(["Date", "Avail from", "Avail to", "Building", "Room", "Capacity"])).toBe(false);
    expect(validateHeaders(["date", "avail from", "avail to", "building", "room", "capacity", "image"])).toBe(false);
    expect(validateHeaders(["Date", "Avail from", "Avail to", "Building", "Room", "Capacity", "Photo"])).toBe(false);
    expect(validateHeaders(null)).toBe(false);
  });

  it("builds byDateAndHour from flat rows", () => {
    /** @type {Array<{dateISO: string, hour: number, dateText: string, availFrom: string, availTo: string, building: string, room: string, capacity: string, image?: string}>} */
    const rows = [
      {
        dateISO: "2026-10-19",
        hour: 7,
        dateText: "Monday, Oct 19, 2026",
        availFrom: "07:00 AM",
        availTo: "8:00 AM",
        building: "CCIT",
        room: "CC 1080",
        capacity: "500",
        image: "See image",
      },
      {
        dateISO: "2026-10-19",
        hour: 7,
        dateText: "Monday, Oct 19, 2026",
        availFrom: "07:00 AM",
        availTo: "8:00 AM",
        building: "DH",
        room: "DH 2060",
        capacity: "100",
        image: "See image",
      },
      {
        dateISO: "2026-10-20",
        hour: 8,
        dateText: "Tuesday, Oct 20, 2026",
        availFrom: "08:00 AM",
        availTo: "9:00 AM",
        building: "IB",
        room: "IB 110",
        capacity: "500",
        image: "See image",
      },
    ];

    const result = buildByDateAndHour(rows);

    const date19 = /** @type {any} */ (result)["2026-10-19"];
    const date20 = /** @type {any} */ (result)["2026-10-20"];

    expect(date19).toBeDefined();
    expect(date19["07"]).toHaveLength(2);
    expect(date20["08"]).toHaveLength(1);
    expect(date19["07"][0][3]).toBe("CCIT");
    expect(date19["07"][0][4]).toBe("CC 1080");
  });
});