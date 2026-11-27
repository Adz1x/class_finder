/**
 * Signs in to the two UofT systems the room refresh needs, in one window,
 * and saves each session as a cookie jar:
 *
 *   ~/.uoft-session/lsm-cookies.txt    St. George Space Management
 *                                      (scripts/fetch-utsg-availability.mjs)
 *   ~/.uoft-session/metis-cookies.txt  UTM Classroom Space Database
 *                                      (scripts/fetch-utm-availability.mjs)
 *
 *   node scripts/auth-session.mjs
 *
 * A browser window opens with both systems. Sign in with your UTORid and
 * approve the Duo push. Both sit behind the same University sign-on, so once
 * one tab is signed in the other is reloaded and usually signs itself in.
 * Each session is saved the moment it is signed in; the script exits when
 * both are, or after 20 minutes.
 *
 * Why jars: the sign-on cookie is a browser *session* cookie and dies with
 * the window, so the browser profile cannot keep it (see auth-lsm-cookies.mjs).
 * Nothing is typed by the script and no password is written down.
 *
 * Exit codes: 0 both saved, 3 only one saved, 1 neither.
 */
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { toJar } from "./lib/cookie-jar.mjs";

const PROFILE = join(homedir(), ".uoft-session");
const MINUTES = 20;

const SYSTEMS = [
  {
    name: "St. George Space Management",
    url: "https://lsm.utoronto.ca/ords/f?p=171:1:::::",
    cookieUrl: "https://lsm.utoronto.ca",
    jar: join(PROFILE, "lsm-cookies.txt"),
    // The sign-on redirects to the idpz; the application has an APEX instance.
    signedIn: async (page) =>
      page.url().includes("lsm.utoronto.ca") &&
      Boolean(
        await page
          .evaluate(() => document.querySelector("#pInstance")?.value ?? "")
          .catch(() => ""),
      ),
  },
  {
    name: "UTM Classroom Space Database (Metis)",
    url: "https://metis.utm.utoronto.ca/space/",
    cookieUrl: "https://metis.utm.utoronto.ca",
    jar: join(PROFILE, "metis-cookies.txt"),
    signedIn: async (page) => {
      const url = page.url();
      if (!url.includes("metis.utm.utoronto.ca") || /idp|login|sso/i.test(url)) return false;
      const text = await page.evaluate(() => document.body?.innerText ?? "").catch(() => "");
      return /Log ?Out|Space Database|Classroom/i.test(text);
    },
  },
];

mkdirSync(PROFILE, { recursive: true });
console.log("A browser window is open with St. George Space Management and Metis.");
console.log("Sign in with your UTORid and approve the Duo push.");
console.log(`Each session is saved to ${PROFILE} as soon as it is signed in.`);
console.log(`The script waits ${MINUTES} minutes.\n`);

const context = await chromium.launchPersistentContext(PROFILE, { headless: false });
const pages = [];
for (const [i, system] of SYSTEMS.entries()) {
  const page = i === 0 ? (context.pages()[0] ?? (await context.newPage())) : await context.newPage();
  await page.goto(system.url, { waitUntil: "domcontentloaded" }).catch(() => {});
  pages.push(page);
}

const saved = new Set();
const deadline = Date.now() + MINUTES * 60 * 1000;
while (Date.now() < deadline && saved.size < SYSTEMS.length) {
  for (const [i, system] of SYSTEMS.entries()) {
    if (saved.has(system.name) || pages[i].isClosed()) continue;
    if (!(await system.signedIn(pages[i]))) continue;
    const cookies = await context.cookies(system.cookieUrl);
    if (!cookies.length) continue;
    writeFileSync(system.jar, toJar(cookies, "scripts/auth-session.mjs"), "utf-8");
    saved.add(system.name);
    console.log(`  signed in: ${system.name}. Session saved to ${system.jar}`);
    // The sign-on session now exists in this window: give the other tab a
    // fresh request so it can pick it up without a second password.
    for (const [j, other] of SYSTEMS.entries()) {
      if (j !== i && !saved.has(other.name) && !pages[j].isClosed()) {
        await pages[j].goto(other.url, { waitUntil: "domcontentloaded" }).catch(() => {});
      }
    }
  }
  if (saved.size < SYSTEMS.length) await new Promise((r) => setTimeout(r, 2000));
}

await context.close();

const missing = SYSTEMS.filter((s) => !saved.has(s.name)).map((s) => s.name);
if (!saved.size) {
  console.error("\nnot signed in - no session was saved.");
  process.exit(1);
}
if (missing.length) {
  console.error(`\nnot signed in: ${missing.join(", ")}. The other session was saved.`);
  process.exit(3);
}
console.log("\nBoth sessions are saved.");
