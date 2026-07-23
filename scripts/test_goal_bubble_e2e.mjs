#!/usr/bin/env node
// Runtime e2e: feeds a synthetic `x.ai/session_notification`
// `goal_updated` envelope through the real AgentBackend.handleNotification
// and asserts the emitted snapshot carries the populated `goalState`.
//
// Compile-free by spawning a tiny tsx-less TS harness via the same
// `npx tsx` Node loader the repo already uses.
//
// Run: node scripts/test_goal_bubble_e2e.mjs

import { spawnSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DESKTOP = path.resolve(__dirname, "..");

const harness = path.join(__dirname, "goal_bubble_e2e_harness.ts");
if (!fs.existsSync(harness)) {
  console.error(`missing harness: ${harness}`);
  process.exit(2);
}

// Use tsx loader so we can import .ts directly.
const env = { ...process.env };
delete env.NODE_OPTIONS;
const out = spawnSync(
  process.execPath,
  [
    "--import",
    "tsx",
    harness,
  ],
  {
    cwd: DESKTOP,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 60_000,
  },
);

const stdout = (out.stdout || "") + "\n--- stderr ---\n" + (out.stderr || "");
console.log(stdout);
process.exit(out.status ?? 1);