/**
 * Reads the answers of the UTM Classroom Space Database (Metis).
 *
 * The capture asks Metis one question per weekday and hour:
 *
 *   POST https://metis.utm.utoronto.ca/space/index.php
 *   date_par=2026-10-20&building_par=All&time_par=13&duration=1
 *
 * and the page answers with a table of the rooms that are free in that hour,
 *
 *   Date | Avail from | Avail to | Building | Room | Capacity | Image
 *
 * or with a single "No rooms available..." row when nothing is free. Both
 * answers are facts about the hour. Anything else (a sign-in page, an error,
 * a redesigned page) is not, and the capture must stop rather than record it.
 * docs/REPORT.md tells why each hour is asked for directly instead of read
 * from the page's own hour menu, which leaves out 13:00.
 *
 * The rows are kept exactly as Metis prints them, which is the shape
 * data/utm_metis_data.json has always had and scraper/src/uoft_scraper/metis.py
 * reads: seven cells per free room, or one cell carrying the message.
 */

export const METIS_HEADERS = [
  "Date",
  "Avail from",
  "Avail to",
  "Building",
  "Room",
  "Capacity",
  "Image",
];

const NO_ROOMS = /No rooms available/i;

const NAMED_ENTITIES = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

/** Decodes the HTML entities a server-rendered PHP page uses. */
export function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity) => {
    if (entity[0] === "#") {
      const code =
        entity[1] === "x" || entity[1] === "X"
          ? parseInt(entity.slice(2), 16)
          : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
  });
}

/** The visible text of an HTML fragment, with whitespace collapsed. */
export function cellText(html) {
  return decodeEntities(
    html
      .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The innermost table rows of a page, as lists of cell texts.
 *
 * Old PHP pages often lay themselves out with tables, so a row can contain a
 * whole table. Only rows with no row inside them are returned, and a cell
 * runs to the next cell or the end of its row, so an omitted `</td>` (legal
 * HTML) does not swallow the rest of the row.
 */
export function tableRows(html) {
  const rows = [];
  const open = /<tr\b[^>]*>/gi;
  let match;
  while ((match = open.exec(html))) {
    const start = match.index + match[0].length;
    const close = html.toLowerCase().indexOf("</tr>", start);
    const end = close === -1 ? html.length : close;
    const body = html.slice(start, end);
    if (/<tr\b/i.test(body)) continue; // an outer layout row
    const cells = [
      ...body.matchAll(/<t[hd]\b[^>]*>([\s\S]*?)(?=<t[hd]\b|<\/t[hd]>|$)/gi),
    ].map((cell) => cellText(cell[1]));
    if (cells.length) rows.push(cells);
  }
  return rows;
}

/**
 * What one Metis answer says about its hour.
 *
 * @param {string} html the page Metis returned
 * @returns {{kind: "rooms", rows: string[][]}
 *   | {kind: "none", rows: string[][]}
 *   | {kind: "unexpected", reason: string}}
 */
export function parseMetisPage(html) {
  const rows = tableRows(html);
  const isHeader = (cells) =>
    cells.length === METIS_HEADERS.length &&
    cells.every((cell, i) => cell.toLowerCase() === METIS_HEADERS[i].toLowerCase());
  const headerAt = rows.findIndex(isHeader);

  if (headerAt !== -1) {
    const rooms = rows
      .slice(headerAt + 1)
      .filter((cells) => cells.length === METIS_HEADERS.length && !isHeader(cells));
    if (rooms.length) return { kind: "rooms", rows: rooms };
  }

  const message = rows.find(
    (cells) => cells.length < METIS_HEADERS.length && NO_ROOMS.test(cells.join(" ")),
  );
  if (message) return { kind: "none", rows: [[message.filter(Boolean).join(" ")]] };
  if (NO_ROOMS.test(cellText(html))) {
    return { kind: "none", rows: [["No rooms available"]] };
  }

  return {
    kind: "unexpected",
    reason:
      headerAt === -1
        ? "no results table and no 'No rooms available' message"
        : "a results table with no rows and no 'No rooms available' message",
  };
}

/** The date as Metis prints it: "Monday, Oct 19, 2026". */
export function metisDateText(date) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}
