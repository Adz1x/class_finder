/**
 * Capture the README screenshots.
 *
 * The clock is pinned to a Monday at 10:00, which is inside the band of hours
 * the UofT space database publishes, so the classroom list shows real
 * availability rather than an hour the source does not cover. A screenshot
 * taken at 9pm would be honest but a poor illustration.
 *
 * Usage:
 *   npm run build && npx next start -p 3000
 *   npm run screenshots
 */
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const BASE = process.env.APP_URL ?? "http://127.0.0.1:3000";
const OUT = "docs/images";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1440, height: 940 },
  deviceScaleFactor: 2,
});

// Monday 19 October 2026, 10:00 - inside the published hours, on a weekday
// with classes running.
await page.clock.setFixedTime(new Date(2026, 9, 19, 10, 0, 0));

const shots = [
  { name: "classroom-list", url: "/", wait: 1600 },
  { name: "course-timetable", url: "/#/course/UTM/ISP100H5", wait: 1800 },
  { name: "classroom-timetable", url: "/#/room/UTM/MN%202100", wait: 1800 },
  {
    name: "section-finder",
    url: "/#/sections/UTM/ISP100H5",
    wait: 1600,
    after: async (p) => {
      await p
        .getByRole("group", { name: "Days you need" })
        .getByRole("button", { name: "Wed" })
        .click();
      await p.waitForTimeout(1000);
    },
  },
  {
    name: "scarborough",
    url: "/",
    wait: 1600,
    after: async (p) => {
      await p.getByRole("button", { name: "UTSC" }).click();
      await p.waitForTimeout(1800);
    },
  },
  {
    name: "st-george",
    url: "/",
    wait: 1600,
    after: async (p) => {
      await p.getByRole("button", { name: "UTSG" }).click();
      await p.waitForTimeout(1500);
    },
  },
];

for (const shot of shots) {
  await page.goto(`${BASE}${shot.url}`, { waitUntil: "networkidle" });
  if (shot.after) await shot.after(page);
  await page.waitForTimeout(shot.wait);
  await page.screenshot({ path: `${OUT}/${shot.name}.png` });
  console.log("captured", shot.name);
}

await browser.close();
