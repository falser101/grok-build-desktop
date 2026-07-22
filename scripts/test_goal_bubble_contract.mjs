#!/usr/bin/env node
// Structural test for goal/loop UI-intent bubble contracts.
//
// Run: node scripts/test_goal_bubble_contract.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DESKTOP = path.resolve(__dirname, "..");

let pass = 0;
let fail = 0;
function check(name, ok, detail) {
  if (ok) {
    console.log(`  \u2713 ${name}`);
    pass++;
  } else {
    console.error(`  \u2717 ${name}  ${detail ?? ""}`);
    fail++;
  }
}
const read = (rel) => fs.readFileSync(path.join(DESKTOP, rel), "utf8");

// (1) PromptPayload flags
{
  const t = read("src/shared/types.ts");
  check(
    "PromptPayload.prependGoal declared",
    /export interface PromptPayload \{[^}]*prependGoal\?: boolean/s.test(t),
  );
  check(
    "PromptPayload.prependLoop declared",
    /export interface PromptPayload \{[^}]*prependLoop\?: boolean/s.test(t),
  );
}

// (2) Timeline badges
{
  const t = read("src/shared/types.ts");
  check(
    "Timeline user has attachGoalBadge",
    /kind:\s*"user";[\s\S]*?attachGoalBadge\?:\s*boolean/s.test(t),
  );
  check(
    "Timeline user has attachLoopBadge",
    /kind:\s*"user";[\s\S]*?attachLoopBadge\?:\s*boolean/s.test(t),
  );
}

// (3) resolvePromptIntent + dispatch
{
  const app = read("src/renderer/App.tsx");
  check(
    "resolvePromptIntent helper present",
    /function resolvePromptIntent\(/.test(app),
  );
  check(
    "dispatch uses resolvePromptIntent",
    /const resolved = resolvePromptIntent\(text/.test(app),
  );
  check(
    "dispatch forwards prependLoop",
    /prependLoop: resolved\.prependLoop \|\| undefined/.test(app),
  );
  check(
    "goal/loop slash actions are set_intent",
    /action:\s*"set_intent"/.test(read("src/renderer/slashMenuCatalog.ts")),
  );
  check(
    "stripComposerIntentSlashPrefix module present",
    /export function stripComposerIntentSlashPrefix\(/.test(
      read("src/renderer/stripComposerIntentSlashPrefix.ts"),
    ),
  );
  check(
    "applySlashMenuItem uses stripComposerIntentSlashPrefix for set_intent",
    /stripComposerIntentSlashPrefix\(/.test(app) &&
      /set_intent/.test(app) &&
      // Both goal and loop branches call the pure strip helper (not only full /goal|/loop regex).
      (app.match(/stripComposerIntentSlashPrefix\(/g) || []).length >= 2,
  );
}

// (4) user bubble badges
{
  const app = read("src/renderer/App.tsx");
  check(
    "user bubble uses attachGoalBadge",
    /attachGoalBadge === true/.test(app),
  );
  check(
    "user bubble uses attachLoopBadge",
    /attachLoopBadge === true/.test(app),
  );
}

// (5) backend strip
{
  const b = read("src/main/backend.ts");
  check(
    "backend strips /goal when prependGoal",
    /p\.prependGoal === true[\s\S]*?trimmed\.replace\(\/\^\\s\*\\\/goal\\s\*\/i, ""\)/.test(
      b,
    ),
  );
  check(
    "backend strips /loop when prependLoop",
    /p\.prependLoop === true[\s\S]*?\/loop\\s\+\(\\S\+\)\\s\+\(\[\\s\\S\]\+\)/.test(
      b,
    ) || /prependLoop === true[\s\S]*?\/loop\\s\+/.test(b),
  );
  check(
    "backend tags attachLoopBadge",
    /attachLoopBadge:\s*loopAutoStripped/.test(b),
  );
  check(
    "backend tags attachGoalBadge",
    /attachGoalBadge:\s*goalAutoStripped/.test(b),
  );
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
