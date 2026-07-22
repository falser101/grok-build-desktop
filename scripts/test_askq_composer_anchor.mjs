#!/usr/bin/env node
/**
 * Contract: ask_user_question UI is composer-anchored (not fullscreen).
 * Pure draft helpers are exercised via tsx against the shipped module.
 *
 * Run: node scripts/test_askq_composer_anchor.mjs
 */
import { spawnSync } from "node:child_process";
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
const modal = read("src/renderer/AskUserQuestionModal.tsx");
const drafts = read("src/renderer/askUserQuestionDrafts.ts");
const css = read("src/renderer/styles.css");

const shellIdx = app.indexOf("className={`shell");
const titleBarIdx = app.indexOf("<WindowTitleBar");
const composerStackIdx = app.indexOf('className="composer-stack"');
const mountRe =
  /\{snap\.pendingQuestion \? \(\s*\n\s*<AskUserQuestionModal/;
const mountMatch = app.match(mountRe);
check("App still mounts AskUserQuestionModal for pendingQuestion", Boolean(mountMatch));

const mountIdx = mountMatch ? app.indexOf(mountMatch[0]) : -1;
check(
  "AskUserQuestionModal is after WindowTitleBar (not shell fullscreen slot)",
  mountIdx > titleBarIdx && titleBarIdx > 0,
);
check(
  "AskUserQuestionModal is near composer (before composer-stack)",
  mountIdx > 0 &&
    composerStackIdx > 0 &&
    mountIdx < composerStackIdx &&
    mountIdx > shellIdx,
);
const planApprovalIdx = app.indexOf("<PlanApprovalCard");
check(
  "AskUserQuestion sits with composer-adjacent chrome",
  planApprovalIdx > 0 && Math.abs(mountIdx - planApprovalIdx) < 2500,
);
check(
  "respondAskUserQuestion still wired via onAskUserQuestion",
  /respondAskUserQuestion/.test(app) &&
    /onSubmit=\{\(response\) => void onAskUserQuestion\(response\)\}/.test(
      app,
    ),
);

check(
  "modal root class is askq-composer-panel",
  /className="askq-composer-panel"/.test(modal),
);
check(
  "no askq-overlay fullscreen wrapper in component",
  !/className="askq-overlay"/.test(modal),
);
check(
  "dialog role + aria-modal preserved",
  /role="dialog"/.test(modal) && /aria-modal="true"/.test(modal),
);
check(
  "Esc still cancels via onSubmit cancelled",
  /key === "Escape"/.test(modal) && /outcome:\s*"cancelled"/.test(modal),
);
check(
  "modal imports pure helpers from askUserQuestionDrafts",
  /from "\.\/askUserQuestionDrafts"/.test(modal) &&
    /buildAcceptedFromDrafts/.test(modal),
);
check(
  "cancel button still calls cancelled",
  /onClick=\{\(\) => onSubmit\(\{ outcome: "cancelled" \}\)\}/.test(modal),
);

check(
  "CSS defines .askq-composer-panel",
  /\.askq-composer-panel\s*\{/.test(css),
);
{
  const idx = css.indexOf(".askq-composer-panel");
  const body = idx >= 0 ? css.slice(idx, idx + 500) : "";
  check(
    "panel is not position:fixed inset:0",
    !/position:\s*fixed/.test(body) && !/inset:\s*0/.test(body),
  );
  check(
    "no full-window dimming backdrop on panel",
    !/backdrop-filter/.test(body) &&
      !/color-mix\(in srgb, #000/.test(body),
  );
}
check(
  "legacy .askq-overlay is not the primary fullscreen style",
  !/\.askq-overlay\s*\{\s*\n\s*position:\s*fixed;\s*\n\s*inset:\s*0/.test(css),
);

check(
  "pure module exports draft helpers",
  /export function emptyDraft/.test(drafts) &&
    /export function isAnswered/.test(drafts) &&
    /export function draftToLabels/.test(drafts) &&
    /export function buildAcceptedFromDrafts/.test(drafts),
);

// Drive shipped pure module via tsx (same code the UI imports).
const helperScript = `
import {
  emptyDraft,
  isAnswered,
  draftToLabels,
  buildAcceptedFromDrafts,
} from ${JSON.stringify(path.join(DESKTOP, "src/renderer/askUserQuestionDrafts.ts"))};

const questions = [{
  question: "Pick one",
  multiSelect: false,
  options: [
    { label: "A", description: "aa", preview: "preview-a" },
    { label: "B", description: "bb" },
  ],
}];

const d0 = emptyDraft();
if (isAnswered(d0)) throw new Error("empty should not be answered");
d0.labels = ["A"];
if (!isAnswered(d0)) throw new Error("selected should be answered");
if (draftToLabels(d0)[0] !== "A") throw new Error("draftToLabels");

const res = buildAcceptedFromDrafts(questions, [d0]);
if (res.outcome !== "accepted") throw new Error("outcome");
if (res.answers["Pick one"]?.[0] !== "A") throw new Error("answers");
if (res.annotations?.["Pick one"]?.preview !== "preview-a") throw new Error("preview");

const other = [{ labels: [], otherSelected: true, notes: "custom note" }];
const res2 = buildAcceptedFromDrafts(questions, other);
if (res2.answers["Pick one"]?.[0] !== "Other") throw new Error("Other label");
if (res2.annotations?.["Pick one"]?.notes !== "custom note") throw new Error("notes");

console.log("pure-helpers:ok");
`;

const r = spawnSync(
  "npx",
  ["--yes", "tsx", "-e", helperScript],
  { cwd: DESKTOP, encoding: "utf8", env: process.env },
);
const helperOut = `${r.stdout || ""}${r.stderr || ""}`;
check(
  "tsx drives shipped askUserQuestionDrafts helpers",
  r.status === 0 && /pure-helpers:ok/.test(helperOut),
  helperOut.slice(0, 400),
);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
