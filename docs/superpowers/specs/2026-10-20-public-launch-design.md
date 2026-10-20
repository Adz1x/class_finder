# Class Finder — public launch design

Date: 2026-10-20
Status: draft for review
Repo: `C:\Users\aramo\.coord\repos\ccf2550a-974d-4709-97e2-17aa6eee1c19\class_finder`
Branch: `main` (7 local commits, not pushed)

## Intent and the why

The app works and is fully tested (84 tests, 3 layers, CI green). It is not yet
**publicable**: there is no URL, no screenshots, no licence, and every visitor
downloads 8.7 MB before the app is usable. The project also has one genuinely
distinctive property that is currently invisible to an outside reader — it
refuses to fabricate data, and it can prove why.

The goal is three outcomes, in this order:

1. **A live link on a CV** that a recruiter clicks and understands in ten seconds.
2. **A school project that scores** — methodology, findings, evaluation, limits.
3. **A tool students actually use** — features the official UofT timetable lacks.

The order matters: (1) is what gets the interview, (2) is what gets the grade,
(3) is what earns stars. (1) and (2) are cheap; (3) is the expensive one and it
only matters if (1) and (2) already work.

## What the project is, in one paragraph

A Next.js 16 app that finds University of Toronto classes and classrooms. It
scrapes the public Timetable Builder API into a committed, versioned dataset
(7,383 course rows → 21,408 class meetings, all 8 faculties, 3 campuses) and
serves it from a prerendered static route. Classroom availability comes from
UTM's official Classroom Space Database (Metis): 65 real rooms with per-hour
occupancy for one snapshot week.

## Non-goals

- **Never invent data.** No guessed room numbers, no guessed building names.
  Where the source publishes nothing, the UI says so. This is the project's
  core value and it outranks every other feature.
- Not a UTSG/UTSC room finder. No public source publishes rooms for those
  campuses; Metis covers UTM only. Those campuses get complete building-level
  class schedules and a plain statement that room-level availability does not
  exist there.
- Not a mobile app. Not an account system. No user data collection.
- Not a commercial product. University data, university audience.

## Anti-goals (what would make this a failure even if it "works")

- A live link that loads an 8.7 MB payload and takes ten seconds on campus wifi.
- A README that looks good but whose numbers cannot be reproduced.
- A "Live Classroom Availability" claim when the data is a dated snapshot. The
  one lie in a project whose value is not lying.
- Shipping a feature because it is impressive rather than because a student
  would use it.

---

## Phase 1 — Make it publishable

### 1.1 Honesty fixes (blocking) — scope corrected

The "live" claim lives in **more places than the header**:

- `src/app/layout.tsx` metadata description — "live classroom availability"
- `package.json` description — same wording
- the header subtitle — "Live Classroom Availability & Course Schedules"
- every room card's status badge — "Available" / "Occupied" / "Unknown"
- every room card's secondary line — "Free in this hour" / "Booked until 3:00 PM"
- the header stat — "X of Y classrooms available on UTM"
- the filter toggle — "Only show empty classes right now"

All of those are computed against the **real clock** using a **dated** occupancy
snapshot (week of 2026-09-30), so today they assert last week's occupancy as
current. That is the one lie in a project whose value is not lying, and it is
the project's own anti-goal.

**Fix (decided): make every one of them snapshot-aware.** Badge states stay
"Available / Occupied / Unknown" (they describe the snapshot, which is the
truthful state), but the copy around them states the snapshot explicitly:
"Free in the 14:00 hour — snapshot of the week of Sept 30", "Booked until
3:00 PM in that snapshot". Add one persistent, visible banner stating the
snapshot week and that the dataset is a dated snapshot, not a live feed, and
make it say so on every campus (including the ones with no room data).

Also update `layout.tsx` and `package.json` metadata.

The search placeholder advertises `room (e.g. BA 1160)`. Rooms exist for UTM
only, and `BA 1160` is not in the dataset at all. Replace with a placeholder
that reflects what the current campus can actually search.

The README currently states *"Both public and non-commercial use of the
timetable API are allowed by the University of Toronto."* **That claim is
unverified and must be deleted** — UofT publishes no terms of use for this
endpoint. Replace with attribution + non-affiliation + "no published terms of
use" + "the dataset is a dated snapshot".

### 1.2 Data payload: 8.7 MB → ~105 KB

Measured: `/api/schedule` serves 8,727,422 bytes with **no `content-encoding`
header**, and Next generated zero precompressed assets. The home page is 7 KB,
so the entire cost is the dataset fetch.

Fix by splitting the dataset per campus and serving it compressed. **The
campus key set is four, not three** — `SHERIDAN` holds 94 meetings that the
UI's three tabs never show, and the numbers must reconcile:

| Campus key | Meetings | Raw | Target (gzipped) | In the UI |
|---|---|---|---|---|
| UTM | 5,178 | 2.1 MB | ~105 KB | yes (default) |
| UTSG | 12,175 | 4.7 MB | ~230 KB | yes |
| UTSC | 3,961 | 1.5 MB | ~78 KB | yes |
| SHERIDAN | 94 | 36 KB | ~4 KB | no tab — as today |
| **Total** | **21,408** | | | |

Write one file per campus key actually present (four). The client fetches by
key and caches in memory. Sheridan stays invisible in the UI, exactly as it is
today, but its rows are not lost. Add a `uoft-scraper verify` invariant that
the per-campus files sum to `classes.json` exactly, so the count can never
silently drift again.

The payload budget means **transferred** bytes: UTM gzipped is 79,347 bytes,
raw 2,201,948. Ship precompressed `.json.gz` artefacts alongside the plain
files, serve with `Content-Encoding: gzip`, and add a `data:size` script that
gzips each campus file and fails if the default campus exceeds 150 KB. Wire
that into CI so the budget cannot regress.

### 1.3 Accessibility

Currently: **0** `aria-label`/`role` attributes in the components, **14**
`onClick` handlers on `<div>` elements, no keyboard handlers, no focus states.
Clickable room cards, building headers and timetable blocks are not reachable
by keyboard.

Fix: use real `<button>` elements for interactive cards, add `aria-label` where
the visible text is ambiguous, add visible focus rings, and make the timetable
grid's blocks keyboard-reachable.

**Target: WCAG 2.1 AA, machine-verified.** Add `@axe-core/playwright` to the
Playwright suite and run it against the three views, so the claim in the
report is backed by a test that fails on regression rather than a checklist.
The report must state that coverage is automated-plus-manual, not a full
external audit. Watch for contrast failures on the dark slate palette, heading
order, and the Font Awesome CDN dependency.

### 1.3a Reproducing the 22,659 figure

The README and the report both cite "22,659 meeting times", but the committed
dataset holds **21,408** — the post-filter count. The 22,659 was the raw
number of `meetingTimes` entries seen before cancelled sections, non-physical
building codes and duplicates were dropped. **That number is not reproducible
from the repo today**, which breaks the Phase 2 requirement that every number
be reproducible.

Fix: record the raw count during the build (`meta.rawMeetingTimesSeen`), add a
verify assertion, and show the filter funnel in the report:
7,383 rows → 22,659 meeting times seen → 21,408 kept.

### 1.4 Repo hygiene

Missing: `LICENSE` (MIT), `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`,
`SECURITY.md`, `CHANGELOG.md`, `.editorconfig`, `.github/PULL_REQUEST_TEMPLATE.md`,
`.github/ISSUE_TEMPLATE/`.

The licence must be MIT to match the scraper and the skills already used.

### 1.5 README as the CV

The README is 230 lines of good prose and **zero images**. It needs:

- A one-line "what it is" + a live link placeholder and a status badge.
- Real screenshots of the three views (classroom list, course timetable,
  classroom timetable), captured from the production build and committed under
  `docs/images/`.
- A short demo GIF (the views have a natural 3–4 second loop).
- The measurable numbers stated plainly: 7,383/7,383 rows, 21,408 meetings,
  84 tests, payload size after the fix.

### 1.6 Branding

`public/` still contains the default Next.js scaffold SVGs (`file.svg`,
`globe.svg`, `next.svg`, `vercel.svg`, `window.svg`) and a default favicon.
Replace with a real icon and add an Open Graph image so a shared link renders
a preview card in Slack/iMessage/WhatsApp.

### 1.7 Building names — solved, see the research note

**Done.** The names live in `data/building_names.json` (87 entries), each with a
`source` and the campus it was accepted for.

Source: **`cobalt-uoft/datasets` → `buildings.json`** — Cobalt is the University
of Toronto's own open-data project (MIT, archived 2020). It is JSON Lines, 265
buildings with code, name, campus, address and coordinates.

**Cobalt's codes collide with the TTB's.** A blind import would have named
`MN` "Maritain House" (a St. George building) and `IA` "Spadina Avenue-703",
because Cobalt's code space is the campus directory's, not the timetable's.
So every candidate was checked against a data-driven rule: *the campus Cobalt
records for a building must match the campus of the timetable classes that
meet there.* 77 codes agree, 2 conflict and were rejected. 42 previously
unnamed buildings were recovered, covering 3,497 of the 3,667 affected
meetings.

Result: **21,238 of 21,408 meetings now carry a real building name** (was
17,741). Six codes remain unknown — `AM`, `BY`, `RO`, `TL`, `UY`, `ZO`, 170
meetings — and they keep saying "Name not listed", which is the honest
fallback.

### 1.7a What the API actually publishes — the reverse-engineering note

The TTB client bundle (`https://ttb.utoronto.ca/main.*.js`, 1.4 MB) was read
to establish what is and is not available, rather than assuming.

**All seven endpoints the official site uses:**
`getCourses`, `getCoursesByCodeAndSectionCode`, `getMatchingCourseTitles`,
`getMatchingDepartments`, `getMatchingDivisions`,
`getOptimizedMatchingCourseTitles`, `getPageableCourses`, plus
`reference-data` and a `findById` (which returns 404 for course ids).

**There is no building filter and no building list.** The site's own search
filters are course code/title, department, instructor, level, day, time,
campus, credit weight and space. So no one — including UofT — publishes a
"number of classes in MN" to compare against; our figure is derived the same
way any third party would have to derive it.

**Room numbers are measured absent, not assumed.** The client renders
`buildingCode + buildingRoomNumber + buildingRoomSuffix`, so the official site
*would* display a room if the API had one. Across **all 22,659 meeting times
in the catalogue, `buildingRoomNumber` is `""`**, and `buildingRoomSuffix` is
`""` too. The claim in the README is now a measurement.

**Bonus:** each meeting carries `buildingUrl`
(`https://map.utoronto.ca/?id=1809#!m/495122`) — a per-building link into
UofT's Concept3D map. The map's marker API is key-protected (403), so no
names from there, but the link enables a "view on the map" affordance later.

### 1.7b The list view was hiding half the data — the bug behind "MN looks wrong"

**The dataset was right; the UI was wrong.** The list view was scoped to the
current term with **no way to change it** — the Fall/Winter toggle only
existed in the timetable view. MN showed **"766 class meetings"** when MN
actually has **1,577** (766 Fall + 811 Winter). Anyone comparing that against
the official timetable would conclude the data was incomplete.

Fixed: the term toggle now lives in the main controls bar (visible in both
views), every count states its term ("811 class meetings · Winter"), and the
header stat states the term too. Covered by a regression test.

Related honesty bug found at the same time: the header read
**"0 of 65 classrooms available"** at 21:00, when the Metis snapshot's last
hour is 20:00 — those rooms are *unknown*, not occupied. The stat now
distinguishes "not published" from "occupied", and says
"Availability not published for this hour" when nothing is known.

### 1.8 Deployment

Target: Vercel (free tier), because it is a Next.js app with a committed
`data/` directory and no server-side state. The build reads `data/` at build
time, so no environment variables are needed.

**This is the one item requiring the human's GitHub/Vercel login.** Everything
else in Phase 1 can be built and verified locally. `gh` is currently
unauthenticated on this machine, so the GitHub push is also a manual step.

### 1.8a Term dates for the calendar export (Phase 3 dependency)

The dataset has no dates — only session codes (`20269` = Fall, `20271` =
Winter), weekday and clock time. A valid `.ics` needs real `DTSTART`/`DTEND`
or an `RRULE` with an `UNTIL`. Commit a `data/term_dates.json` sourced from
the published UofT academic calendar, with the source URL recorded, and emit
one `VEVENT` per meeting with an `RRULE` and `UNTIL` in `America/Toronto`.

### 1.9 Bug fixes found during the audit

- The "Show N more" / "Show fewer" buttons render adjacent with no gap —
  they read as "Show 3 moreshow fewer". Fix the spacing.
- On St. George, 68 building chips wrap to three rows. The original static UI
  had a "More buildings (N)…" dropdown; restore that behaviour past a
  threshold.
- `TtbClient.fetch_reference_data()` does not send `Accept: application/json`,
  so the API returns XML and `json.loads` raises. Currently unused, but broken.
- The loading state is one line of text; replace with a skeleton.

---

## Phase 2 — Make it a school project

- **`docs/REPORT.md`** — the technical report: problem, method, the room-number
  finding (measured across 22,659 meeting times), architecture, evaluation
  (scrape completeness, payload size, build time, test counts), limitations,
  future work.
- **`docs/ARCHITECTURE.md`** with a diagram. graphify has already produced a
  449-node / 833-edge knowledge graph of this codebase; use it to generate the
  real diagram rather than drawing one by hand.
- **`docs/images/`** — screenshots and the demo GIF (also used by the README).
- A **benchmarks table** in the report, with the numbers reproducible by
  `npm run data:verify` and the test suites.
- Attribution and non-affiliation statement: the API has **no published terms of
  use**, its CORS is restricted to `ttb.utoronto.ca`, and the dataset is a
  dated snapshot refreshed by the maintainer. State that plainly.

## Phase 3 — Make it a tool

Ordered by value per unit of work:

1. **Calendar export (.ics)** — "add my classes to Google Calendar". Every
   meeting of a course becomes an event with the building, instructor and
   session. ~80 lines, no library needed (the format is a text format).
2. **"My schedule"** — select courses → one combined weekly grid → export
   that. Makes (1) natural and is the feature that turns the app into
   something a student keeps open.
3. **Shareable deep links + OG image** — the hash routing already works;
   make a shared course link render a proper preview card.
4. **Search quality** — currently exact/prefix/substring on the course code.
   Add fuzzy matching and instructor search.

Non-goals for Phase 3: accounts, notifications, anything that requires a
backend beyond the static app.

---

## Constraints

- **No fabrication.** Absolute. A value is either published by the source or
  it is absent.
- Python ≥ 3.10, < 3.14 for the scraper; Node 22+ for the app.
- The toolchain on this machine is Windows: `npm`, `next`, `uv` and `pytest`
  must run through `cmd.exe`. `node_modules` is a Windows install
  (`swc-win32-x64-msvc` only) — running npm from WSL fails.
- The app must keep working with the dataset committed to the repo, so CI and
  a fresh clone need no network.
- Do not push to `origin` without asking. Do not touch the user's own
  uncommitted edits to `.mcp.json`, `AMOEBA.md` or `skills/`.

## Decisions taken by the builder (no need to revisit)

- Per-campus static routes, chosen client-side; the dataset is split by the
  scraper into `data/campus/<KEY>.json` (+ `.gz`).
- Four campus files, including SHERIDAN; no fourth tab.
- The payload budget is measured in transferred bytes and enforced by a
  `data:size` script in CI.
- Accessibility target is WCAG 2.1 AA, verified by `@axe-core/playwright` on
  the three views.
- The 22,659 figure becomes reproducible via `meta.rawMeetingTimesSeen`.
- The README's unverified terms-of-use permission claim is deleted.
- The `LICENSE` copyright holder is `Adz1x` (the repository's git author and
  GitHub handle); MIT; the launch is versioned `0.3.0`.
- Phase 3 keeps hash routing and ships one strong generic OG image.
  Per-course preview cards would require real path routes and are recorded as
  future work, not built.
- Chip overflow: the legacy UI used `MAX_BUILDING_CHIPS = 8`; restore that
  threshold with a "More buildings (N)…" dropdown, sorted by meeting count.
- `TtbClient.fetch_reference_data()` gains `Accept: application/json`.
- The Playwright readiness probe and the `/api/schedule` e2e assertion are
  updated for the new routes, and placeholder-sensitive selectors
  (`getByPlaceholder(/Search building/i)`) are updated when the copy changes.

## Definition of done

**Phase 1:** production build green, all 84 tests still green, payload for the
default campus under 150 KB, no keyboard traps, README has screenshots and a
live link, `LICENSE` present, and the UI makes no claim the data cannot
support.

**Phase 2:** `docs/REPORT.md` and `docs/ARCHITECTURE.md` exist, every number in
them is reproducible from the repo, and the architecture diagram is generated
from the real codebase.

**Phase 3:** calendar export produces a file that imports into Google Calendar
and Apple Calendar with correct times, and "My schedule" combines multiple
courses into one grid.

## Left to the builder

- Exact component structure for the accessibility refactor.
- Whether the campus split happens in the scraper or in a build step.
- The ics file layout, within the format's rules.
- Screenshot capture tooling.
- Curated building-name table contents (must be verifiable, not invented).
