/**
 * Opens the University of Toronto systems that need a UTORid login, so the
 * session can be captured once and reused by the scrapers.
 *
 * The systems:
 *
 *   1. `metis.utm.utoronto.ca/space/`      - the Classroom Space Database.
 *                                             This is the only open source of
 *                                             per-hour classroom occupancy.
 *                                             Its page redirects to the
 *                                             University single sign-on, and
 *                                             the snapshot in `data/` has no
 *                                             row for 13:00 - the reason has
 *                                             never been established.
 *   2. `lsm.utoronto.ca/lsm_portal`        - St. George Space Management.
 *                                             The classroom specification is
 *                                             public; the booking system
 *                                             behind this portal is not.
 *   3. `intranet.utsc.utoronto.ca/...`     - the Scarborough classroom
 *                                             calendar, behind a UTORid.
 *
 * The script does not ask for a password. It opens a real browser window,
 * you sign in there, and the session is saved in a browser profile that the
 * scrapers reuse.
 *
 *   node scripts/auth-login.mjs
 *
 * The window closes on its own once all three sessions are signed in, or
 * after 20 minutes. The profile is kept at `~/.uoft-session`.
 */
import { chromium } from "@playwright/test";
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const PROFILE = join(homedir(), ".uoft-session");

const TARGETS = [
  {
    name: "Mississauga Classroom Space Database",
    url: "https://metis.utm.utoronto.ca/space/",
    // Signed in when the app itself is on screen, not the SSO page.
    signedIn: () =>
      !/idp|login|sso/i.test(location.href) &&
      /Log Out|Space Database/i.test(document.body.innerText),
    expect: "the space database",
  },
  {
    name: "St. George Space Management portal",
    url: "https://lsm.utoronto.ca/lsm_portal",
    signedIn: () =>
      !/login|idp|sso/i.test(location.href) &&
      !/Log in to your account/i.test(document.body.innerText),
    expect: "the LSM portal",
  },
  {
    name: "Scarborough classroom calendar",
    url: "https://intranet.utsc.utoronto.ca/intranet2/s2/calendar/show.action?filter=-4",
    signedIn: () =>
      !/login|sso1|idp/i.test(location.href) &&
      !/Sign in to your account/i.test(document.body.innerText),
    expect: "the classroom calendar",
  },
];

if (!existsSync(PROFILE)) mkdirSync(PROFILE, { recursive: true });

const context = await chromium.launchPersistentContext(PROFILE, {
  headless: false,
  viewport: { width: 1280, height: 900 },
  args: ["--start-maximized"],
});

const done = new Set();
const deadline = Date.now() + 20 * 60 * 1000;

console.log(
  `\nA browser window is open with three University of Toronto tabs.\n` +
    `Sign in to each one with your UTORid. The window closes when all three\n` +
    `are signed in, or after 20 minutes.\n` +
    `Profile: ${PROFILE}\n`,
);

const pages = [];
for (const target of TARGETS) {
  const page = await context.newPage();
  await page.goto(target.url, { waitUntil: "domcontentloaded" }).catch(() => {});
  pages.push(page);
}

while (Date.now() < deadline && done.size < TARGETS.length) {
  for (const [index, target] of TARGETS.entries()) {
    if (done.has(target.name)) continue;
    const page = pages[index];
    if (page.isClosed()) continue;
    const ok = await page
      .evaluate(target.signedIn)
      .then((value) => Boolean(value))
      .catch(() => false);
    if (ok) {
      done.add(target.name);
      console.log(`  signed in: ${target.name}`);
    }
  }
  if (done.size < TARGETS.length) {
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
}

if (done.size < TARGETS.length) {
  console.log(
    `\nNot every session was signed in. Signed in: ${[...done].join(", ") || "none"}.\n` +
      `The profile is saved anyway - re-run this script to finish.\n`,
  );
} else {
  console.log(`\nAll three sessions are signed in. The profile is saved.\n`);
}

await context.close();
