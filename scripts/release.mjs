#!/usr/bin/env node
// Release: bump every workspace package in lockstep, commit, tag, publish, push.
//
// Usage:
//   node scripts/release.mjs [version] [--dry-run] [--otp <code>] [--yes] [--no-push]
//   pnpm run release            # interactive: prompts for the version
//   pnpm run release 0.6.0      # version as argument
//   pnpm run release 0.6.0 --dry-run   # run checks + pack preview, mutate nothing
//
// Flags:
//   --dry-run     run the gate checks and a publish dry-run (shows each tarball's
//                 contents so a missing dist/ is caught) — no bump/commit/tag/publish.
//   --otp <code>  npm one-time password (2FA). If omitted and publishing, the script
//                 prompts for it just before publish (fresh, since it expires in ~30s).
//                 Press enter at the prompt to publish without an OTP.
//   --yes         skip the final "push now?" confirmation (push anyway).
//   --no-push     never push; print the manual push command instead.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { argv, exit, stdin, stdout } from "node:process";

const run = (cmd, args) => execFileSync(cmd, args, { stdio: "inherit", encoding: "utf8" });
const capture = (cmd, args) => execFileSync(cmd, args, { encoding: "utf8" }).trim();

// --- parse args ---------------------------------------------------------------
const raw = argv.slice(2);
const flags = { dryRun: false, yes: false, push: true, otp: undefined };
let version;
for (let i = 0; i < raw.length; i++) {
  const a = raw[i];
  if (a === "--dry-run") flags.dryRun = true;
  else if (a === "--yes" || a === "-y") flags.yes = true;
  else if (a === "--no-push") flags.push = false;
  else if (a === "--otp") flags.otp = raw[++i];
  else if (a.startsWith("--")) {
    console.error(`Unknown flag: ${a}`);
    exit(1);
  } else if (version === undefined) version = a;
  else {
    console.error(`Unexpected argument: ${a}`);
    exit(1);
  }
}

const current = JSON.parse(readFileSync("package.json", "utf8")).version;
const branch = capture("git", ["rev-parse", "--abbrev-ref", "HEAD"]);

// --- resolve version ----------------------------------------------------------
if (version === undefined) {
  const rl = createInterface({ input: stdin, output: stdout });
  version = (await rl.question(`New version (current ${current}): `)).trim();
  rl.close();
}
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error(`Invalid semver: "${version}"`);
  exit(1);
}
if (version === current && !flags.dryRun) {
  console.error(`Version is already ${current}.`);
  exit(1);
}

const tag = `v${version}`;

// --- gate: clean tree + checks ------------------------------------------------
// Dirty tree fails early so the release commit stays clean.
if (!flags.dryRun && capture("git", ["status", "--porcelain"]) !== "") {
  console.error("Working tree is not clean. Commit or stash first.");
  exit(1);
}

console.log("Running checks: lint, typecheck, test ...");
run("pnpm", ["run", "lint"]);
run("pnpm", ["run", "typecheck"]);
run("pnpm", ["test"]);
console.log("Checks passed.\n");

// --- dry run ------------------------------------------------------------------
if (flags.dryRun) {
  console.log(`[dry-run] would release ${version} (tag ${tag}) on branch ${branch}.`);
  console.log("[dry-run] publish preview (tarball contents per package):\n");
  run("pnpm", ["-r", "--include-workspace-root", "publish", "--no-git-checks", "--dry-run"]);
  console.log("\n[dry-run] no files changed, nothing published.");
  exit(0);
}

// --- bump + commit + tag ------------------------------------------------------
console.log(`Releasing ${version} (tag ${tag}) on branch ${branch}...`);
// Bump root + all workspace packages (plugins/*, packages/*) in lockstep.
run("pnpm", ["-r", "--include-workspace-root", "exec", "npm", "pkg", "set", `version=${version}`]);
run("git", ["commit", "-am", `chore: release ${version}`]);
// Annotated tag so `git push --follow-tags` and tooling see it as a real release.
run("git", ["tag", "-a", tag, "-m", `release ${version}`]);

// --- publish (with just-in-time OTP) -----------------------------------------
let otp = flags.otp;
if (otp === undefined) {
  const rl = createInterface({ input: stdin, output: stdout });
  otp = (await rl.question("npm OTP (2FA code, or enter to skip): ")).trim();
  rl.close();
}
// prepublishOnly runs typecheck + build before each package is published.
const publishArgs = ["-r", "--include-workspace-root", "publish", "--no-git-checks"];
if (otp) publishArgs.push("--otp", otp);
run("pnpm", publishArgs);
console.log(`\nReleased ${version}.`);

// --- push ---------------------------------------------------------------------
const pushCmd = ["push", "origin", branch, tag]; // branch + tag explicitly (lightweight or not)
if (!flags.push) {
  console.log(`Skipped push. Push later with: git ${pushCmd.join(" ")}`);
  exit(0);
}
let doPush = flags.yes;
if (!doPush) {
  const rl = createInterface({ input: stdin, output: stdout });
  const ans = (await rl.question(`Push ${branch} + tag ${tag} now? [y/N]: `)).trim().toLowerCase();
  rl.close();
  doPush = ans === "y" || ans === "yes";
}
if (doPush) {
  run("git", pushCmd);
  console.log("Pushed.");
} else {
  console.log(`Skipped. Push later with: git ${pushCmd.join(" ")}`);
}
