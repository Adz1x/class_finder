# UofT Class & Room Finder — Project Report

**Version 0.3.0 · October 2026**

---

## 1. Summary

A student at the University of Toronto wants to answer two questions:

1. *Which classroom is free right now, and how big is it?*
2. *Where and when is my class, and who teaches it?*

Both questions have public answers. The University publishes a timetable
API and, for the Mississauga campus, a classroom space database. But the two
halves do not fit together, and the most useful half — the room — is the one
the University does not publish.

This project builds an application that answers both questions from the
published data, and that is explicit about the limits of that data. The
central design rule is:

> **A value is either published by the source or it is absent. Nothing is
> inferred, guessed or back-filled.**

That rule turned out to be the most important thing in the project. The
first version of the application invented room numbers — plausible-looking
strings like `MN 3220` — because the timetable API returned an empty room
field and the interface looked broken without one. Every one of those rooms
was wrong. The rewrite deleted the guessing and replaced it with an
interface that says what is true, once, instead of apologising on every row.

The result is an application that is smaller, faster, and more useful than
the one it replaced, and that makes a claim a reviewer can check.

| | |
|---|---|
| Class meetings | 21,408 across 7,383 course rows, 8 faculties, 3 campuses |
| Classrooms | 65 UTM classrooms with published per-hour occupancy, 334 St. George classrooms with their capacities |
| Invented values | **0** |
| First load | **83 KB** (was 8.3 MB) |
| Tests | 111 across three layers, plus 4 automated accessibility checks |

---

## 2. The problem

### 2.1 What a student is actually trying to do

The University of Toronto runs on three physical campuses and a shared
academic calendar. A student juggling a 10:00 lecture, a 13:00 tutorial and
a study session needs to know, for a specific building and a specific hour,
whether there is a room free and whether it fits them.

Two different systems hold that information:

| Source | What it publishes | Coverage |
|---|---|---|
| **Timetable Builder API** (`api.easi.utoronto.ca/ttb`) | Course code, title, section, instructor, day, start and end time, building code | All campuses, both terms of 2026-27 |
| **Classroom Space Database** (Metis, `metis.utm.utoronto.ca`) | Every classroom, its capacity, and whether it is booked in each hour of a snapshot week | UTM only |

Neither one alone answers the student's question. The timetable says a class
meets in `MN`. The space database says which rooms in `MN` are free. Joining
them requires knowing the room, and **the timetable API does not publish
it.**

### 2.2 The finding

Across all **22,659** meeting times in the 2026-27 Fall and Winter sessions,
the field `building.buildingRoomNumber` is an **empty string**. Not sparse,
not partially populated — empty, every time.

This is the fact the project is built around, and it was established by
reverse-engineering the timetable's own front end rather than by assuming
it. The site `ttb.utoronto.ca` loads a JavaScript bundle that calls the API
directly; reading it shows the full set of nine endpoints the application
uses. There is:

- no endpoint that filters by building,
- no endpoint that lists rooms,
- no room endpoint at all,
- and `findById` returns 404 for course identifiers, so a course cannot be
  fetched with its rooms either.

The room number is not hiding behind a parameter. It is not published.

### 2.3 The previous version of this project

The first implementation of this application **guessed**. It contained a
hard-coded table mapping building codes to plausible room numbers, and it
displayed a room for every class. Those rooms were invented: no class was
ever scheduled in `MN 3220`, because the timetable does not say so.

The same codebase had a second, quieter failure. Its pagination was
computed from the page size the client *requested*:

```
ceil(7383 / 50) = 148 pages
```

The API ignores the requested page size and returns 20 rows per page, and
there are 370 pages. The scraper therefore fetched 148 of them and wrote
**2,960 of 7,383** course rows — 40% of the catalogue — while reporting
success. A student's own class, `ISP100H5`, was in the missing 60%.

Both failures shared a shape: **a number that looked right and was not.**
The rewrite was designed around making such numbers impossible to state
without checking them.

### 2.4 The availability investigation

The missing room number is the first half of the problem. Classroom
*occupancy* is the second half: even with a room, a student needs to know
whether it is free. The timetable publishes no room, so the occupancy has to
come from somewhere else. It does for Mississauga. Whether it does anywhere
else was searched for rather than assumed, and the search is worth recording
because the answer is a fact about the University:

| Source checked | What it would give | Result |
|---|---|---|
| **Classroom Space Database** (Metis), `metis.utm.utoronto.ca/space/` | UTM classrooms, capacity, per-hour availability | **Found and used.** The page now redirects to the University single sign-on and the endpoint behind the committed snapshot could not be re-identified, so it cannot be refreshed automatically. |
| **St. George classroom specification**, `lsm.utoronto.ca/webapp/f?p=210` | Every St. George classroom, its name and its capacity | **Found and used.** 40 buildings, 334 classrooms. |
| **"Calendar of Availability"**, `lsm.utoronto.ca/webapp/f?p=200` | The St. George availability calendar, linked from the classroom app | **Withdrawn.** "Could not determine workspace for application (200)". The button that pointed at it is commented out in the page source. |
| **Privacy-Synchronous Space Finder**, `lsm.utoronto.ca/syncstudy.html` | The St. George empty-classroom finder | The data exists and the app uses it, but it ships as an iOS/Android application with no public feed. |
| **Scarborough classroom schedule**, `intranet.utsc.utoronto.ca` | The Scarborough classroom calendar, linked from the Registrar's room information page | **Behind a UTORid login.** |
| **Scarborough classroom details**, `utsc.utoronto.ca/iits/classroom-support` | A Scarborough classroom inventory | Public, but a list of rooms, not a schedule. |
| **Concept3D campus map**, `map.utoronto.ca` | The map the timetable links each building to | Wayfinding only. Its API is `api.concept3d.com` and its bundle contains no schedule, occupancy or booking endpoint. |
| **Room reservation**, `lsm.utoronto.ca/webapp/f?p=220` | The room booking system | A request form, not a calendar. |
| `classrooms.utoronto.ca`, `bookings.utoronto.ca`, `rooms.utoronto.ca`, `space.utoronto.ca`, `facilities.utoronto.ca`, `metis.utsg.utoronto.ca`, `metis.utsc.utoronto.ca` | A per-campus room system | **Do not resolve.** Each was checked against hosts that do respond, so the failure is the name, not the method. |
| `getPageableCourses` with `availableSpace: true` | A timetable-side availability flag | The flag exists in the request payload and changes nothing: the response is identical, with the same empty room fields. |

The conclusion is therefore a fact about the University rather than about
this project:

> The University publishes room-level classroom availability for
> Mississauga, and a classroom *inventory* for St. George. It publishes no
> room-level availability for St. George or Scarborough through any open
> channel.

So for those campuses the application publishes the two things that *are*
open: the complete class timetable, and — from Space Management — the real
classrooms of every St. George building with their capacities. What the
application adds is the join a student would otherwise have to make by hand:
how many classes are running in each building right now, and an ordering that
puts the quietest buildings first.

---

## 3. Method

### 3.1 The pipeline

```
   UofT Timetable Builder API        UofT Classroom Space      UofT Space
   getPageableCourses (370 pages)     Database (Metis)          Management
   getMatchingDivisions               UTM campus                St. George
   reference-data                          │                        │
          │                                │                        │
          ▼                                ▼                        ▼
   ┌──────────────────────┐     ┌──────────────────┐     ┌──────────────────┐
   │ parse.py             │     │ metis.py         │     │ classrooms       │
   │ verbatim codes,      │     │ 65 rooms,        │     │ 334 classrooms,  │
   │ real filters, no     │     │ per-hour         │     │ 40 buildings,    │
   │ room invention       │     │ occupancy,       │     │ room + capacity  │
   │                     │     │ missing hours    │     │                  │
   └──────────┬───────────┘     └────────┬─────────┘     └────────┬─────────┘
              │                          │                        │
              └──────────────┬───────────┴────────────────────────┘
                             ▼
                  ┌────────────────────┐
                  │ build.py           │  21,408 meetings
                  │ split per campus   │  4 campus files
                  │ provenance in meta │  + rooms + meta
                  └──────────┬─────────┘
                             ▼
                  ┌────────────────────┐
                  │ data/campus/*.json │  committed to the repo
                  │ data/classrooms/*  │
                  └────────────────────┘
```

The scraper runs by hand, not on a schedule, at a polite pace. The result is
committed to the repository as a dated snapshot, so the application works
offline, in CI, and for anyone who clones it — and so the University is not
hit on every page view.

### 3.2 The filter funnel

Every number in this report is reproducible. The funnel is measured, not
remembered: `uoft-scraper funnel` re-fetches the catalogue and accounts for
every meeting time the API published.

| Stage | Count | |
|---|---:|---|
| Course rows fetched | 7,383 | matches the API's own total |
| Meeting times published | 22,659 | every `meetingTimes` entry in the response |
| − cancelled sections | 12 | `cancelInd == "Y"` |
| − no physical building | 1,007 | empty building code, or `ZZ` / `ON` / `OFF` / `TBA` / … |
| − invalid time range | 0 | |
| − repeated by the API | 232 | the same meeting returned more than once |
| **Class meetings kept** | **21,408** | |

The counter and the parser are separate pieces of code, so a test asserts
that the funnel keeps exactly as many meetings as the parser does. If they
ever drift, the build fails rather than the report quietly becoming false.

The funnel is stored in `data/meta.json`, and `uoft-scraper verify` checks
that it adds up.

### 3.3 Rules the parser obeys

- **Course codes are verbatim.** `course.code` already contains the course
  *and* the section (`ISP100H5`, `CSC108H1`). The previous version appended
  the session letter and produced labels like `ISP100H5F`. `course.sectionCode`
  is the *session* (`F` / `S` / `Y`), not a section number, and is kept as
  its own field.
- **Campus comes from `course.campus`.** Not from the faculty list, and not
  from the building code — a St. George course can meet in a UTM building.
- **A room is either published or absent.** `buildingRoomNumber` is kept
  when the API gives one and is `null` when it gives an empty string. It is
  never reconstructed.
- **The Metis weekday is derived from the ISO date**, not from the order the
  hours happen to appear in.
- **An hour the source omits is unknown, not free.** The snapshot publishes
  07:00–12:00 and 14:00–20:00; it omits 13:00 entirely. A room at 13:00 is
  reported as *unknown*, never as *free*, because "the database does not
  say" and "nobody is in it" are different facts.

### 3.4 Building names

68 building codes appear in the timetable. A code is not a name, and showing
`MN` alone tells a student nothing.

Names come from **Cobalt**, the University of Toronto's own open-data
project (`cobalt-uoft/datasets`, MIT licence). But Cobalt and the timetable
share a code space with different meanings, so a blind import would have
labelled the Mississauga building `MN` as a St. George building.

Every imported name was therefore accepted only when the campus Cobalt
records for that building **matches the campus of the timetable classes
that actually meet there**. Two candidates were rejected on that test
(`MN` → "Maritain House", `IA` → "Spadina Avenue-703"). Each name in
`data/building_names.json` carries its own source, so the table can be
audited.

Result: **21,238 of 21,408** meetings carry a real building name.

### 3.5 The honesty rules in the interface

| Situation | What the interface does |
|---|---|
| The API lists no room | Shows the building, and says so once in the course view |
| The space database omits an hour (13:00) | Shows **unknown**, never "free" |
| The current hour is outside the published band | One banner says so, once, instead of 65 cards reading "unknown" |
| A building has no published name | Shows the code, not a guess |
| The campus has no occupancy data | Lists the classrooms that are published, and how busy each building is |
| Availability is a dated snapshot | Dated once, in the footer |

Two of these were real defects, not stylistic preferences.

The header called the data **"Live Classroom Availability"** when it is a
snapshot of one week. The word is gone from the header, the page metadata and
the package description.

The second was repetition. Every class row ended with **"Room not published"**
and every classroom card ended with **"Not published"** — the same sentence
65 times on one screen, which reads as an error rather than as a fact about
the source. The application now says it once, in the banner, and shows the
room only when the source has one. The published band is described as it
actually is — *"7:00 AM – 12:00 PM and 2:00 PM – 8:00 PM"* — because a
single range from 7 AM to 9 PM would claim the 13:00 hour the database
omits.

---

## 4. Evaluation

### 4.1 Testing

The test suite is a pyramid, and every layer exists to protect something
specific.

| Layer | Tests | Protects | Network |
|---|---:|---|---|
| **pytest** | 44 | The data contract: pagination completeness, the code and session rules, cancelled sections, the Metis weekday, the missing hour, the per-campus split, the filter funnel | none — fixtures are committed |
| **Vitest** | 50 | The application: time handling, term filtering, search, room states, the timetable layout, and the components — including "no invented room numbers" | none |
| **Playwright** | 17 | The shipped product: campus tabs, search, the weekly timetable, the classroom view, the St. George classroom inventory, the API payload, keyboard operation | none — a production build, served locally |
| **axe-core** | 4 views | WCAG 2.1 AA violations in the classroom list, a course timetable, a classroom timetable and St. George | none |

**111 tests, none of which touches the University of Toronto's servers.** CI
runs them in four jobs; the data-verification and payload-budget jobs need
no network either.

Two of the tests exist because of bugs that shipped in the previous
version, and would not have existed otherwise:

- `test_deep_pages_are_covered` — rows beyond the old 148-page cutoff.
- `test_the_funnel_accounts_for_every_meeting_time` — the counter and the
  parser must agree.

### 4.2 The payload problem

The first version of the rebuilt application downloaded the entire
catalogue — **8.3 MB** — before rendering anything, because the dataset was
one JSON file and the app needed every campus at once. It only ever shows
one campus at a time.

The dataset is now stored one file per campus key and the route serves
exactly the campus on screen, gzipped:

| Campus | Meetings | On disk | Over the wire | Before |
|---|---:|---:|---:|---:|
| UTM | 5,178 | 2.1 MB | **83 KB** | 8.3 MB |
| UTSG | 12,175 | 4.8 MB | 224 KB | |
| UTSC | 3,961 | 1.5 MB | 68 KB | |
| SHERIDAN | 94 | 36 KB | 2 KB | |
| **Total** | **21,408** | **8.4 MB** | **377 KB** | 8.3 MB |

A hundredfold reduction for the first screen, and a quarter of a megabyte
for the whole catalogue. `npm run data:size` measures the gzipped size of
each payload and fails the build if the default campus crosses 150 KB, so
the win cannot be given back by accident. It runs in CI as its own job.

### 4.3 Accessibility

The target is **WCAG 2.1 AA**, and it is checked rather than claimed.
`@axe-core/playwright` runs against four views and the build fails on any
violation. That surfaced three real problems:

- The room cards, the timetable blocks and the logo were `<div onClick>`:
  clickable, but invisible to the keyboard and to a screen reader. They are
  buttons now, with an accessible name.
- The muted grey used for secondary text was **3.8:1** against the panel
  background, under the 4.5:1 that AA requires for small text. It is
  **7.1:1** now, and looks the same.
- The weekly grid scrolls sideways on a narrow screen, so it is focusable
  and labelled rather than a trap for keyboard users.

Every interactive element also draws a visible focus ring — the dark palette
swallowed the browser's default outline.

This is automated coverage, not an external audit. A machine cannot judge
whether the wording makes sense.

### 4.4 Reproducibility

Every figure in this report can be checked:

```bash
npm run data:verify     # the dataset's invariants
npm run data:size       # the payload budget
npm run scraper:test    # 44 tests, offline
npm test                # 50 tests, offline
npm run test:e2e        # 17 tests, against a local production build
```

`data:verify` re-reads the per-campus files, unions them, and checks that
they add up to the totals in `meta.json` exactly, that no meeting carries a
room the source did not publish, that there are no duplicates, and that the
filter funnel adds up.

**The dataset is byte-for-byte reproducible.** Re-running the scraper
against the live API produces files whose SHA-256 digests match the
committed ones exactly:

```
UTM        80330865dc8e6ccd  ==  80330865dc8e6ccd
UTSG       e336af8e3665b9f3  ==  e336af8e3665b9f3
UTSC       539265e2d86ab360  ==  539265e2d86ab360
SHERIDAN   499cc324c6a31d3b  ==  499cc324c6a31d3b
rooms      IDENTICAL
```

That needed one change: the API returns rows in a different order on every
run, and the scraper fetches pages in parallel, so the same catalogue
produced a different file every time. The meetings are now sorted by a
total order before they are written, which turns "did the data change?"
into a question `git diff` can answer.

---

## 5. Limitations

These are limitations of the *data*, not bugs in the application. The
application's job is to make them visible rather than to hide them.

1. **No room numbers.** The timetable API publishes none for the 2026-27
   sessions. No feature can tell a student the room their class is in. Any
   tool that claims to is guessing.

2. **Room-level availability is UTM-only, and that is the University's
   doing.** Section 2.4 records every source that was checked. The
   University publishes occupancy for Mississauga and a classroom inventory
   for St. George; its St. George availability calendar was withdrawn, its
   Scarborough calendar needs a UTORid, and the rest of the room data for
   St. George lives in a mobile application. The application therefore
   publishes, for St. George and Scarborough, the class timetable, the real
   classrooms of each St. George building with their capacities, and how
   many classes are running in each building right now. That last number is
   the closest published thing to "is there space here" on those campuses,
   and it is a proxy, not occupancy.

3. **Availability is a snapshot, not live.** One week of the 2026 Fall
   term (30 September – 6 October 2026). It does not know about a room
   booked yesterday, and it will not know about changes until the dataset is
   regenerated.

4. **The published hours are a band.** 07:00–12:00 and 14:00–20:00, with
   13:00 omitted — the space database returns no 13:00 row for any of the
   five days in the snapshot. At any other hour the honest answer is
   "unknown".

5. **Six building codes have no published name**: `AM` (1 meeting), `RO` (6),
   `ZO` (11), `BY` (24), `UY` (27), `TL` (101). Together, 170 of 21,408
   meetings — 0.8% — show a code instead of a name.

6. **Sheridan College's 94 meetings have no tab.** The campus key is in the
   dataset and reconciled in the totals, exactly as before, but the
   interface has three tabs.

7. **The University publishes no terms of use, rate-limit statement or
   versioning policy** for the timetable API. The API is read by hand at a
   polite pace, and the result is committed as a dated snapshot so the
   application does not hit UofT's servers on every visit.

---

## 6. What I would do next

1. **Live availability.** A scheduled scraper would turn the snapshot into a
   feed. The blocker is sharper than it was: the Mississauga space database
   now sits behind the University single sign-on, and the endpoint behind
   the committed snapshot could not be re-identified, so the first job is
   finding a public read path again — or asking Space Management for one.
2. **`.ics` calendar export** for a course, so a timetable lands in the
   student's own calendar. It needs the University academic calendar for
   term start and end dates — `data/term_dates.json`, sourced, not guessed.
3. **"My schedule"** — pin a set of courses and get one merged weekly view
   with the clashes marked.
4. **Share links** for a course or a room, so a link carries its own
   preview card.
5. **The six unnamed buildings.** Worth chasing: each one is a code with a
   name somewhere, and the names are findable.
6. **Scarborough classrooms.** The Registrar publishes a Scarborough room
   information page and IITS publishes classroom details; neither is a
   schedule, but the same treatment as St. George would give that tab real
   rooms and capacities.

---

## 7. Attribution

Class schedules come from the University of Toronto's public Timetable
Builder API. Classroom availability comes from the UofT Classroom Space
Database. The St. George classroom inventory comes from UofT Space
Management's classroom specification. Building names come from
[Cobalt](https://github.com/cobalt-uoft/datasets), U of T's own open-data
project.

This project is **not affiliated with or endorsed by the University of
Toronto**. The code is MIT licensed; the data in `data/` is a redistributed
snapshot of public University information and is not covered by that
licence.
