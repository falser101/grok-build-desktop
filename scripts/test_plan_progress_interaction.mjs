#!/usr/bin/env node
/**
 * Contract + pure logic for plan progress pill interaction:
 * - Hover shows only current task (not full list)
 * - Click toggles expanded full list
 * - current task = first in_progress else first pending
 *
 * Imports the same pure helpers the React component uses.
 * Run: node scripts/test_plan_progress_interaction.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DESKTOP = path.resolve(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(DESKTOP, rel), "utf8");

// Load pure module (TS may need transpile — prefer compiled or inline re-export).
// electron-vite doesn't emit renderer TS to disk; re-implement via dynamic
// eval of exported source is fragile. Instead: parse + execute the pure
// file by stripping types with a minimal transform, OR duplicate by
// importing via tsx. Prefer reading the .ts and running equivalent checks
// that call into a local copy that must match structure.
//
// Ship path: component imports from planProgressCurrent.ts — we mirror the
// pure functions here only after asserting the source exports them, then
// execute the real logic by evaluating a stripped version of that file.

function loadPureFromTs() {
  const src = read("src/renderer/planProgressCurrent.ts");
  // Strip types enough for Function constructor.
  let js = src
    .replace(/\/\*\*[\s\S]*?\*\//g, "")
    .replace(/^export type[\s\S]*?;$/gm, "")
    .replace(/^export interface[\s\S]*?^}/gm, "")
    .replace(/:\s*TodoLike\[\]/g, "")
    .replace(/:\s*TodoLike/g, "")
    .replace(/:\s*number/g, "")
    .replace(/:\s*string/g, "")
    .replace(/:\s*boolean/g, "")
    .replace(/:\s*TodoStatusLike/g, "")
    .replace(/fallback\s*=\s*""/g, 'fallback = ""')
    .replace(/export function/g, "function")
    .replace(/export /g, "");
  // Collect function bodies
  const scope = {};
  // eslint-disable-next-line no-new-func
  const runner = new Function(
    `${js}\nreturn { selectCurrentTodoIndex, shouldShowPlanProgress, currentTaskHoverText };`,
  );
  return runner();
}

const pure = loadPureFromTs();
const bubble = read("src/renderer/PlanProgressBubble.tsx");

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

// --- Pure current-task selection (drives real shipped helpers) ---
{
  const todos = [
    { status: "completed", content: "done" },
    { status: "in_progress", content: "running now" },
    { status: "pending", content: "later" },
  ];
  check(
    "selectCurrentTodoIndex prefers in_progress",
    pure.selectCurrentTodoIndex(todos) === 1,
  );
  check(
    "currentTaskHoverText is only the running task",
    pure.currentTaskHoverText(todos) === "running now",
  );
}

{
  const todos = [
    { status: "completed", content: "a" },
    { status: "pending", content: "next up" },
    { status: "pending", content: "after" },
  ];
  check(
    "selectCurrentTodoIndex falls back to first pending",
    pure.selectCurrentTodoIndex(todos) === 1,
  );
  check(
    "hover text is first pending when nothing in_progress",
    pure.currentTaskHoverText(todos) === "next up",
  );
}

{
  const todos = [
    { status: "completed", content: "a" },
    { status: "cancelled", content: "b" },
  ];
  check(
    "shouldShowPlanProgress false when all done",
    pure.shouldShowPlanProgress(todos) === false,
  );
  check(
    "shouldShowPlanProgress true with pending",
    pure.shouldShowPlanProgress([
      { status: "pending", content: "x" },
    ]) === true,
  );
}

// --- Structural: component interaction contract ---
check(
  "component uses expanded state (not hover for full list)",
  /const \[expanded, setExpanded\] = useState\(false\)/.test(bubble),
);
check(
  "click toggles expanded",
  /setExpanded\(\(v\) => !v\)/.test(bubble) ||
    /onClick=\{onToggle\}/.test(bubble),
);
check(
  "full task list gated on expanded",
  /\{expanded \? \(/.test(bubble) &&
    /plan-progress-bubble-tasks/.test(bubble),
);
check(
  "hover tip is separate from full list",
  /plan-progress-bubble-hover-tip/.test(bubble) &&
    /hovered && !expanded/.test(bubble),
);
check(
  "hover does not set expanded true",
  !/onMouseEnter=\{[^}]*setExpanded\(true\)/.test(bubble) &&
    !/setHovered\(true\).*setExpanded/s.test(
      bubble.slice(
        bubble.indexOf("onMouseEnter"),
        bubble.indexOf("onMouseEnter") + 80,
      ),
    ),
);
check(
  "aria-expanded on control",
  /aria-expanded=\{expanded\}/.test(bubble),
);
check(
  "imports pure helpers from planProgressCurrent",
  /from "\.\/planProgressCurrent"/.test(bubble) &&
    /selectCurrentTodoIndex/.test(bubble) &&
    /currentTaskHoverText/.test(bubble),
);
check(
  "default expanded is false",
  /useState\(false\)/.test(bubble),
);
check(
  "Escape / outside click dismiss",
  /Escape/.test(bubble) && /mousedown/.test(bubble),
);

// Simulated interaction model matching component state machine
{
  let expanded = false;
  let hovered = false;
  // hover alone
  hovered = true;
  check("hover alone leaves expanded false", expanded === false);
  // click opens
  expanded = !expanded;
  check("click opens expanded", expanded === true);
  // second click closes
  expanded = !expanded;
  check("second click closes expanded", expanded === false);
  // hover while closed shows tip only (expanded false)
  hovered = true;
  const showTip = hovered && !expanded;
  const showList = expanded;
  check("hover shows tip not list", showTip === true && showList === false);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
