#!/usr/bin/env node
// Interactive release: prompt for a version, bump every workspace package,
// commit, tag, then publish. Run via `pnpm run release`.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

const run = (cmd, args) =>
  execFileSync(cmd, args, { stdio: "inherit", encoding: "utf8" });
const capture = (cmd, args) =>
  execFileSync(cmd, args, { encoding: "utf8" }).trim();

const current = JSON.parse(readFileSync("package.json", "utf8")).version;

const rl = createInterface({ input: stdin, output: stdout });
const answer = (await rl.question(`New version (current ${current}): `)).trim();
rl.close();

if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(answer)) {
  console.error(`Invalid semver: "${answer}"`);
  process.exit(1);
}
if (answer === current) {
  console.error(`Version is already ${current}.`);
  process.exit(1);
}

// Fail early on a dirty tree so the release commit stays clean.
if (capture("git", ["status", "--porcelain"]) !== "") {
  console.error("Working tree is not clean. Commit or stash first.");
  process.exit(1);
}

const tag = `v${answer}`;
console.log(`Releasing ${answer} (tag ${tag})...`);

// Bump root + all workspace packages (plugins/*, packages/*).
run("pnpm", ["-r", "--include-workspace-root", "exec", "npm", "pkg", "set", `version=${answer}`]);

run("git", ["commit", "-am", `chore: release ${answer}`]);
run("git", ["tag", tag]);

// prepublishOnly runs typecheck + build before each package is published.
run("pnpm", ["-r", "--include-workspace-root", "publish", "--no-git-checks"]);

console.log(`\nReleased ${answer}.`);

const pushRl = createInterface({ input: stdin, output: stdout });
const push = (await pushRl.question(`Push commit and tag ${tag} now? [y/N]: `)).trim().toLowerCase();
pushRl.close();

if (push === "y" || push === "yes") {
  run("git", ["push", "--follow-tags"]);
  console.log("Pushed.");
} else {
  console.log(`Skipped. Push later with: git push --follow-tags`);
}
