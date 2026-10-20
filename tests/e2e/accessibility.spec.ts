import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/**
 * Accessibility checks with axe-core.
 *
 * The target is WCAG 2.1 AA. This is automated coverage, not an audit: a
 * machine cannot judge whether the wording makes sense, only whether the
 * markup and the contrast hold up.
 */

const VIEWS = [
  { name: "the classroom list", url: "/" },
  { name: "a course timetable", url: "/#/course/UTM/ISP100H5" },
  { name: "a classroom timetable", url: "/#/room/UTM/MN%202100" },
  { name: "St. George", url: "/", after: "UTSG" },
];

for (const view of VIEWS) {
  test(`${view.name} has no automatically detectable violations`, async ({
    page,
  }) => {
    await page.goto(view.url, { waitUntil: "networkidle" });
    if (view.after) {
      await page.getByRole("button", { name: view.after }).click();
      await page.waitForTimeout(1500);
    }
    await page.waitForTimeout(1200);

    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();

    const summary = results.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      help: violation.help,
      nodes: violation.nodes.map((node) => node.target.join(" ")),
    }));

    expect(summary).toEqual([]);
  });
}
