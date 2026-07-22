#!/usr/bin/env node
/**
 * Structural contract: desktop slash catalog aligns with CLI ACP path.
 *
 * - available_commands_update applied even while replaying (no hard skip)
 * - applyAvailableCommands awaits disk merge before assign/emit
 * - refreshCommands unions with previous catalog (list cannot erase ACU)
 *
 * Run: node scripts/test_slash_catalog_acu.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DESKTOP = path.resolve(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(DESKTOP, rel), "utf8");

let pass = 0;
let fail = 0;
function check(name, ok, detail) {
  if (ok) {
    console.log(`  ✓ ${name}`);
    pass++;
  } else {
    console.error(`  ✗ ${name}  ${detail ?? ""}`);
    fail++;
  }
}

const backend = read("src/main/backend.ts");

// --- ACU handler ---
{
  const idx = backend.indexOf(
    'kind === "available_commands_update"',
  );
  // Include debug logging block; end before next sessionUpdate kind.
  const end = backend.indexOf("auto_compact_started", idx);
  const body =
    idx >= 0
      ? backend.slice(idx, end > idx ? end : idx + 2500)
      : "";
  check(
    "ACU handler found",
    idx >= 0,
    "available_commands_update branch missing",
  );
  check(
    "ACU does not hard-skip on replaying",
    !/if\s*\(\s*this\.replaying\s*\)\s*return\s*;/.test(body),
    "still has if (this.replaying) return in ACU block",
  );
  check(
    "ACU empty-list guard when catalog non-empty",
    /cmds\.length === 0 && this\.availableCommands\.length > 0/.test(body),
  );
  check(
    "ACU calls applyAvailableCommands",
    /applyAvailableCommands\(cmds\)/.test(body),
  );
  check(
    "ACU comment mentions CLI / replaying",
    /Align with CLI|CLI pager|replaying/.test(body),
  );
  check(
    "ACU has slash-catalog debug log",
    /logSlashCatalog\(/.test(body) && /ACU received/.test(body),
  );
}

// --- unionAvailableCommands ---
check(
  "unionAvailableCommands helper defined",
  /function unionAvailableCommands\(/.test(backend),
);
check(
  "union keeps extras not in primary",
  /if \(!existing\) \{\s*\n\s*byName\.set\(key, \{ \.\.\.c \}\)/.test(backend) ||
    /if \(!existing\) \{\s*byName\.set\(key, \{ \.\.\.c \}\)/.test(backend),
);

// --- applyAvailableCommands ---
{
  const idx = backend.indexOf("private async applyAvailableCommands");
  const alt = backend.indexOf("private applyAvailableCommands");
  const start = idx >= 0 ? idx : alt;
  const nextFn = backend.indexOf("\n  async newSession", start);
  const body =
    start >= 0
      ? backend.slice(start, nextFn > start ? nextFn : start + 900)
      : "";
  check(
    "applyAvailableCommands is async",
    /private async applyAvailableCommands\(/.test(backend),
  );
  check(
    "apply awaits mergeDiskSkillsIntoCommands before assign",
    /const merged = await mergeDiskSkillsIntoCommands\(/.test(body) &&
      /this\.availableCommands = merged/.test(body),
  );
  check(
    "apply always emitSnapshot (not gated on !replaying)",
    /this\.emitSnapshot\(\)/.test(body) &&
      !/if\s*\(\s*!this\.replaying\s*\)\s*this\.emitSnapshot/.test(body),
  );
  check(
    "no fire-and-forget .then merge in apply",
    !/mergeDiskSkillsIntoCommands\([^)]*\)\.then\(/.test(body),
  );
  check(
    "apply logs slash-catalog",
    /logSlashCatalog\(/.test(body),
  );
}

// --- refreshCommands union ---
{
  const idx = backend.indexOf("async refreshCommands()");
  const body = idx >= 0 ? backend.slice(idx, idx + 2200) : "";
  check(
    "refreshCommands unions with live catalog at end (not stale previous)",
    /unionAvailableCommands\(\s*merged,\s*this\.availableCommands/.test(body),
  );
  check(
    "refreshCommands documents ACU race / concurrent catalog",
    /ACU may land|current catalog|this\.availableCommands/i.test(body),
  );
  check(
    "refreshCommands does not capture stale previous for final union",
    !/unionAvailableCommands\(merged,\s*previous\)/.test(body),
  );
}

// --- menu still requireAcp for goal/loop (CLI-aligned, not fake local) ---
const catalog = read("src/renderer/slashMenuCatalog.ts");
check(
  "goal still requireAcp (agent-advertised)",
  /name:\s*"goal"[\s\S]*?requireAcp:\s*true/.test(catalog),
);
check(
  "loop still requireAcp (agent-advertised)",
  /name:\s*"loop"[\s\S]*?requireAcp:\s*true/.test(catalog),
);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
