// Structural assertion script for the goal-detail modal alignment fix.
//
// Goal: prove the desktop renderer no longer duplicates the status
// label for paused goals and now renders the shell's `pause_message`
// as a labelled, multi-line block (mirroring the TUI pager's
// `format_pause_reason()` + `wrap_pause_message_lines()`).
//
// What it checks (against the shipped source, no React runtime needed):
//   1. GoalDetailModal.tsx no longer renders the duplicated
//      `statusText — phase` form for paused statuses.
//   2. GoalDetailModal.tsx renders `goal-detail-reason` block when
//      `goal.pauseMessage` is truthy.
//   3. i18n.ts defines `goalPauseReasonLabel` + `goalPausedResumeLine`
//      for both English and Chinese message bundles.
//   4. styles.css adds `.goal-detail-reason` with `white-space: pre-wrap`
//      and `word-break: break-word` so long shell messages wrap and
//      embedded `\n` survives.
//
// Exits 0 on full pass, 1 on first failure with a message.

import fs from "node:fs";
import path from "node:path";

const repo = "/home/falser/Projects/grok-build-desktop";
const modalPath = path.join(repo, "src/renderer/GoalDetailModal.tsx");
const i18nPath = path.join(repo, "src/renderer/i18n.ts");
const cssPath = path.join(repo, "src/renderer/styles.css");

const modal = fs.readFileSync(modalPath, "utf8");
const i18n = fs.readFileSync(i18nPath, "utf8");
const css = fs.readFileSync(cssPath, "utf8");

const checks = [];
function check(name, ok, detail = "") {
  checks.push({ name, ok: !!ok, detail });
}

// 1. The duplicated `statusText — phase` form must be gone for paused
//    statuses specifically — it may legitimately remain for the
//    active / non-paused branch (where `statusText` ≠ `phase`).
//    Original bug: paused fell into the active branch and rendered
//    the status label twice. Now it must short-circuit before the
//    duplicate form.
const duplicateForPaused =
  /isPaused\s*\?\s*statusText\s*:[\s\S]{0,80}`\$\{statusText\}\s*—\s*\$\{phase\}`/.test(
    modal,
  );
check(
  "Paused branch short-circuits before the `statusText — phase` template",
  duplicateForPaused,
);

// 1b. The paused-status branch must render `statusText` only.
const pausedOnlyBranch =
  /isPaused\s*\?\s*statusText\s*:[\s\S]{0,80}isActive\s*\|\|\s*goal\.phase/;
check(
  "GoalDetailModal paused branch returns `statusText` only (no phase suffix)",
  pausedOnlyBranch.test(modal),
);

// 2. The reason block must be present and conditionally render the wire text.
const reasonBlockPresent = /className="goal-detail-reason"/.test(modal);
check(
  "GoalDetailModal renders `.goal-detail-reason` block",
  reasonBlockPresent,
);
const reasonWrapped = /goal\.pauseMessage\s*\?[\s\S]{0,400}goal-detail-reason[\s\S]{0,800}null/;
check(
  "Reason block is gated on `goal.pauseMessage` truthiness",
  reasonWrapped.test(modal),
);
const reasonTextSpan = /className="goal-detail-reason-text"[\s\S]{0,200}goal\.pauseMessage/.test(
  modal,
);
check(
  "Reason block renders `goal.pauseMessage` verbatim inside `.goal-detail-reason-text`",
  reasonTextSpan,
);
// Resume hint line uses the new i18n key with `{status}` placeholder.
const resumeLine = /m\.goalPausedResumeLine\.replace\("\{status\}"/.test(modal);
check(
  "Resume hint uses `m.goalPausedResumeLine` with `{status}` placeholder",
  resumeLine,
);

// 3. i18n keys present in both message bundles.
const interfaceDef = /goalPauseReasonLabel:\s*string;[\s\S]+?goalPausedResumeLine:\s*string;/.test(
  i18n,
);
check("i18n Messages interface declares both new keys", interfaceDef);

const enBundle = /goalPauseReasonLabel:\s*"Reason:\s*"/.test(i18n) &&
  /goalPausedResumeLine:\s*"\{status\}\s*—\s*type\s*\/goal resume to continue"/.test(
    i18n,
  );
check("English bundle fills `goalPauseReasonLabel` and `goalPausedResumeLine`", enBundle);

const zhBundle = /goalPauseReasonLabel:\s*"原因："/.test(i18n) &&
  /goalPausedResumeLine:\s*"\{status\}\s*—\s*输入\s*\/goal resume 继续"/.test(
    i18n,
  );
check("Chinese bundle fills `goalPauseReasonLabel` and `goalPausedResumeLine`", zhBundle);

// 4. CSS rules.
const cssBlock = /\.goal-detail-reason\s*\{/.test(css);
const cssPreWrap = /\.goal-detail-reason-text\s*\{[\s\S]*?white-space:\s*pre-wrap/.test(
  css,
);
const cssBreakWord = /\.goal-detail-reason-text\s*\{[\s\S]*?word-break:\s*break-word/.test(
  css,
);
const cssLabel = /\.goal-detail-reason-label/.test(css);
check("styles.css declares `.goal-detail-reason`", cssBlock);
check("styles.css sets `.goal-detail-reason-text` to `white-space: pre-wrap`", cssPreWrap);
check(
  "styles.css sets `.goal-detail-reason-text` to `word-break: break-word`",
  cssBreakWord,
);
check("styles.css declares `.goal-detail-reason-label`", cssLabel);

let failed = 0;
for (const c of checks) {
  const tag = c.ok ? "PASS" : "FAIL";
  if (!c.ok) failed++;
  console.log(`[${tag}] ${c.name}${c.detail ? ` — ${c.detail}` : ""}`);
}
console.log(`\n${checks.length - failed}/${checks.length} assertions passed.`);
process.exit(failed === 0 ? 0 : 1);