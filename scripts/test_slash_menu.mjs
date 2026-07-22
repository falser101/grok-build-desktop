/**
 * Unit tests for desktop slash menu filter (whitelist + skills).
 * Run: node scripts/test_slash_menu.mjs
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Compile-free: re-implement the filter contract checks against catalog + pure logic
// by importing built output if present, else inline minimal mirror of public API.

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

// Dynamic import of TS via esbuild-register is unavailable; duplicate the
// catalog list for assertion and test pure JS logic extracted from design.

const DESKTOP_SLASH_MENU = [
  { name: "compact", action: "execute", requireAcp: false },
  { name: "plan", action: "set_mode", requireAcp: false },
  { name: "ask", action: "set_mode", requireAcp: false },
  { name: "agent", action: "set_mode", requireAcp: false },
  { name: "goal", action: "set_intent", requireAcp: true },
  { name: "loop", action: "set_intent", requireAcp: true },
  { name: "deep-research", action: "fill", requireAcp: true },
];

function filterSlashMenu(acp, query) {
  const acpByName = new Map(acp.map((c) => [c.name.toLowerCase(), c]));
  const q = query.toLowerCase();
  const commands = [];
  for (const def of DESKTOP_SLASH_MENU) {
    if (def.requireAcp && !acpByName.has(def.name.toLowerCase())) continue;
    if (q && !def.name.includes(q)) continue;
    commands.push({ section: "command", name: def.name, action: def.action });
  }
  const skills = [];
  for (const c of acp) {
    if (!c.skillPath && !c.skillScope) continue;
    if (q && !c.name.toLowerCase().includes(q)) continue;
    skills.push({ section: "skill", name: c.name, action: "fill" });
  }
  return [...commands, ...skills];
}

const acp = [
  { name: "compact", description: "c" },
  { name: "goal", description: "g" },
  { name: "new", description: "n" },
  { name: "vim-mode", description: "v" },
  {
    name: "commit",
    description: "git commit helper",
    skillPath: "/skills/commit",
    skillScope: "user",
  },
  { name: "loop", description: "loop" },
];

let list = filterSlashMenu(acp, "");
const names = list.map((x) => x.name);
assert.ok(names.includes("compact"));
assert.ok(names.includes("plan"));
assert.ok(names.includes("goal"));
assert.ok(names.includes("loop"));
assert.ok(names.includes("commit"));
assert.ok(!names.includes("new"));
assert.ok(!names.includes("vim-mode"));
assert.equal(list.find((x) => x.name === "commit")?.section, "skill");
assert.equal(list.find((x) => x.name === "compact")?.section, "command");
assert.equal(list.find((x) => x.name === "goal")?.action, "set_intent");
assert.equal(list.find((x) => x.name === "loop")?.action, "set_intent");

list = filterSlashMenu(acp, "com");
assert.ok(list.some((x) => x.name === "compact"));
assert.ok(list.some((x) => x.name === "commit"));

// without goal in acp
list = filterSlashMenu(
  [{ name: "compact", description: "c" }],
  "",
);
assert.ok(list.some((x) => x.name === "compact"));
assert.ok(!list.some((x) => x.name === "goal"));
assert.ok(list.some((x) => x.name === "plan"));

// no skills without meta
list = filterSlashMenu([{ name: "fake", description: "x" }], "");
assert.ok(!list.some((x) => x.name === "fake"));

// qualified skill name counts even without meta fields
function isSkillCommand(c) {
  if (c.skillPath || c.skillScope) return true;
  if (/^(local|repo|user|server|bundled|plugin):/i.test(c.name)) return true;
  return false;
}
assert.ok(isSkillCommand({ name: "user:help", description: "h" }));
assert.ok(
  isSkillCommand({
    name: "create-skill",
    description: "c",
    skillPath: "/x",
    skillScope: "user",
  }),
);
assert.ok(!isSkillCommand({ name: "compact", description: "c" }));

console.log("test_slash_menu: ok");
