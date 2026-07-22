import type {
  AvailableCommand,
  ModelInfo,
  SessionModeId,
} from "@shared/types";
import type { Messages } from "./i18n";
import { localizeEffort } from "./i18n";
import {
  DESKTOP_SLASH_MENU,
  type SlashMenuAction,
  type SlashMenuIntentId,
  type SlashMenuModeId,
} from "./slashMenuCatalog";

/** Desktop-local slash commands (not always advertised by the shell). */
export const LOCAL_COMMANDS: AvailableCommand[] = [
  {
    name: "new",
    description: "Start a new session",
  },
  {
    name: "clear",
    description: "Start a new session (alias of /new)",
  },
  {
    name: "model",
    description: "Switch the active model",
    inputHint: "<model> [effort]",
  },
  {
    name: "m",
    description: "Switch the active model (alias of /model)",
    inputHint: "<model> [effort]",
  },
  {
    name: "effort",
    description: "Set reasoning effort for the current model",
    inputHint: "<level>",
  },
  {
    name: "plan",
    description: "Enter plan mode",
    inputHint: "[description]",
  },
  {
    name: "view-plan",
    description: "Open the Plan / TODO panel",
  },
  {
    name: "show-plan",
    description: "Open the Plan / TODO panel (alias of /view-plan)",
  },
  {
    name: "ask",
    description: "Enter ask (read-only) mode",
  },
  {
    name: "agent",
    description: "Enter agent (default) mode",
  },
  {
    name: "always-approve",
    description: "Toggle always-approve (YOLO) mode",
  },
  {
    name: "yolo",
    description: "Toggle always-approve mode (alias of /always-approve)",
  },
  {
    name: "history",
    description: "Search prompt history",
    inputHint: "[filter]",
  },
];

export interface SlashSuggestion {
  name: string;
  description: string;
  inputHint?: string;
  /** Display label e.g. `/compact` */
  display: string;
  source: "local" | "acp";
}

export type SlashMenuSection = "command" | "skill";

/** Localized row for the composer `/` popup. */
export interface SlashMenuItem {
  section: SlashMenuSection;
  name: string;
  title: string;
  description: string;
  action: SlashMenuAction;
  modeId?: SlashMenuModeId;
  intentId?: SlashMenuIntentId;
  inputHint?: string;
  skillScope?: string;
  /** Localized scope badge (user / bundled / …). */
  skillScopeLabel?: string;
  /** Silent agent send (no user bubble) — used for menu compact. */
  hideUserMessage?: boolean;
}

/** Max chars for skill description in the `/` popup (full text still searchable). */
export const SKILL_DESC_DISPLAY_MAX = 100;

function isZhLocale(m?: Messages): boolean {
  return m?.you === "你";
}

function scoreMenuQuery(
  query: string,
  name: string,
  title: string,
  description: string,
): number | null {
  const q = query.toLowerCase();
  if (!q) return 0;
  const n = name.toLowerCase();
  const t = title.toLowerCase();
  const d = description.toLowerCase();
  if (n === q || t === q) return 0;
  if (n.startsWith(q) || t.startsWith(q)) return 1;
  if (n.includes(q) || t.includes(q)) return 2;
  if (d.includes(q)) return 3;
  return null;
}

/** Collapse whitespace and truncate for the slash dropdown. */
export function shortenSlashDescription(
  text: string,
  max = SKILL_DESC_DISPLAY_MAX,
): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
}

/** Bare skill id from a possibly qualified name (`user:commit` → `commit`). */
export function skillBareName(name: string): string {
  if (!name.includes(":")) return name;
  return name.split(":").pop() || name;
}

/** Display title for a skill row: `/check-work`. */
export function skillMenuTitle(name: string): string {
  return `/${skillBareName(name)}`;
}

/** Localized short label for skill scope (user, bundled, …). */
export function skillScopeLabel(
  scope: string | undefined,
  zh: boolean,
): string | undefined {
  if (!scope) return undefined;
  const s = scope.toLowerCase();
  if (zh) {
    const map: Record<string, string> = {
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

/** Whether an ACP catalog entry is a user-invocable skill (not a builtin/workflow). */
export function isSkillCommand(c: AvailableCommand): boolean {
  if (c.skillPath || c.skillScope) return true;
  // Qualified skill names survive even when _meta is stripped.
  if (/^(local|repo|user|server|bundled|plugin):/i.test(c.name)) return true;
  return false;
}

/**
 * Build the desktop `/` menu: whitelist commands + ACP skills, localized.
 * Aliases and non-whitelisted shell/TUI commands are omitted (hand-type still works).
 */
export function filterSlashMenu(
  acp: AvailableCommand[],
  query: string,
  m?: Messages,
  limit = 50,
): SlashMenuItem[] {
  const zh = isZhLocale(m);
  const acpByName = new Map<string, AvailableCommand>();
  for (const c of acp) {
    acpByName.set(c.name.toLowerCase(), c);
  }

  const commands: { item: SlashMenuItem; score: number }[] = [];
  for (const def of DESKTOP_SLASH_MENU) {
    if (def.requireAcp && !acpByName.has(def.name.toLowerCase())) {
      continue;
    }
    const title = zh ? def.titleZh : def.titleEn;
    const description = zh ? def.descZh : def.descEn;
    const score = scoreMenuQuery(query, def.name, title, description);
    if (score === null) continue;
    const acpCmd = acpByName.get(def.name.toLowerCase());
    commands.push({
      score,
      item: {
        section: "command",
        name: def.name,
        title,
        description,
        action: def.action,
        modeId: def.modeId,
        intentId: def.intentId,
        inputHint: acpCmd?.inputHint,
        hideUserMessage: def.action === "execute" && def.name === "compact",
      },
    });
  }
  commands.sort((a, b) => {
    if (a.score !== b.score) return a.score - b.score;
    return a.item.name.localeCompare(b.item.name);
  });

  const skills: { item: SlashMenuItem; score: number }[] = [];
  for (const c of acp) {
    if (!isSkillCommand(c)) continue;
    const name = c.name;
    const title = skillMenuTitle(name);
    const fullDesc = c.description || "";
    const description = shortenSlashDescription(fullDesc);
    // Score against full description so long Chinese trigger phrases still match.
    const score = scoreMenuQuery(query, name, title, fullDesc);
    if (score === null) continue;
    const scope =
      c.skillScope ||
      (name.includes(":") ? name.split(":")[0]?.toLowerCase() : undefined);
    skills.push({
      score,
      item: {
        section: "skill",
        name,
        title,
        description,
        action: "fill",
        inputHint: c.inputHint,
        skillScope: scope,
        skillScopeLabel: skillScopeLabel(scope, zh),
      },
    });
  }
  skills.sort((a, b) => {
    if (a.score !== b.score) return a.score - b.score;
    return a.item.name.localeCompare(b.item.name);
  });

  const half = Math.max(8, Math.floor(limit / 2));
  return [
    ...commands.slice(0, half).map((x) => x.item),
    ...skills.slice(0, half).map((x) => x.item),
  ].slice(0, limit);
}

export interface ParsedSlash {
  /** Command name without leading slash (lowercase). */
  name: string;
  /** Remainder after first whitespace (raw). */
  args: string;
  /** True when the buffer is only `/name` or `/name …` (slash at start). */
  isSlash: boolean;
}

/** Parse a full-line slash invocation: `/cmd args…` */
export function parseSlashLine(text: string): ParsedSlash | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) return null;
  const body = trimmed.slice(1);
  if (!body) {
    return { name: "", args: "", isSlash: true };
  }
  const m = body.match(/^(\S+)(?:\s+([\s\S]*))?$/);
  if (!m) return { name: "", args: "", isSlash: true };
  return {
    name: (m[1] ?? "").toLowerCase(),
    args: (m[2] ?? "").trimEnd(),
    isSlash: true,
  };
}

/**
 * Whether the composer should show slash autocomplete.
 * Active when the entire draft is a slash command being typed (leading `/`,
 * no newline).
 */
export function isSlashCompose(text: string, cursor: number): boolean {
  if (!text.startsWith("/")) return false;
  if (text.includes("\n")) return false;
  // Only while cursor is in the command-name segment (before first space)
  // or at the end of a bare `/` / `/pre`.
  const before = text.slice(0, cursor);
  if (before.includes(" ") || before.includes("\t")) return false;
  return true;
}

/** Query string for filtering command names (without leading `/`). */
export function slashNameQuery(text: string, cursor: number): string {
  if (!text.startsWith("/")) return "";
  const before = text.slice(0, cursor);
  return before.slice(1).toLowerCase();
}

export function mergeCommands(
  acp: AvailableCommand[],
): AvailableCommand[] {
  const byName = new Map<string, AvailableCommand>();
  for (const c of LOCAL_COMMANDS) {
    byName.set(c.name.toLowerCase(), { ...c });
  }
  for (const c of acp) {
    const key = c.name.toLowerCase();
    const existing = byName.get(key);
    if (!existing) {
      byName.set(key, { ...c });
      continue;
    }
    // Merge: keep local inputHint if ACP omits it; prefer non-empty descriptions.
    byName.set(key, {
      name: c.name || existing.name,
      description: c.description || existing.description,
      inputHint: c.inputHint ?? existing.inputHint,
      skillPath: c.skillPath ?? existing.skillPath,
      skillScope: c.skillScope ?? existing.skillScope,
    });
  }
  return Array.from(byName.values());
}

export function filterSlashSuggestions(
  acp: AvailableCommand[],
  query: string,
  limit = 40,
): SlashSuggestion[] {
  const all = mergeCommands(acp);
  const q = query.toLowerCase();
  const localNames = new Set(LOCAL_COMMANDS.map((c) => c.name.toLowerCase()));

  const scored: { cmd: AvailableCommand; score: number }[] = [];
  for (const cmd of all) {
    const name = cmd.name.toLowerCase();
    if (!q) {
      scored.push({ cmd, score: 0 });
      continue;
    }
    if (name === q) {
      scored.push({ cmd, score: 0 });
    } else if (name.startsWith(q)) {
      scored.push({ cmd, score: 1 });
    } else if (name.includes(q)) {
      scored.push({ cmd, score: 2 });
    } else if (cmd.description.toLowerCase().includes(q)) {
      scored.push({ cmd, score: 3 });
    }
  }
  scored.sort((a, b) => {
    if (a.score !== b.score) return a.score - b.score;
    return a.cmd.name.localeCompare(b.cmd.name);
  });

  return scored.slice(0, limit).map(({ cmd }) => ({
    name: cmd.name,
    description: cmd.description,
    inputHint: cmd.inputHint,
    display: `/${cmd.name}`,
    source: localNames.has(cmd.name.toLowerCase()) ? "local" : "acp",
  }));
}

/** Insert `/name` or `/name ` at the start of the draft (replacing slash token). */
export function completeSlashName(
  text: string,
  suggestion: SlashSuggestion,
): string {
  const takesArgs = Boolean(suggestion.inputHint);
  const insert = takesArgs ? `/${suggestion.name} ` : `/${suggestion.name}`;
  // Replace from leading `/` through the first space or end of first token
  const rest = text.includes(" ")
    ? text.slice(text.indexOf(" "))
    : "";
  if (takesArgs) {
    return rest.trim() ? `/${suggestion.name}${rest}` : insert;
  }
  return insert;
}

export type LocalSlashResult =
  | { kind: "handled"; message?: string }
  | { kind: "send"; text: string }
  | { kind: "error"; message: string }
  | { kind: "passthrough" }
  /** Open the prompt-history search UI (optional filter from args). */
  | { kind: "open_history"; filter?: string }
  /** Open the Plan / TODO right panel. */
  | { kind: "open_plan" };

export interface LocalSlashContext {
  models: ModelInfo[];
  modelId?: string;
  workspace?: string;
  alwaysApprove?: boolean;
  /** Localized messages used for slash command toasts / errors. */
  m?: Messages;
  newSession: (workspace: string) => Promise<void>;
  /** Empty chat without workspace (user must pick one). */
  prepareNewChat?: () => Promise<void>;
  setModel: (modelId: string, effort?: string) => Promise<void>;
  setMode: (modeId: SessionModeId) => Promise<void>;
  setAlwaysApprove: (enabled: boolean) => Promise<void>;
  pickFolder: () => Promise<string | null>;
}

const FALLBACK_M: Pick<Messages, "you" | "grok"> = {
  you: "You",
  grok: "Grok",
};

function t(
  ctx: LocalSlashContext,
  zh: (m: Messages) => string,
  en: (m: Messages) => string,
): string {
  const m = ctx.m ?? (FALLBACK_M as Messages);
  return m.you === "你" ? zh(m) : en(m);
}

function resolveModel(
  models: ModelInfo[],
  token: string,
): ModelInfo | undefined {
  const t = token.trim().toLowerCase();
  if (!t) return undefined;
  const exactId = models.find((m) => m.modelId.toLowerCase() === t);
  if (exactId) return exactId;
  const exactName = models.find((m) => m.name.toLowerCase() === t);
  if (exactName) return exactName;
  const startsId = models.find((m) => m.modelId.toLowerCase().startsWith(t));
  if (startsId) return startsId;
  const startsName = models.find((m) => m.name.toLowerCase().startsWith(t));
  if (startsName) return startsName;
  const includes = models.find(
    (m) =>
      m.name.toLowerCase().includes(t) || m.modelId.toLowerCase().includes(t),
  );
  return includes;
}

/**
 * Handle desktop-local slash commands. ACP/shell commands return `passthrough`
 * so the caller can send them as a normal prompt (`/compact`, skills, …).
 */
export async function tryHandleLocalSlash(
  text: string,
  ctx: LocalSlashContext,
): Promise<LocalSlashResult> {
  const parsed = parseSlashLine(text);
  if (!parsed || !parsed.name) return { kind: "passthrough" };

  const name = parsed.name;
  const args = parsed.args.trim();

  if (name === "history") {
    return { kind: "open_history", filter: args || undefined };
  }

  if (name === "new" || name === "clear") {
    if (ctx.prepareNewChat) {
      await ctx.prepareNewChat();
      return {
        kind: "handled",
        message: t(
          ctx,
          (mm) => "新会话就绪 — 请选择工作区后开始。",
          () => "New chat ready — choose a workspace to start.",
        ),
      };
    }
    const folder = ctx.workspace || (await ctx.pickFolder());
    if (!folder) {
      return {
        kind: "error",
        message: t(
          ctx,
          (mm) => "请选择工作区后再开始新会话。",
          () => "Choose a workspace to start a new session.",
        ),
      };
    }
    await ctx.newSession(folder);
    return {
      kind: "handled",
      message: t(
        ctx,
        (mm) => "已开启新会话。",
        () => "Started a new session.",
      ),
    };
  }

  if (name === "model" || name === "m") {
    if (!args) {
      return {
        kind: "error",
        message: t(
          ctx,
          (mm) => "用法：/model <名称> [推理力度]",
          () => "Usage: /model <name> [effort]",
        ),
      };
    }
    // Prefer full-string match (display names may contain spaces).
    let model = resolveModel(ctx.models, args);
    let effort: string | undefined;
    if (!model) {
      const parts = args.split(/\s+/);
      if (parts.length >= 2) {
        const maybeEffort = parts[parts.length - 1]!;
        const modelPart = parts.slice(0, -1).join(" ");
        model = resolveModel(ctx.models, modelPart);
        if (model) effort = maybeEffort;
      }
    }
    if (!model) {
      return {
        kind: "error",
        message: t(
          ctx,
          (mm) => `未找到模型：${args}`,
          () => `Unknown model: ${args}`,
        ),
      };
    }
    if (
      effort &&
      model.supportsReasoningEffort &&
      model.reasoningEfforts?.length
    ) {
      const ok = model.reasoningEfforts.some(
        (e) => e.id.toLowerCase() === effort!.toLowerCase(),
      );
      if (!ok) {
        return {
          kind: "error",
          message: t(
            ctx,
            (mm) => `${model!.name} 不支持推理力度：${effort}`,
            () => `Unknown effort for ${model!.name}: ${effort}`,
          ),
        };
      }
    } else if (effort && !model.supportsReasoningEffort) {
      effort = undefined;
    }
    await ctx.setModel(model.modelId, effort);
    return {
      kind: "handled",
      message: effort
        ? `Model set to ${model.name} (${effort}).`
        : `Model set to ${model.name}.`,
    };
  }

  if (name === "effort") {
    if (!args) {
      return {
        kind: "error",
        message: t(
          ctx,
          (mm) => "用法：/effort <力度>",
          () => "Usage: /effort <level>",
        ),
      };
    }
    const model = ctx.models.find((m) => m.modelId === ctx.modelId);
    if (!model) {
      return {
        kind: "error",
        message: t(
          ctx,
          (mm) => "当前没有激活的模型。",
          () => "No active model.",
        ),
      };
    }
    if (!model.supportsReasoningEffort) {
      return {
        kind: "error",
        message: t(
          ctx,
          (mm) => `${model.name} 不支持推理力度。`,
          () => `${model.name} does not support reasoning effort.`,
        ),
      };
    }
    const level = args.split(/\s+/)[0]!;
    const ok = model.reasoningEfforts?.some(
      (e) => e.id.toLowerCase() === level.toLowerCase(),
    );
    if (!ok) {
      const opts =
        model.reasoningEfforts
          ?.map((e) => localizeEffort(e.id, ctx.m ?? (FALLBACK_M as Messages)))
          .join("、") || (ctx.m ? ctx.m.effortOff : "none");
      return {
        kind: "error",
        message: t(
          ctx,
          (mm) => `未知的推理力度「${level}」。可选：${opts}`,
          () => `Unknown effort "${level}". Options: ${opts}`,
        ),
      };
    }
    await ctx.setModel(model.modelId, level);
    const label = localizeEffort(level, ctx.m ?? (FALLBACK_M as Messages));
    return {
      kind: "handled",
      message: t(
        ctx,
        (mm) => `已设置推理力度：${label}`,
        () => `Reasoning effort set to ${label}.`,
      ),
    };
  }

  if (name === "plan") {
    await ctx.setMode("plan");
    if (args) {
      return { kind: "send", text: args };
    }
    return {
      kind: "handled",
      message: t(
        ctx,
        (mm) => "已切换到计划模式。",
        () => "Switched to plan mode.",
      ),
    };
  }

  if (name === "view-plan" || name === "show-plan" || name === "plan-view") {
    return { kind: "open_plan" };
  }

  if (name === "ask") {
    await ctx.setMode("ask");
    return {
      kind: "handled",
      message: t(
        ctx,
        (mm) => "已切换到问答模式。",
        () => "Switched to ask mode.",
      ),
    };
  }

  if (name === "agent" || name === "default") {
    await ctx.setMode("default");
    return {
      kind: "handled",
      message: t(
        ctx,
        (mm) => "已切换到 Agent 模式。",
        () => "Switched to agent mode.",
      ),
    };
  }

  if (name === "always-approve" || name === "yolo") {
    const arg = args.split(/\s+/)[0]?.toLowerCase() ?? "";
    let next: boolean;
    if (arg === "on" || arg === "true" || arg === "1" || arg === "enable") {
      next = true;
    } else if (
      arg === "off" ||
      arg === "false" ||
      arg === "0" ||
      arg === "disable"
    ) {
      next = false;
    } else if (!arg) {
      next = !ctx.alwaysApprove;
    } else {
      return {
        kind: "error",
        message: t(
          ctx,
          (mm) => "用法：/always-approve [on|off]",
          () => "Usage: /always-approve [on|off]",
        ),
      };
    }
    await ctx.setAlwaysApprove(next);
    return {
      kind: "handled",
      message: t(
        ctx,
        (mm) =>
          next
            ? "已开启始终批准 — 工具无需确认即可运行。"
            : "已关闭始终批准 — 工具每次都会请求授权。",
        () =>
          next
            ? "Always-approve enabled — tools run without prompts."
            : "Always-approve disabled — tools will ask for permission.",
      ),
    };
  }

  // Known local aliases already handled; everything else (including shell
  // builtins and skills) goes through as a prompt starting with `/`.
  return { kind: "passthrough" };
}
