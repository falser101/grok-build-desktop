#!/usr/bin/env node
/**
 * Unit tests for stripComposerIntentSlashPrefix — the pure transform used when
 * applying goal/loop set_intent from the slash menu.
 *
 * Run: node --experimental-strip-types scripts/test_goal_loop_slash_strip.mjs
 */
import assert from "node:assert/strict";
import { stripComposerIntentSlashPrefix } from "../src/renderer/stripComposerIntentSlashPrefix.ts";

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

function expect(intent, input, want) {
  const got = stripComposerIntentSlashPrefix(input, intent);
  check(
    `${intent}: ${JSON.stringify(input)} → ${JSON.stringify(want)}`,
    got === want,
    `got ${JSON.stringify(got)}`,
  );
}

console.log("stripComposerIntentSlashPrefix (goal)");
// Partial / incomplete tokens while typing
expect("goal", "/", "");
expect("goal", "/g", "");
expect("goal", "/go", "");
expect("goal", "/goa", "");
expect("goal", "/goal", "");
expect("goal", "/goal ", "");
expect("goal", "  /go  ", "");
// Full command with body
expect("goal", "/goal do X", "do X");
expect("goal", "/goal  do X", "do X");
expect("goal", "  /GOAL fix bugs", "fix bugs");
// Unrelated draft stays
expect("goal", "plain text", "plain text");
expect("goal", "/help", "/help");
expect("goal", "/loop 5m x", "/loop 5m x");

console.log("stripComposerIntentSlashPrefix (loop)");
expect("loop", "/", "");
expect("loop", "/l", "");
expect("loop", "/lo", "");
expect("loop", "/loo", "");
expect("loop", "/loop", "");
expect("loop", "/loop ", "");
expect("loop", "/loop 5m", "");
expect("loop", "/loop 5m do X", "do X");
expect("loop", "  /LOOP 1h watch", "watch");
expect("loop", "plain text", "plain text");
expect("loop", "/goal do X", "/goal do X");
expect("loop", "/help", "/help");

// No leftover leading slash for selection cases
for (const [intent, inputs] of [
  ["goal", ["/", "/g", "/go", "/goal", "/goal do X"]],
  ["loop", ["/", "/l", "/loop", "/loop 5m do X"]],
]) {
  for (const input of inputs) {
    const out = stripComposerIntentSlashPrefix(input, intent);
    check(
      `${intent} no leftover slash from ${JSON.stringify(input)}`,
      !out.startsWith("/"),
      `got ${JSON.stringify(out)}`,
    );
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
