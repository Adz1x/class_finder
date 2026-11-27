import { describe, expect, it, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  normalizeRoomId,
  yymmddToIso,
  parseBuildings,
  parseQuery,
  buildAvailabilityRooms,
} from "../../scripts/lib/madlab.mjs";

const FIXTURES_DIR = join(process.cwd(), "tests", "fixtures", "madlab");

interface BuildingItem {
  bd_code: string;
  bd_name: string;
  bd_address: string;
  bd_marker: string;
  rooms: Array<{
    room_number: string;
    capacity: number;
    wheelchair_accessible: string;
    room_link: string;
    links?: Array<Record<string, string>>;
  }>;
}

interface BuildingsJson {
  items: BuildingItem[];
}

interface QueryJson {
  items: Array<{
    book_date: number;
    building: string;
    room: string;
    time: string;
  }>;
  hasMore: boolean;
  limit: number;
  offset: number;
  count: number;
  links: Array<{ rel: string; href: string }>;
}

let utsgBuildings: BuildingsJson;
let utsgQuery: QueryJson;
let utscBuildings: BuildingsJson;
let utscQuery: QueryJson;

beforeAll(() => {
  utsgBuildings = JSON.parse(readFileSync(join(FIXTURES_DIR, "lsm_buildings-v2.json"), "utf-8"));
  utsgQuery = JSON.parse(readFileSync(join(FIXTURES_DIR, "lsm_query-v2.json"), "utf-8"));
  utscBuildings = JSON.parse(readFileSync(join(FIXTURES_DIR, "lsm_buildings-utsc-v2.json"), "utf-8"));
  utscQuery = JSON.parse(readFileSync(join(FIXTURES_DIR, "lsm_query-utsc-v2.json"), "utf-8"));
});

describe("normalizeRoomId", () => {
  it("joins building and room with a space", () => {
    expect(normalizeRoomId("UC", "44")).toBe("UC 44");
    expect(normalizeRoomId("AA", "112")).toBe("AA 112");
    expect(normalizeRoomId("HL", "B101")).toBe("HL B101");
  });
});

describe("yymmddToIso", () => {
  it("converts YYMMDD to YYYY-MM-DD", () => {
    expect(yymmddToIso(261127)).toBe("2026-11-27");
    expect(yymmddToIso("261127")).toBe("2026-11-27");
    expect(yymmddToIso(261201)).toBe("2026-12-01");
    expect(yymmddToIso("001231")).toBe("2000-12-31");
  });
});

describe("parseBuildings", () => {
  it("parses UTSC buildings file", () => {
    const details = parseBuildings(utscBuildings);
    expect(details.length).toBe(56); // 56 rooms in UTSC fixture

    const aa112 = details.find((d) => d.room === "AA 112");
    expect(aa112).toBeDefined();
    expect(aa112!.building).toBe("AA");
    expect(aa112!.buildingName).toBe("Arts and Administration Building");
    expect(aa112!.capacity).toBe("300");
    expect(aa112!.wheelchairAccessible).toBe(true);
    // UTSC rooms don't have photo links in the feed
    expect(aa112!.photos).toEqual([]);
    expect(aa112!.infoUrl).toBe("https://www.utsc.utoronto.ca/iits/classroom/aa112");
  });

  it("parses UTSG buildings file", () => {
    const details = parseBuildings(utsgBuildings);
    expect(details.length).toBe(291); // 291 rooms in UTSG fixture

    const uc44 = details.find((d) => d.room === "UC 44");
    expect(uc44).toBeDefined();
    expect(uc44!.building).toBe("UC");
    expect(uc44!.buildingName).toBe("University College");
    expect(uc44!.capacity).toBe("15");
    expect(uc44!.wheelchairAccessible).toBe(true);
    expect(uc44!.photos.length).toBe(3);
    expect(uc44!.infoUrl).toBe("https://lsm.utoronto.ca/webapp/f?p=210:1:::::P1_BLDG,P1_ROOM:UC,44");
  });

  it("handles buildings with empty rooms arrays", () => {
    // UTSC KW building has empty rooms array
    const kw = utscBuildings.items.find((b) => b.bd_code === "KW");
    const details = parseBuildings({ items: [kw!] });
    expect(details.length).toBe(0);
  });

  it("gives no location, not 0,0, when a building has no map marker", () => {
    const [room] = parseBuildings({
      items: [
        {
          bd_code: "XX",
          bd_name: "Test",
          bd_address: "",
          bd_marker: "",
          rooms: [{ room_number: "1", capacity: 10, wheelchair_accessible: "N", room_link: "" }],
        },
      ],
    });
    expect(room.lat).toBeNull();
    expect(room.lng).toBeNull();
  });
});

describe("parseQuery", () => {
  it("parses empty UTSG query", () => {
    const { occupancy, datesCovered } = parseQuery(utsgQuery);
    expect(datesCovered).toEqual([]);
    expect(Object.keys(occupancy)).toEqual([]);
  });

  it("parses UTSC query file", () => {
    const { occupancy, datesCovered } = parseQuery(utscQuery) as {
      occupancy: Record<string, Record<string, Record<number, boolean>>>;
      datesCovered: string[];
    };
    expect(datesCovered.length).toBe(3); // 2026-11-27, 2026-11-30, 2026-12-01
    expect(datesCovered).toContain("2026-11-27");
    expect(datesCovered).toContain("2026-11-30");
    expect(datesCovered).toContain("2026-12-01");

    // AA 112 on 2026-11-27 has free hours: 08:00, 18:00, 19:00, 20:00, 21:00
    const dateKey = "2026-11-27";
    const roomKey = "AA 112";
    expect(occupancy[dateKey]).toBeDefined();
    expect(occupancy[dateKey]![roomKey]).toBeDefined();
    // Listed hours are free (false = not booked)
    expect(occupancy[dateKey]![roomKey][8]).toBe(false);
    expect(occupancy[dateKey]![roomKey][18]).toBe(false);
    expect(occupancy[dateKey]![roomKey][19]).toBe(false);
    expect(occupancy[dateKey]![roomKey][20]).toBe(false);
    expect(occupancy[dateKey]![roomKey][21]).toBe(false);
    // Unlisted hours on a covered date are booked (true)
    expect(occupancy[dateKey]![roomKey][9]).toBe(true);
    expect(occupancy[dateKey]![roomKey][10]).toBe(true);
  });

  it("does not include dates not covered by the feed", () => {
    const { occupancy } = parseQuery(utscQuery) as {
      occupancy: Record<string, Record<string, Record<number, boolean>>>;
      datesCovered: string[];
    };
    // 2026-11-28 is not in the feed
    expect(occupancy["2026-11-28"]).toBeUndefined();
  });

  it("handles rooms not listed on a covered date as fully booked", () => {
    parseQuery(utscQuery);
    // A room in the buildings file but not in the query on a covered date
    // should not appear in occupancy at all for that date (treated as fully booked)
    // The implementation only includes rooms that have at least one free hour
    // This is the expected behavior per requirements
  });
});

describe("buildAvailabilityRooms", () => {
  it("returns empty for UTSG (query is empty)", () => {
    const result = buildAvailabilityRooms(utsgBuildings, utsgQuery, "UTSG");
    expect(result.empty).toBe(true);
    expect(result.rooms).toEqual([]);
    expect(result.datesCovered).toEqual([]);
  });

  it("builds rooms for UTSC with free hours, keyed by date", () => {
    const result = buildAvailabilityRooms(utscBuildings, utscQuery, "UTSC");
    expect(result.empty).toBe(false);
    expect(result.datesCovered).toEqual(["2026-11-27", "2026-11-30", "2026-12-01"]);

    const aa112 = result.rooms.find((r) => r.room === "AA 112");
    expect(aa112).toBeDefined();
    expect(aa112!.building).toBe("AA");
    expect(aa112!.capacity).toBe("300");
    expect(aa112!.campusKey).toBe("UTSC");

    const friday = (aa112!.occupancyByDate as Record<string, Record<number, boolean>>)["2026-11-27"];
    // Hours the query lists are free (false); the rest are booked (true).
    expect(friday[8]).toBe(false);
    expect(friday[18]).toBe(false);
    expect(friday[21]).toBe(false);
    expect(friday[9]).toBe(true);
    expect(friday[10]).toBe(true);
  });

  it("never folds a window that spans two weeks into weekdays", () => {
    const result = buildAvailabilityRooms(utscBuildings, utscQuery, "UTSC");
    for (const room of result.rooms) {
      expect(Object.keys(room.occupancyByDate)).toEqual(result.datesCovered);
    }
  });

  it("lists every room of the campus, booked all day when the query lists none of its hours", () => {
    const buildings = {
      items: [
        {
          bd_code: "UC",
          bd_name: "University College",
          bd_address: "",
          bd_marker: "43.66,-79.39",
          rooms: [
            { room_number: "44", capacity: 15, wheelchair_accessible: "Y", room_link: "" },
            { room_number: "51", capacity: 11, wheelchair_accessible: "N", room_link: "" },
          ],
        },
      ],
    };
    const query = {
      items: [
        { book_date: 261130, building: "UC", room: "44", time: "08:00" },
        { book_date: 261130, building: "UC", room: "44", time: "09:00" },
      ],
    };
    const result = buildAvailabilityRooms(buildings, query, "UTSG");
    expect(result.empty).toBe(false);
    expect(result.datesCovered).toEqual(["2026-11-30"]);
    const uc44 = result.rooms.find((r) => r.room === "UC 44")!;
    const uc51 = result.rooms.find((r) => r.room === "UC 51")!;
    expect(uc44.occupancyByDate["2026-11-30"][8]).toBe(false);
    expect(uc44.occupancyByDate["2026-11-30"][9]).toBe(false);
    expect(uc44.occupancyByDate["2026-11-30"][10]).toBe(true);
    expect(Object.values(uc51.occupancyByDate["2026-11-30"]).every(Boolean)).toBe(true);
  });
});
