/**
 * Fetches the Scarborough classroom inventory from UofT Scarborough's
 * public classroom-support page.
 *
 * The University publishes the Scarborough classroom specification at
 * `www.utsc.utoronto.ca/iits/classroom-support`: a Drupal view of every
 * classroom on campus, with its capacity, its AV features, its type and its
 * accessibility. It is public - no UTORid - but it is a *specification*, not
 * a schedule: it says which rooms exist, not when they are booked.
 *
 * The page filters by building with a plain GET form
 * (`field_room_location_value`), and one of the option values is wrong on the
 * page itself - the Kina Wiiya Enadong Building is listed as `KW` but its
 * option value is `MW` - so the scraper drives the form rather than
 * building the URLs itself.
 *
 *   node scripts/fetch-utsc-classrooms.mjs
 *
 * Writes `data/classrooms/UTSC.json`: building code -> the classrooms in it.
 */
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";

const APP = "https://www.utsc.utoronto.ca/iits/classroom-support";
const OUT = "data/classrooms/UTSC.json";
const CAMPUS = "UTSC";

/** Pull the value out of a "Label value" cell. */
function cellValue(text, label) {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.toLowerCase().startsWith(label.toLowerCase())
    ? clean.slice(label.length).trim()
    : clean;
}

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(APP, { waitUntil: "domcontentloaded", timeout: 90_000 });

const COLUMNS = [
  ["room", null],
  ["capacity", "Capacity"],
  ["features", "Features"],
  ["type", "Type"],
  ["physicalAccessibility", "Physical Accessibility"],
  ["assistiveListening", "Assistive Listening System"],
  ["aura", "AuRA Equipped"],
  ["emergencyPhone", "Campus Safety Emergency Phone"],
  ["entrances", "Number of Entrances / Exits"],
];

/** Read the rooms table on the page as it stands. */
async function readTable() {
  return page
    .locator("table.views-table tbody tr")
    .evaluateAll((rows, columns) => {
      const cellText = (td) =>
        (td.textContent || "").replace(/\s+/g, " ").trim();
      return rows
        .map((tr) => {
          const tds = [...tr.querySelectorAll("td")].map(cellText);
          if (!tds.length || !tds[0]) return null;
          const entry = {};
          columns.forEach(([key, label], index) => {
            const raw = tds[index] ?? "";
            let value = raw;
            if (label) {
              const lower = raw.toLowerCase();
              const at = lower.indexOf(label.toLowerCase());
              value = at >= 0 ? raw.slice(at + label.length).trim() : raw;
            }
            entry[key] = value || null;
          });
          return entry;
        })
        .filter(Boolean);
    }, COLUMNS.map(([key, label]) => [key, label]));
}

const buildings = {};
const classrooms = {};

// The exposed filter lists the buildings. Take the option values from the
// page rather than hard-coding them, because one of them is wrong on the
// page (KW is published as MW).
const options = await page
  .locator("#edit-field-room-location-value option")
  .evaluateAll((els) =>
    els.map((e) => ({ value: e.value, label: e.textContent.trim() })),
  );

for (const option of options) {
  if (!option.value || option.value === "All") continue;

  await page.selectOption("#edit-field-room-location-value", option.value);
  await page
    .locator("#edit-submit-view-classrooms")
    .click()
    .catch(() => {});
  await page.waitForLoadState("domcontentloaded").catch(() => {});
  await page.waitForTimeout(400);

  const rows = await readTable();
  if (!rows.length) {
    console.log(`  ${option.value}: no rows`);
    continue;
  }

  // The label is "AA - Arts & Administration Building". The building code is
  // the code the timetable uses, so it is taken from the label, not the
  // option value, which is wrong for one building.
  const code = (option.label.match(/^([A-Z]{2})\b/) || [])[1] ?? option.value;

  buildings[code] = option.label.replace(/^[A-Z]{2}\s*-\s*/, "").trim();
  classrooms[code] = rows.map((row) => {
    const entry = { room: row.room, name: null };
    const capacity = Number.parseInt(row.capacity, 10);
    entry.capacity = Number.isNaN(capacity) ? undefined : capacity;
    // The University publishes a room *type* and a feature list at
    // Scarborough, not a room name. The type is kept under its own key so
    // nothing is invented; `name` stays null.
    entry.type = row.type;
    entry.features = row.features;
    entry.physicalAccessibility = row.physicalAccessibility;
    entry.assistiveListening = row.assistiveListening;
    entry.aura = row.aura;
    entry.emergencyPhone = row.emergencyPhone;
    entry.entrances = row.entrances;
    return entry;
  });

  console.log(`  ${code}: ${rows.length} classrooms`);
}

// The "All" filter gives the whole campus in one request; use it to check
// that the per-building sweep found every room.
await page.selectOption("#edit-field-room-location-value", "All");
await page.locator("#edit-submit-view-classrooms").click().catch(() => {});
await page.waitForLoadState("domcontentloaded").catch(() => {});
await page.waitForTimeout(400);
const all = await readTable();
const swept = Object.values(classrooms).reduce((n, rooms) => n + rooms.length, 0);
console.log(`\nper-building sweep: ${swept} rooms; "All" filter: ${all.length} rooms`);
if (all.length !== swept) {
  console.log("  the two disagree - the per-building sweep may have missed rooms");
}

mkdirSync("data/classrooms", { recursive: true });
writeFileSync(
  OUT,
  JSON.stringify({ campus: CAMPUS, source: APP, buildings, classrooms }),
  "utf-8",
);
await browser.close();

console.log(`wrote ${OUT}: ${Object.keys(buildings).length} buildings, ${swept} classrooms`);
