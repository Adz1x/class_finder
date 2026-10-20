import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import type { CampusPayload, ClassMeeting, Meta, Room } from "@/components/lib/types";

/**
 * Serves the dataset one campus at a time.
 *
 * The whole catalogue is 8.3 MB of JSON, and the app used to download all of
 * it before it rendered anything, even though it only ever shows one campus.
 * The dataset is stored split per campus key, so the default campus costs
 * 2.1 MB raw - 83 KB over the wire - instead of 8.3 MB.
 *
 * The gzip buffer is built once per server process and kept in memory. The
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

const cache = new Map<CampusKey, { plain: Bytes; gzip: Bytes }>();

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

function load(campus: CampusKey): { plain: Bytes; gzip: Bytes } {
  const cached = cache.get(campus);
  if (cached) return cached;

  const dataDir = join(process.cwd(), "data");
  const classes = readJson<ClassMeeting[]>(
    join(dataDir, "campus", `${campus}.json`),
  );
  const allRooms = readJson<Room[]>(join(dataDir, "rooms.json"));
  const meta = readJson<Meta>(join(dataDir, "meta.json"));

  const payload: CampusPayload = {
    campus,
    classes,
    rooms: allRooms.filter((room) => room.campusKey === campus),
    meta,
  };

  const plain = new TextEncoder().encode(JSON.stringify(payload));
  const compressed = gzipSync(plain);
  const gzip = new Uint8Array(compressed.length);
  gzip.set(compressed);

  const entry = { plain, gzip };
  cache.set(campus, entry);
  return entry;
}

function isCampusKey(value: string): value is CampusKey {
  return (CAMPUS_KEYS as readonly string[]).includes(value);
}

export async function GET(
  request: Request,
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

  const { plain, gzip } = load(campus);
  const acceptsGzip = (request.headers.get("accept-encoding") ?? "").includes("gzip");

  const headers: Record<string, string> = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate",
    "X-Payload-Bytes": String(acceptsGzip ? gzip.byteLength : plain.byteLength),
  };

  if (acceptsGzip) {
    return new Response(gzip, {
      headers: { ...headers, "Content-Encoding": "gzip" },
    });
  }
  return new Response(plain, { headers });
}
