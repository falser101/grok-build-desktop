#!/usr/bin/env node
/**
 * Structural contract: right-side Plan panel auto-open policy.
 *
 * - Single auto-open path: only on pendingPlanApproval
 * - No todos 0→N soft open
 * - Manual dismiss uses open→closed edge detect
 * - Manual entry points remain
 *
 * Run: node scripts/test_plan_panel_auto_open.mjs
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

const app = read("src/renderer/App.tsx");

// Single auto-pop policy comment (Effect 1)
check(
  "auto-pop comment: only on plan awaiting approval",
  /Auto-pop the right-side Plan panel only when the agent actually has/.test(
    app,
  ) &&
    /a plan awaiting user approval/.test(app) &&
    /just because todos showed up/.test(app),
);

// No second dual auto-open effect
check(
  "no prevTodoCountRef (todos soft-open removed)",
  !/prevTodoCountRef/.test(app),
);
check(
  "no prevPlanApprovalRef dual effect",
  !/prevPlanApprovalRef/.test(app),
);
check(
  "no todos first-appear soft open comment",
  !/todos appear for the first time/.test(app) &&
    !/Auto-open Plan panel when a plan approval arrives or todos first appear/.test(
      app,
    ),
);

// Dismissed flag + edge detect
check(
  "planAutoPopDismissed exists",
  /planAutoPopDismissed/.test(app),
);
check(
  "edge-detect via prevRightPanelOpenRef",
  /prevRightPanelOpenRef/.test(app) &&
    /prevRightPanelOpenRef\.current &&\s*\n\s*!rightPanelOpen/.test(app),
);
check(
  "no naive dismissed on pending && !open alone",
  !/if \(snap\.pendingPlanApproval && !rightPanelOpen\) \{\s*\n\s*planAutoPopDismissed\.current = true;/.test(
    app,
  ),
);

// Dead helper removed
check(
  "ensurePlanTabOpen removed",
  !/ensurePlanTabOpen/.test(app),
);

// openPlanTab still the open primitive
check(
  "openPlanTab sets rightPanelOpen true",
  /const openPlanTab = useCallback\(\(\) => \{[\s\S]*?setRightPanelOpen\(true\);/.test(
    app,
  ),
);

// Manual entry points
check(
  "Ctrl+Shift+P opens plan",
  /if \(e\.shiftKey\) \{[\s\S]*?openRightTool\("plan"\)/.test(app),
);
check(
  "PlanProgressBubble onOpenPanel uses openPlanTab",
  /PlanProgressBubble[\s\S]*?onOpenPanel=\{\(\) => \{\s*\n\s*openPlanTab\(\);/.test(
    app,
  ),
);
check(
  "GoalProgressBubble onOpenPanel uses openPlanTab",
  /GoalProgressBubble[\s\S]*?onOpenPanel=\{\(\) => \{\s*\n\s*openPlanTab\(\);/.test(
    app,
  ),
);

// Auto-pop body still gates on pendingPlanApproval + dismissed
{
  const idx = app.indexOf(
    "Auto-pop the right-side Plan panel only when the agent actually has",
  );
  const body = idx >= 0 ? app.slice(idx, idx + 900) : "";
  check(
    "auto-pop effect gates on pendingPlanApproval",
    /if \(!snap\.pendingPlanApproval\)/.test(body),
    body ? "missing pending gate" : "auto-pop comment not found",
  );
  check(
    "auto-pop effect respects planAutoPopDismissed",
    /if \(planAutoPopDismissed\.current\) return;/.test(body),
  );
  check(
    "auto-pop calls openPlanTab",
    /openPlanTab\(\);/.test(body),
  );
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
