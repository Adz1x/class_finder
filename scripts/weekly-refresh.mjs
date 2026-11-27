/**
 * The weekly room refresh: one sign-in, next week's rooms for every campus.
 *
 *   npm run data:weekly              # sign in, refresh next week, commit here
 *   npm run data:weekly -- --push    # ...and push (pushing main deploys the site)
 *
 * 1. Brings this checkout up to date (git pull --ff-only), so the commit lands
 *    on top of the daily CI refreshes instead of beside them.
 * 2. Opens the UofT sign-in (scripts/auth-session.mjs). Sign in and approve the
 *    Duo push; that is the only thing a person has to do.
 * 3. Runs scripts/refresh-data.mjs --next-week: Scarborough, St. George and
 *    Mississauga for next week, then the dataset checks. A campus whose session
 *    could not be saved is skipped and keeps its previous week.
 * 4. Commits data/ if something other than meta.json's timestamp changed.
 * 5. Pushes only with --push.
 *
 * Every run appends to ~/uoft-classfinder-weekly.log.
 */
import { spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { isoLocal, weekFromArgs } from "./lib/week.mjs";

const ROOT = resolve(import.meta.dirname, "..");
const LOG_FILE = join(homedir(), "uoft-classfinder-weekly.log");
const PUSH = process.argv.includes("--push");
const WEEK = isoLocal(weekFromArgs(["--next-week"]));

function log(message) {
  const line = `[${new Date().toISOString()}] ${message}`;
  console.log(line);
  try {
    appendFileSync(LOG_FILE, `${line}\n`, "utf-8");
  } catch {
    // The log is a convenience; a refresh never fails because of it.
  }
}

function fail(message) {
  log(message);
  log("=== weekly refresh FAILED ===");
  process.exit(1);
}

function git(...args) {
  const result = spawnSync("git", args, { cwd: ROOT, encoding: "utf-8" });
  return { ok: result.status === 0, out: `${result.stdout ?? ""}${result.stderr ?? ""}`.trim() };
}

function node(script, args = [], options = {}) {
  log(`running: node ${script} ${args.join(" ")}`.trim());
  return spawnSync(process.execPath, [join(ROOT, script), ...args], {
    cwd: ROOT,
    stdio: "inherit",
    ...options,
  }).status;
}

log(`=== weekly refresh for the week of ${WEEK} ===`);

// 1. Up to date with origin.
const pull = git("pull", "--ff-only");
if (!pull.ok) fail(`git pull --ff-only failed, so nothing was changed:\n${pull.out}`);

// 2. Sign in. 0: both sessions saved. 3: one saved, so its campus still runs.
const signIn = node("scripts/auth-session.mjs", [], { timeout: 25 * 60 * 1000 });
if (signIn !== 0 && signIn !== 3) fail("no UofT session was saved (sign-in not finished)");
if (signIn === 3) log("only one of the two sessions was saved; the other campus keeps its previous week");

// 3. Refresh next week and verify.
if (node("scripts/refresh-data.mjs", ["--next-week"]) !== 0) {
  git("restore", "--staged", "--", "data");
  git("restore", "--", "data");
  fail("the refresh or its checks failed; the data changes were discarded");
}

// 4. Commit real changes only. meta.json is stamped with the time on every
//    build, so a run where nothing else changed is not a change.
git("add", "-A", "--", "data");
const realChange = !git("diff", "--cached", "--quiet", "--", "data", ":(exclude)data/meta.json").ok;
if (!realChange) {
  git("restore", "--staged", "--", "data");
  git("restore", "--", "data");
  log("no room data changed; nothing to commit");
  log("=== weekly refresh done ===");
  process.exit(0);
}
const message = `data: weekly refresh for week of ${WEEK}`;
const commit = git("commit", "-m", message);
if (!commit.ok) fail(`git commit failed:\n${commit.out}`);
log(`committed: ${message}`);

// 5. Push only when asked. If CI pushed meanwhile, rebase once and retry.
if (PUSH) {
  let push = git("push");
  if (!push.ok) {
    const rebase = git("pull", "--rebase");
    if (!rebase.ok) fail(`push rejected and rebase failed; the commit is kept locally:\n${rebase.out}`);
    push = git("push");
  }
  if (!push.ok) fail(`git push failed; the commit is kept locally:\n${push.out}`);
  log("pushed");
} else {
  log("not pushed (run with --push to push)");
}
log("=== weekly refresh done ===");
