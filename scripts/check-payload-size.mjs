/**
 * Enforces the payload budget, in transferred bytes.
 *
 * The app fetches one campus at a time, so what matters is not how big the
 * dataset is on disk but how many bytes reach the browser for the campus the
 * user is looking at. That number is the gzip size of the exact payload the
 * route serves, so this script builds the same payload and measures it.
 *
 * The budgets are ~30% above today's sizes, which is enough headroom for a
 * term's worth of new classes and tight enough that a change which dumps the
 * whole catalogue into one response fails the build.
 *
 *   node scripts/check-payload-size.mjs
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

/** Compressed budget per campus key, in bytes. */
const BUDGETS = {
  UTM: 150 * 1024,
  UTSG: 320 * 1024,
  UTSC: 120 * 1024,
  SHERIDAN: 8 * 1024,
};

/** The budget for everything the app could load in one session. */
const TOTAL_BUDGET = 600 * 1024;

const DATA = "data";

function readJson(name) {
  return JSON.parse(readFileSync(join(DATA, name), "utf-8"));
}

const rooms = readJson("rooms.json");
const meta = readJson("meta.json");

const campusFiles = readdirSync(join(DATA, "campus")).filter((name) =>
  name.endsWith(".json"),
);

if (!campusFiles.length) {
  console.error("No campus files found in data/campus.");
  process.exit(1);
}

let total = 0;
const failures = [];

console.log("payload budget (transferred, gzipped)");
console.log("=".repeat(68));

for (const file of campusFiles.sort()) {
  const key = file.replace(/\.json$/, "");
  const classes = readJson(join("campus", file));
  const payload = JSON.stringify({
    campus: key,
    classes,
    rooms: rooms.filter((room) => room.campusKey === key),
    meta,
  });
  const compressed = gzipSync(Buffer.from(payload)).length;
  const budget = BUDGETS[key];
  total += compressed;

  const verdict = budget === undefined ? "no budget" : compressed <= budget ? "ok" : "OVER";
  console.log(
    `  ${key.padEnd(10)} ${String(classes.length).padStart(6)} meetings  ` +
      `${String(Math.round(compressed / 1024)).padStart(5)} KB gz  ` +
      `budget ${budget === undefined ? "     -" : `${Math.round(budget / 1024)} KB`.padStart(8)}  ${verdict}`,
  );

  if (budget !== undefined && compressed > budget) {
    failures.push(
      `${key} is ${Math.round(compressed / 1024)} KB gzipped, over the ` +
        `${Math.round(budget / 1024)} KB budget`,
    );
  }
}

console.log("=".repeat(68));
console.log(`  ${"total".padEnd(10)} ${String(total / 1024).padStart(23)} KB gz  ` +
  `budget ${Math.round(TOTAL_BUDGET / 1024)} KB`);

if (total > TOTAL_BUDGET) {
  failures.push(
    `the whole catalogue is ${Math.round(total / 1024)} KB gzipped, over the ` +
      `${Math.round(TOTAL_BUDGET / 1024)} KB budget`,
  );
}

if (failures.length) {
  console.error("\nPAYLOAD BUDGET EXCEEDED");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log("\npayload budget OK");
