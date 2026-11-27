#!/usr/bin/env node
/**
 * The one weekly command: sign in once, refresh all three campuses for next week,
 * commit if data changed, and optionally push.
 *
 *   node scripts/weekly-refresh.mjs        # sign in, refresh next week, commit locally
 *   node scripts/weekly-refresh.mjs --push # same, then push to origin
 *
 * The script:
 * 1. Opens a browser for UTORid + Duo sign-in (waits up to 15 minutes)
 * 2. Runs refresh-data.mjs with --next-week
 * 3. If verify passed and data changed, commits with a descriptive message
 * 4. Pushes only when --push flag is given
 * 5. Writes a short log to ~/uoft-classfinder-weekly.log and prints a summary
 */
import { spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const LOG_FILE = join(homedir(), "uoft-classfinder-weekly.log");

const PUSH = process.argv.includes("--push");

function log(message) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${message}`;
  console.log(line);
  try {
    appendFileSync(LOG_FILE, line + "\n", "utf-8");
  } catch {
    // Ignore log file errors
  }
}

function runCommand(command, args, options = {}) {
  log(`Running: ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, {
    cwd: ROOT,
    stdio: "inherit",
    shell: process.platform === "win32",
    ...options,
  });
  return result;
}

async function main() {
  log("=== Weekly refresh started ===");

  // 1. Sign in to UofT systems (waits up to 15 minutes)
  log("Opening browser for UTORid + Duo sign-in...");
  log("Please sign in to each tab and approve Duo pushes. The window will close automatically when done.");

  const signInResult = runCommand("node", ["scripts/auth-login.mjs"], {
    timeout: 15 * 60 * 1000, // 15 minutes
  });

  if (signInResult.status !== 0) {
    log("Sign-in failed or timed out after 15 minutes");
    log("=== Weekly refresh FAILED ===");
    process.exit(1);
  }

  log("Sign-in complete. Session saved.");

  // 2. Run refresh-data with --next-week
  log("Refreshing room availability for next week...");
  const refreshResult = runCommand("node", ["scripts/refresh-data.mjs", "--next-week"]);

  if (refreshResult.status !== 0) {
    log("Refresh failed");
    log("=== Weekly refresh FAILED ===");
    process.exit(1);
  }

  log("Refresh completed successfully");

  // 3. Check if data changed and commit if so
  // Check git status for data/ changes
  const gitStatus = spawnSync("git", ["status", "--porcelain", "data/"], {
    cwd: ROOT,
    encoding: "utf-8",
  });

  const changedFiles = gitStatus.stdout.trim().split("\n").filter(Boolean);
  const hasDataChanges = changedFiles.length > 0;

  if (hasDataChanges) {
    // Determine the Monday date for the commit message
    const now = new Date();
    const day = now.getDay(); // 0 = Sunday
    // On Saturday (6) or Sunday (0), "next week" is the Monday right after today
    let nextMonday;
    if (day === 0 || day === 6) {
      nextMonday = new Date(now);
      nextMonday.setDate(now.getDate() + (day === 0 ? 1 : 2));
    } else {
      nextMonday = new Date(now);
      nextMonday.setDate(now.getDate() - ((day + 6) % 7) + 7);
    }
    const mondayStr = nextMonday.toISOString().slice(0, 10);

    const commitMsg = `data: weekly refresh for week of ${mondayStr}`;

    log(`Data changed, committing: ${commitMsg}`);
    const commitResult = spawnSync("git", ["add", "data/"], { cwd: ROOT });
    if (commitResult.status !== 0) {
      log("Git add failed");
      process.exit(1);
    }

    const commitResult2 = spawnSync("git", ["commit", "-m", commitMsg], {
      cwd: ROOT,
      encoding: "utf-8",
    });
    if (commitResult2.status !== 0) {
      log("Git commit failed");
      process.exit(1);
    }
    log("Committed successfully");

    // 4. Push if requested
    if (PUSH) {
      log("Pushing to origin...");
      const pushResult = spawnSync("git", ["push"], {
        cwd: ROOT,
        stdio: "inherit",
      });
      if (pushResult.status !== 0) {
        log("Push failed");
        process.exit(1);
      }
      log("Pushed successfully");
    } else {
      log("Skipping push (use --push to push)");
    }
  } else {
    log("No data changes detected, skipping commit");
  }

  log("=== Weekly refresh COMPLETED ===");

  // Print summary
  console.log("\n=== Summary ===");
  console.log("Sign-in: OK");
  console.log("Refresh: OK");
  console.log(`Data changed: ${hasDataChanges ? "YES" : "NO"}`);
  if (hasDataChanges) {
    console.log("Commit: YES");
    console.log(`Push: ${PUSH ? "YES" : "NO (run with --push to push)"}`);
  } else {
    console.log("Commit: NO (no changes)");
  }
  console.log(`Log: ${LOG_FILE}`);
}

main().catch((error) => {
  log(`ERROR: ${error.message}`);
  log("=== Weekly refresh FAILED ===");
  process.exit(1);
});