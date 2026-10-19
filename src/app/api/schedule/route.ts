import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ClassMeeting, Meta, Room } from "@/components/lib/types";

/**
 * Serves the generated dataset.
 *
 * The data files are produced by the Python scraper in `scraper/`:
 *
 *     npm run data:build
 *
 * They are read at module scope so this route can be prerendered - it never
 * depends on request-specific data.
 */

function readJson<T>(name: string): T {
  const path = join(process.cwd(), "data", name);
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as T;
  } catch (error) {
    throw new Error(
      `Could not read ${path}. Run "npm run data:build" to generate the dataset. (${
        error instanceof Error ? error.message : String(error)
      })`,
    );
  }
}

const dataset = {
  classes: readJson<ClassMeeting[]>("classes.json"),
  rooms: readJson<Room[]>("rooms.json"),
  meta: readJson<Meta>("meta.json"),
};

export async function GET() {
  return Response.json(dataset, {
    headers: {
      "Cache-Control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate",
    },
  });
}
