# Find a section, and a room for a time you need — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a student find an alternative section of a course that fits the times they can attend, and find the rooms of a building that are free across a time window they name.

**Architecture:** One new value, `TimeWindow`, and two pure modules that read it: `window.ts` (does a class or a room fall inside the window) and `sections.ts` (group a course's meetings into sections and score each against the window). The UI is two components — `WindowControl.tsx`, which owns the days and the hours, and `SectionFinder.tsx`, which lists a course's sections — plus two changes inside `ClassFinder.tsx`: the matching-course list now opens the finder, and the classroom list answers for the window when one is set.

**Tech Stack:** React 19, Next.js 16 (App Router), TypeScript, Tailwind, Vitest + Testing Library, Playwright. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-20-section-finder-design.md` — read it before starting; the plan argues from it.

## Global Constraints

- **No new dependencies.** React 19, Next 16, Tailwind, as installed.
- **No new scraping.** The campus payload already carries every section of every course; the finder adds **zero bytes** to the payload.
- **Never invent data.** The timetable API publishes no room number for any class meeting, so a section shows its **building** and never a room. A window hour the snapshot does not carry is **unknown**, never free.
- **No window means today's behaviour, unchanged.** Both surfaces keep their current copy and their current meaning when the window is empty.
- **The interface keeps its look** — the existing dark palette, card and badge patterns, and font sizes in `src/app/globals.css` and the existing components.
- **Python >=3.10, <3.14**; `uv` for the scraper; `npm` for the app.
- Every task ends with a commit. Branch: `main`. **Do not push to `origin`.**

## Review Focus

Each line is an input the spec implies that a task's own tests must pin down.

1. **A section that meets on two days with different times** (MAT223H1 LEC0301: Wed 09:00–11:00, Fri 10:00–11:00) — the verdict is per meeting, never per section. → Task 2.
2. **A class that hangs over the end of the window** (window 10:00–12:00, class 11:00–13:00) — containment, not overlap. → Task 1.
3. **A class on a day the window did not pick** — the day filter. → Task 1.
4. **A room whose occupancy the snapshot does not carry for part of the window** — unknown, never free. → Task 1.
5. **A course with one section and a course with 129** — the finder must not assume a tidy number, and must render both. → Task 4.

---

### Task 1: The window's pure logic

**Files:**
- Create: `src/components/lib/window.ts`
- Test: `tests/unit/window.test.ts`

**Interfaces:**
- Consumes: `ClassMeeting` and `Room` from `@/components/lib/types`; `RoomState` from the same file; `timeToMinutes` from `@/components/lib/schedule`; `DAY_NAMES` from the same file.
- Produces:
  ```ts
  export interface TimeWindow {
    /** Days the user needs: 1 = Monday .. 7 = Sunday. Empty means any day. */
    days: number[];
    /** Minutes since midnight. null means unbounded. */
    startMins: number | null;
    endMins: number | null;
  }
  export const EMPTY_WINDOW: TimeWindow;
  export function windowIsEmpty(window: TimeWindow): boolean;
  export function meetingFitsWindow(meeting: ClassMeeting, window: TimeWindow): boolean;
  export function classesInWindow(meetings: ClassMeeting[], window: TimeWindow): ClassMeeting[];
  export function roomStateForWindow(room: Room, window: TimeWindow): RoomState;
  ```

- [ ] **Step 1: Write the failing tests** in `tests/unit/window.test.ts`.

  Build meetings with a local helper `meeting(overrides)` (a `ClassMeeting` with `day: 2`, `start: "10:00"`, `end: "12:00"` as defaults) and rooms with a local helper `room(hours)` (a `Room` whose `occupancy` is `{ "2": { 10: false, 11: false } }` by default).

  The tests, with their exact assertions:
  - `windowIsEmpty` is true for `{ days: [], startMins: null, endMins: null }` and false when any part is set.
  - `meetingFitsWindow` with an empty window is true for any meeting.
  - A meeting at Tue 10:00–12:00 **fits** the window `{ days: [2], startMins: 600, endMins: 720 }`.
  - A meeting at Tue 09:00–11:00 **does not fit** that window — it starts before 10:00 (containment, not overlap).
  - A meeting at Tue 11:00–13:00 **does not fit** that window — it ends after 12:00.
  - A meeting at Wed 10:00–12:00 **does not fit** a window whose days are `[2]`.
  - A window with `startMins: 600, endMins: 480` (start after end) ignores the hours: the Tue 09:00–11:00 meeting **fits** it.
  - `classesInWindow` returns only the meetings that overlap the window; an empty window returns them all.
  - `roomStateForWindow` is `"free"` for a room that is free in every hour the window touches, `"busy"` when it is booked in one of them, and `"unknown"` when the snapshot does not carry one of those hours.
  - A room whose occupancy carries only hour 10, with a window of 10:00–12:00 (hours 10 and 11), is **unknown**, never free.

- [ ] **Step 2: Run the test to verify it fails**

  Run: `npx vitest run tests/unit/window.test.ts`
  Expected: FAIL — `Failed to resolve import "./lib/window"`.

- [ ] **Step 3: Implement `src/components/lib/window.ts`**

  The hour range a window touches: `startHour = Math.floor(startMins / 60)`, `endHour = Math.ceil(endMins / 60) - 1`, inclusive. A window with no hours bound touches every hour of the day. A window whose start is after its end has no hour bound and touches every hour.

  `meetingFitsWindow` is true when the day matches (empty `days` matches any day) **and** the meeting is contained in the hours (no hours bound matches any time): `startMins >= window.startMins` and `endMins <= window.endMins`, where a null bound matches anything.

  `classesInWindow` keeps a meeting when it **overlaps** the window: `meetingStart < windowEnd && meetingEnd > windowStart`. An empty window keeps everything.

  `roomStateForWindow` reads `room.occupancy[String(day)]` for every picked day and every hour the window touches: if any hour is missing from the occupancy, or the day is missing, the state is `"unknown"`; otherwise it is `"busy"` if any hour is booked and `"free"` if none is. An empty window asks about the whole published day.

- [ ] **Step 4: Run the test to verify it passes**

  Run: `npx vitest run tests/unit/window.test.ts`
  Expected: PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add src/components/lib/window.ts tests/unit/window.test.ts
  git commit -m "feat: the time window, and what falls inside it"
  ```

---

### Task 2: Sections, and whether they fit

**Files:**
- Create: `src/components/lib/sections.ts`
- Test: `tests/unit/sections.test.ts`

**Interfaces:**
- Consumes: `TimeWindow`, `EMPTY_WINDOW`, `meetingFitsWindow` from `@/components/lib/window`; `ClassMeeting`, `Term` from `@/components/lib/types`; `SESSION_TERMS` from `@/components/lib/schedule`.
- Produces:
  ```ts
  export type SectionFit = "fits" | "partial" | "none";
  export interface CourseSection {
    courseCode: string;
    courseTitle: string;
    sectionName: string;
    sectionType: string;
    sectionNumber: string;
    sessionCode: string;
    term: Term;
    meetings: ClassMeeting[];
    days: number[];
    buildings: string[];
    instructor: string | null;
  }
  export interface MeetingFit {
    meeting: ClassMeeting;
    fits: boolean;
    /** Why it does not fit, when it does not. Empty when it fits. */
    reason: string;
  }
  export function groupCourseSections(meetings: ClassMeeting[]): CourseSection[];
  export function sectionFit(section: CourseSection, window: TimeWindow): {
    fit: SectionFit;
    meetings: MeetingFit[];
  };
  export function sortSectionsByFit(sections: CourseSection[], window: TimeWindow): CourseSection[];
  ```

- [ ] **Step 1: Write the failing tests** in `tests/unit/sections.test.ts`.

  - `groupCourseSections` groups by `(sectionName, sessionCode)`: two meetings of `LEC0101` in session `20269` make one section with two meetings; the same `LEC0101` in session `20271` makes a **second** section.
  - A section's `days` are sorted and unique; its `buildings` are sorted and unique; its `instructor` is the first instructor of its meetings, or `null` when it has none.
  - A section that meets on two days with **different times** (Wed 09:00–11:00, Fri 10:00–11:00) keeps **both** meetings, and `sectionFit` reports them separately: the Wednesday one fits a Wednesday-10:00–12:00 window, the Friday one does not, so the section is `"partial"`.
  - A section whose every meeting fits is `"fits"`; a section with no fitting meeting is `"none"`.
  - `sectionFit` with an empty window reports `"fits"` for every section.
  - The `reason` for a meeting that is not picked mentions the day it is on; the reason for one that starts too early names the start time.
  - `sortSectionsByFit` puts the fitting sections first, then the partial ones, then the rest; within a group, by the earliest meeting (day, then start time), then by section name.

- [ ] **Step 2: Run the test to verify it fails**

  Run: `npx vitest run tests/unit/sections.test.ts`
  Expected: FAIL — `Failed to resolve import "./lib/sections"`.

- [ ] **Step 3: Implement `src/components/lib/sections.ts`**

  `groupCourseSections` walks the meetings once, keyed by `` `${meeting.sessionCode}:${meeting.sectionName}` ``, and builds each section from its first meeting plus the collected days, buildings and instructors.

  `sectionFit` calls `meetingFitsWindow` per meeting and builds a `MeetingFit` for each. The reason is built from the same rules: the day it falls on (`DAY_NAMES[day - 1]`) when the window picked days and this is not one of them; the start time (`format12Hour`) when it starts before the window; the end time when it ends after the window. Join the applicable parts with " and ".

  `sortSectionsByFit` sorts by fit rank (`fits` 0, `partial` 1, `none` 2), then by the earliest meeting's day, then its start time, then the section name.

- [ ] **Step 4: Run the test to verify it passes**

  Run: `npx vitest run tests/unit/sections.test.ts`
  Expected: PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add src/components/lib/sections.ts tests/unit/sections.test.ts
  git commit -m "feat: group a course into sections, and score them against a window"
  ```

---

### Task 3: The window control

**Files:**
- Create: `src/components/WindowControl.tsx`
- Test: `tests/unit/WindowControl.test.tsx`

**Interfaces:**
- Consumes: `TimeWindow` from `@/components/lib/window`.
- Produces:
  ```ts
  export interface WindowControlProps {
    window: TimeWindow;
    onChange: (window: TimeWindow) => void;
    /** What the window is for, in the user's words. */
    label?: string;
  }
  export default function WindowControl(props: WindowControlProps): JSX.Element;
  ```

- [ ] **Step 1: Write the failing tests** in `tests/unit/WindowControl.test.tsx`.

  - It renders a button for each day, Monday to Sunday, named `Mon` … `Sun`.
  - Clicking `Tue` calls `onChange` with `{ ...window, days: [2] }`.
  - Clicking `Tue` again, when it is the only picked day, calls `onChange` with `days: []`.
  - The time inputs are named "From" and "To"; typing `10:00` into "From" calls `onChange` with `startMins: 600`.
  - Typing `08:00` into "To" calls `onChange` with `endMins: 480`.
  - A "Clear" button calls `onChange` with `EMPTY_WINDOW`.

- [ ] **Step 2: Run the test to verify it fails**

  Run: `npx vitest run tests/unit/WindowControl.test.tsx`
  Expected: FAIL — the module does not exist.

- [ ] **Step 3: Implement `src/components/WindowControl.tsx`**

  Seven day buttons, two `<input type="time">` fields, and a Clear button. The day buttons carry `aria-pressed` and the same button styles the campus tabs use (`bg-blue-600 text-white` when on, `bg-slate-800 text-slate-300` when off). The time inputs carry the same classes the search input uses. The "To" input's `min` is the "From" input's value, so the browser refuses an end before the start.

- [ ] **Step 4: Run the test to verify it passes**

  Run: `npx vitest run tests/unit/WindowControl.test.tsx`
  Expected: PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add src/components/WindowControl.tsx tests/unit/WindowControl.test.tsx
  git commit -m "feat: the control that says when you need it"
  ```

---

### Task 4: The section finder

**Files:**
- Create: `src/components/SectionFinder.tsx`
- Modify: `src/components/ClassFinder.tsx` — the route type, `parseHash`, the matching-course list, and the render switch.
- Test: `tests/e2e/app.spec.ts`; `tests/unit/ClassFinder.test.tsx` for the routing.

**Interfaces:**
- Consumes: `groupCourseSections`, `sectionFit`, `sortSectionsByFit` from `@/components/lib/sections`; `TimeWindow`, `EMPTY_WINDOW` from `@/components/lib/window`; `WindowControl` from `@/components/WindowControl`; `ClassMeeting`, `Term` from `@/components/lib/types`; `format12Hour`, `DAY_NAMES` from `@/components/lib/schedule`.
- Produces:
  ```ts
  export interface SectionFinderProps {
    campus: string;
    courseCode: string;
    classes: ClassMeeting[];
    window: TimeWindow;
    onWindowChange: (window: TimeWindow) => void;
    onOpenSection: (courseCode: string, sectionName: string) => void;
    onOpenCourse: (courseCode: string) => void;
  }
  export default function SectionFinder(props: SectionFinderProps): JSX.Element;
  ```

  Two new routes, added to the `Route` union in `ClassFinder.tsx`:
  ```ts
  | { mode: "sections"; campus: string; id: string }   // the finder, id = course code
  | { mode: "section"; campus: string; id: string; section: string }
  ```
  `parseHash` reads `#/sections/<campus>/<code>` and `#/section/<campus>/<code>/<sectionName>`.

- [ ] **Step 1: Write the failing E2E test** in `tests/e2e/app.spec.ts`.

  ```ts
  test("finds another section of a course that fits the window", async ({ page }) => {
    await page.clock.setFixedTime(new Date("2026-10-19T10:00:00"));
    await page.goto("/");
    await page.getByPlaceholder(/Search building/i).fill("ISP100H5");
    await page.getByText("ISP100H5").first().click();

    // The finder, not the course timetable.
    await expect(page.getByRole("heading", /Find another section/i)).toBeVisible();
    // Every section of the course, with its day and time.
    await expect(page.getByText("LEC0101").first()).toBeVisible();
    await expect(page.getByText(/9:00 AM – 12:00 PM/).first()).toBeVisible();

    // Pick Wednesday 09:00–12:00 and the section that meets then is marked.
    await page.getByRole("button", { name: "Wed" }).click();
    await expect(page.getByText(/Fits your window/i).first()).toBeVisible();
  });
  ```

  The exact heading and the fit wording are fixed in Task 4's Step 3.

- [ ] **Step 2: Run the test to verify it fails**

  Run: `npx playwright test --grep "another section"`
  Expected: FAIL — the heading is not there.

- [ ] **Step 3: Implement `src/components/SectionFinder.tsx` and the routes**

  The view, in the order top to bottom:

  1. A heading `Find another section` and the course title and code.
  2. A line saying how many sections the course has: `90 sections in this term`.
  3. `WindowControl`, labelled **When do you need it?**
  4. The sections, each a row:
     - the section name and type on the left (`LEC0101`, `Lecture`),
     - the term badge (`Fall 2026` / `Winter 2027`),
     - one line per meeting: `Tue 10:00 AM – 12:00 PM` and, when it does not
       fit, the reason after it: `Wed 09:00 AM – 11:00 AM · on a day you did
       not pick`,
     - the building(s) and the instructor,
     - a fit badge: **Fits your window** (emerald), **Partly fits** (amber),
       **Doesn't fit** (slate).
  5. When the course is not on this campus: a line saying so, in the same
     voice as the rest of the app: `No sections of ISP100H5 are listed on
     UTSG.`

  The section row is a button that calls `onOpenSection`. A link above the
  list, `the whole course's timetable →`, calls `onOpenCourse`.

  In `ClassFinder.tsx`: the matching-course list's items call
  `navigate(`#/sections/${campus}/${code}`)` instead of the course route,
  and the render switch gains a case for `mode === "sections"` and one for
  `mode === "section"` — the latter renders the existing `WeeklySchedule`
  with only that section's meetings.

- [ ] **Step 4: Run the test to verify it passes**

  Run: `npx playwright test --grep "another section"`
  Expected: PASS.

- [ ] **Step 5: Run the whole suite**

  Run: `npm run lint && npx vitest run && npx playwright test`
  Expected: all green.

- [ ] **Step 6: Commit**

  ```bash
  git add src/components/SectionFinder.tsx src/components/ClassFinder.tsx tests/e2e/app.spec.ts
  git commit -m "feat: find another section of a course that fits your week"
  ```

---

### Task 5: The building, for the window you need

**Files:**
- Modify: `src/components/ClassFinder.tsx` — the list view's room cards, the class list and the badges.
- Test: `tests/e2e/app.spec.ts`

**Interfaces:**
- Consumes: `TimeWindow`, `EMPTY_WINDOW`, `windowIsEmpty`, `classesInWindow`, `roomStateForWindow` from `@/components/lib/window`; `WindowControl` from `@/components/WindowControl`.
- Produces: no new exported names. `ClassFinder` gains the state `const [window, setWindow] = useState<TimeWindow>(EMPTY_WINDOW)` and passes it down.

- [ ] **Step 1: Write the failing E2E test** in `tests/e2e/app.spec.ts`.

  ```ts
  test("a building answers for the window you need", async ({ page }) => {
    await page.clock.setFixedTime(new Date("2026-10-19T10:00:00"));
    await page.goto("/");

    // The control is there, and the building still reads "today" until a
    // window is picked.
    await expect(page.getByText(/Today in IB/i)).toBeVisible();

    await page.getByRole("button", { name: "Tue" }).click();
    await page.getByLabel("From").fill("14:00");
    await page.getByLabel("To").fill("16:00");

    // The class list is now about the window, not about today.
    await expect(page.getByText(/In your window/i).first()).toBeVisible();
    // And the rooms answer for the whole window.
    await expect(page.getByText(/free for your window/i).first()).toBeVisible();
  });
  ```

- [ ] **Step 2: Run the test to verify it fails**

  Run: `npx playwright test --grep "window you need"`
  Expected: FAIL — the control and the window copy are not there.

- [ ] **Step 3: Implement the window in the list view**

  In `ClassFinder.tsx`:

  - Add `const [window, setWindow] = useState<TimeWindow>(EMPTY_WINDOW)`.
  - Render `WindowControl` above the building sections, labelled **When do
    you need a room?**, with `onChange={setWindow}`.
  - The building's class list: with an empty window it keeps reading
    *Today in IB* and shows today's classes; with a window it reads
    *In your window* and shows `classesInWindow(buildingClasses, window)`.
  - The room cards: with an empty window they keep the current card
    (`Free in this hour`, `Free next at 4:00 PM`); with a window they show
    the window's answer — `Free for your window`, `Busy 2:00 PM – 4:00 PM`,
    or `Not published for your window` for unknown.
  - The building's badge: with an empty window it keeps `2 of 27 free now`;
    with a window it reads `2 of 27 free for your window`.

- [ ] **Step 4: Run the test to verify it passes**

  Run: `npx playwright test --grep "window you need"`
  Expected: PASS.

- [ ] **Step 5: Run the whole suite**

  Run: `npm run lint && npx vitest run && npx playwright test`
  Expected: all green.

- [ ] **Step 6: Commit**

  ```bash
  git add src/components/ClassFinder.tsx tests/e2e/app.spec.ts
  git commit -m "feat: a building answers for the window you need"
  ```

---

### Task 6: The documentation and the screenshots

**Files:**
- Modify: `README.md`, `docs/REPORT.md`, `docs/ARCHITECTURE.md`, `CHANGELOG.md`
- Modify: `docs/images/*.png` (re-captured)

**Interfaces:**
- Consumes: nothing.
- Produces: nothing.

- [ ] **Step 1: Update the counts**

  The test counts in `README.md`, `docs/REPORT.md` and `docs/ARCHITECTURE.md`
  must match what the suite reports. Count them from the run, do not guess.

- [ ] **Step 2: Write the entries**

  `CHANGELOG.md` — an "Application" entry for the section finder and one for
  the building's window.

  `README.md` — the campus table gains a row about the finder; the "What it
  does" list gains the section finder.

  `docs/REPORT.md` — the honesty table gains a row: *a class that does not
  fit the window | says which meeting does not fit and why*.

  `docs/ARCHITECTURE.md` — the data layout table gains the two new modules.

- [ ] **Step 3: Re-capture the screenshots**

  Run: `npm run build && npx next start -p 3000` (in the background), then
  `npm run screenshots`.
  Expected: `captured classroom-list`, `captured course-timetable`,
  `captured classroom-timetable`, `captured st-george`.

- [ ] **Step 4: Verify and commit**

  Run: `npm run lint && npm run scraper:test && npx vitest run && npx playwright test && npm run data:verify && npm run data:size`
  Expected: all green, and the payload budget unchanged.

  ```bash
  git add README.md docs/ CHANGELOG.md
  git commit -m "docs: the section finder, and the window"
  ```
