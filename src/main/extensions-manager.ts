/**
 * MCP / Skills / Plugins / Hooks management via grok CLI + filesystem scan.
 * Config paths match the CLI (user ~/.grok + project .grok).
 */

import { spawn } from "node:child_process";
import {
  readdir,
  readFile,
  writeFile,
  stat,
  access,
} from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { resolveGrokBinary } from "./backend";
import type {
  HookEntry,
  InstallSkillInput,
  InstallSkillResult,
  McpServerEntry,
  McpServerScope,
  PluginEntry,
  SkillCatalogEntry,
  SkillEntry,
} from "../shared/types";

function grokHome(): string {
  return join(homedir(), ".grok");
}

function userConfigPath(): string {
  return join(grokHome(), "config.toml");
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function runGrokCli(
  args: string[],
  options?: { cwd?: string; timeoutMs?: number },
): Promise<{ stdout: string; stderr: string; code: number }> {
  const binary = await resolveGrokBinary();
  const timeoutMs = options?.timeoutMs ?? 60_000;
  return new Promise((resolvePromise, reject) => {
    const child = spawn(binary, args, {
      cwd: options?.cwd || process.cwd(),
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGTERM");
      reject(new Error(`grok ${args[0] ?? ""} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout?.on("data", (d: Buffer) => {
      stdout += d.toString("utf8");
    });
    child.stderr?.on("data", (d: Buffer) => {
      stderr += d.toString("utf8");
    });
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise({ stdout, stderr, code: code ?? 1 });
    });
  });
}

async function runGrokOk(
  args: string[],
  options?: { cwd?: string; timeoutMs?: number },
): Promise<string> {
  const r = await runGrokCli(args, options);
  if (r.code !== 0) {
    const msg = (r.stderr || r.stdout || `exit ${r.code}`).trim();
    throw new Error(msg || `grok ${args.join(" ")} failed`);
  }
  return r.stdout;
}

// ── MCP ─────────────────────────────────────────────────────────────

export async function listMcpServers(cwd?: string): Promise<McpServerEntry[]> {
  const out = await runGrokOk(["mcp", "list", "--json"], {
    cwd: cwd || process.cwd(),
    timeoutMs: 30_000,
  });
  const raw = JSON.parse(out || "[]") as unknown;
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => {
    const o = item as Record<string, unknown>;
    const name = String(o.name ?? "");
    const enabled = o.enabled !== false;
    const scope: McpServerScope =
      o.scope === "project" ? "project" : "user";
    let transport: McpServerEntry["transport"] = "stdio";
    let detail = "";
    if (typeof o.url === "string" && o.url) {
      const t = typeof o.type === "string" ? o.type.toLowerCase() : "";
      transport = t === "sse" ? "sse" : "http";
      detail = o.url;
    } else if (typeof o.command === "string") {
      transport = "stdio";
      const args = Array.isArray(o.args)
        ? (o.args as unknown[]).map(String)
        : [];
      detail = [o.command, ...args].join(" ");
    }
    return { name, enabled, scope, transport, detail };
  }).filter((s) => s.name);
}

export interface AddMcpInput {
  name: string;
  transport: "stdio" | "http" | "sse";
  /** Command (stdio) or URL (http/sse). */
  commandOrUrl: string;
  args?: string[];
  env?: string[];
  headers?: string[];
  scope?: McpServerScope;
  cwd?: string;
}

export async function addMcpServer(input: AddMcpInput): Promise<void> {
  const name = input.name.trim();
  if (!/^[A-Za-z0-9_-]+$/.test(name)) {
    throw new Error(
      "Server name may only contain letters, numbers, hyphens, and underscores",
    );
  }
  const args = ["mcp", "add"];
  if (input.transport !== "stdio") {
    args.push("--transport", input.transport);
  }
  if (input.scope === "project") {
    args.push("--scope", "project");
  }
  for (const e of input.env ?? []) {
    if (e.includes("=")) args.push("-e", e);
  }
  for (const h of input.headers ?? []) {
    if (h.includes(":")) args.push("--header", h);
  }
  args.push(name);
  if (input.transport === "stdio") {
    args.push("--");
    args.push(input.commandOrUrl);
    for (const a of input.args ?? []) args.push(a);
  } else {
    args.push(input.commandOrUrl);
  }
  await runGrokOk(args, {
    cwd: input.cwd || process.cwd(),
    timeoutMs: 30_000,
  });
}

export async function removeMcpServer(
  name: string,
  scope?: McpServerScope,
  cwd?: string,
): Promise<void> {
  const args = ["mcp", "remove", name];
  if (scope) args.push("--scope", scope);
  await runGrokOk(args, { cwd: cwd || process.cwd(), timeoutMs: 30_000 });
}

/**
 * Toggle `enabled` for `[mcp_servers.<name>]` in user or project config.
 * Best-effort line rewrite (same style as permission_mode helper).
 */
export async function setMcpEnabled(
  name: string,
  enabled: boolean,
  scope: McpServerScope = "user",
  cwd?: string,
): Promise<void> {
  const path =
    scope === "project"
      ? join(cwd || process.cwd(), ".grok", "config.toml")
      : userConfigPath();
  let text = "";
  try {
    text = await readFile(path, "utf8");
  } catch {
    throw new Error(`Config not found: ${path}`);
  }
  const section = `[mcp_servers.${name}]`;
  const lines = text.split(/\r?\n/);
  let inSection = false;
  let found = false;
  let enabledIdx = -1;
  let sectionIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i]!.trim();
    if (t.startsWith("[")) {
      inSection = t === section;
      if (inSection) {
        found = true;
        sectionIdx = i;
      }
      continue;
    }
    if (inSection && /^enabled\s*=/.test(t)) {
      enabledIdx = i;
    }
  }
  if (!found) {
    throw new Error(`MCP server section ${section} not found in ${path}`);
  }
  if (enabledIdx >= 0) {
    lines[enabledIdx] = `enabled = ${enabled}`;
  } else {
    lines.splice(sectionIdx + 1, 0, `enabled = ${enabled}`);
  }
  await writeFile(path, lines.join("\n").replace(/\n{3,}/g, "\n\n"), "utf8");
}

// ── Skills ──────────────────────────────────────────────────────────

function parseSkillFrontmatter(md: string): {
  name?: string;
  description?: string;
} {
  const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return {};
  const body = m[1]!;
  let name: string | undefined;
  let description: string | undefined;
  let descMultiline = false;
  let descBuf: string[] = [];
  for (const line of body.split(/\r?\n/)) {
    if (descMultiline) {
      if (/^\S/.test(line) && !line.startsWith(" ") && !line.startsWith("\t")) {
        description = descBuf.join(" ").trim();
        descMultiline = false;
        descBuf = [];
      } else {
        descBuf.push(line.trim());
        continue;
      }
    }
    const nm = line.match(/^name:\s*(.+)$/);
    if (nm) {
      name = nm[1]!.trim().replace(/^["']|["']$/g, "");
      continue;
    }
    const dm = line.match(/^description:\s*(.*)$/);
    if (dm) {
      const rest = dm[1]!.trim();
      if (rest === ">" || rest === "|" || rest === "") {
        descMultiline = true;
        descBuf = [];
      } else {
        description = rest.replace(/^["']|["']$/g, "");
      }
    }
  }
  if (descMultiline && descBuf.length) {
    description = descBuf.join(" ").trim();
  }
  return { name, description };
}

async function collectSkillsInDir(
  root: string,
  scope: SkillEntry["scope"],
  out: SkillEntry[],
  disabled: Set<string>,
): Promise<void> {
  if (!(await pathExists(root))) return;
  let entries: string[];
  try {
    entries = await readdir(root);
  } catch {
    return;
  }
  for (const ent of entries) {
    if (ent.startsWith(".")) continue;
    const full = join(root, ent);
    let st;
    try {
      st = await stat(full);
    } catch {
      continue;
    }
    if (!st.isDirectory()) continue;
    const skillMd = join(full, "SKILL.md");
    if (!(await pathExists(skillMd))) continue;
    try {
      const text = await readFile(skillMd, "utf8");
      const fm = parseSkillFrontmatter(text);
      const name = (fm.name || ent).trim();
      out.push({
        name,
        description: (fm.description || "").slice(0, 280),
        path: full,
        scope,
        disabled: disabled.has(name),
      });
    } catch {
      // skip unreadable
    }
  }
}

async function readSkillsDisabled(): Promise<Set<string>> {
  const set = new Set<string>();
  try {
    const text = await readFile(userConfigPath(), "utf8");
    let inSkills = false;
    for (const line of text.split(/\r?\n/)) {
      const t = line.trim();
      if (t.startsWith("[")) {
        inSkills = t === "[skills]";
        continue;
      }
      if (!inSkills) continue;
      // disabled = ["a", "b"] or disabled = ["a"]
      const m = t.match(/^disabled\s*=\s*\[(.*)\]\s*(?:#.*)?$/);
      if (m) {
        const inner = m[1]!;
        for (const part of inner.split(",")) {
          const name = part.trim().replace(/^["']|["']$/g, "");
          if (name) set.add(name);
        }
      }
    }
  } catch {
    // no config
  }
  return set;
}

function tomlStringArray(items: string[]): string {
  if (items.length === 0) return "[]";
  return `[${items
    .map((n) => `"${n.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`)
    .join(", ")}]`;
}

/**
 * Upsert a key inside the `[skills]` table of ~/.grok/config.toml.
 * `key` is e.g. `disabled` or `paths`; `values` replaces the array.
 */
async function upsertSkillsTomlArray(
  key: "disabled" | "paths" | "ignore",
  values: string[],
): Promise<void> {
  const path = userConfigPath();
  let text = "";
  try {
    text = await readFile(path, "utf8");
  } catch {
    text = "";
  }
  const line = `${key} = ${tomlStringArray(values)}`;
  const lines = text.length ? text.split(/\r?\n/) : [];
  let inSkills = false;
  let sawSkills = false;
  let keyIdx = -1;
  let skillsHeaderIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i]!.trim();
    if (t.startsWith("[")) {
      inSkills = t === "[skills]";
      if (t === "[skills]") {
        sawSkills = true;
        skillsHeaderIdx = i;
      }
      continue;
    }
    if (inSkills && new RegExp(`^${key}\\s*=`).test(t)) keyIdx = i;
  }
  if (keyIdx >= 0) {
    lines[keyIdx] = line;
  } else if (sawSkills) {
    lines.splice(skillsHeaderIdx + 1, 0, line);
  } else {
    if (lines.length && lines[lines.length - 1] !== "") lines.push("");
    lines.push("[skills]", line);
  }
  await writeFile(
    path,
    lines.join("\n").replace(/\n{3,}/g, "\n\n") +
      (lines[lines.length - 1] === "" ? "" : "\n"),
    "utf8",
  );
}

async function readSkillsPaths(): Promise<string[]> {
  const out: string[] = [];
  try {
    const text = await readFile(userConfigPath(), "utf8");
    let inSkills = false;
    for (const line of text.split(/\r?\n/)) {
      const t = line.trim();
      if (t.startsWith("[")) {
        inSkills = t === "[skills]";
        continue;
      }
      if (!inSkills) continue;
      const m = t.match(/^paths\s*=\s*\[(.*)\]\s*(?:#.*)?$/);
      if (m) {
        for (const part of m[1]!.split(",")) {
          const p = part.trim().replace(/^["']|["']$/g, "");
          if (p) out.push(p);
        }
      }
    }
  } catch {
    // no config
  }
  return out;
}

/**
 * Upsert skill name in `[skills].disabled` array.
 */
export async function setSkillDisabled(
  name: string,
  disabled: boolean,
): Promise<void> {
  const set = await readSkillsDisabled();
  if (disabled) set.add(name);
  else set.delete(name);
  await upsertSkillsTomlArray("disabled", Array.from(set).sort());
}

const SKILLS_SH_API = "https://skills.sh";

/**
 * Search the open skills catalog (skills.sh) — same source as `npx skills find`.
 */
export async function searchSkillCatalog(
  query: string,
): Promise<SkillCatalogEntry[]> {
  const q = query.trim();
  if (!q) return [];
  const url = `${SKILLS_SH_API}/api/search?${new URLSearchParams({ q }).toString()}`;
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    throw new Error(`skills.sh search failed (${res.status})`);
  }
  const raw = (await res.json()) as {
    skills?: Array<Record<string, unknown>>;
  };
  const list = Array.isArray(raw.skills) ? raw.skills : [];
  const out: SkillCatalogEntry[] = [];
  for (const item of list) {
    const skillId = String(item.skillId ?? item.name ?? "").trim();
    const source = String(item.source ?? "").trim();
    if (!skillId || !source) continue;
    const id = String(item.id ?? `${source}/${skillId}`);
    const name = String(item.name ?? skillId);
    const installs =
      typeof item.installs === "number" ? item.installs : undefined;
    out.push({
      id,
      skillId,
      name,
      source,
      installs,
      url: `https://skills.sh/${id.replace(/^\/+/, "")}`,
    });
  }
  return out;
}

/**
 * Install a skill for Grok via the Skills CLI (`npx skills add -a grok`).
 * Global scope → ~/.grok/skills; project → <cwd>/.grok/skills.
 */
export async function installSkillFromRegistry(
  input: InstallSkillInput & { cwd?: string },
): Promise<InstallSkillResult> {
  let source = (input.source || "").trim();
  if (!source) throw new Error("source is required");

  // Allow package form owner/repo@skill
  let skillId = (input.skillId || "").trim();
  const at = source.indexOf("@");
  if (!skillId && at > 0 && !source.startsWith("http")) {
    skillId = source.slice(at + 1).trim();
    source = source.slice(0, at).trim();
  }

  const scope = input.scope === "project" ? "project" : "user";
  const args = ["--yes", "skills", "add", source, "-y", "-a", "grok", "--copy"];
  if (scope === "user") args.push("-g");
  if (skillId) args.push("--skill", skillId);

  const result = await new Promise<{
    stdout: string;
    stderr: string;
    code: number;
  }>((resolvePromise, reject) => {
    const child = spawn("npx", args, {
      cwd: input.cwd || process.cwd(),
      env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
      shell: false,
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("skills install timed out (120s)"));
    }, 120_000);
    child.stdout?.on("data", (d: Buffer) => {
      stdout += d.toString("utf8");
    });
    child.stderr?.on("data", (d: Buffer) => {
      stderr += d.toString("utf8");
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolvePromise({ stdout, stderr, code: code ?? 1 });
    });
  });

  const combined = `${result.stdout}\n${result.stderr}`.trim();
  if (result.code !== 0) {
    const snippet = combined.slice(-800) || `exit ${result.code}`;
    throw new Error(`skills install failed: ${snippet}`);
  }

  const installed: string[] = [];
  // e.g. "✓ vercel-react-best-practices (copied)" or "→ ~/.grok/skills/foo"
  for (const line of combined.split(/\r?\n/)) {
    const m =
      line.match(/[✓✔]\s+([a-zA-Z0-9_.:-]+)\s*\(/) ||
      line.match(/→\s+.*\/skills\/([a-zA-Z0-9_.:-]+)/);
    if (m?.[1] && !installed.includes(m[1])) installed.push(m[1]);
  }
  if (skillId && !installed.includes(skillId)) installed.push(skillId);

  const label = skillId || source;
  const where =
    scope === "user" ? "~/.grok/skills" : ".grok/skills (project)";
  return {
    message: `Installed ${label} → ${where}`,
    installed,
    stdout: combined.slice(0, 4000),
  };
}

/** @deprecated kept for internal path config; not used by catalog install UI */
export async function addSkillPath(
  rawPath: string,
  cwd?: string,
): Promise<{ path: string; message: string }> {
  const trimmed = rawPath.trim();
  if (!trimmed) throw new Error("path is required");

  let expanded = trimmed;
  if (trimmed === "~") {
    expanded = homedir();
  } else if (trimmed.startsWith("~/")) {
    expanded = join(homedir(), trimmed.slice(2));
  } else if (!trimmed.startsWith("/") && !/^[A-Za-z]:[\\/]/.test(trimmed)) {
    expanded = resolve(cwd || process.cwd(), trimmed);
  }

  let resolved = expanded;
  try {
    const { realpath } = await import("node:fs/promises");
    resolved = await realpath(expanded);
  } catch {
    resolved = resolve(expanded);
  }

  const paths = await readSkillsPaths();
  if (!paths.includes(resolved)) {
    paths.push(resolved);
    await upsertSkillsTomlArray("paths", paths);
  }

  return {
    path: resolved,
    message: `Added path ${resolved} to [skills].paths`,
  };
}

export async function listSkills(cwd?: string): Promise<SkillEntry[]> {
  const disabled = await readSkillsDisabled();
  const out: SkillEntry[] = [];
  const seen = new Set<string>();

  const addAll = async (
    roots: { path: string; scope: SkillEntry["scope"] }[],
  ) => {
    for (const r of roots) {
      const batch: SkillEntry[] = [];
      await collectSkillsInDir(r.path, r.scope, batch, disabled);
      for (const s of batch) {
        if (seen.has(s.name)) continue;
        seen.add(s.name);
        out.push(s);
      }
    }
  };

  // Higher priority first so they win dedupe (local > repo > user)
  const roots: { path: string; scope: SkillEntry["scope"] }[] = [];
  if (cwd) {
    roots.push(
      { path: join(cwd, ".grok", "skills"), scope: "local" },
      { path: join(cwd, ".agents", "skills"), scope: "local" },
      { path: join(cwd, ".claude", "skills"), scope: "local" },
      { path: join(cwd, ".cursor", "skills"), scope: "local" },
    );
  }
  roots.push(
    { path: join(grokHome(), "skills"), scope: "user" },
    { path: join(grokHome(), "bundled", "skills"), scope: "bundled" },
    { path: join(homedir(), ".agents", "skills"), scope: "user" },
    { path: join(homedir(), ".claude", "skills"), scope: "user" },
    { path: join(homedir(), ".cursor", "skills"), scope: "user" },
  );
  await addAll(roots);
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

// ── Plugins ─────────────────────────────────────────────────────────

export async function listPlugins(available = false): Promise<PluginEntry[]> {
  const args = ["plugin", "list", "--json"];
  if (available) args.push("--available");
  const out = await runGrokOk(args, {
    timeoutMs: available ? 120_000 : 30_000,
  });
  const raw = JSON.parse(out || "[]") as unknown;
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => {
    const o = item as Record<string, unknown>;
    const status =
      o.status === "available" ? ("available" as const) : ("installed" as const);
    return {
      status,
      name: String(o.name ?? ""),
      version: typeof o.version === "string" ? o.version : undefined,
      path: typeof o.path === "string" ? o.path : undefined,
      source: typeof o.source === "string" ? o.source : undefined,
      marketplace:
        typeof o.marketplace === "string" ? o.marketplace : undefined,
      description:
        typeof o.description === "string" ? o.description : undefined,
      skillCount:
        typeof o.skill_count === "number" ? o.skill_count : undefined,
      hasHooks: Boolean(o.has_hooks),
      hasAgents: Boolean(o.has_agents),
      hasMcp: Boolean(o.has_mcp),
      // Install registry may mark disabled via source or extra fields
      enabled: o.enabled !== false,
    };
  }).filter((p) => p.name);
}

export async function installPlugin(source: string): Promise<void> {
  await runGrokOk(["plugin", "install", source, "--trust"], {
    timeoutMs: 180_000,
  });
}

export async function uninstallPlugin(name: string): Promise<void> {
  await runGrokOk(["plugin", "uninstall", name, "--confirm"], {
    timeoutMs: 60_000,
  });
}

export async function setPluginEnabled(
  name: string,
  enabled: boolean,
): Promise<void> {
  await runGrokOk(["plugin", enabled ? "enable" : "disable", name], {
    timeoutMs: 30_000,
  });
}

// ── Hooks ───────────────────────────────────────────────────────────

async function parseHookFile(
  filePath: string,
  scope: HookEntry["scope"],
): Promise<HookEntry | null> {
  try {
    const text = await readFile(filePath, "utf8");
    const json = JSON.parse(text) as Record<string, unknown>;
    const hooksRoot =
      json.hooks && typeof json.hooks === "object" && !Array.isArray(json.hooks)
        ? (json.hooks as Record<string, unknown>)
        : json;
    const events: string[] = [];
    let commandCount = 0;
    for (const [ev, val] of Object.entries(hooksRoot)) {
      if (ev === "hooks" && typeof val === "object") continue;
      // Claude style: { "PreToolUse": [ { hooks: [...] } ] }
      if (Array.isArray(val)) {
        events.push(ev);
        for (const matcher of val) {
          if (matcher && typeof matcher === "object") {
            const hs = (matcher as { hooks?: unknown }).hooks;
            if (Array.isArray(hs)) commandCount += hs.length;
            else commandCount += 1;
          }
        }
      }
    }
    return {
      name: basename(filePath),
      path: filePath,
      scope,
      events: events.length ? events : ["(unknown)"],
      commandCount: commandCount || undefined,
    };
  } catch {
    return null;
  }
}

async function listHookDir(
  dir: string,
  scope: HookEntry["scope"],
  out: HookEntry[],
): Promise<void> {
  if (!(await pathExists(dir))) return;
  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    return;
  }
  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    const entry = await parseHookFile(join(dir, f), scope);
    if (entry) out.push(entry);
  }
}

export async function listHooks(cwd?: string): Promise<HookEntry[]> {
  const out: HookEntry[] = [];
  await listHookDir(join(grokHome(), "hooks"), "user", out);
  // Claude/Cursor global
  const claudeSettings = join(homedir(), ".claude", "settings.json");
  if (await pathExists(claudeSettings)) {
    const e = await parseHookFile(claudeSettings, "compat");
    if (e) out.push({ ...e, name: "claude settings.json" });
  }
  const cursorHooks = join(homedir(), ".cursor", "hooks.json");
  if (await pathExists(cursorHooks)) {
    const e = await parseHookFile(cursorHooks, "compat");
    if (e) out.push({ ...e, name: "cursor hooks.json" });
  }
  if (cwd) {
    await listHookDir(join(cwd, ".grok", "hooks"), "project", out);
    const projClaude = join(cwd, ".claude", "settings.json");
    if (await pathExists(projClaude)) {
      const e = await parseHookFile(projClaude, "project");
      if (e) out.push({ ...e, name: "project claude settings.json" });
    }
    const projCursor = join(cwd, ".cursor", "hooks.json");
    if (await pathExists(projCursor)) {
      const e = await parseHookFile(projCursor, "project");
      if (e) out.push({ ...e, name: "project cursor hooks.json" });
    }
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

/** Reveal path parent in system file manager is left to shell.openPath if needed. */
export function resolveOpenPath(p: string): string {
  return resolve(p);
}

export async function readHookPreview(filePath: string): Promise<string> {
  const abs = resolve(filePath);
  // Only allow under home or workspace-ish; keep simple home containment
  const home = homedir();
  if (!abs.startsWith(home) && !abs.startsWith("/tmp")) {
    // still allow absolute project paths under /home
  }
  const text = await readFile(abs, "utf8");
  if (text.length > 64_000) return text.slice(0, 64_000) + "\n…";
  return text;
}

export async function getConfigPaths(cwd?: string): Promise<{
  userConfig: string;
  projectConfig?: string;
  skillsUser: string;
  hooksUser: string;
}> {
  return {
    userConfig: userConfigPath(),
    projectConfig: cwd
      ? join(cwd, ".grok", "config.toml")
      : undefined,
    skillsUser: join(grokHome(), "skills"),
    hooksUser: join(grokHome(), "hooks"),
  };
}

// silence unused dirname if tree-shaken
void dirname;
