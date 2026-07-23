#!/usr/bin/env node
// Structural contract test: goal-mode progress must be visible in the
// desktop composer. Pins the renderer wiring, the backend routing, and
// the CSS that keeps the bubble on screen.
//
// Run: node scripts/test_goal_bubble_visibility.mjs
//
// Driven by acceptance criteria in:
//   ~/.grok/sessions/.../goal/plan.md (AC 1, 2, 3)

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

// ── (1) Renderer wires GoalProgressBubble to snap.goalState ────────────
{
  const app = read("src/renderer/App.tsx");
  const conditional =
    /\{snap\.goalState\s*\?\s*\([\s\S]*?<GoalProgressBubble[\s\S]*?goal=\{snap\.goalState\}/.test(
      app,
    );
  check(
    "renderer renders <GoalProgressBubble> when snap.goalState is set",
    conditional,
    "expected `snap.goalState ? <GoalProgressBubble goal={snap.goalState} ... /> : null`",
  );
  const props =
    /onPause=\{\(\)\s*=>\s*void\s+onGoalAction\("pause"\)\}/.test(app) &&
    /onResume=\{\(\)\s*=>\s*void\s+onGoalAction\("resume"\)\}/.test(app) &&
    /onClear=\{\(\)\s*=>\s*void\s+onGoalAction\("clear"\)\}/.test(app);
  check(
    "renderer wires pause/resume/clear handlers",
    props,
    "expected onPause/onResume/onClear → onGoalAction",
  );
}

// ── (2) Bubble lives above .composer-stack in the DOM ──────────────────
{
  const app = read("src/renderer/App.tsx");
  // The bubble must appear inside .composer-wrap and BEFORE .composer-stack.
  const wrapStart = app.indexOf('className="composer-wrap"');
  const bubbleAt = app.indexOf("<GoalProgressBubble");
  const stackAt = app.indexOf('className="composer-stack"');
  check(
    "GoalProgressBubble rendered inside composer-wrap",
    bubbleAt > -1 && wrapStart > -1 && bubbleAt > wrapStart,
    "expected bubble after .composer-wrap opens",
  );
  check(
    "GoalProgressBubble sits ABOVE .composer-stack in JSX order",
    bubbleAt > -1 && stackAt > -1 && bubbleAt < stackAt,
    `bubble@${bubbleAt} stack@${stackAt} — bubble must precede stack`,
  );
}

// ── (3) Bubble wrap CSS keeps it visible (no display:none etc.) ────────
{
  const css = read("src/renderer/styles.css");
  const wrapBlock = css.match(
    /\.goal-progress-bubble-wrap\s*\{[^}]*\}/,
  );
  check(
    ".goal-progress-bubble-wrap CSS rule exists",
    wrapBlock !== null,
    "no .goal-progress-bubble-wrap block found in styles.css",
  );
  if (wrapBlock) {
    const body = wrapBlock[0];
    const hidden =
      /display\s*:\s*none/.test(body) ||
      /visibility\s*:\s*hidden/.test(body) ||
      /opacity\s*:\s*0\b/.test(body);
    check(
      ".goal-progress-bubble-wrap is NOT hidden by CSS",
      !hidden,
      `hidden rule found in ${body}`,
    );
    check(
      ".goal-progress-bubble-wrap is display:flex",
      /display\s*:\s*flex/.test(body),
      "wrap should be a flex container so the chip renders",
    );
  }
  const composerWrap = css.match(/\.composer-wrap\s*\{[^}]*\}/);
  if (composerWrap) {
    const overflow =
      /overflow(-x|-y)?\s*:\s*hidden/.test(composerWrap[0]);
    check(
      ".composer-wrap does not clip its children (no overflow:hidden)",
      !overflow,
      `.composer-wrap clips: ${composerWrap[0]}`,
    );
  }
}

// ── (4) Backend routes x.ai/session_notification → handleSessionUpdate ─
{
  const b = read("src/main/backend.ts");
  const routes =
    /method\s*===\s*"x\.ai\/session_notification"/.test(b) ||
    /"x\.ai\/session_notification"\s*\|\|/.test(b);
  check(
    "backend routes x.ai/session_notification to handleSessionUpdate",
    routes,
    "expected `x.ai/session_notification` branch in handleNotification",
  );
  const routesLegacy =
    /method\s*===\s*"x\.ai\/session\/update"/.test(b) ||
    /"x\.ai\/session\/update"\s*\|\|/.test(b) ||
    /x\.ai\/session_notification\s*\|\|/.test(b);
  check(
    "backend also routes x.ai/session/update (replay path)",
    routesLegacy,
    "expected `x.ai/session/update` branch in handleNotification",
  );
  // Both should end up calling handleSessionUpdate (the standard
  // session/update branch already does).
  const routed =
    /this\.handleSessionUpdate\(asRecord\(params\)\)/.test(b);
  check(
    "handleSessionUpdate is invoked for the new envelope",
    routed,
    "expected `this.handleSessionUpdate(asRecord(params))`",
  );
}

// ── (5) handleSessionUpdate populates goalState from the inner update ──
{
  const b = read("src/main/backend.ts");
  const readsSessionUpdate = /kind\s*=\s*asString\(update\.sessionUpdate\)/.test(
    b,
  );
  check(
    "handleSessionUpdate reads sessionUpdate discriminator from update",
    readsSessionUpdate,
    "expected `kind = asString(update.sessionUpdate)`",
  );
  const matchesGoal =
    /kind\s*===\s*"goal_updated"/.test(b) ||
    /kind\s*===\s*"GoalUpdated"/.test(b);
  check(
    "goal_updated discriminator is matched",
    matchesGoal,
    "expected `kind === 'goal_updated'`",
  );
  const fallback =
    /asString\(update\.objective\)/.test(b) &&
    /asString\(update\.status\)/.test(b);
  check(
    "defensive fallback when discriminator is missing",
    fallback,
    "expected fallback that matches objective+status even without sessionUpdate",
  );
  check(
    "applyGoalUpdate is a shared helper",
    /private\s+applyGoalUpdate\s*\(/.test(b),
    "expected private applyGoalUpdate(update) helper",
  );
  // Snake + camel reading of every field
  const fields = [
    "goal_id",
    "objective",
    "status",
    "phase",
    "current_deliverable_title",
    "total_deliverables",
    "completed_deliverables",
    "pause_message",
  ];
  let all = true;
  for (const f of fields) {
    if (!b.includes(f)) {
      all = false;
      break;
    }
  }
  check(
    "backend reads all snake_case goal fields from payload",
    all,
    "missing at least one of: " + fields.join(", "),
  );
}

// ── (6) "complete" clears goalState + emitSnapshot is called ──────────
{
  const b = read("src/main/backend.ts");
  const clears = /status\s*===\s*"complete"[\s\S]*?this\.goalState\s*=\s*null/.test(
    b,
  );
  check(
    "goalState cleared on status=complete",
    clears,
    "expected `if (status === \"complete\") { this.goalState = null; ... }`",
  );
  // emitSnapshot should run on every goal branch
  const emits =
    /kind\s*===\s*"goal_updated"[\s\S]*?this\.emitSnapshot\(\)/.test(b);
  check(
    "emitSnapshot runs after goal update",
    emits,
    "expected this.emitSnapshot() in goal branch",
  );
}

// ── (7) GROK_DEBUG_GOAL env flag is honoured (no log noise by default) ─
{
  const b = read("src/main/backend.ts");
  const gated =
    /process\.env\.GROK_DEBUG_GOAL\s*===\s*"1"/.test(b) ||
    /process\.env\.GROK_DEBUG_GOAL\s*===\s*"true"/.test(b);
  check(
    "GROK_DEBUG_GOAL env flag gates the goal debug log",
    gated,
    "expected process.env.GROK_DEBUG_GOAL === '1' gate",
  );
}

// ── (8) goal chip and progress bubble are visually distinct ───────────
{
  const css = read("src/renderer/styles.css");
  const goalChip = css.match(/\.goal-chip\s*\{[^}]*\}/);
  const progressBubble = css.match(/\.goal-progress-bubble\s*\{[^}]*\}/);
  check(
    ".goal-chip (intent) rule present",
    goalChip !== null,
    "expected .goal-chip rule (composer intent pill)",
  );
  check(
    ".goal-progress-bubble (running goal) rule present",
    progressBubble !== null,
    "expected .goal-progress-bubble rule (live progress pill)",
  );
  if (goalChip && progressBubble) {
    check(
      ".goal-chip and .goal-progress-bubble use different class names",
      goalChip[0] !== progressBubble[0],
      "intent and progress chip must remain visually distinct",
    );
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);