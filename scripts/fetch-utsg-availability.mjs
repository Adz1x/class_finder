/**
 * Captures St. George classroom availability from UofT Space Management.
 *
 * The University publishes room-level availability for St. George through the
 * Campus Events recognised-student-group booking portal: the "Preferred Room"
 * list on that form is repopulated from the date, the start and end time and
 * the expected attendance, and it returns the rooms that are free in that
 * slot. A room that is not in the list is booked in it.
 *
 * The form is an Oracle APEX application, so the room list is only in the
 * page after the form has been filled in - and the reply is an APEX dynamic
 * action, which needs the session's own `p_request`, salt and protected
 * values. The script therefore drives the form in a browser and asks the
 * question from inside the page, where the session already is.
 *
 *   node scripts/fetch-utsg-availability.mjs               # this week
 *   node scripts/fetch-utsg-availability.mjs --next-week   # coming Monday
 *   node scripts/fetch-utsg-availability.mjs 2026-10-19    # a given Monday
 *
 * Writes `data/rooms/UTSG.json`: the same shape the app already reads for
 * Mississauga, so the interface needs no special case for this campus.
 */
import { chromium } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const PROFILE = join(homedir(), ".uoft-session");
const COOKIES = process.env.LSM_COOKIES ?? join(PROFILE, "lsm-cookies.txt");
const APP = "https://lsm.utoronto.ca/ords/f?p=171:1:::::";

/** The first hour the portal answers for, and the last. */
const FIRST_HOUR = 7;
const LAST_HOUR = 21;

/**
 * The expected attendance. The portal only returns rooms that seat the
 * number you ask for, so the smallest number asks for every room there is.
 */
const ATTENDANCE = 1;

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
    // Otherwise, it's the Monday after this week's Monday.
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

/** The portal wants the American form: 10/20/2026. */
function portalDate(date) {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${month}/${day}/${date.getFullYear()}`;
}

/**
 * The session.
 *
 * The space management system sits behind the University's single sign-on,
 * so the capture needs a signed-in session. The sign-on's session cookie is
 * a browser *session* cookie, so it does not survive the browser closing -
 * which is why the session is kept in a cookie jar instead, written by
 * `scripts/auth-lsm-cookies.mjs` after a sign-in.
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

/** Walk the APEX flow to the form, the way the portal's own links do. */
await page.goto(APP, { waitUntil: "domcontentloaded" });
const instance = await page.evaluate(
  () => document.querySelector("#pInstance")?.value ?? "",
);
if (!instance) {
  console.error("not signed in - sign in at lsm.utoronto.ca first");
  await browser.close();
  process.exit(1);
}

await page.goto(`https://lsm.utoronto.ca/ords/f?p=171:7:${instance}:::RP::`, {
  waitUntil: "domcontentloaded",
});
const firstGroup = await page.evaluate(() => {
  const select = document.querySelector("select");
  return select?.options?.[1]?.value ?? "";
});
if (firstGroup) {
  await page.goto(
    `https://lsm.utoronto.ca/ords/f?p=171:7:${instance}::NO::RESV_ORG:${firstGroup}`,
    { waitUntil: "domcontentloaded" },
  );
}
await page.goto(`https://lsm.utoronto.ca/ords/f?p=171:2:${instance}:::::`, {
  waitUntil: "domcontentloaded",
});

/** The values APEX needs to answer a dynamic action. */
const form = await page.evaluate(() => {
  const value = (id) => document.querySelector(`#${id}`)?.value ?? "";
  const script = document.documentElement.innerHTML;
  const ajax = script.match(
    /apex\.widget\.selectList\("#P2_ROOM".*?"ajaxIdentifier":"([^"]+)"/s,
  );
  return {
    instance: value("pInstance"),
    salt: value("pSalt"),
    protected: value("pPageItemsProtected"),
    ajaxIdentifier: ajax ? ajax[1].replaceAll("\\u002F", "/") : "",
  };
});

if (!form.instance || !form.salt || !form.protected || !form.ajaxIdentifier) {
  console.error("could not read the booking form's parameters");
  await browser.close();
  process.exit(1);
}
console.log(`booking form ready (session ${form.instance})`);

/** Ask the portal which rooms are free in one slot. */
async function freeRooms(date, hour) {
  const payload = {
    pageItems: {
      itemsToSubmit: [
        { n: "P2_DATE", v: portalDate(date) },
        { n: "P2_STIME", v: `${String(hour).padStart(2, "0")}:00` },
        { n: "P2_ETIME", v: `${String(hour + 1).padStart(2, "0")}:00` },
        { n: "P2_ATTENDANCE", v: String(ATTENDANCE) },
      ],
      protected: form.protected,
      rowVersion: "",
      formRegionChecksums: [],
    },
    salt: form.salt,
  };
  const body = new URLSearchParams({
    p_flow_id: "171",
    p_flow_step_id: "2",
    p_instance: form.instance,
    p_debug: "",
    p_request: `PLUGIN=${form.ajaxIdentifier}`,
    p_json: JSON.stringify(payload),
  }).toString();

  const raw = await page.evaluate(
    async ({ url, body }) => {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          "X-Requested-With": "XMLHttpRequest",
        },
        body,
      });
      return response.text();
    },
    {
      url: `https://lsm.utoronto.ca/ords/wwv_flow.ajax?p_context=171:2:${form.instance}`,
      body,
    },
  );

  try {
    const parsed = JSON.parse(raw);
    return (parsed.values ?? [])
      .map((value) => {
        if (typeof value.r !== "string") return null;
        // The display text carries the capacity: "KP  113 (36 cap.)".
        const capacity = String(value.d ?? "").match(/\((\d+)\s*cap/i);
        return { room: value.r, capacity: capacity ? capacity[1] : null };
      })
      .filter(Boolean);
  } catch (error) {
    // A failed parse is not "no rooms free": it means we got no usable
    // answer from the portal. Failing loudly is safer than silently
    // marking every hour of every room as booked.
    console.error(
      `failed to parse availability reply for ${date} ${String(hour).padStart(2, "0")}:00: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    throw error;
  }
}

const weekArg = parseWeekArg();
const monday = mondayForWeek(weekArg);
const days = [];
for (let offset = 0; offset < 7; offset += 1) {
  const date = new Date(monday);
  date.setDate(monday.getDate() + offset);
  days.push(date);
}

/** room -> {building, capacity, occupancy by day and hour} */
const rooms = new Map();

for (const [index, date] of days.entries()) {
  const day = index + 1; // the app numbers the week from Monday
  for (let hour = FIRST_HOUR; hour <= LAST_HOUR; hour += 1) {
    const free = await freeRooms(date, hour);
    for (const entry of free) {
      const parts = entry.room.trim().split(/\s+/);
      const building = parts[0];
      const number = parts.slice(1).join(" ");
      if (!building || !number) continue;
      const key = `${building} ${number}`;
      if (!rooms.has(key)) {
        rooms.set(key, {
          building,
          number,
          capacity: entry.capacity ?? "",
          occupancy: {},
        });
      }
      const room = rooms.get(key);
      if (!room.capacity && entry.capacity) room.capacity = entry.capacity;
      room.occupancy[day] ??= {};
      room.occupancy[day][hour] = false; // free in this slot
    }
  }
  process.stdout.write(
    `  ${isoDate(date)} done (${rooms.size} rooms so far)\n`,
  );
}

// A room that is free in one slot and booked in another needs the booked
// hours filled in, so the whole band is answered for every room.
const output = [];
for (const [key, room] of [...rooms.entries()].sort()) {
  const occupancy = {};
  for (const [day, hours] of Object.entries(room.occupancy)) {
    const row = {};
    for (let hour = FIRST_HOUR; hour <= LAST_HOUR; hour += 1) {
      row[hour] = hours[hour] === false ? false : true;
    }
    occupancy[day] = row;
  }
  output.push({
    room: key,
    building: room.building,
    buildingName: null,
    capacity: room.capacity,
    campusKey: "UTSG",
    occupancy,
    hoursMissing: [],
  });
}

mkdirSync("data/rooms", { recursive: true });
writeFileSync(
  "data/rooms/UTSG.json",
  JSON.stringify(
    {
      campus: "UTSG",
      source: "UofT Space Management campus booking portal",
      sourceUrl: "https://lsm.utoronto.ca/ords/f?p=171:2",
      weekStart: isoDate(days[0]),
      weekEnd: isoDate(days[days.length - 1]),
      rooms: output,
    },
    null,
    0,
  ),
  "utf-8",
);
await browser.close();

console.log(
  `wrote data/rooms/UTSG.json: ${output.length} rooms, ` +
    `${days.length} days, hours ${FIRST_HOUR}-${LAST_HOUR}`,
);