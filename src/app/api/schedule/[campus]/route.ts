import { readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  CampusPayload,
  ClassMeeting,
  Classroom,
  Meta,
  Room,
} from "@/components/lib/types";

/**
 * Serves the dataset one campus at a time.
 *
 * The whole catalogue is 8.3 MB of JSON, and the app used to download all of
 * it before it rendered anything, even though it only ever shows one campus.
 * The dataset is stored split per campus key, so the default campus costs
 * 2.1 MB raw - 83 KB over the wire - instead of 8.3 MB.
 *
 * The JSON buffer is built once per server process and kept in memory. The
 * route never touches the UofT API: it reads the committed snapshot.
 */

const CAMPUS_KEYS = ["UTM", "UTSG", "UTSC", "SHERIDAN"] as const;

type CampusKey = (typeof CAMPUS_KEYS)[number];

/**
 * The bytes of a response body.
 *
 * `BufferSource` is `ArrayBufferView<ArrayBuffer>`, so a `Uint8Array` that
 * might be backed by a shared pool does not fit. Everything here is built
 * fresh, so it is always backed by its own `ArrayBuffer`.
 */
type Bytes = Uint8Array<ArrayBuffer>;

const cache = new Map<CampusKey, Bytes>();

function readJson<T>(path: string): T {
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

/**
 * A campus's classrooms with their occupancy, and where that came from.
 *
 * The provenance travels with the data because the source is not the same
 * for every campus: Mississauga publishes a classroom space database, and
 * St. George's room list comes from the booking portal Space Management
 * runs for recognised student groups.
 */
interface RoomFile {
  campus: string;
  source: string;
  sourceUrl: string;
  weekStart: string;
  weekEnd: string;
  rooms: Room[];
}

/** The classroom inventory the University publishes for a campus, if any. */
type ClassroomEntry = Omit<Classroom, "building">;

interface ClassroomFile {
  campus: string;
  source: string;
  buildings: Record<string, string>;
  classrooms: Record<string, ClassroomEntry[]>;
}

function loadClassrooms(campus: CampusKey): Classroom[] {
  const path = join(process.cwd(), "data", "classrooms", `${campus}.json`);
  let file: ClassroomFile;
  try {
    file = JSON.parse(readFileSync(path, "utf-8")) as ClassroomFile;
  } catch (error) {
    // A campus without a published inventory simply has none. Anything else
    // (a malformed file, an unreadable directory) must fail loudly rather
    // than silently drop every classroom the University published.
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new Error(
        `Could not read ${path}. (${
          error instanceof Error ? error.message : String(error)
        })`,
      );
    }
    return [];
  }

  const classrooms: Classroom[] = [];
  for (const [building, rooms] of Object.entries(file.classrooms ?? {})) {
    for (const room of rooms) {
      // Keep every field the University publishes: capacity, type, AV
      // features, accessibility, and the rest. The app used to drop them at
      // this boundary.
      classrooms.push({
        ...room,
        building,
        capacity: room.capacity ?? null,
      });
    }
  }
  return classrooms;
}

function load(campus: CampusKey): Bytes {
  const cached = cache.get(campus);
  if (cached) return cached;

  const dataDir = join(process.cwd(), "data");
  const classes = readJson<ClassMeeting[]>(
    join(dataDir, "campus", `${campus}.json`),
  );
  const meta = readJson<Meta>(join(dataDir, "meta.json"));

  // A campus with no published occupancy simply has no rooms file.
  let roomFile: RoomFile | null = null;
  try {
    roomFile = readJson<RoomFile>(
      join(dataDir, "rooms", `${campus}.json`),
    );
  } catch {
    roomFile = null;
  }

  const payload: CampusPayload = {
    campus,
    classes,
    rooms: roomFile?.rooms ?? [],
    classrooms: loadClassrooms(campus),
    availability: roomFile
      ? {
          source: roomFile.source,
          sourceUrl: roomFile.sourceUrl,
          weekStart: roomFile.weekStart,
          weekEnd: roomFile.weekEnd,
        }
      : null,
    meta,
  };

  const plain = new TextEncoder().encode(JSON.stringify(payload));
  cache.set(campus, plain);
  return plain;
}

function isCampusKey(value: string): value is CampusKey {
  return (CAMPUS_KEYS as readonly string[]).includes(value);
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ campus: string }> },
) {
  const { campus: raw } = await params;
  const campus = raw.toUpperCase();

  if (!isCampusKey(campus)) {
    return Response.json(
      { error: `Unknown campus "${raw}".` },
      { status: 404 },
    );
  }

  const plain = load(campus);

  // Compression is left to the platform (Vercel's edge, or Next's own
  // `compress` when self-hosted). Gzipping here as well made `next start`
  // send the body gzipped twice, which the browser cannot parse.
  return new Response(plain, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate",
      "X-Payload-Bytes": String(plain.byteLength),
    },
  });
}
