#!/usr/bin/env node

// Bumps the version across all manifest files, commits, tags, and optionally
// pushes to trigger the GitHub Actions release workflow.
//
// Usage: node scripts/release.mjs <version> [--push] [--dry-run]
//
// Examples:
//   node scripts/release.mjs 0.9.0            # bump, commit, tag
//   node scripts/release.mjs 0.9.0 --push     # … and push to remote
//   node scripts/release.mjs 0.9.0 --dry-run  # preview without writing
//
// The version can optionally include a "v" prefix (v0.9.0 → 0.9.0).

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");
const tauriDir = join(rootDir, "src-tauri");

// ── Helpers ──────────────────────────────────────────────────────────────────

function run(cmd, opts = {}) {
  const result = execSync(cmd, { encoding: "utf-8", cwd: rootDir, ...opts });
  return result == null ? "" : result.trim();
}

function fatal(msg) {
  console.error(`\n❌ ${msg}`);
  process.exit(1);
}

function info(msg) {
  console.log(`  ${msg}`);
}

// ── Parse args ───────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const push = args.includes("--push");
const versionArg = args.find((a) => !a.startsWith("--"));

if (!versionArg) {
  console.log("Usage: node scripts/release.mjs <version> [--push] [--dry-run]");
  console.log("");
  console.log("  <version>   Semver version (e.g. 0.9.0 or v0.9.0)");
  console.log("  --push      Push commit and tag to remote after creating them");
  console.log("  --dry-run   Preview changes without writing anything");
  process.exit(1);
}

// Strip leading "v" if present
const newVersion = versionArg.replace(/^v/, "");

// ── Validate version ─────────────────────────────────────────────────────────

const semverRe = /^\d+\.\d+\.\d+(-[a-zA-Z0-9.]+)?$/;
if (!semverRe.test(newVersion)) {
  fatal(`Invalid semver version: "${newVersion}"`);
}

const tag = `v${newVersion}`;

// ── Preflight checks ─────────────────────────────────────────────────────────

console.log("\n🔍 Preflight checks\n");

// Check for clean working tree
const status = run("git status --porcelain");
if (status) {
  fatal(
    "Working tree is dirty. Commit or stash your changes first.\n\n" + status,
  );
}

// Check current branch
const branch = run("git rev-parse --abbrev-ref HEAD");
if (branch !== "main") {
  fatal(`Must be on "main" branch (currently on "${branch}").`);
}

// Check tag doesn't already exist
const existingTags = run("git tag -l").split("\n").filter(Boolean);
if (existingTags.includes(tag)) {
  fatal(`Tag "${tag}" already exists.`);
}

// Read current version
const pkg = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf-8"));
const currentVersion = pkg.version;

info(`Current version : ${currentVersion}`);
info(`New version     : ${newVersion}`);
info(`Tag             : ${tag}`);
info(`Branch          : ${branch}`);
info(`Dry run         : ${dryRun ? "yes" : "no"}`);
info(`Push            : ${push ? "yes" : "no"}`);

if (newVersion === currentVersion) {
  fatal(`New version is the same as current version (${currentVersion}).`);
}

// ── Version files ────────────────────────────────────────────────────────────

const versionFiles = [
  {
    path: join(rootDir, "package.json"),
    name: "package.json",
    update(content) {
      return content.replace(
        /"version":\s*"[^"]*"/,
        `"version": "${newVersion}"`,
      );
    },
  },
  {
    path: join(tauriDir, "tauri.conf.json"),
    name: "src-tauri/tauri.conf.json",
    update(content) {
      return content.replace(
        /"version":\s*"[^"]*"/,
        `"version": "${newVersion}"`,
      );
    },
  },
  {
    path: join(tauriDir, "Cargo.toml"),
    name: "src-tauri/Cargo.toml",
    update(content) {
      // Only replace the version in the [package] section (first occurrence)
      let replaced = false;
      return content.replace(/^version\s*=\s*"[^"]*"/m, (match) => {
        if (replaced) return match;
        replaced = true;
        return `version = "${newVersion}"`;
      });
    },
  },
];

// ── Update files ─────────────────────────────────────────────────────────────

console.log("\n📝 Updating version files\n");

for (const file of versionFiles) {
  const original = readFileSync(file.path, "utf-8");
  const updated = file.update(original);

  if (original === updated) {
    fatal(`No version string found to replace in ${file.name}`);
  }

  if (dryRun) {
    info(`[dry-run] Would update ${file.name}`);
  } else {
    writeFileSync(file.path, updated);
    info(`Updated ${file.name}`);
  }
}

// ── Update Cargo.lock ────────────────────────────────────────────────────────

console.log("\n📦 Updating Cargo.lock\n");

if (dryRun) {
  info("[dry-run] Would run `cargo check` to update Cargo.lock");
} else {
  info("Running cargo check to regenerate Cargo.lock...");
  try {
    run("cargo check", { cwd: tauriDir, stdio: "inherit" });
  } catch {
    fatal("cargo check failed — version may be partially updated.");
  }
}

// ── Git commit & tag ─────────────────────────────────────────────────────────

const commitMsg = `chore: bump version to ${tag}`;

console.log("\n🏷️  Creating commit and tag\n");

if (dryRun) {
  info(`[dry-run] Would commit: "${commitMsg}"`);
  info(`[dry-run] Would create tag: ${tag}`);
} else {
  run("git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml src-tauri/Cargo.lock");
  run(`git commit -m "${commitMsg}"`);
  info(`Committed: "${commitMsg}"`);

  run(`git tag -a ${tag} -m "${tag}"`);
  info(`Tagged: ${tag}`);
}

// ── Push ─────────────────────────────────────────────────────────────────────

if (push) {
  console.log("\n🚀 Pushing to remote\n");

  if (dryRun) {
    info("[dry-run] Would push commit and tag to origin");
  } else {
    run("git push origin main");
    info("Pushed commit to origin/main");

    run(`git push origin ${tag}`);
    info(`Pushed tag ${tag}`);

    console.log(
      `\n✅ Release ${tag} pushed! GitHub Actions will build the release.`,
    );
  }
} else {
  console.log(`\n✅ Version bumped to ${tag}. Run the following to trigger the release:\n`);
  console.log(`  git push origin main && git push origin ${tag}\n`);
}
