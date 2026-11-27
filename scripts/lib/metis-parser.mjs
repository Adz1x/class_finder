/**
 * Parse the UofT Mississauga Classroom Space Database (Metis) table output.
 *
 * The Metis space database lists, for every hour of a given week, the rooms
 * that are available in that hour. A room that is not listed for an hour is
 * therefore booked for that hour.
 *
 * The parsing lives here so it can be tested against a saved row: the
 * capture script uses it, and the parsing is the part that can silently
 * go wrong.
 *
 * The expected shape of the Metis data:
 * {
 *   dates: [{val: "2026-10-19", text: "Monday, Oct 19, 2026"}, ...],
 *   headers: ["Date", "Avail from", "Avail to", "Building", "Room", "Capacity", "Image"],
 *   byDateAndHour: {
 *     "2026-10-19": {
 *       "07": [["Monday, Oct 19, 2026", "07:00 AM", "8:00 AM", "CCIT", "CC 1080", "500", "See image"], ...]
 *     }
 *   }
 * }
 */

/**
 * @typedef {object} MetisDate
 * @property {string} val - ISO date string like "2026-10-19"
 * @property {string} text - Human readable date like "Monday, Oct 19, 2026"
 */

/**
 * @typedef {object} MetisData
 * @property {MetisDate[]} dates - Array of date objects
 * @property {string[]} headers - Table headers (7 columns)
 * @property {object.<string, object.<string, string[][]>>} byDateAndHour - Nested structure: date -> hour -> rows
 */

/**
 * @typedef {object} ParsedMetisRow
 * @property {string} date
 * @property {string} availFrom
 * @property {string} availTo
 * @property {string} building
 * @property {string} room
 * @property {string} capacity
 * @property {string} image
 */

/**
 * Convert the Metis raw data to the format used by the app.
 *
 * @param {MetisData} raw - The raw Metis JSON data
 * @returns {MetisData} - The validated structured data
 */
export function parseMetisData(raw) {
  if (!raw || typeof raw !== "object") {
    throw new Error("Metis data must be an object");
  }

  const dates = raw.dates || [];
  const headers = raw.headers || [];
  const byDateAndHour = raw.byDateAndHour || {};

  // Validate dates
  for (const date of dates) {
    if (!date.val || !date.text) {
      throw new Error("Each date must have val and text properties");
    }
  }

  // Validate byDateAndHour structure
  for (const [dateKey, hours] of Object.entries(byDateAndHour)) {
    if (!hours || typeof hours !== "object") {
      throw new Error(`byDateAndHour[${dateKey}] must be an object`);
    }
    for (const [hour, rows] of Object.entries(hours)) {
      if (!Array.isArray(rows)) {
        throw new Error(`byDateAndHour[${dateKey}][${hour}] must be an array`);
      }
      for (const row of rows) {
        if (!Array.isArray(row) || row.length < 7) {
          throw new Error(`Row in byDateAndHour[${dateKey}][${hour}] must have at least 7 cells`);
        }
      }
    }
  }

  return {
    dates,
    headers,
    byDateAndHour,
  };
}

/**
 * Convert a single Metis row to a structured object.
 *
 * @param {string[]} row - A row from byDateAndHour (7 cells)
 * @returns {ParsedMetisRow} - Structured row with named fields
 */
export function parseMetisRow(row) {
  if (!Array.isArray(row) || row.length < 7) {
    throw new Error("Row must be an array with at least 7 cells");
  }

  return {
    date: row[0],
    availFrom: row[1],
    availTo: row[2],
    building: row[3],
    room: row[4],
    capacity: row[5],
    image: row[6],
  };
}

/**
 * Validate that the Metis data has the expected structure for our headers.
 *
 * @param {string[] | null | undefined} headers - The headers array from Metis
 * @returns {boolean} - True if headers match expected pattern
 */
export function validateHeaders(headers) {
  if (!Array.isArray(headers)) {
    return false;
  }

  const expectedHeaders = ["Date", "Avail from", "Avail to", "Building", "Room", "Capacity", "Image"];

  if (headers.length !== expectedHeaders.length) {
    return false;
  }

  for (let i = 0; i < headers.length; i++) {
    // Allow case-insensitive comparison with trimmed values
    const headerVal = String(headers[i] || "").trim();
    const expectedVal = expectedHeaders[i];
    if (headerVal !== expectedVal) {
      return false;
    }
  }

  return true;
}

/**
 * Build the byDateAndHour structure from a flat list of rows.
 * Used when refreshing data from the capture script.
 *
 * @param {Array<{dateISO: string, hour: number, dateText: string, availFrom: string, availTo: string, building: string, room: string, capacity: string, image?: string}>} rows - Array of row objects with date, hour, and room info
 * @returns {object.<string, object.<string, string[][]>>} - The byDateAndHour structure
 */
export function buildByDateAndHour(rows) {
  const result = {};

  for (const row of rows) {
    const dateKey = row.dateISO; // ISO date like "2026-10-19"
    const hourKey = String(row.hour).padStart(2, "0");

    if (!result[dateKey]) {
      result[dateKey] = {};
    }
    if (!result[dateKey][hourKey]) {
      result[dateKey][hourKey] = [];
    }

    result[dateKey][hourKey].push([
      row.dateText,
      row.availFrom,
      row.availTo,
      row.building,
      row.room,
      row.capacity,
      row.image || "See image",
    ]);
  }

  return result;
}