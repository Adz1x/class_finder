/**
 * Signs in to UofT Space Management and saves the session as a cookie jar.
 *
 * The space management system sits behind the University's single sign-on,
 * and the sign-on's session cookie is a browser *session* cookie: it does
 * not survive the browser closing, so the profile cannot keep it for us.
 * The capture scripts therefore need the session as a cookie jar, which is
 * what this writes.
 *
 *   node scripts/auth-lsm-cookies.mjs
 *
 * A window opens. Sign in with your UTORid, approve the Duo push, and the
 * script writes `~/.uoft-session/lsm-cookies.txt` and exits. Nothing is
 * typed by the script and no password is ever written down.
 *
 * The jar is in your home directory, not in the repository.
 */
import { chromium } from "@playwright/test";
import { existsSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const PROFILE = join(homedir(), ".uoft-session");
const JAR = join(PROFILE, "lsm-cookies.txt");
const APP = "https://lsm.utoronto.ca/ords/f?p=171:1:::::";

/** How long to wait for the sign-in, in minutes. */
const MINUTES = 20;

console.log("A browser window is open with the UofT space management system.");
console.log("Sign in with your UTORid and approve the Duo push.");
console.log(`The script saves the session to ${JAR} and exits.`);
console.log(`It waits ${MINUTES} minutes.`);

const context = await chromium.launchPersistentContext(PROFILE, { headless: false });
const page = context.pages()[0] ?? (await context.newPage());

await page.goto(APP, { waitUntil: "domcontentloaded" }).catch(() => {});

/** The sign-on redirects to the idpz; the application does not. */
async function signedIn() {
  const url = page.url();
  if (!url.includes("lsm.utoronto.ca")) return false;
  const instance = await page
    .evaluate(() => document.querySelector("#pInstance")?.value ?? "")
    .catch(() => "");
  return Boolean(instance);
}

const deadline = Date.now() + MINUTES * 60 * 1000;
while (Date.now() < deadline) {
  if (await signedIn()) break;
  await page.waitForTimeout(2000);
}

if (!(await signedIn())) {
  console.error("not signed in - no session was saved.");
  await context.close();
  process.exit(1);
}

/** The Netscape cookie jar format, which curl and Playwright both read. */
function toJar(cookies) {
  const lines = [
    "# Netscape HTTP Cookie File",
    "# https://curl.se/docs/http-cookies.html",
    "# Written by scripts/auth-lsm-cookies.mjs. Edit at your own risk.",
  ];
  for (const cookie of cookies) {
    const secure = cookie.secure ? "TRUE" : "FALSE";
    const expires = cookie.expires && cookie.expires > 0 ? Math.floor(cookie.expires) : 0;
    const include = cookie.domain.startsWith(".") ? "TRUE" : "FALSE";
    lines.push(
      [
        cookie.domain,
        include,
        cookie.path || "/",
        secure,
        expires,
        cookie.name,
        cookie.value,
      ].join("\t"),
    );
  }
  return `${lines.join("\n")}\n`;
}

const cookies = await context.cookies("https://lsm.utoronto.ca");
if (!cookies.length) {
  console.error("no cookies were found for lsm.utoronto.ca - nothing saved.");
  await context.close();
  process.exit(1);
}

writeFileSync(JAR, toJar(cookies), "utf-8");
console.log(`signed in: Space Management. Session saved to ${JAR}`);
await context.close();
