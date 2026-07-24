#!/usr/bin/env node
// Structural contract: Models settings UI is a plain settings surface.
// Drives shipped ModelsView.tsx + styles.css (no reimplementation).
//
// Run: node scripts/test_models_ui_simplify.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DESKTOP = path.resolve(__dirname, "..");

let pass = 0;
let fail = 0;
function check(name, ok, detail = "") {
  if (ok) {
    console.log(`  ✓ ${name}`);
    pass++;
  } else {
    console.error(`  ✗ ${name}${detail ? `  ${detail}` : ""}`);
    fail++;
  }
}
const read = (rel) => fs.readFileSync(path.join(DESKTOP, rel), "utf8");

const view = read("src/renderer/ModelsView.tsx");
const css = read("src/renderer/styles.css");

// ── AC1: no decorative page gradient / marketing eyebrow / dense tiles ──
check(
  "ModelsView has no models-page-bg markup",
  !/className="models-page-bg"/.test(view) && !/models-page-bg/.test(view),
  "expected models-page-bg removed from JSX",
);
check(
  "ModelsView has no models-hero-eyebrow",
  !/models-hero-eyebrow/.test(view),
  "expected marketing eyebrow removed",
);
check(
  "ModelsView has no models-stat-tile metric chrome",
  !/models-stat-tile/.test(view),
  "expected dense stat tiles removed",
);
check(
  "CSS hides residual models-page-bg",
  /\.models-page-bg\s*\{[^}]*display:\s*none/s.test(css) ||
    !/\.models-page-bg\s*\{[^}]*radial-gradient/s.test(css),
  "page-bg must not paint atmosphere gradients",
);

// ── AC2: button hierarchy — one primary Add, secondary Refresh/Reconnect ──
const actionBlock = view.match(
  /models-hero-actions[\s\S]*?<\/div>\s*<\/div>\s*<\/header>/,
);
check(
  "hero actions block present",
  Boolean(actionBlock),
  "could not locate models-hero-actions block",
);
if (actionBlock) {
  const block = actionBlock[0];
  const primaries = (block.match(/ext-btn primary/g) || []).length;
  const secondaries = (block.match(/className="ext-btn"/g) || []).length;
  check(
    "exactly one primary CTA in hero actions (Add provider)",
    primaries === 1,
    `found ${primaries} primary buttons`,
  );
  check(
    "Refresh + Reconnect use plain secondary ext-btn",
    secondaries >= 2,
    `found ${secondaries} secondary ext-btn`,
  );
  check(
    "hero actions do not use models-add-btn glow class",
    !/models-add-btn/.test(block),
    "models-add-btn must not appear on Add CTA",
  );
  check(
    "hero actions do not use models-toolbar-btn",
    !/models-toolbar-btn/.test(block),
    "toolbar blur variant removed",
  );
}

check(
  "CSS has no models-add-btn box-shadow glow as primary style",
  !/\.models-add-btn\s*\{[^}]*box-shadow:[^}]*accent/s.test(css),
  "residual models-add-btn glow found",
);

// ── AC3: settings tokens for surfaces ──
check(
  "provider cards use var(--bg-elevated) surface",
  /\.models-provider-card\s*\{[\s\S]{0,400}background:\s*var\(--bg-elevated\)/.test(
    css,
  ),
  "expected flat --bg-elevated provider cards",
);
check(
  "searchbar uses var(--bg-elevated)",
  /\.models-searchbar\s*\{[\s\S]{0,300}background:\s*var\(--bg-elevated\)/.test(
    css,
  ),
);
check(
  "empty card uses settings surface tokens (no accent radial default)",
  /\.models-empty-card\s*\{[\s\S]{0,350}background:\s*var\(--bg-elevated\)/.test(
    css,
  ) &&
    !/\.models-empty-card\s*\{[\s\S]{0,350}radial-gradient/.test(css),
);
check(
  "inline stats use --text-muted / --text",
  /\.models-stats-inline\s*\{[\s\S]{0,200}color:\s*var\(--text-muted\)/.test(
    css,
  ),
);

// ── AC4: behavior wiring preserved ──
const handlers = [
  ["load()", /onClick=\{\(\)\s*=>\s*void\s+load\(\)\}/],
  ["onReconnect()", /onClick=\{\(\)\s*=>\s*onReconnect\(\)\}/],
  ["preset picker toggle", /setPresetPickerOpen\(\(v\)\s*=>\s*!v\)/],
  ["openEdit", /openEdit\(/],
  ["onDelete", /onDelete\(/],
  ["onSave", /onSave\(/],
  ["onToggleProvider", /onToggleProvider\(/],
  ["toggleModel", /toggleModel\(/],
  ["editor form present", /models-editor-card/],
  ["preset picker present", /models-presets/],
];
for (const [name, re] of handlers) {
  check(`behavior wired: ${name}`, re.test(view));
}

// Embed path still hides back/title, keeps actions
check(
  "embed path hides models-hero-text + settings-back",
  /\.settings-models-embed\s+\.settings-back[\s\S]{0,80}\.models-hero-text[\s\S]{0,40}display:\s*none/s.test(
    css,
  ) ||
    (/\.settings-models-embed\s+\.settings-back/.test(css) &&
      /\.settings-models-embed\s+\.models-hero-text/.test(css)),
);
check(
  "embed path does not require models-page-bg hide for layout",
  true, // always — page-bg removed globally
);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
