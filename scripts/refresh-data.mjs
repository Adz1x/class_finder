#!/usr/bin/env node
/**
 * Refreshes every room-availability snapshot, then verifies the committed data.
 *
 *   npm run data:refresh               # refresh every campus that can run now
 *   npm run data:refresh -- --next-week  # refresh for next week
 *   node scripts/refresh-data.mjs --only utsc
 *   node scripts/refresh-data.mjs --only utsg --next-week
 *
 * Each campus is a step with its own source, output file and sign-on rule:
 *
 *   utsc  Scarborough Registrar schedule service. Public, no sign-on.
 *   utsg  St. George booking portal. Needs a saved UofT session.
 *   utm   Mississauga Metis space database. Needs a saved UofT session.
 *
 * Nothing is typed on your behalf and no password is read. If a campus needs
 * a session that is missing or stale, the step is skipped and the summary
 * prints the exact command to run. A failed step makes the whole run exit 1,
 * and the dataset is only verified when every step that ran succeeded, so a
 * half-refreshed dataset is never reported as current.
 */
import { spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const SESSIONS = join(homedir(), ".uoft-session");
const MAX_SESSION_AGE_HOURS = 12;

const STEPS = [
  {
    key: "utsc",
    label: "Scarborough (Registrar)",
    script: "scripts/fetch-utsc-availability.mjs",
    output: "data/rooms/UTSC.json",
    needsSession: false,
  },
  {
    key: "utsg",
    label: "St. George (booking portal)",
    script: "scripts/fetch-utsg-availability.mjs",
    output: "data/rooms/UTSG.json",
    needsSession: true,
    jar: join(SESSIONS, "lsm-cookies.txt"),
    signIn: "node scripts/auth-session.mjs",
  },
  {
    key: "utm",
    label: "Mississauga (Metis)",
    script: "scripts/fetch-utm-availability.mjs",
    output: "data/rooms/UTM.json",
    needsSession: true,
    jar: join(SESSIONS, "metis-cookies.txt"),
    signIn: "node scripts/auth-session.mjs",
  },
];

const only = process.argv.includes("--only")
  ? process.argv[process.argv.indexOf("--only") + 1]
  : null;

const nextWeek = process.argv.includes("--next-week");

/** Returns "ok", "missing" or "stale" for a saved UofT session jar. */
function sessionState(jar) {
  if (!existsSync(jar)) return "missing";
  const ageHours = (Date.now() - statSync(jar).mtimeMs) / 3_600_000;
  return ageHours > MAX_SESSION_AGE_HOURS ? "stale" : "ok";
}

function runNode(script, extraArgs = []) {
  const args = [join(ROOT, script), ...extraArgs];
  const result = spawnSync(process.execPath, args, {
    cwd: ROOT,
    stdio: "inherit",
  });
  return result.status === 0;
}

const results = [];

for (const step of STEPS) {
  if (only && step.key !== only) continue;

  const session = step.needsSession ? sessionState(step.jar) : "ok";
  if (session !== "ok") {
    results.push({
      step,
      status: "skipped",
      reason:
        session === "missing"
          ? `no saved UofT session. Run: ${step.signIn}`
          : `saved UofT session is older than ${MAX_SESSION_AGE_HOURS} hours. Run: ${step.signIn}`,
    });
    continue;
  }

  console.log(`\n== ${step.label} ==`);
  const extraArgs = nextWeek ? ["--next-week"] : [];
  const ok = runNode(step.script, extraArgs);
  results.push({
    step,
    status: ok ? "ok" : "failed",
    reason: ok ? "" : `${step.script} exited with an error`,
  });
}

// Verify only when nothing that ran has failed. A dataset with a failed
// refresh in it must not be reported as current.
const anyFailed = results.some((r) => r.status === "failed");
let verified = null;
if (!anyFailed) {
  console.log("\n== Verify ==");
  // Keep the scraper's environment outside the repo. scraper/.venv can end up
  // locked by another process (a broken lib64 link on this machine), and uv
  // then fails to sync it. A separate environment avoids that entirely.
  const verify = spawnSync(
    "uv",
    ["run", "--project", "scraper", "uoft-scraper", "verify", "--data", "data"],
    {
      cwd: ROOT,
      stdio: "inherit",
      shell: process.platform === "win32",
      env: {
        ...process.env,
        UV_PROJECT_ENVIRONMENT: join(homedir(), ".uoft-scraper-venv"),
      },
    },
  );
  verified = verify.status === 0;
}

console.log("\n== Summary ==");
for (const { step, status, reason } of results) {
  const line = `${status.padEnd(8)} ${step.label}`;
  console.log(reason ? `${line}\n         ${reason}` : line);
}
if (verified === null) {
  console.log("verify   not run (a campus step failed)");
} else {
  console.log(`verify   ${verified ? "ok" : "FAILED"}`);
}

const skipped = results.filter((r) => r.status === "skipped");
if (skipped.length) {
  console.log(
    `\n${skipped.length} campus(es) not refreshed. The dataset still holds their previous snapshot.`,
  );
}

process.exit(anyFailed || verified === false ? 1 : 0);
