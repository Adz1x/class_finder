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

    await expect(page.getByText(/room not published/i).first()).toBeVisible();
    // The UofT API publishes no room numbers for these sessions.
    await expect(page.getByText(/Room: MN \d/)).toHaveCount(0);
  });

  test("switches between campuses", async ({ page }) => {
    await page.goto("/");

    await page.getByRole("button", { name: "UTSG" }).click();
    await expect(page.getByRole("button", { name: "BA", exact: true })).toBeVisible();

    await page.getByRole("button", { name: "UTSC" }).click();
    await expect(page.getByRole("button", { name: "AA", exact: true })).toBeVisible();
  });

  test("serves the full dataset from the API", async ({ request }) => {
    const response = await request.get("/api/schedule");
    expect(response.ok()).toBe(true);

    const data = await response.json();
    expect(data.classes.length).toBeGreaterThan(20_000);
    expect(data.meta.courseRowsFetched).toBe(data.meta.courseRowsExpected);
    expect(data.meta.meetingsWithPublishedRoom).toBe(0);
    expect(
      data.classes.some((c: { courseCode: string }) => c.courseCode === "ISP100H5"),
    ).toBe(true);
  });
});
