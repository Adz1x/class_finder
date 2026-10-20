# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Data

- **The St. George classroom inventory.** UofT Space Management publishes
  every classroom of every St. George building, with the number of students
  it seats. The app now lists all **334 of them in 40 buildings**
  (`data/classrooms/UTSG.json`), refreshed by
  `node scripts/fetch-utsg-classrooms.mjs`.
- **Where the University publishes room occupancy was searched for, not
  assumed.** The Mississauga space database is the only open source of
  room-level availability. The St. George "Calendar of Availability"
  application has been withdrawn, the Scarborough classroom calendar is
  behind a UTORid login, the St. George empty-classroom finder is a mobile
  application with no public feed, and the campus map has no schedule
  endpoint. Section 2.4 of the report records every source that was checked.

### Application

- **The repetition is gone.** Every class row used to end with "Room not
  published" and every classroom card with "Not published" - the same
  sentence 65 times on one screen, which reads as an error rather than as a
  fact about the source. It is said once now, in the banner and the course
  view, and a room is shown only when the source has one.
- **The published band is described honestly.** "7:00 AM - 9:00 PM" claimed
  the 13:00 hour the space database omits. It reads "7:00 AM - 12:00 PM and
  2:00 PM - 8:00 PM" now.
- **The snapshot date is dated once**, in the footer, instead of on every
  view.
- **How busy every building is right now**, on every campus, with the
  emptiest buildings first. It is the closest published thing to "is there
  space here" on the campuses where the University publishes no occupancy.
- **The St. George tab now shows real classrooms** - the building's
  classrooms and their capacities - instead of only a class schedule.
- **The Scarborough tab has its real classrooms too** - 71 of them in 10
  buildings, from the IITS classroom specifications: room number, capacity,
  room type, features and accessibility.
- **The building order control is gone.** The buildings are ordered by how
  many classes they have, as they always were.

### Engineering

- 109 tests across three layers: 44 pytest, 48 Vitest, 17 Playwright.

## [0.3.0] — 2026-10-20

The project becomes a real application: the data pipeline is rewritten and
proven complete, the UI is rebuilt in Next.js, and the whole thing is
covered by an automated test pyramid.

### Data

- **Rewrote the scraper.** The previous version computed the page count from
  the page size it *requested*; the API caps pages at 20 rows regardless, so
  it fetched 148 of the 370 pages that exist and wrote 2,960 of 7,383 course
  rows while reporting success. The new client derives the page count from
  the rows it actually receives, asserts `fetched == total`, detects
  duplicate rows, and fails loudly instead of writing a partial dataset.
- **The catalogue is now complete**: 7,383 course rows → 21,408 class
  meetings, all 8 faculties, 3 campuses.
- **The dataset is stored one file per campus key** (`data/campus/<KEY>.json`).
  The app fetches one campus at a time, so serving the whole catalogue cost
  8.3 MB before the first pixel. The default campus now costs **87 KB over
  the wire**; St. George, the largest, costs 231 KB. `npm run data:size`
  measures the gzipped size of each payload and fails the build if the
  default campus crosses 150 KB.
- **Rooms are never invented.** The timetable API publishes an empty
  `buildingRoomNumber` for all 22,659 meeting times, so the room field is
  `null` and the interface says "room not published". The previous version
  guessed room numbers from a hard-coded table.
- **Course codes are verbatim.** `course.code` already contains the course
  and section (`ISP100H5`); the old code appended the session letter and
  produced labels like `ISP100H5F`.
- **Campus comes from `course.campus`**, not from the faculty list.
- **42 more buildings named.** Names come from Cobalt, U of T's own open-data
  project, and were only accepted when the campus it records matches the
  campus of the timetable classes that meet there. 21,238 of 21,408 meetings
  now carry a real building name.
- The Metis weekday is derived from the ISO date, and the hour the space
  database omits (13:00) is reported as *unknown*, never as *free*.
- The filter funnel is measured rather than remembered: 22,659 meeting
  times published, 12 dropped as cancelled sections, 1,007 with no physical
  building, 232 the API repeated, 21,408 kept. `uoft-scraper funnel` prints
  it, `meta.filterFunnel` records it, and `verify` checks that it adds up.

### Application

- The static single-file UI was ported faithfully into the Next.js app, with
  real state instead of DOM mutation.
- The class list **no longer hides half the timetable**: it is scoped to a
  term with a visible Fall/Winter toggle, and every count states its term.
- Classroom availability is explained in **one banner** instead of repeated
  on every room card, and distinguishes "not published" from "occupied".
  Outside the published hours the app says so, instead of showing 65 cards
  that all read "unknown" and looking like a closed campus.
- The building picker shows the busiest few and moves the rest into a
  dropdown, which matters on St. George's 68 buildings.
- Every classroom now says how many are free in its building, and each class
  row carries that count.
- Search, room status and the weekly timetable are pure functions in
  `src/components/lib/schedule.ts`.

### Engineering

- 99 tests across three layers: 39 pytest, 45 Vitest, 15 Playwright.
- Four CI jobs on GitHub Actions. None of them touches the UofT API.
- `npm run data:verify` checks the dataset's invariants, including that the
  per-campus files add up to the totals and that no meeting carries a room
  the source did not publish.
- `npm run data:size` enforces the payload budget in transferred bytes.
- MIT licence, contribution guide, code of conduct and security policy.

### Accessibility

- **WCAG 2.1 AA**, checked by `@axe-core/playwright` against the classroom
  list, a course timetable, a classroom timetable and St. George. The build
  fails on any violation.
- The room cards, the timetable blocks and the logo were `<div onClick>`:
  clickable, but invisible to the keyboard and to a screen reader. They are
  buttons now, with an accessible name.
- The muted grey used for secondary text was 3.8:1 against the panel
  background, under the 4.5:1 that AA requires for small text. It is 7.1:1
  now.
- Every interactive element draws a visible focus ring, and the weekly
  grid's sideways scroll is focusable and labelled rather than a trap.

### Earlier

- [0.2.0] — Next.js 16 scaffold, Tailwind v4, the first port of the UI.
- [0.1.0] — The original static page and the first scraper.

[Unreleased]: https://github.com/Adz1x/class_finder/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/Adz1x/class_finder/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/Adz1x/class_finder/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/Adz1x/class_finder/releases/tag/v0.1.0
