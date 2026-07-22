/**
 * Unit tests for desktop slash menu filter (whitelist + skills).
 * Run: node scripts/test_slash_menu.mjs
 */
import assert from "node:assert/strict";

const DESKTOP_SLASH_MENU = [
  { name: "compact", action: "execute", requireAcp: false },
  { name: "plan", action: "set_mode", requireAcp: false },
  { name: "ask", action: "set_mode", requireAcp: false },
  { name: "agent", action: "set_mode", requireAcp: false },
  { name: "goal", action: "set_intent", requireAcp: true },
  { name: "loop", action: "set_intent", requireAcp: true },
  { name: "deep-research", action: "fill", requireAcp: true },
];

const SKILL_DESC_DISPLAY_MAX = 100;

function skillBareName(name) {
  if (!name.includes(":")) return name;
  return name.split(":").pop() || name;
}

function skillMenuTitle(name) {
  return `/${skillBareName(name)}`;
}

function shortenSlashDescription(text, max = SKILL_DESC_DISPLAY_MAX) {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
}

function skillScopeLabel(scope, zh) {
  if (!scope) return undefined;
  const s = scope.toLowerCase();
  if (zh) {
    const map = {
      local: "本地",
      repo: "仓库",
      user: "用户",
      bundled: "内置",
      server: "服务端",
      plugin: "插件",
    };
    return map[s] ?? scope;
  }
  return s;
}

function isSkillCommand(c) {
  if (c.skillPath || c.skillScope) return true;
  if (/^(local|repo|user|server|bundled|plugin):/i.test(c.name)) return true;
  return false;
}

function filterSlashMenu(acp, query, zh = false) {
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
    if (!isSkillCommand(c)) continue;
    if (q && !c.name.toLowerCase().includes(q) && !(c.description || "").toLowerCase().includes(q)) {
      continue;
    }
    const scope =
      c.skillScope ||
      (c.name.includes(":") ? c.name.split(":")[0].toLowerCase() : undefined);
    skills.push({
      section: "skill",
      name: c.name,
      title: skillMenuTitle(c.name),
      description: shortenSlashDescription(c.description || ""),
      action: "fill",
      skillScope: scope,
      skillScopeLabel: skillScopeLabel(scope, zh),
    });
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

// Skill rows expose /name, scope badge, and truncated description
const commit = list.find((x) => x.name === "commit");
assert.equal(commit?.title, "/commit");
assert.equal(commit?.skillScope, "user");
assert.equal(commit?.skillScopeLabel, "user");
assert.equal(commit?.description, "git commit helper");

list = filterSlashMenu(acp, "", true);
assert.equal(list.find((x) => x.name === "commit")?.skillScopeLabel, "用户");

list = filterSlashMenu(acp, "com");
assert.ok(list.some((x) => x.name === "compact"));
assert.ok(list.some((x) => x.name === "commit"));

// without goal in acp
list = filterSlashMenu([{ name: "compact", description: "c" }], "");
assert.ok(list.some((x) => x.name === "compact"));
assert.ok(!list.some((x) => x.name === "goal"));
assert.ok(list.some((x) => x.name === "plan"));

// no skills without meta
list = filterSlashMenu([{ name: "fake", description: "x" }], "");
assert.ok(!list.some((x) => x.name === "fake"));

// qualified skill name counts even without meta fields
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

const qualified = filterSlashMenu(
  [{ name: "user:help", description: "docs help skill" }],
  "",
  true,
);
const helpSkill = qualified.find((x) => x.name === "user:help");
assert.ok(helpSkill);
assert.equal(helpSkill.title, "/help");
assert.equal(helpSkill.skillScopeLabel, "用户");

// long description is shortened for display
const long =
  "将Markdown文章转换为美化的HTML格式，适配微信公众号发布。".repeat(6);
const longList = filterSlashMenu(
  [
    {
      name: "wechat-article-formatter",
      description: long,
      skillPath: "/s",
      skillScope: "user",
    },
  ],
  "",
);
const desc = longList.find((x) => x.name === "wechat-article-formatter")
  ?.description;
assert.ok(desc && desc.length <= SKILL_DESC_DISPLAY_MAX + 1);
assert.ok(desc.endsWith("…"));

console.log("test_slash_menu: ok");
