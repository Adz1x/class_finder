# Find a section, and a room for a time you need — design

**Date:** 2026-10-20 · **Status:** approved ("go") · **Repo:** `class_finder`

## Intent and the why

A student who must take a course sometimes cannot take the section they were
given: it clashes with another class, it is on the wrong campus, it is full.
The University publishes every section of every course in the timetable API,
so the answer — *these are the other thirty ways to take MAT223* — is in the
data the app already has. The app never showed it.

The same student, hunting for somewhere to study, asks a second question:
*which room in this building is free between 2 and 4 on Tuesday?* The
published per-hour occupancy answers that too.

So the app gains one shared concept, **a time window**, and two surfaces
built on it:

1. **Find a section** — every section of a course, with the ones that fit
   your window first.
2. **A building, for the window you need** — the rooms of a building that
   are free across your window, and the classes running in it.

## Goals

- A student can find an alternative section of a required course, and see at
  a glance which alternatives fit the times they can actually attend.
- A student can ask for a room for a time window and get the options.
- One window control, shared by both, so the two questions feel like one
  tool.

## Non-goals

- Not a registration tool: nothing here enrols anyone or checks for
  conflicts in the student's own timetable. The app has no idea what else
  the student is taking.
- Not a seat-count tool. The timetable API publishes **no room numbers** for
  any class meeting (verified: 0 of 21,408 meetings carry one), so a
  section can only be located to its **building**. The app says "BA" and
  never "BA 1024".
- Not a scheduler. No new data is scraped; this is a view over the dataset
  that is already committed.

## Anti-goals

- **Do not invent availability.** A window that the source does not publish
  is *unknown*, never *free*. The existing rule holds: an hour the snapshot
  does not carry is unknown, and unknown is never free.
- **Do not quietly change what "now" means.** With no window set, every
  surface behaves exactly as it does today. The window is an addition, not
  a replacement of the clock.

## The window

One type, shared by both surfaces:

```ts
export interface TimeWindow {
  /** Days the user needs: 1 = Monday .. 7 = Sunday. Empty means any day. */
  days: number[];
  /** Minutes since midnight. null means unbounded. */
  startMins: number | null;
  endMins: number | null;
}
```

Rules:

- **Empty window** (`days: []`, both times null) means "no filter". It is
  the default, and it keeps today's behaviour intact.
- **A day list** filters by weekday. A meeting on a day that is not in the
  list does not fit.
- **A time range** is *containment*: a class fits when it starts at or
  after `startMins` **and** ends at or before `endMins`. A class that hangs
  over the end of the window does not fit.
- **A start after the end** (10:00 → 08:00) is not an overnight window —
  the University does not schedule classes overnight — so the time filter is
  ignored, and the control prevents it.
- **Rooms** are checked at hour granularity, because that is the only
  granularity published. A room is free for a window when it is free in
  every hour the window overlaps. An hour the snapshot does not carry makes
  the room **unknown** for that window, never free.

## Surface A — Find a section

Route: `#/sections/<campus>/<courseCode>`.

The view shows the course title, how many sections exist, the window
control, and every section of the course:

| Shown | Source |
|---|---|
| Section type and number (`LEC0101`) | `sectionName` |
| Term | the session code (20269 Fall, 20271 Winter) |
| Each meeting: weekday, time | the meetings of the section |
| Building(s) | `buildingCode` — never a room |
| Instructor | `instructors` (may be empty) |
| A verdict | the fit against the window |

**A section is a group of meetings**, keyed by `(sectionName, sessionCode)`.
A section can meet on two days with *different times each day* — MAT223H1's
LEC0301 meets Wednesday 09:00–11:00 and Friday 10:00–11:00 — so the fit is
computed per meeting and the section's verdict is the roll-up:

- **Fits** — every meeting of the section fits.
- **Partly fits** — some meetings fit, some do not. The row shows which,
  so the conflict is visible rather than implied.
- **Doesn't fit** — no meeting fits.

Ordering: fitting sections first, then partly fitting, then the rest; within
a group, by the earliest meeting (day, then start time), then by section
name. A section with no meeting at all cannot exist.

Rows are links to that section's own weekly grid, `#/section/<campus>/<code>/<sectionName>`.
The whole course's timetable stays reachable from the finder.

**Entry point.** The search box's matching-course list no longer jumps
straight to the course timetable: choosing a course opens its section
finder. The course timetable is one click away from there, so nothing is
lost.

## Surface B — a building, for the window you need

Same window control, in the classroom list. With a window set:

- The room cards answer for the **whole window**, not the current hour:
  *free for your window* / *busy 2:00–4:00* / *unknown*.
- The building's class list — which reads "Today in BA" today — reads
  *the classes running in your window* instead.
- The building's "N of M free now" badge becomes "N of M free for your
  window".

With no window set, all three keep their current wording and behaviour.

## Constraints

- No new dependencies. React 19, Next 16, Tailwind, as installed.
- No new scraping: the dataset already carries every section of every
  course.
- The payload budget must still hold: the section finder reads the campus
  payload the app already fetches, so **no bytes are added**.
- The interface keeps its look: the existing dark palette, the existing
  card and badge patterns, the existing font sizes.

## Review focus

The five inputs most likely to bite a student, each of which gets a test:

1. **A section that meets on two days with different times** — the verdict
   must be per meeting, not per section.
2. **A class that hangs over the end of the window** (10:00–12:00 asked,
   11:00–13:00 offered) — containment, not overlap.
3. **A window on a day the class does not meet** — the day filter.
4. **A room whose occupancy the snapshot does not carry for part of the
   window** — unknown, never free.
5. **A course with one section, or one with a hundred and twenty-nine** —
   the finder must not assume a tidy number.

## What the builder still has to decide

Nothing that changes what gets built. The builder picks the component
split inside `src/components/`, the exact copy of the badges, and the
order of the fields in the control — all within the look already
established.
