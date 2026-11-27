/**
 * MADLab public room-availability feed parsing.
 *
 * The feed publishes two files per campus (St. George and Scarborough):
 * - buildings: room metadata (capacity, accessibility, photos, coordinates)
 * - query: free room-hours for a rolling window of ~3 school days
 *
 * All functions here are pure (no network) so they can be unit-tested.
 */

const PHOTO_BASE = "https://lsm.utoronto.ca/images/Photos/Website/RoomViews";

/**
 * Normalize a room id to the repo's naming convention.
 * Examples: "UC", "44" -> "UC 44"; "AA", "112" -> "AA 112"
 */
export function normalizeRoomId(building, room) {
  return `${building} ${room}`;
}

/**
 * Convert YYMMDD to ISO date string (YYYY-MM-DD).
 * Assumes 20xx for years 00-99.
 */
export function yymmddToIso(yymmdd) {
  const str = String(yymmdd).padStart(6, "0");
  const year = 2000 + Number(str.slice(0, 2));
  const month = str.slice(2, 4);
  const day = str.slice(4, 6);
  return `${year}-${month}-${day}`;
}

/**
 * Parse the buildings file and return room details.
 * Input shape: { items: [{ bd_code, bd_name, bd_address, bd_marker, rooms: [...] }] }
 * Each room: { room_number, capacity, wheelchair_accessible, room_link, links: [{ photo1, photo2, photo3 }] }
 */
export function parseBuildings(json) {
  if (!json || !Array.isArray(json.items)) {
    throw new Error("Invalid buildings JSON: missing items array");
  }

  const details = [];
  for (const building of json.items) {
    const buildingCode = building.bd_code;
    const buildingName = building.bd_name;
    const address = building.bd_address;
    // "43.663,-79.395". An empty or partial marker means no location, not 0,0.
    const [lat, lng] = String(building.bd_marker ?? "")
      .split(",")
      .map((c) => (c.trim() === "" ? NaN : Number(c)));

    for (const room of building.rooms || []) {
      const roomNumber = room.room_number;
      const capacity = room.capacity;
      const wheelchairAccessible = room.wheelchair_accessible === "Y";
      const infoUrl = room.room_link;

      const photos = [];
      // UTSC rooms don't have links; St. George rooms do
      for (const linkGroup of room.links || []) {
        for (const [, path] of Object.entries(linkGroup)) {
          if (path && typeof path === "string" && path.startsWith("/")) {
            photos.push(`${PHOTO_BASE}${path}`);
          }
        }
      }

      details.push({
        room: normalizeRoomId(buildingCode, roomNumber),
        building: buildingCode,
        buildingName,
        address,
        lat: Number.isFinite(lat) ? lat : null,
        lng: Number.isFinite(lng) ? lng : null,
        capacity: capacity != null ? String(capacity) : "",
        wheelchairAccessible,
        photos,
        infoUrl,
      });
    }
  }
  return details;
}

/**
 * Parse the query file and return free hours per room per date.
 * Input shape: { items: [{ book_date: YYMMDD, building, room, time: "HH:MM" }] }
 *
 * A room-hour listed in the query is free.
 * Any room-hour of a feed room that isn't listed on a covered date is NOT free.
 * A date not covered by the feed is absent from the result (never claim free).
 */
export function parseQuery(json) {
  if (!json || !Array.isArray(json.items)) {
    throw new Error("Invalid query JSON: missing items array");
  }

  // Collect all dates that appear in the feed
  const datesCovered = new Set();
  for (const row of json.items) {
    datesCovered.add(yymmddToIso(row.book_date));
  }

  // Build map: date -> room -> Set of free hours
  const freeHours = new Map();
  for (const row of json.items) {
    const date = yymmddToIso(row.book_date);
    const roomId = normalizeRoomId(row.building, row.room);
    const hour = Number(row.time.split(":")[0]);

    if (!freeHours.has(date)) freeHours.set(date, new Map());
    if (!freeHours.get(date).has(roomId)) freeHours.get(date).set(roomId, new Set());
    freeHours.get(date).get(roomId).add(hour);
  }

  // Convert to the occupancy shape the app expects:
  // { date: { room: { hour: boolean (true = booked, false = free) } } }
  // We only include dates the feed covers.
  const occupancy = {};
  for (const [date, rooms] of freeHours) {
    occupancy[date] = {};
    for (const [roomId, hours] of rooms) {
      occupancy[date][roomId] = {};
      // Hours are 8-21 based on the feed
      for (let h = 8; h <= 21; h++) {
        // Listed = free (false = not booked), unlisted = booked (true)
        occupancy[date][roomId][h] = !hours.has(h);
      }
    }
  }

  return { occupancy, datesCovered: [...datesCovered].sort() };
}

/**
 * Build the room-details file for a campus from buildings data.
 * Filters to only rooms that have capacity or accessibility info.
 */
export function buildRoomDetails(buildingsJson) {
  return parseBuildings(buildingsJson);
}

/**
 * Per-room availability from the MADLab feed, keyed by date.
 *
 * Used for St. George when its query has rows. The feed covers a rolling
 * window of about three school days that can span two weeks (Fri, Mon, Tue),
 * so occupancy is keyed by ISO date, never by weekday: folding it into the
 * app's one-week weekday shape happens only if St. George switches to this
 * source, once a full week is known.
 *
 * Every room in the buildings file is listed for every covered date. An hour
 * the query lists is free (false); an hour it does not list is booked (true).
 *
 * Returns { rooms, datesCovered, empty: false } or { rooms: [], datesCovered: [], empty: true }.
 */
export function buildAvailabilityRooms(buildingsJson, queryJson, campusKey) {
  const { occupancy, datesCovered } = parseQuery(queryJson);

  if (!datesCovered.length) {
    return { rooms: [], datesCovered: [], empty: true };
  }

  // Build a lookup of room details from buildings
  const details = parseBuildings(buildingsJson);
  const detailMap = new Map(details.map((d) => [d.room, d]));

  // Get all room IDs that appear in the buildings file for this campus
  const allRoomIds = new Set(details.map((d) => d.room));

  const rooms = [];
  for (const roomId of allRoomIds) {
    const detail = detailMap.get(roomId);
    if (!detail) continue;

    // date -> hour -> booked. A room with no listed hour on a covered date is booked all day.
    const occupancyByDate = {};
    for (const date of datesCovered) {
      const hours = occupancy[date]?.[roomId] || {};
      occupancyByDate[date] = {};
      for (let h = 8; h <= 21; h++) {
        occupancyByDate[date][h] = hours[h] ?? true;
      }
    }

    rooms.push({
      room: roomId,
      building: detail.building,
      buildingName: detail.buildingName,
      capacity: detail.capacity,
      campusKey,
      occupancyByDate,
    });
  }

  return { rooms, datesCovered, empty: false };
}