/**
 * Captures UTM classroom availability from the Classroom Space Database (Metis).
 *
 *   node scripts/fetch-utm-availability.mjs               # this week
 *   node scripts/fetch-utm-availability.mjs --next-week   # next week
 *   node scripts/fetch-utm-availability.mjs 2026-10-19    # the week of a date
 *
 * Metis answers one question per weekday and hour:
 *
 *   POST https://metis.utm.utoronto.ca/space/index.php
 *   date_par=2026-10-20&building_par=All&time_par=13&duration=1
 *
 * with the rooms free in that hour. The capture asks it directly for every
 * hour from 07:00 to 20:00, Monday to Friday. It never reads the page's own
 * hour menu: that menu leaves out 13:00, and a capture that copied it once
 * left a hole at 1 PM in the data (docs/REPORT.md).
 *
 * Needs the Metis session that `node scripts/auth-session.mjs` saves to
 * ~/.uoft-session/metis-cookies.txt. Writes data/utm_metis_data.json in the
 * shape scraper/src/uoft_scraper/metis.py reads, then rebuilds
 * data/rooms/UTM.json and data/meta.json with `uoft-scraper rebuild-rooms`.
 *
 * Nothing is written unless every answer is a results table or a "No rooms
 * available" row. Any other page (the sign-in page, an error, a redesign) stops
 * the capture and is saved to a temp file so it can be looked at.
 */
import { spawnSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { applySetCookies, cookieHeader, readJar } from "./lib/cookie-jar.mjs";
import { METIS_HEADERS, metisDateText, parseMetisPage } from "./lib/metis-parser.mjs";
import { isoLocal, weekFromArgs, weekdaysFrom } from "./lib/week.mjs";

const ROOT = resolve(import.meta.dirname, "..");
const JAR = process.env.METIS_COOKIES ?? join(homedir(), ".uoft-session", "metis-cookies.txt");
const ENDPOINT = "https://metis.utm.utoronto.ca/space/index.php";
const OUTPUT = join(ROOT, "data", "utm_metis_data.json");

/** The band Metis publishes: 07:00 to 20:00, 13:00 included. */
const FIRST_HOUR = 7;
const LAST_HOUR = 20;

/** A pause between questions, so the capture is a polite 70 requests. */
const PAUSE_MS = 250;

function stop(message, page) {
  if (page) {
    const path = join(tmpdir(), `metis-answer-${Date.now()}.html`);
    writeFileSync(path, page, "utf-8");
    console.error(`${message}\nThe page Metis returned is saved at ${path}`);
  } else {
    console.error(message);
  }
  console.error("Nothing was written.");
  process.exit(1);
}

if (!existsSync(JAR)) {
  stop(`no Metis session at ${JAR}.\nSign in first: node scripts/auth-session.mjs`);
}
const cookies = readJar(JAR);

async function ask(date, hour) {
  const body = new URLSearchParams({
    date_par: isoLocal(date),
    building_par: "All",
    time_par: String(hour),
    duration: "1",
  });
  const response = await fetch(ENDPOINT, {
    method: "POST",
    redirect: "manual",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: cookieHeader(cookies, ENDPOINT),
      "User-Agent": "uoftclassfinder-data-refresh (+https://uoftclassfinder.tech)",
    },
    body,
  });
  applySetCookies(cookies, response.headers.getSetCookie?.() ?? [], ENDPOINT);
  if (response.status >= 300 && response.status < 400) {
    const to = response.headers.get("location") ?? "";
    stop(
      `Metis sent the request to ${to || "another page"} instead of answering: ` +
        "the session has expired.\nSign in again: node scripts/auth-session.mjs",
    );
  }
  const page = await response.text();
  if (!response.ok) stop(`Metis answered ${response.status} for ${isoLocal(date)} ${hour}:00.`, page);
  return page;
}

const monday = weekFromArgs(process.argv.slice(2));
const days = weekdaysFrom(monday);
console.log(`Asking Metis about the week of ${isoLocal(monday)} (${days.length} days, ${FIRST_HOUR}:00-${LAST_HOUR}:00).`);

const byDateAndHour = {};
let freeRoomHours = 0;
for (const date of days) {
  const key = isoLocal(date);
  byDateAndHour[key] = {};
  const counts = [];
  for (let hour = FIRST_HOUR; hour <= LAST_HOUR; hour += 1) {
    const page = await ask(date, hour);
    const answer = parseMetisPage(page);
    if (answer.kind === "unexpected") {
      stop(`Metis gave an unexpected page for ${key} ${hour}:00 (${answer.reason}).`, page);
    }
    byDateAndHour[key][String(hour).padStart(2, "0")] = answer.rows;
    const free = answer.kind === "rooms" ? answer.rows.length : 0;
    freeRoomHours += free;
    counts.push(free);
    await new Promise((r) => setTimeout(r, PAUSE_MS));
  }
  console.log(`  ${key}: free rooms per hour ${counts.join(" ")}`);
}

// A whole week with no free room anywhere is not a believable answer: it is
// what a closed or unpublished week looks like. Keep the previous snapshot.
if (freeRoomHours === 0) {
  stop(`Metis lists no free room in any hour of the week of ${isoLocal(monday)}. It may not have published that week yet.`);
}

const snapshot = {
  dates: days.map((date) => ({ val: isoLocal(date), text: metisDateText(date) })),
  headers: METIS_HEADERS,
  byDateAndHour,
};
writeFileSync(OUTPUT, `${JSON.stringify(snapshot, null, 2)}\n`, "utf-8");
console.log(`wrote data/utm_metis_data.json: ${freeRoomHours} free room-hours`);

// Rebuild the app's UTM rooms and the snapshot dates in meta.json. The
// scraper's environment is kept outside the repo, as refresh-data.mjs does.
const rebuild = spawnSync(
  "uv",
  ["run", "--project", "scraper", "uoft-scraper", "rebuild-rooms", "--data", "data"],
  {
    cwd: ROOT,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: { ...process.env, UV_PROJECT_ENVIRONMENT: join(homedir(), ".uoft-scraper-venv") },
  },
);
if (rebuild.status !== 0) {
  console.error("uoft-scraper rebuild-rooms failed; data/rooms/UTM.json was not rebuilt.");
  process.exit(1);
}
console.log("rebuilt data/rooms/UTM.json and data/meta.json");
