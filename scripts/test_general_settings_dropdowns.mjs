// Structural assertion script for the General Settings dropdown refactor.
//
// Goal: prove the four option groups in the General Settings section
// render as <select> dropdowns (bound to prefs.locale / prefs.theme /
// alwaysApprove / autoTrustNewSessions) instead of the old stacked
// radio-style OptionCard list. Mirrors the plan's verification steps
// 1-4 as a one-shot runtime check.
//
// Exit 0 on full pass, 1 on first failure.

import fs from "node:fs";
import path from "node:path";

const repo = "/home/falser/Projects/grok-build-desktop";
const settingsPath = path.join(repo, "src/renderer/SettingsView.tsx");
const cssPath = path.join(repo, "src/renderer/styles.css");

const settings = fs.readFileSync(settingsPath, "utf8");
const css = fs.readFileSync(cssPath, "utf8");

const checks = [];
function check(name, ok, detail = "") {
  checks.push({ name, ok: !!ok, detail });
}

// 1. SelectField component is defined.
check(
  "SelectField component is defined",
  /function\s+SelectField<[^>]+>\s*\(/.test(settings),
);

// 2. Each of the four groups uses SelectField bound to its preference
//    value + matching setter (gating check #3 from the plan).
const locale =
  /value=\{prefs\.locale\}[\s\S]*?onChange=\{setLocale\}/.test(settings);
check(
  "Language group: SelectField bound to prefs.locale + setLocale",
  locale,
);

const theme =
  /value=\{prefs\.theme\}[\s\S]*?onChange=\{setTheme\}/.test(settings);
check(
  "Theme group: SelectField bound to prefs.theme + setTheme",
  theme,
);

const alwaysApprove =
  /value=\{alwaysApprove\s*\?\s*"on"\s*:\s*"off"\}[\s\S]*?onSetAlwaysApprove\(v === "on"\)/.test(
    settings,
  );
check(
  "alwaysApprove group: SelectField wired to onSetAlwaysApprove",
  alwaysApprove,
);

const autoTrust =
  /value=\{autoTrustNewSessions\s*\?\s*"on"\s*:\s*"off"\}[\s\S]*?onSetAutoTrustNewSessions\(v === "on"\)/.test(
    settings,
  );
check(
  "autoTrust group: SelectField wired to onSetAutoTrustNewSessions",
  autoTrust,
);

// 3. GeneralCards no longer renders OptionCard JSX or .settings-options
//    radiogroups (gating checks #1 and #2).
const generalStart = settings.indexOf("function GeneralCards");
const generalEnd = settings.indexOf("\n}\n", generalStart);
const generalSlice = settings.slice(generalStart, generalEnd);
check(
  "GeneralCards no longer uses <OptionCard> JSX",
  !/<OptionCard\b/.test(generalSlice),
  "<OptionCard> still rendered inside GeneralCards",
);
check(
  "GeneralCards no longer uses .settings-options radiogroup",
  !/className="settings-options"/.test(generalSlice),
  ".settings-options still rendered inside GeneralCards",
);

// 4. CSS contains the new dropdown chrome selectors (gating check #4).
check(
  "styles.css declares .settings-select-wrap",
  /\.settings-select-wrap\b/.test(css),
);
check(
  "styles.css declares .settings-select",
  /\.settings-select\b/.test(css),
);
check(
  "styles.css declares .settings-select-caret",
  /\.settings-select-caret\b/.test(css),
);
check(
  "styles.css declares .settings-row (label + dropdown row)",
  /\.settings-row\b/.test(css),
);
check(
  "styles.css declares .settings-row-text",
  /\.settings-row-text\b/.test(css),
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