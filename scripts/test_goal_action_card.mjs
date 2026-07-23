// Structural assertion script for the ephemeral `goal_action` card.
//
// Goal: prove the goal-mode pause/resume/clear actions emit a
// `.compact-card`-shaped receipt card into the timeline, mirroring
// how `/compact` is shown. Drives the real shipped source on each
// run; exits 0 on full pass, 1 on first failure.
//
// Asserts:
//   1. TimelineItem gains a new `goal_action` variant
//      (src/shared/types.ts).
//   2. backend.ts has beginGoalAction / finishGoalAction helpers
//      AND sendPrompt detects /goal (pause|resume|clear).
//   3. App.tsx renders `kind === "goal_action"` reusing .compact-card.
//   4. i18n.ts declares the new keys in both EN and ZH bundles.
//   5. styles.css adds .compact-card.goal-action and per-verb badges.

import fs from "node:fs";
import path from "node:path";

const repo = "/home/falser/Projects/grok-build-desktop";
const typesPath = path.join(repo, "src/shared/types.ts");
const backendPath = path.join(repo, "src/main/backend.ts");
const appPath = path.join(repo, "src/renderer/App.tsx");
const i18nPath = path.join(repo, "src/renderer/i18n.ts");
const cssPath = path.join(repo, "src/renderer/styles.css");

const types = fs.readFileSync(typesPath, "utf8");
const backend = fs.readFileSync(backendPath, "utf8");
const app = fs.readFileSync(appPath, "utf8");
const i18n = fs.readFileSync(i18nPath, "utf8");
const css = fs.readFileSync(cssPath, "utf8");

const checks = [];
function check(name, ok, detail = "") {
  checks.push({ name, ok: !!ok, detail });
}

// 1. TimelineItem variant.
const variant =
  /kind:\s*"goal_action";[\s\S]{0,400}verb:\s*"pause"\s*\|\s*"resume"\s*\|\s*"clear";[\s\S]{0,200}status:\s*"running"\s*\|\s*"completed"\s*\|\s*"failed"\s*\|\s*"cancelled"/.test(
    types,
  );
check(
  "shared/types.ts adds `kind: \"goal_action\"` TimelineItem variant",
  variant,
);

// 2. backend helpers + sendPrompt detection.
check(
  "backend.ts declares beginGoalAction helper",
  /private\s+beginGoalAction\s*\(\s*verb\s*:\s*"pause"\s*\|\s*"resume"\s*\|\s*"clear"\s*\)/.test(
    backend,
  ),
);
check(
  "backend.ts declares finishGoalAction helper",
  /private\s+finishGoalAction\s*\(/.test(backend),
);
check(
  "backend.ts sendPrompt detects /goal (pause|resume|clear)",
  /\/goal\\s\+\(pause\|resume\|clear\)\\s\*\$/i.test(backend),
);
check(
  "backend.ts sendPrompt calls beginGoalAction(goalVerb) on match",
  /beginGoalAction\(\s*goalVerb\s*\)/.test(backend),
);
check(
  "backend.ts sendPrompt success path finishes the goal_action card",
  /finishGoalAction\(\s*"completed"\s*\)/.test(backend),
);
check(
  "backend.ts sendPrompt catch path finishes the card with failure status",
  /finishGoalAction\(\s*cancelled\s*\?\s*"cancelled"\s*:\s*"failed"/.test(
    backend,
  ),
);

// 3. App.tsx renderer reuses .compact-card.
check(
  "App.tsx renders `item.kind === \"goal_action\"` branch",
  /item\.kind\s*===\s*"goal_action"/.test(app),
);
check(
  "App.tsx goal_action card reuses `.compact-card` class",
  /className=\{`compact-card goal-action status-\$\{item\.status\}/.test(
    app,
  ),
);
check(
  "App.tsx goal_action card reuses `.compact-card-row` + `.compact-badge`",
  /className=\{`compact-badge mode-\$\{item\.verb\}`/.test(app),
);
check(
  "App.tsx goal_action card reuses `.compact-spinner` while running",
  /compact-spinner/.test(app) && /compact-progress-bar/.test(app),
);

// 4. i18n — interface + both bundles.
const interfaceKeys = [
  "goalActionBadgePause",
  "goalActionBadgeResume",
  "goalActionBadgeClear",
  "goalActionTitlePauseRunning",
  "goalActionTitleResumeRunning",
  "goalActionTitleClearRunning",
  "goalActionTitlePauseDone",
  "goalActionTitleResumeDone",
  "goalActionTitleClearDone",
  "goalActionFailed",
  "goalActionCancelled",
];
const missingInterface = interfaceKeys.filter(
  (k) => !new RegExp(`\\b${k}:\\s*string;`).test(i18n),
);
check(
  "i18n.ts Messages interface declares all 11 new keys",
  missingInterface.length === 0,
  missingInterface.length ? `missing: ${missingInterface.join(", ")}` : "",
);

const enBundle = [
  /goalActionBadgePause:\s*"Pause"/,
  /goalActionBadgeResume:\s*"Resume"/,
  /goalActionBadgeClear:\s*"Clear"/,
  /goalActionTitlePauseRunning:\s*"Pausing goal…"/,
  /goalActionTitleResumeRunning:\s*"Resuming goal…"/,
  /goalActionTitleClearRunning:\s*"Clearing goal…"/,
  /goalActionTitlePauseDone:\s*"Goal paused"/,
  /goalActionTitleResumeDone:\s*"Goal resumed"/,
  /goalActionTitleClearDone:\s*"Goal cleared"/,
  /goalActionFailed:\s*"Action failed"/,
  /goalActionCancelled:\s*"Action cancelled"/,
];
const enMissing = enBundle.filter((re) => !re.test(i18n));
check(
  "English bundle fills all 11 new keys",
  enMissing.length === 0,
  enMissing.length
    ? `${enMissing.length} regex(es) missing`
    : "",
);

const zhBundle = [
  /goalActionBadgePause:\s*"暂停"/,
  /goalActionBadgeResume:\s*"恢复"/,
  /goalActionBadgeClear:\s*"清除"/,
  /goalActionTitlePauseRunning:\s*"正在暂停目标…"/,
  /goalActionTitleResumeRunning:\s*"正在恢复目标…"/,
  /goalActionTitleClearRunning:\s*"正在清除目标…"/,
  /goalActionTitlePauseDone:\s*"目标已暂停"/,
  /goalActionTitleResumeDone:\s*"目标已恢复"/,
  /goalActionTitleClearDone:\s*"目标已清除"/,
  /goalActionFailed:\s*"操作失败"/,
  /goalActionCancelled:\s*"操作已取消"/,
];
const zhMissing = zhBundle.filter((re) => !re.test(i18n));
check(
  "Chinese bundle fills all 11 new keys",
  zhMissing.length === 0,
  zhMissing.length ? `${zhMissing.length} regex(es) missing` : "",
);

// 5. styles.css additions.
check(
  "styles.css declares `.compact-card.goal-action` marker class",
  /\.compact-card\.goal-action\b/.test(css),
);
check(
  "styles.css declares `.compact-badge.mode-pause`",
  /\.compact-badge\.mode-pause\b/.test(css),
);
check(
  "styles.css declares `.compact-badge.mode-resume`",
  /\.compact-badge\.mode-resume\b/.test(css),
);
check(
  "styles.css declares `.compact-badge.mode-clear`",
  /\.compact-badge\.mode-clear\b/.test(css),
);
check(
  "styles.css adds a failure-state override for goal-action cards",
  /\.compact-card\.goal-action\.status-failed\b/.test(css),
);

let failed = 0;
for (const c of checks) {
  const tag = c.ok ? "PASS" : "FAIL";
  if (!c.ok) failed++;
  console.log(
    `[${tag}] ${c.name}${c.detail ? ` — ${c.detail}` : ""}`,
  );
}
console.log(
  `\n${checks.length - failed}/${checks.length} assertions passed.`,
);
process.exit(failed === 0 ? 0 : 1);