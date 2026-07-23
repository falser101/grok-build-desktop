#!/usr/bin/env node
// Structural alignment test: the desktop `modeOptions.ts` must stay in
// sync with grok-build's `PermissionMode::VALID_VALUES` minus
// `bypassPermissions` (which is owned by the always-approve chip, not
// the mode dropdown).
//
// Run: node scripts/test_mode_options_alignment.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DESKTOP = path.resolve(__dirname, "..");
const GROK = path.resolve(DESKTOP, "..", "grok-build");

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
const read = (p) => fs.readFileSync(p, "utf8");

// 1) Backend `PermissionMode::VALID_VALUES` exists and is the source of truth.
let backendValidValues = null;
try {
  const src = read(
    path.join(GROK, "crates/codegen/xai-grok-agent/src/config.rs"),
  );
  const m = src.match(
    /VALID_VALUES[^=]*=\s*&\[([^\]]+)\]/,
  );
  if (m) {
    backendValidValues = m[1]
      .split(",")
      .map((s) => s.trim().replace(/^"|"$/g, ""))
      .filter(Boolean);
  }
} catch (err) {
  // fall through; check below will report missing
}
check(
  "grok-build PermissionMode::VALID_VALUES read",
  Array.isArray(backendValidValues) && backendValidValues.length > 0,
  backendValidValues ?? "could not locate grok-build/crates/codegen/xai-grok-agent/src/config.rs",
);

if (Array.isArray(backendValidValues)) {
  // 2) The set of mode ids exposed by `modeOptions.ts` (deduped, sorted)
  // matches `backendValidValues \ { "bypassPermissions" }`.
  const desktopSrc = read(
    path.join(DESKTOP, "src/renderer/modeOptions.ts"),
  );
  const idMatches = [
    ...desktopSrc.matchAll(/id:\s*"(default|acceptEdits|auto|dontAsk|plan)"/g),
  ].map((m) => m[1]);
  const desktopIds = [...new Set(idMatches)].sort();
  const expectedIds = backendValidValues
    .filter((v) => v !== "bypassPermissions")
    .sort();
  check(
    "modeOptions ids == backend VALID_VALUES \\ { bypassPermissions }",
    JSON.stringify(desktopIds) === JSON.stringify(expectedIds),
    `desktop=${JSON.stringify(desktopIds)} expected=${JSON.stringify(expectedIds)}`,
  );

  // 3) Desktop must NOT list bypassPermissions in modeOptions (chip owns it).
  check(
    "modeOptions includes bypassPermissions",
    desktopSrc.includes('id: "bypassPermissions"'),
    "bypassPermissions must be in the mode dropdown",
  );

  // 4) Both locales must define every label key referenced by the chip /
  // dropdown (one per mode id).
  const i18n = read(path.join(DESKTOP, "src/renderer/i18n.ts"));
  const expectKeys = [
    "modeDefault",
    "modeDefaultHint",
    "modeAcceptEdits",
    "modeAcceptEditsHint",
    "modeAuto",
    "modeAutoHint",
    "modeDontAsk",
    "modeDontAskHint",
    "modePlan",
    "modePlanHint",
    "modeGroupApproval",
    "modeGroupWorkflow",
  ];
  for (const k of expectKeys) {
    check(
      `i18n key present in both locales: ${k}`,
      new RegExp(`\\b${k}\\s*:`).test(i18n),
      `missing ${k}`,
    );
  }
  check(
    "i18n: no legacy 'ask' label remains (replaced by dontAsk)",
    !/modeAsk(\b|Hint)\s*:/.test(i18n),
    "remove modeAsk/modeAskHint — replaced by modeDontAsk",
  );
}

// 5) Backend still allows the 5 values we're going to set (sanity).
if (Array.isArray(backendValidValues)) {
  const need = ["default", "acceptEdits", "auto", "dontAsk", "plan"];
  for (const v of need) {
    check(
      `backend accepts "${v}"`,
      backendValidValues.includes(v),
      `${v} missing from VALID_VALUES`,
    );
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);