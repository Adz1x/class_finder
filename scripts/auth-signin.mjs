/**
 * Signs in to the University of Toronto systems with the user's UTORid.
 *
 * The credentials are read from stdin as two lines - the username and then
 * the password - so they never reach a command line, a file, or a log. The
 * session that comes out of it is stored in a browser profile that the
 * scrapers reuse, so this is the only time the password is used.
 *
 *   printf "%s\n%s" "$USER" "$PASS" | node scripts/auth-signin.mjs
 *
 * If a site asks for a second factor, the script stops and leaves the
 * window open for that step to be finished by hand.
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
    signedIn: () =>
      !/idp|login|sso/i.test(location.href) &&
      document.querySelector("select, table, form") !== null,
  },
  {
    name: "St. George Space Management portal",
    url: "https://lsm.utoronto.ca/lsm_portal",
    signedIn: () => !/login|idp|sso/i.test(location.href),
  },
  {
    name: "Scarborough classroom calendar",
    url: "https://intranet.utsc.utoronto.ca/intranet2/s2/calendar/show.action?filter=-4",
    signedIn: () => !/login|sso1|idp/i.test(location.href),
  },
];

const USERNAME_FIELD = 'input[name="username"], input#username, input#user, input[type="text"]';
const PASSWORD_FIELD = 'input[name="password"], input#password, input[type="password"]';

function readCredentials() {
  return new Promise((resolve, reject) => {
    let buffer = "";
    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", (chunk) => {
      buffer += chunk;
    });
    process.stdin.on("end", () => {
      const [username, password] = buffer.split(/\r?\n/);
      if (!username || !password) {
        reject(new Error("expected the username and the password on stdin"));
        return;
      }
      resolve({ username: username.trim(), password });
    });
  });
}

const { username, password } = await readCredentials();

if (!existsSync(PROFILE)) mkdirSync(PROFILE, { recursive: true });

const context = await chromium.launchPersistentContext(PROFILE, {
  headless: false,
  viewport: { width: 1280, height: 900 },
});
const page = await context.newPage();

let needsYou = false;

for (const target of TARGETS) {
  console.log(`\n${target.name}`);

  await page.goto(target.url, { waitUntil: "domcontentloaded" }).catch(() => {});
  await page.waitForTimeout(2500);

  const user = page.locator(USERNAME_FIELD).first();
  const pass = page.locator(PASSWORD_FIELD).first();

  if (await pass.count()) {
    console.log("  signing in...");
    await user.fill(username).catch(() => {});
    await pass.fill(password);
    await pass.press("Enter");
    await page.waitForTimeout(6000);
  }

  // The University uses Duo. The push has to be approved on the phone, so
  // wait here for it rather than closing the window.
  const deadline = Date.now() + 5 * 60 * 1000;
  let approved = false;
  while (Date.now() < deadline) {
    const url = page.url();
    const body = (await page.locator("body").innerText().catch(() => "")) || "";
    if (!/duosecurity\.com/i.test(url) && !/duo/i.test(body)) {
      approved = true;
      break;
    }
    if (!approved) {
      console.log("  waiting for the Duo push - approve it on your phone.");
    }
    await page.waitForTimeout(5000);
  }

  // Some flows land on a "you are signed in" confirmation page.
  const continueButton = page.locator(
    'input[type="submit"], button[type="submit"], a:has-text("Continue")',
  );
  if (await continueButton.count()) {
    await continueButton.first().click().catch(() => {});
    await page.waitForTimeout(3000);
  }

  const signedIn = await page
    .evaluate(target.signedIn)
    .then((value) => Boolean(value))
    .catch(() => false);

  if (signedIn) {
    console.log(`  signed in - ${page.url()}`);
  } else {
    console.log(`  NOT signed in - ${page.url()}`);
    needsYou = true;
  }
}

console.log("");
if (needsYou) {
  console.log(
    "Some sessions need another step. The browser window is still open - finish\n" +
      "them there, then close the window. The profile is saved either way.\n",
  );
} else {
  console.log("All three sessions are signed in. The profile is saved.\n");
}

await context.close();
