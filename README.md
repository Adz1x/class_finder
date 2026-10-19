# UofT Class & Room Finder

Find University of Toronto classes and classrooms.

- **Complete course schedules** for Fall 2026 (session `20269`) and Winter 2027 (session `20271`) — 7,383 course records, 21,408 class meetings, all 8 faculties.
- **Real classroom availability** for UTM, from the official UTM Classroom Space Database (Metis) — 65 actual rooms with per-hour occupancy.
- Search by course code, building or classroom; weekly timetable per course, per building, per classroom.

---

## What the data does *not* contain — and why

The UofT timetable API publishes `building.buildingRoomNumber` as an **empty string** for
every one of the 22,659 meeting times in these two sessions. There is no public source
that maps a class to a room. This project therefore **never invents a room number**:

| Situation | What the app shows |
|---|---|
| Class in a building, no room published | The building, and the label **"room not published"** |
| UTM classroom (Metis covers it) | The real room, its capacity and its availability |
| St. George / Scarborough classroom | Building-level class schedule — the only thing UofT publishes |

Metis also omits the **13:00** hour entirely. That hour is reported as *unknown*, never as
"free".

The previous version of this project shipped 100% fabricated room numbers. That code
(`assign_smart_room`, `REAL_BUILDING_ROOMS`, `SKIP_ESTIMATED_ROOMS` and the `estimated`
field) has been deleted.

---

## Stack

| Layer | Tooling |
|---|---|
| App | Next.js 16.4 (App Router, Turbopack, Cache Components), React 19.3, Tailwind v4, TypeScript |
| Scraper | Python 3.10–3.13, `uv`, standard library only |
| Unit tests | pytest (scraper), Vitest + Testing Library (app) |
| End-to-end | Playwright (Chromium) |
| CI | GitHub Actions — three jobs, no network access to UofT |

---

## Getting started

### Prerequisites

- **Node.js 22+** and npm
- **[uv](https://docs.astral.sh/uv/)** for the Python side (`uv sync` creates the venv for you)

### Install and run

```bash
npm install                 # JavaScript dependencies
npm run dev                 # http://localhost:3000
```

The dataset in `data/` is committed, so the app runs immediately — no scraping needed.

### The Python side

```bash
cd scraper
uv sync                     # creates scraper/.venv
uv run pytest               # 34 unit tests, no network
```

---

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm run build` | Production build (prerenders `/` and `/api/schedule`) |
| `npm run start` | Serve the production build |
| `npm run lint` | ESLint |
| `npm test` | Vitest — 43 unit/component tests |
| `npm run test:e2e` | Playwright — 7 end-to-end tests (builds and starts the app itself) |
| `npm run scraper:test` | pytest — 34 scraper tests |
| `npm run data:build` | Fetch the timetable and rewrite `data/` |
| `npm run data:verify` | Check the committed dataset's invariants |

Playwright needs its browser once:

```bash
npx playwright install chromium
```

---

## Regenerating the dataset

```bash
npm run data:build
```

This fetches every course row for the two sessions, parses them, merges the Metis space
database, and writes:

| File | Contents |
|---|---|
| `data/classes.json` | 21,408 class meetings |
| `data/rooms.json` | 65 UTM classrooms with occupancy |
| `data/meta.json` | Provenance: rows fetched vs. expected, snapshot week, source URLs |
| `data/utm_metis_data.json` | The input space database snapshot (committed) |

`npm run data:verify` re-checks the invariants, and `npm run data:verify -- --live`
re-fetches the catalogue and asserts the dataset still matches what the API publishes.

### Why the previous scraper lost 60% of the catalogue

`getPageableCourses` **ignores the `pageSize` you send** and always returns 20 rows per
page. The old client computed the page count from the page size it had *requested*
(`ceil(7383 / 50) = 148` pages) instead of from the rows it actually received
(`ceil(7383 / 20) = 370` pages). It wrote 2,960 of 7,383 rows and reported success.

The new client derives the page count from the rows returned, asserts
`fetched == total`, detects duplicate rows, and **fails loudly** rather than writing a
partial dataset. There is a regression test for exactly this.

---

## Data sources

| Source | Endpoint |
|---|---|
| Course catalogue | `POST https://api.easi.utoronto.ca/ttb/getPageableCourses` |
| Faculties | `GET https://api.easi.utoronto.ca/ttb/getMatchingDivisions` |
| Reference data | `GET https://api.easi.utoronto.ca/ttb/reference-data` |
| UTM classroom space | `https://metis.utm.utoronto.ca/` (snapshot committed in `data/`) |

Both public and non-commercial use of the timetable API are allowed by the University of
Toronto; please keep the request rate reasonable and attribute the source.

---

## Architecture

```
src/
  app/
    layout.tsx              # shell, Font Awesome, metadata
    page.tsx                # server component -> <ClassFinder />
    globals.css             # Tailwind v4 + the dark theme
    api/schedule/route.ts   # prerendered JSON endpoint
  components/
    ClassFinder.tsx         # client component: state, routing, list view
    WeeklySchedule.tsx      # the weekly grid
    lib/
      schedule.ts           # pure logic (unit tested)
      types.ts              # shared types
scraper/
  src/uoft_scraper/
    api.py                  # TTB client: pagination, retries, completeness checks
    parse.py                # raw rows -> class meetings
    metis.py                # space database -> rooms + occupancy
    build.py                # assembly + provenance
    cli.py                  # `build` and `verify` commands
  tests/                    # pytest suite + committed API fixtures
tests/
  unit/                     # Vitest: pure logic + component tests
  e2e/                      # Playwright
data/                       # generated dataset (committed)
scripts/legacy/             # the previous diagnostic scripts, kept for reference
reference/legacy/index.html # the original single-file UI this app was ported from
```

### Two decisions worth knowing about

**Term filtering uses the meeting's `sessionCode`,** not the course label. `20269` is
Fall, `20271` is Winter. The old code appended the session letter to the course code and
produced labels like `ISP100H5F`, which no student would ever search for. `course.code`
already contains the course *and* section (`ISP100H5`) and is used verbatim.

**Campus comes from `course.campus`,** not from the faculty list: `St. George`,
`Scarborough`, `University of Toronto at Mississauga`, `Sheridan College`,
`Centennial College`, `Off Campus`.

---

## Testing

```bash
npm run scraper:test   # 34 pytest tests - saved API fixtures, no network
npm test               # 43 Vitest tests  - pure logic + React components
npm run test:e2e       # 7 Playwright tests against the production build
```

The three layers cover different things:

- **pytest** protects the data contract: pagination completeness, the code/label rules,
  cancelled sections, the Metis weekday derivation and the missing 13:00 hour.
- **Vitest** protects the app's logic: time handling, term filtering, search, room
  availability states, and the React components (including "no invented room numbers").
- **Playwright** protects the shipped product: the campus tabs, course search, the weekly
  timetable, the classroom view, and the API payload.

Every test runs against committed fixtures. **CI never touches the UofT API.**

---

## CI

`.github/workflows/ci.yml` runs three jobs on every push and pull request:

1. `scraper` — `uv sync`, `pytest`, then `uoft-scraper verify` on the committed dataset.
2. `web` — `npm ci`, ESLint, Vitest, `next build`.
3. `e2e` — `npm ci`, install Chromium, `playwright test`.

---

## Known limitations

- **Room numbers are not available for any campus.** The timetable API does not publish
  them. Only UTM has classroom-level availability, because Metis covers only UTM.
- **Metis is a snapshot of one week** (the week of 2026-09-30). Occupancy is shown by
  weekday; the app always labels which week the data is from.
- **The 13:00 hour is not published by Metis** and is shown as unknown.
- The dataset is ~8.7 MB of JSON (~420 KB gzipped). It is fetched once and cached; split
  it per campus if you need a lighter first paint.
- Cancelled sections are excluded. Sections that change after the scrape are picked up on
  the next `npm run data:build`.

---

## Credits

Class schedules come from the University of Toronto's public timetable API; classroom
availability comes from UTM's Classroom Space Database.
