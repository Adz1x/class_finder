#!/usr/bin/env node
/**
 * Download the MADLab public room-availability feed and archive it.
 *
 * Fetches four JSON files from madlab01.act.utoronto.ca (no login needed):
 * - lsm_buildings-v2.json (St. George buildings + rooms)
 * - lsm_query-v2.json (St. George free room-hours)
 * - lsm_buildings-utsc-v2.json (Scarborough buildings + rooms)
 * - lsm_query-utsc-v2.json (Scarborough free room-hours)
 *
 * Writes:
 * - data/sources/madlab/*.json (raw, diff-friendly)
 * - data/room-details/UTSG.json, data/room-details/UTSC.json (room metadata)
 * - data/room-candidates/UTSG-madlab.json (when St. George query has rows)
 *
 * Prints a coverage summary: dates covered per campus, rows, and rooms.
 */
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseBuildings,
  parseQuery,
  buildRoomDetails,
  buildAvailabilityRooms,
} from "./lib/madlab.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASE_URL = "https://madlab01.act.utoronto.ca/RoomAvailability";
const FILES = [
  { key: "lsm_buildings-v2", url: `${BASE_URL}/lsm_buildings-v2.json`, campus: "UTSG" },
  { key: "lsm_query-v2", url: `${BASE_URL}/lsm_query-v2.json`, campus: "UTSG" },
  { key: "lsm_buildings-utsc-v2", url: `${BASE_URL}/lsm_buildings-utsc-v2.json`, campus: "UTSC" },
  { key: "lsm_query-utsc-v2", url: `${BASE_URL}/lsm_query-utsc-v2.json`, campus: "UTSC" },
];

const USER_AGENT = "uoftclassfinder-data-refresh (+https://uoftclassfinder.tech)";
const FETCH_TIMEOUT_MS = 30000;

async function fetchWithTimeout(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!response.ok) {
      throw new Error(`${url} answered ${response.status}`);
    }
    const json = await response.json();
    if (!json || !Array.isArray(json.items)) {
      throw new Error(`${url} returned invalid JSON: missing items array`);
    }
    return json;
  } catch (error) {
    clearTimeout(timeout);
    if (error.name === "AbortError") {
      throw new Error(`${url} timed out after ${FETCH_TIMEOUT_MS}ms`);
    }
    throw error;
  }
}

function ensureDir(path) {
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true });
  }
}

async function main() {
  console.log("Fetching MADLab feed...");

  // Fetch all four files
  const results = {};
  for (const file of FILES) {
    console.log(`  ${file.key}...`);
    results[file.key] = await fetchWithTimeout(file.url);
  }

  // Write raw files to data/sources/madlab/
  const sourcesDir = join(ROOT, "data", "sources", "madlab");
  ensureDir(sourcesDir);
  for (const [key, json] of Object.entries(results)) {
    writeFileSync(join(sourcesDir, `${key}.json`), `${JSON.stringify(json, null, 2)}\n`);
  }
  console.log(`Wrote raw files to ${sourcesDir}`);

  // Build room details for each campus
  const detailsDir = join(ROOT, "data", "room-details");
  ensureDir(detailsDir);

  for (const campus of ["UTSG", "UTSC"]) {
    const buildingsKey = campus === "UTSG" ? "lsm_buildings-v2" : "lsm_buildings-utsc-v2";
    const details = buildRoomDetails(results[buildingsKey]);
    const detailPath = join(detailsDir, `${campus}.json`);
    writeFileSync(detailPath, `${JSON.stringify(details, null, 2)}\n`);
    console.log(`Wrote ${details.length} room details to ${detailPath}`);
  }

  // Build St. George availability candidates (only when query has rows)
  const candidatesDir = join(ROOT, "data", "room-candidates");
  ensureDir(candidatesDir);

  const utsgResult = buildAvailabilityRooms(
    results["lsm_buildings-v2"],
    results["lsm_query-v2"],
    "UTSG"
  );
  if (!utsgResult.empty) {
    const candidatesPath = join(candidatesDir, "UTSG-madlab.json");
    const file = {
      campus: "UTSG",
      source: "MADLab public room-availability feed",
      sourceUrl: BASE_URL,
      datesCovered: utsgResult.datesCovered,
      rooms: utsgResult.rooms,
    };
    writeFileSync(candidatesPath, `${JSON.stringify(file, null, 2)}\n`);
    console.log(`Wrote ${utsResult.rooms.length} candidate rooms to ${candidatesPath}`);
  } else {
    console.log("St. George query is empty (no availability rows); no candidate file written.");
  }

  // Print coverage summary
  console.log("\n=== Coverage Summary ===");
  for (const campus of ["UTSG", "UTSC"]) {
    const queryKey = campus === "UTSG" ? "lsm_query-v2" : "lsm_query-utsc-v2";
    const buildingsKey = campus === "UTSG" ? "lsm_buildings-v2" : "lsm_buildings-utsc-v2";

    const { occupancy, datesCovered } = parseQuery(results[queryKey]);
    const details = parseBuildings(results[buildingsKey]);

    console.log(`\n${campus}:`);
    console.log(`  Dates covered: ${datesCovered.join(", ") || "(none)"}`);
    console.log(`  Total query rows: ${results[queryKey].items.length}`);
    console.log(`  Rooms in buildings file: ${details.length}`);
    console.log(`  Rooms with free hours in feed: ${new Set(Object.values(occupancy).flatMap((r) => Object.keys(r))).size}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});