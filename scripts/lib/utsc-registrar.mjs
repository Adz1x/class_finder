/**
 * @typedef {{ booked: boolean, label: string }} Slot
 * @typedef {{ days: string[], grid: Slot[][] }} RoomTable
 */

/**
 * The University of Toronto Scarborough Registrar's classroom schedule
 * service, and how to read it.
 *
 * The service answers a JSONP request with a map of room code to an HTML
 * table: one row per half hour, one column per day, and every booked cell
 * carries the course code and the instructor.
 *
 * The parsing lives here rather than in the capture script so it can be
 * tested against a saved table: the service is read again every term, and
 * the parsing is the part that can silently go wrong.
 */

/** The JSONP answer, as a map of room code to its table. */
export function parseWeek(text) {
  const trimmed = text.trim();
  const open = trimmed.indexOf("(");
  const close = trimmed.lastIndexOf(")");
  if (open < 0 || close < 0) {
    throw new Error(
      `Unexpected answer from the Registrar's service: ${trimmed.slice(0, 200)}`,
    );
  }
  return JSON.parse(trimmed.slice(open + 1, close));
}

/**
 * One room's table: the days it publishes, and half-hour slots per day.
 *
 * A booked cell spans several half-hour rows, and the room is booked for
 * all of them.
 */
/** @returns {RoomTable} */
export function parseTable(table) {
  const headers = [...table.matchAll(/<th>([^<]*)<\/th>/g)].map((m) => m[1]);
  const days = headers.slice(1);

  const body = table.slice(table.indexOf("<tbody>"));
  const rows = [...body.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map((m) => m[1]);

  // grid[day] is the list of half-hour slots for that day.
  const grid = days.map(() => []);
  // carry[day] is a rowspan still covering rows, and whether it is booked.
  const carry = days.map(() => null);

  for (const row of rows) {
    const cells = [...row.matchAll(/<td([^>]*)>([\s\S]*?)<\/td>/g)];
    if (!cells.length) continue;
    // The first cell is the time the row starts at.
    const label = cells[0][2].trim();

    let column = 0;
    for (const [, attributes] of cells.slice(1)) {
      while (column < days.length && carry[column]) {
        const span = carry[column];
        grid[column].push({ booked: span.booked, label });
        span.remaining -= 1;
        if (span.remaining <= 0) carry[column] = null;
        column += 1;
      }
      if (column >= days.length) break;

      const booked = /class=['"]booked['"]/.test(attributes);
      const rowspan = Number(
        (attributes.match(/rowspan=['"](\d+)['"]/) || [])[1] || 1,
      );
      grid[column].push({ booked, label });
      if (rowspan > 1) {
        carry[column] = { remaining: rowspan - 1, booked };
      }
      column += 1;
    }
    // Columns the row did not reach are covered by an earlier rowspan, or
    // simply empty.
    while (column < days.length) {
      if (carry[column]) {
        const span = carry[column];
        grid[column].push({ booked: span.booked, label });
        span.remaining -= 1;
        if (span.remaining <= 0) carry[column] = null;
      }
      column += 1;
    }
  }

  return { days, grid };
}

/** The hour a half-hour row starts at, from its label. */
export function hourOf(label) {
  const [hours, minutes] = label.split(":").map(Number);
  return hours + (minutes >= 30 ? 0.5 : 0);
}

/**
 * The occupancy the app stores: one flag per hour per day.
 *
 * The source publishes half hours and the app shows hours, so a booked half
 * hour makes its hour booked: the app never claims a room is free for an
 * hour it is not.
 */
/** @param {Slot[][]} grid */
export function toHourly(grid) {
  const occupancy = {};
  grid.forEach((slots, index) => {
    const hours = {};
    for (const slot of slots) {
      const hour = Math.floor(hourOf(slot.label));
      hours[hour] = Boolean(hours[hour]) || slot.booked;
    }
    occupancy[index + 1] = hours;
  });
  return occupancy;
}
