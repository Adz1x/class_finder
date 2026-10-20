/**
 * Fetches the St. George classroom inventory from UofT Space Management.
 *
 * The University publishes one classroom space database (Metis, for
 * Mississauga) and a classroom specification for St. George at
 * `lsm.utoronto.ca`, run by the Local Space Management group. The
 * specification is public: it lists every building and every classroom in
 * it, with the classroom's name and its description.
 *
 * It is an Oracle APEX application, so the room list for a building is only
 * in the page after the building has been chosen - a hand-written POST gets
 * a checksum error. A browser does it properly, so this uses one.
 *
 *   node scripts/fetch-utsg-classrooms.mjs
 *
 * Writes `data/classrooms_utsg.json`: building code -> the classrooms in it.
 */
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";

const APP = "https://lsm.utoronto.ca/webapp/f?p=210:1";
const OUT = "data/classrooms/UTSG.json";
const CAMPUS = "UTSG";

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(APP, { waitUntil: "networkidle", timeout: 90_000 });

const buildings = await page.locator("#P1_BLDG option").evaluateAll((els) =>
  els
    .map((e) => ({ code: e.value, name: e.textContent.trim() }))
    .filter((b) => b.code && b.code !== "%null%"),
);
console.log(`${buildings.length} buildings`);

const inventory = {};
const names = {};

for (const building of buildings) {
  // Choosing a building posts the page back, so the browser navigates and
  // the previous execution context goes away. Wait for the new page, then
  // read the room list out of it.
  await page.selectOption("#P1_BLDG", building.code);
  await page.waitForLoadState("domcontentloaded").catch(() => {});

  let rooms = [];
  for (let attempt = 0; attempt < 20 && !rooms.length; attempt += 1) {
    await page.waitForTimeout(400);
    rooms = await page
      .locator("#P1_ROOM option")
      .evaluateAll((els) =>
        els
          .map((e) => e.textContent.trim())
          .filter((label) => label && !label.startsWith("Select a Room")),
      )
      .catch(() => []);
  }

  if (!rooms.length) {
    console.log(`  ${building.code}: no rooms listed`);
    continue;
  }

  // The option label is "<room number> <room name>", e.g. "1130 Auditorium".
  inventory[building.code] = rooms.map((label) => {
    const match = label.match(/^(\S+)\s*(.*)$/);
    return match ? { room: match[1], name: match[2] || null } : { room: label, name: null };
  });
  names[building.code] = building.name;
  console.log(`  ${building.code}: ${rooms.length} classrooms`);

  // Now each room, for its capacity. The room description page carries it.
  for (const entry of inventory[building.code]) {
    await page.selectOption("#P1_ROOM", entry.room);
    await page.waitForLoadState("domcontentloaded").catch(() => {});
    await page.waitForTimeout(250);

    const capacity = await page
      .locator("body")
      .innerText()
      .then((text) => {
        const match = text.match(/Room Capacity\s*(\d+)/i);
        return match ? Number(match[1]) : null;
      })
      .catch(() => null);

    if (capacity) entry.capacity = capacity;
  }
}

mkdirSync("data/classrooms", { recursive: true });
writeFileSync(
  OUT,
  JSON.stringify({ campus: CAMPUS, source: APP, buildings: names, classrooms: inventory }, null, 0),
  "utf-8",
);
await browser.close();

const total = Object.values(inventory).reduce((sum, rooms) => sum + rooms.length, 0);
console.log(`wrote ${OUT}: ${Object.keys(inventory).length} buildings, ${total} classrooms`);
