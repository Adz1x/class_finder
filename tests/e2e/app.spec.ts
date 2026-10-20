import { expect, test } from "@playwright/test";

/**
 * End-to-end tests against the real dataset in `data/`.
 *
 * They run against the production build, so they also prove the prerendered
 * `/api/schedule` route works.
 */

test.describe("class & room finder", () => {
  test("loads the UTM campus with its buildings and classrooms", async ({ page }) => {
    await page.goto("/");

    await expect(
      page.getByRole("heading", { name: /UofT Class & Room Finder/i }),
    ).toBeVisible();

    // The UTM campus has six buildings in the timetable.
    for (const code of ["MN", "IB", "DH", "CC", "DV", "KN"]) {
      await expect(page.getByRole("button", { name: code, exact: true })).toBeVisible();
    }

    // Real rooms from the UTM space database, not invented ones.
    await expect(page.getByText("MN 2100")).toBeVisible();
  });

  test("finds a course by the code a student types", async ({ page }) => {
    await page.goto("/");

    await page.getByPlaceholder(/Search building/i).fill("isp100h5");

    await expect(page.getByText("Matching courses")).toBeVisible();
    await expect(page.getByText("ISP100H5").first()).toBeVisible();
  });

  test("shows the weekly timetable of a course", async ({ page }) => {
    await page.goto("/#/course/UTM/ISP100H5");

    await expect(page.getByRole("heading", { name: "ISP100H5" })).toBeVisible();
    await expect(page.getByText(/Course Timetable across UTM/i)).toBeVisible();

    // The user's own class: Monday 12:00-15:00 in MN.
    const monday = page.locator("div").filter({ hasText: /^ISP100H5/ });
    await expect(monday.first()).toBeVisible();
  });

  test("opens a classroom and its weekly occupancy", async ({ page }) => {
    await page.goto("/#/room/UTM/MN%202100");

    await expect(page.getByRole("heading", { name: "MN 2100" })).toBeVisible();
    await expect(page.getByText(/does not publish which course/i)).toBeVisible();
  });

  test("never invents a room number for a class", async ({ page }) => {
    await page.goto("/#/course/UTM/ISP100H5");

    // The UofT API lists no room number for these sections, so none is
    // shown - and the course view says so once, instead of on every block.
    await expect(
      page.getByText(/No room number is listed for these sections/i),
    ).toBeVisible();
    await expect(page.getByText(/Room: MN \d/)).toHaveCount(0);
  });

  test("finds another section of a course that fits the window", async ({
    page,
  }) => {
    await page.clock.setFixedTime(new Date("2026-10-19T10:00:00"));
    await page.goto("/");
    await page.getByPlaceholder(/Search building/i).fill("ISP100H5");
    await page.getByRole("button", { name: /ISP100H5/ }).first().click();

    // The finder, not the course timetable.
    await expect(
      page.getByRole("heading", { name: /Find another section/i }),
    ).toBeVisible();
    await expect(page.getByText(/Writing for University and Beyond/i).first()).toBeVisible();

    // Every section of the course, with the day and time it meets.
    await expect(page.getByText("LEC0101").first()).toBeVisible();
    await expect(page.getByText(/9:00 AM – 12:00 PM/).first()).toBeVisible();
    await expect(page.getByText(/43 sections/).first()).toBeVisible();

    // Pick Wednesday and the sections that meet on it are the ones that fit.
    await page
      .getByRole("group", { name: "Days you need" })
      .getByRole("button", { name: "Wed" })
      .click();
    await expect(page.getByText("Fits your window").first()).toBeVisible();
    await expect(page.getByText("Doesn't fit").first()).toBeVisible();
  });

  test("the timetable lines up with its own hour labels", async ({ page }) => {
    // 4:54 PM on the Monday the snapshot covers.
    await page.clock.setFixedTime(new Date("2026-10-19T16:54:00"));
    await page.goto("/#/room/UTM/IB%20335");
    await page.waitForSelector(".hour-row");

    const grid = await page.evaluate(() => {
      const labels = [...document.querySelectorAll<HTMLElement>(".hour-row")]
        .filter((el) => el.textContent?.trim())
        .map((el) => ({
          hour: el.textContent!.trim(),
          top: el.getBoundingClientRect().top,
        }));
      const red = document.querySelector<HTMLElement>(".bg-rose-500.rounded-full");
      const blocks = [
        ...document.querySelectorAll<HTMLElement>(
          ".relative.border-l > .absolute.rounded-lg",
        ),
      ].map((el) => el.getBoundingClientRect().top);
      return { labels, redTop: red?.getBoundingClientRect().top ?? null, blocks };
    });

    const at = (hour: string) => grid.labels.find((l) => l.hour === hour)!.top;

    // The now-line at 4:54 PM belongs between the 4 PM and 5 PM labels.
    expect(grid.redTop).toBeGreaterThan(at("4 PM"));
    expect(grid.redTop).toBeLessThan(at("5 PM"));

    // Every block inside the grid starts on one of the hour lines.
    const hourLines = grid.labels.map((label) => label.top);
    const strays = grid.blocks.filter(
      (top) => top >= 0 && !hourLines.some((line) => Math.abs(line - top) < 1.5),
    );
    expect(strays).toEqual([]);
  });

  test("the rooms that free soonest come first, and say when they free", async ({
    page,
  }) => {
    await page.clock.setFixedTime(new Date("2026-10-19T10:00:00"));
    await page.goto("/");

    // The two Instructional Centre rooms that are free at 10:00 come
    // before the ones that are booked.
    const rooms = page.locator("button").filter({ hasText: /^IB \d+/ });
    await expect(rooms.first()).toContainText(/IB 340|IB 395/);

    // A booked room says when it is free again, not merely when the hour
    // ends: IB 335 is booked from 10:00 and free from 16:00.
    await expect(page.getByText("Free next at 4:00 PM").first()).toBeVisible();
    await expect(page.getByText(/Booked until/i)).toHaveCount(0);
  });

  test("St. George lists the classrooms the University publishes", async ({
    page,
  }) => {
    // A fixed afternoon, so the order of the buildings is the same every run.
    await page.clock.setFixedTime(new Date("2026-10-19T14:00:00"));
    await page.goto("/");
    await page.getByRole("button", { name: "UTSG" }).click();

    // 334 classrooms in 40 buildings, from UofT Space Management. The
    // buildings that have published occupancy show their rooms with it; the
    // rest show the inventory.
    await expect(page.getByText(/Classrooms in MY/i)).toBeVisible();
    await expect(page.getByText("150 · 468")).toBeVisible();
  });

  test("Scarborough lists the classrooms the University publishes", async ({
    page,
  }) => {
    await page.clock.setFixedTime(new Date("2026-10-19T14:00:00"));
    await page.goto("/");
    await page.getByRole("button", { name: "UTSC" }).click();

    // 71 classrooms in 10 buildings, from the Registrar's room information
    // page and the IITS classroom specifications.
    await expect(
      page.getByText(/71 classrooms are listed for Scarborough/i),
    ).toBeVisible();

    // A real classroom of a real building, with the capacity it seats.
    await expect(page.getByText(/Classrooms in IA/i)).toBeVisible();
    await expect(page.getByText("IA-B1010 · 36")).toBeVisible();
  });

  test("St. George has classroom availability of its own", async ({ page }) => {
    await page.clock.setFixedTime(new Date("2026-10-19T14:00:00"));
    await page.goto("/");
    await page.getByRole("button", { name: "UTSG" }).click();

    // The St. George rooms come from the Space Management booking portal,
    // so the band and the source are its own.
    await expect(
      page.getByText(/Classroom availability, 7:00 AM – 9:00 PM/i),
    ).toBeVisible();
    await expect(
      page.getByText(/Space Management campus booking portal/i).first(),
    ).toBeVisible();

    // A real classroom with its occupancy for the hour.
    await expect(page.getByText("BA 2179").first()).toBeVisible();
  });

  test("every building says how many classes are running in it", async ({
    page,
  }) => {    await page.clock.setFixedTime(new Date("2026-10-19T14:00:00"));
    await page.goto("/");

    // The closest published thing to availability on a campus without it.
    await expect(page.getByText(/running now/).first()).toBeVisible();
  });

  test("switches between campuses", async ({ page }) => {
    await page.goto("/");

    await page.getByRole("button", { name: "UTSG" }).click();
    await expect(page.getByRole("button", { name: "BA", exact: true })).toBeVisible();

    await page.getByRole("button", { name: "UTSC" }).click();
    await expect(page.getByRole("button", { name: "IA", exact: true })).toBeVisible();
    await expect(page.getByText(/class meetings scheduled on UTSC/i)).toBeVisible();
  });

  test("keeps 68 St. George buildings behind one dropdown", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "UTSG" }).click();

    // Only the busiest buildings get a chip; the rest are in the dropdown.
    const dropdown = page.getByRole("combobox", { name: "More buildings" });
    await expect(dropdown).toBeVisible();
    await expect(dropdown).toContainText("More buildings (");
    await expect(dropdown).toContainText("AH");
  });

  test("a classroom can be opened with the keyboard", async ({ page }) => {
    await page.goto("/");

    // The room cards are buttons, so they are reachable and operable
    // without a mouse.
    const room = page.getByRole("button", { name: /MN 2100/ });
    await room.focus();
    await expect(room).toBeFocused();
    await page.keyboard.press("Enter");

    await expect(page.getByRole("heading", { name: "MN 2100" })).toBeVisible();
  });

  test("serves one campus per request, compressed", async ({ request }) => {
    const response = await request.get("/api/schedule/UTM");
    expect(response.ok()).toBe(true);

    const data = await response.json();
    expect(data.campus).toBe("UTM");
    expect(data.classes.length).toBeGreaterThan(5_000);
    expect(data.rooms.length).toBe(65);
    expect(data.meta.courseRowsFetched).toBe(data.meta.courseRowsExpected);
    expect(data.meta.meetingsWithPublishedRoom).toBe(0);
    expect(
      data.classes.some((c: { courseCode: string }) => c.courseCode === "ISP100H5"),
    ).toBe(true);
    // Every meeting in the payload belongs to the campus that was asked for.
    expect(data.classes.every((c: { campusKey: string }) => c.campusKey === "UTM")).toBe(true);
  });

  test("each campus publishes the availability it has, and says where it came from", async ({
    request,
  }) => {
    const utm = await (await request.get("/api/schedule/UTM")).json();
    const utsg = await (await request.get("/api/schedule/UTSG")).json();
    const utsc = await (await request.get("/api/schedule/UTSC")).json();

    // Two campuses publish occupancy, from two different sources.
    expect(utm.availability.source).toMatch(/Classroom Space Database/);
    expect(utsg.availability.source).toMatch(/booking portal/);
    expect(utm.rooms.length).toBeGreaterThan(0);
    expect(utsg.rooms.length).toBeGreaterThan(0);

    // Scarborough publishes rooms, but no occupancy for them.
    expect(utsc.availability).toBeNull();
    expect(utsc.rooms).toHaveLength(0);
    expect(utsc.classrooms.length).toBeGreaterThan(0);
  });

  test("the campus payloads add up to the whole catalogue", async ({ request }) => {
    let total = 0;
    for (const campus of ["UTM", "UTSG", "UTSC", "SHERIDAN"]) {
      const response = await request.get(`/api/schedule/${campus}`);
      expect(response.ok()).toBe(true);
      const data = await response.json();
      total += data.classes.length;
    }
    expect(total).toBe(21_408);
  });

  test("refuses a campus that does not exist", async ({ request }) => {
    const response = await request.get("/api/schedule/UVIC");
    expect(response.status()).toBe(404);
  });
});
