#!/usr/bin/env node
/**
 * Captures UTM classroom availability from the Metis Classroom Space Database.
 *
 * The Metis database (https://metis.utm.utoronto.ca/space/) lists available
 * rooms for a chosen date and hour. The table columns match the headers:
 * ["Date", "Avail from", "Avail to", "Building", "Room", "Capacity", "Image"]
 *
 *   node scripts/fetch-utm-availability.mjs               # this week
 *   node scripts/fetch-utm-availability.mjs --next-week   # coming Monday
 *   node scripts/fetch-utm-availability.mjs 2026-10-19    # a given Monday
 *
 * Writes `data/utm_metis_data.json` in the existing shape, then runs
 * `npm run data:rooms` to rebuild `data/rooms/UTM.json` and `data/meta.json`.
 */
import { chromium } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { tmpdir } from "node:os";

const PROFILE = join(homedir(), ".uoft-session");
const METIS_URL = "https://metis.utm.utoronto.ca/space/";

/** Hours to query: 07:00 through 21:00 (same as UTSG) */
const FIRST_HOUR = 7;
const LAST_HOUR = 21;

/**
 * Parse the week argument. Accepts:
 * - `--next-week` (the coming Monday)
 * - `YYYY-MM-DD` (a specific Monday)
 * - nothing (this week's Monday)
 */
function parseWeekArg() {
  const args = process.argv.slice(2);

  if (args.includes("--next-week")) {
    return "next-week";
  }

  const dateArg = args.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a));
  if (dateArg) {
    return dateArg;
  }

  return "this-week";
}

/**
 * Get the Monday for the requested week.
 */
function mondayForWeek(weekArg) {
  const now = new Date();
  const day = now.getDay(); // 0 is Sunday

  if (weekArg === "next-week") {
    // On Saturday (6) or Sunday (0), "next week" is the Monday right after today.
    if (day === 0 || day === 6) {
      const monday = new Date(now);
      monday.setDate(now.getDate() + (day === 0 ? 1 : 2));
      return monday;
    }
    // This week's Monday + 7 days
    const thisMonday = new Date(now);
    thisMonday.setDate(now.getDate() - ((day + 6) % 7) + 7);
    return thisMonday;
  }

  if (weekArg === "this-week") {
    const monday = new Date(now);
    monday.setDate(now.getDate() - ((day + 6) % 7));
    return monday;
  }

  // Specific date: parse as YYYY-MM-DD
  const [year, month, dayOfMonth] = weekArg.split("-").map(Number);
  const date = new Date(year, month - 1, dayOfMonth);
  if (isNaN(date.getTime())) {
    console.error(`Invalid date: ${weekArg}`);
    process.exit(1);
  }
  return date;
}

function isoDate(date) {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** Format date like "Monday, Oct 19, 2026" for matching select options. */
function metisDateText(date) {
  const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const dayName = dayNames[date.getDay()];
  const monthName = monthNames[date.getMonth()];
  const dayNum = date.getDate();
  const year = date.getFullYear();
  return `${dayName}, ${monthName} ${dayNum}, ${year}`;
}

/** Format hour like "07:00 AM" for matching select options. */
function metisHourText(hour) {
  const h = hour % 12 || 12;
  const ampm = hour < 12 ? "AM" : "PM";
  return `${String(h).padStart(2, "0")}:00 ${ampm}`;
}

/**
 * Read the cookie jar for Metis (same session as LSM).
 */
function readCookieJar(path) {
  const cookies = [];
  for (const line of readFileSync(path, "utf-8").split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const parts = line.split("\t");
    if (parts.length < 7) continue;
    const [domain, , path_, secure, expires, name, value] = parts;
    cookies.push({
      name,
      value,
      domain: domain.replace(/^\./, ""),
      path: path_ || "/",
      secure: secure === "TRUE",
      httpOnly: false,
      expires: Number(expires) > 0 ? Number(expires) : -1,
    });
  }
  return cookies;
}

/**
 * Save the page HTML to a debug file under the OS temp dir.
 */
function saveDebugPage(html, prefix = "metis-debug") {
  const debugPath = join(tmpdir(), `${prefix}-${Date.now()}.html`);
  writeFileSync(debugPath, html, "utf-8");
  return debugPath;
}

/**
 * Extract available rooms from the Metis results table.
 * Returns an array of { date, hour, building, room, capacity, image } objects.
 */
async function extractAvailableRooms(page, date, hour) {
  const html = await page.content();

  // Look for the results table - it should have 7 columns matching our headers
  const tables = await page.$$("table");

  for (const table of tables) {
    // Check headers
    const headerCells = await table.$$("th");
    const headers = [];
    for (const cell of headerCells) {
      const text = await cell.innerText();
      headers.push(text.trim());
    }

    // Check if this is the availability table
    const expectedHeaders = ["Date", "Avail from", "Avail to", "Building", "Room", "Capacity", "Image"];
    let isAvailTable = false;
    if (headers.length >= 7) {
      isAvailTable = headers.slice(0, 7).every((h, i) => h === expectedHeaders[i]);
    }

    if (isAvailTable) {
      // Extract rows
      const rows = await table.$$("tbody tr");
      const results = [];

      for (const row of rows) {
        const cells = await row.$$("td");
        if (cells.length < 7) continue;

        const rowData = [];
        for (const cell of cells) {
          const text = await cell.innerText();
          rowData.push(text.trim());
        }

        // Expect: Date, Avail from, Avail to, Building, Room, Capacity, Image
        if (rowData.length >= 7) {
          const [dateText, availFrom, availTo, building, room, capacity, image] = rowData;
          if (building && room) {
            results.push({
              date: dateText,
              availFrom,
              availTo,
              building,
              room,
              capacity,
              image: image || "See image",
            });
          }
        }
      }

      if (results.length > 0) {
        return results;
      }
    }
  }

  // If we didn't find the table, save debug HTML
  const debugPath = saveDebugPage(html, "metis-no-table-found");
  console.error(`Could not find availability table for ${isoDate(date)} ${String(hour).padStart(2, "0")}:00`);
  console.error(`Saved debug page to: ${debugPath}`);
  return null;
}

/**
 * Query Metis for available rooms at a specific date and hour.
 */
async function queryMetis(page, date, hour) {
  // Find the date select
  const dateSelect = await page.$("select");
  if (!dateSelect) {
    const html = await page.content();
    const debugPath = saveDebugPage(html, "metis-no-date-select");
    throw new Error(`No date select found on Metis page. Debug: ${debugPath}`);
  }

  // Select the date - match by the visible text like "Monday, Oct 19, 2026"
  const dateText = metisDateText(date);
  await page.selectOption("select", { label: dateText });

  // Wait a moment for the page to update
  await page.waitForTimeout(500);

  // Find the hour select - there should be another select for the hour
  const selects = await page.$$("select");
  let hourSelect = null;

  // The second select is usually the hour select
  if (selects.length >= 2) {
    hourSelect = selects[1];
  } else {
    const html = await page.content();
    const debugPath = saveDebugPage(html, "metis-no-hour-select");
    throw new Error(`No hour select found on Metis page. Debug: ${debugPath}`);
  }

  // Select the hour - match by the visible text like "07:00 AM"
  const hourText = metisHourText(hour);
  await hourSelect.selectOption({ label: hourText });

  // Wait for results to load
  await page.waitForTimeout(1000);

  // Extract the available rooms
  const rooms = await extractAvailableRooms(page, date, hour);
  return rooms;
}

/**
 * Main capture function.
 */
async function main() {
  const weekArg = parseWeekArg();
  const monday = mondayForWeek(weekArg);

  console.log(`Capturing UTM availability for week starting ${isoDate(monday)}`);

  // Check for session cookies
  const COOKIES = join(PROFILE, "lsm-cookies.txt");
  if (!existsSync(COOKIES)) {
    console.error(
      `no session cookie jar at ${COOKIES}\n` +
        "Sign in to lsm.utoronto.ca first: node scripts/auth-lsm-cookies.mjs",
    );
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  await context.addCookies(readCookieJar(COOKIES));
  const page = await context.newPage();

  // Navigate to Metis
  console.log("Loading Metis Classroom Space Database...");
  await page.goto(METIS_URL, { waitUntil: "domcontentloaded" });

  // Check if we're still on the SSO page (not signed in)
  const url = page.url();
  if (/idp|login|sso/i.test(url)) {
    await browser.close();
    console.error("Not signed in - session may be stale. Run: node scripts/auth-lsm-cookies.mjs");
    process.exit(1);
  }

  // Wait for the page to fully load with the form
  await page.waitForTimeout(2000);

  // Verify we have the date select
  const dateSelect = await page.$("select");
  if (!dateSelect) {
    const html = await page.content();
    const debugPath = saveDebugPage(html, "metis-initial-load");
    console.error(`Could not find date select on Metis page. Debug: ${debugPath}`);
    await browser.close();
    process.exit(1);
  }

  // Get available date options to verify the week is available (unused but kept for potential validation)
  await page.$$eval("select option", (options) =>
    options.map((o) => ({ value: o.value, text: o.text.trim() })),
  );

  const days = [];
  for (let offset = 0; offset < 5; offset += 1) { // Mon-Fri only
    const date = new Date(monday);
    date.setDate(monday.getDate() + offset);
    days.push(date);
  }

  // Build the output structure
  const datesArray = days.map((d) => ({
    val: isoDate(d),
    text: metisDateText(d),
  }));

  const headers = ["Date", "Avail from", "Avail to", "Building", "Room", "Capacity", "Image"];
  const byDateAndHour = {};

  // Loop through Mon-Fri × hours 07-21
  for (const date of days) {
    const dateKey = isoDate(date);
    byDateAndHour[dateKey] = {};

    for (let hour = FIRST_HOUR; hour <= LAST_HOUR; hour += 1) {
      const hourKey = String(hour).padStart(2, "0");
      process.stdout.write(`  Querying ${dateKey} ${hourKey}:00... `);

      const rooms = await queryMetis(page, date, hour);

      if (rooms === null) {
        // Table not found - page structure changed
        await browser.close();
        process.exit(1);
      }

      byDateAndHour[dateKey][hourKey] = rooms.map((r) => [
        r.date,
        r.availFrom,
        r.availTo,
        r.building,
        r.room,
        r.capacity,
        r.image,
      ]);

      process.stdout.write(`${rooms.length} rooms\n`);
    }
  }

  await browser.close();

  // Write the metis data file
  const metisData = {
    dates: datesArray,
    headers,
    byDateAndHour,
  };

  mkdirSync("data", { recursive: true });
  writeFileSync("data/utm_metis_data.json", JSON.stringify(metisData, null, 2), "utf-8");
  console.log(`\nWrote data/utm_metis_data.json`);

  // Now run the rebuild-rooms command
  console.log("\nRebuilding room data...");
  const { spawnSync } = await import("node:child_process");
  const { resolve } = await import("node:path");

  const ROOT = resolve(import.meta.dirname, "..");
  const rebuild = spawnSync("uv", ["run", "uoft-scraper", "rebuild-rooms", "--data", "data"], {
    cwd: join(ROOT, "scraper"),
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  if (rebuild.status !== 0) {
    console.error("Rebuild failed");
    process.exit(1);
  }

  console.log("\nUTM capture complete!");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});