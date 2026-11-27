/**
 * Which week a capture script asks for.
 *
 * Every capture script takes the same optional argument:
 *
 *   (none)        this week
 *   --next-week   next week (on a Saturday or Sunday, that is the coming Monday)
 *   YYYY-MM-DD    the week that date falls in
 *
 * Weeks run Monday to Sunday and dates are local: the refresh runs on a
 * machine in Toronto, so a Sunday-evening run asks for the next morning's
 * week even though it is already Monday in UTC.
 */

/** YYYY-MM-DD for a local date. */
export function isoLocal(date) {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** Local midnight on the Monday of the week `date` falls in. */
export function mondayOf(date) {
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  return monday;
}

/**
 * The Monday a capture should start from, given the script's arguments.
 *
 * @param {string[]} args the script's arguments (process.argv.slice(2))
 * @param {Date} [now]
 * @returns {Date} local midnight on that Monday
 */
export function weekFromArgs(args, now = new Date()) {
  const explicit = args.find((arg) => /^\d{4}-\d{2}-\d{2}$/.test(arg));
  if (explicit) {
    const [year, month, day] = explicit.split("-").map(Number);
    const date = new Date(year, month - 1, day);
    if (
      date.getFullYear() !== year ||
      date.getMonth() !== month - 1 ||
      date.getDate() !== day
    ) {
      throw new Error(`not a real date: ${explicit}`);
    }
    return mondayOf(date);
  }
  const monday = mondayOf(now);
  if (args.includes("--next-week")) monday.setDate(monday.getDate() + 7);
  return monday;
}

/** The weekdays (Monday to Friday) of the week starting on `monday`. */
export function weekdaysFrom(monday) {
  return [0, 1, 2, 3, 4].map((offset) => {
    const date = new Date(monday);
    date.setDate(monday.getDate() + offset);
    return date;
  });
}
