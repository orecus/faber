#!/usr/bin/env node

// Builds the faber-mcp sidecar binary and copies it to src-tauri/binaries/
// with the Tauri-expected target-triple suffix.
//
// Usage: node scripts/prepare-sidecar.mjs [--debug] [--target <triple>]
//
// Tauri's build script validates that externalBin paths exist at compile time,
// creating a bootstrap problem (can't build sidecar without the placeholder,
// can't have the real binary without building). This script solves it by
// creating a placeholder first, then building, then overwriting with the real binary.

import { execSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");
const tauriDir = join(rootDir, "src-tauri");
const binariesDir = join(tauriDir, "binaries");

const isDebug = process.argv.includes("--debug");
const profile = isDebug ? "debug" : "release";
const profileFlag = isDebug ? [] : ["--release"];

// Parse --target flag for cross-compilation (e.g. universal macOS builds)
function getExplicitTarget() {
  const idx = process.argv.indexOf("--target");
  if (idx !== -1 && process.argv[idx + 1]) {
    return process.argv[idx + 1];
  }
  return null;
}

// Detect the Rust target triple
function getTargetTriple() {
  const rustcOutput = execSync("rustc -vV", { encoding: "utf-8" });
  const match = rustcOutput.match(/^host:\s*(.+)$/m);
  if (!match) {
    throw new Error("Could not determine Rust target triple from `rustc -vV`");
  }
  return match[1].trim();
}

// Get the expected sidecar path for a given target
function sidecarPath(target) {
  const ext = target.includes("windows") ? ".exe" : "";
  return join(binariesDir, `faber-mcp-${target}${ext}`);
}

// Ensure a placeholder exists so Tauri's build script doesn't fail
function ensurePlaceholder(target) {
  mkdirSync(binariesDir, { recursive: true });
  const dest = sidecarPath(target);
  if (!existsSync(dest)) {
    console.log(`Creating placeholder at ${dest}`);
    writeFileSync(dest, "");
  }
}

// Build the sidecar, optionally cross-compiling for a specific target
function buildSidecar(target, explicitTarget) {
  const targetFlag = explicitTarget ? ["--target", target] : [];
  const args = ["cargo", "build", ...profileFlag, ...targetFlag, "--bin", "faber-mcp"];
  console.log(`> ${args.join(" ")}`);
  execSync(args.join(" "), {
    cwd: tauriDir,
    stdio: "inherit",
  });
}

// Copy built binary to binaries/ with target-triple suffix
function copySidecar(target, explicitTarget) {
  const ext = target.includes("windows") ? ".exe" : "";
  // When cross-compiling, cargo puts the output under target/<triple>/<profile>/
  const sourceDir = explicitTarget
    ? join(tauriDir, "target", target, profile)
    : join(tauriDir, "target", profile);
  const source = join(sourceDir, `faber-mcp${ext}`);
  const dest = sidecarPath(target);

  console.log(`Copying ${source} -> ${dest}`);
  copyFileSync(source, dest);
}

try {
  const explicitTarget = getExplicitTarget();
  const target = explicitTarget || getTargetTriple();
  console.log(`Target triple: ${target}${explicitTarget ? " (explicit)" : ""}`);
  console.log(`Profile: ${profile}`);

  // Create placeholder first to satisfy Tauri's build script
  ensurePlaceholder(target);

  buildSidecar(target, explicitTarget);
  copySidecar(target, explicitTarget);

  console.log("Sidecar prepared successfully.");
} catch (err) {
  console.error("Failed to prepare sidecar:", err.message);
  process.exit(1);
}
