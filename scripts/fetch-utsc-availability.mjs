#!/usr/bin/env node
/**
 * Scarborough classroom occupancy, from the Registrar's classroom schedule
 * service.
 *
 * The Registrar publishes a room's week as an HTML table: one row per half
 * hour, one column per day, and every booked cell carries the course code
 * and the instructor. The service answers without a login, so there is
 * nothing to sign into and no session to keep.
 *
 *   node scripts/fetch-utsc-availability.mjs             # this week's Monday
 *   node scripts/fetch-utsc-availability.mjs --next-week # next week's Monday
 *   node scripts/fetch-utsc-availability.mjs 2026-10-19  # a given Monday
 *
 * The app stores occupancy by the hour, so a booked half hour makes its hour
 * booked: the app never claims a room is free for an hour it is not. The
 * source publishes finer detail than the app shows, and this is the only
 * place that detail is lost.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseTable, parseWeek, toHourly } from "./lib/utsc-registrar.mjs";
import { isoLocal, weekFromArgs } from "./lib/week.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SERVICE =
  "https://intranet.utsc.utoronto.ca/intranet2/RegistrarService";

/** The Monday of the week to capture, defaulting to this week's. */
function mondayOfThisWeek() {
  const now = new Date();
  const day = now.getUTCDay(); // 0 = Sunday
  const sinceMonday = (day + 6) % 7;
  const monday = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  monday.setUTCDate(monday.getUTCDate() - sinceMonday);
  return monday.toISOString().slice(0, 10);
}

/** The Registrar's answer: a map of room code to table. */
async function fetchWeek(monday) {
  const url = `${SERVICE}?day=${monday}&callback=cb`;
  const response = await fetch(url, {
    headers: { accept: "text/javascript, application/javascript" },
  });
  if (!response.ok) {
    throw new Error(`${url} answered ${response.status}`);
  }
  return parseWeek(await response.text());
}

async function main() {
  const args = process.argv.slice(2);
  // `--next-week` is local (see lib/week.mjs); without it the default stays
  // the UTC week, which is what the daily CI job has always asked for.
  const monday = args.includes("--next-week")
    ? isoLocal(weekFromArgs(args))
    : args[0] || mondayOfThisWeek();
  const week = await fetchWeek(monday);
  const rooms = Object.keys(week).sort();
  console.log(`RegistrarService answered with ${rooms.length} rooms for ${monday}`);

  // The classroom inventory UTSC publishes, for capacities.
  let inventory = { classrooms: {} };
  try {
    inventory = JSON.parse(
      readFileSync(join(ROOT, "data", "classrooms", "UTSC.json"), "utf-8"),
    );
  } catch {
    console.warn("No classroom inventory found; capacities will be missing.");
  }
  const byCode = new Map();
  for (const list of Object.values(inventory.classrooms || {})) {
    for (const classroom of list) {
      byCode.set(classroom.room.replace(/-/g, "").toUpperCase(), classroom);
    }
  }

  // The building names the timetable publishes.
  const buildingNames = new Map();
  try {
    const classes = JSON.parse(
      readFileSync(join(ROOT, "data", "campus", "UTSC.json"), "utf-8"),
    );
    for (const meeting of classes) {
      buildingNames.set(meeting.buildingCode, meeting.buildingName);
    }
  } catch {
    console.warn("No UTSC class data found; buildings will be unnamed.");
  }

  const out = [];
  for (const room of rooms) {
    const { grid } = parseTable(week[room]);
    const code = room.replace(/-/g, "").toUpperCase();
    const classroom = byCode.get(code);
    const building = room.split("-")[0];

    out.push({
      room,
      building,
      buildingName: buildingNames.get(building) ?? null,
      capacity: classroom?.capacity != null ? String(classroom.capacity) : "",
      campusKey: "UTSC",
      occupancy: toHourly(grid),
      hoursMissing: [],
    });
  }

  const mondayDate = new Date(`${monday}T00:00:00Z`);
  const sunday = new Date(mondayDate);
  sunday.setUTCDate(sunday.getUTCDate() + 6);

  const file = {
    campus: "UTSC",
    source:
      "UofT Scarborough Registrar classroom schedule service (half-hour bookings, stored by the hour)",
    sourceUrl: SERVICE,
    weekStart: monday,
    weekEnd: sunday.toISOString().slice(0, 10),
    rooms: out,
  };

  writeFileSync(
    join(ROOT, "data", "rooms", "UTSC.json"),
    `${JSON.stringify(file, null, 2)}\n`,
  );

  const booked = out.reduce(
    (total, room) =>
      total +
      Object.values(room.occupancy).reduce(
        (day, hours) => day + Object.values(hours).filter(Boolean).length,
        0,
      ),
    0,
  );
  const allHours = new Set();
  for (const room of out) {
    for (const day of Object.values(room.occupancy)) {
      for (const hour of Object.keys(day)) allHours.add(hour);
    }
  }
  console.log(
    `Wrote data/rooms/UTSC.json: ${out.length} rooms, ${booked} booked hours, hours ${Math.min(...[...allHours].map(Number))} to ${Math.max(...[...allHours].map(Number))}`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
