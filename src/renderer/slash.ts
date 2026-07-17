import type {
  AvailableCommand,
  ModelInfo,
  SessionModeId,
} from "@shared/types";

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
  | { kind: "open_history"; filter?: string };

export interface LocalSlashContext {
  models: ModelInfo[];
  modelId?: string;
  workspace?: string;
  alwaysApprove?: boolean;
  newSession: (workspace: string) => Promise<void>;
  /** Empty chat without workspace (user must pick one). */
  prepareNewChat?: () => Promise<void>;
  setModel: (modelId: string, effort?: string) => Promise<void>;
  setMode: (modeId: SessionModeId) => Promise<void>;
  setAlwaysApprove: (enabled: boolean) => Promise<void>;
  pickFolder: () => Promise<string | null>;
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
        message: "New chat ready — choose a workspace to start.",
      };
    }
    const folder = ctx.workspace || (await ctx.pickFolder());
    if (!folder) {
      return { kind: "error", message: "Choose a workspace to start a new session." };
    }
    await ctx.newSession(folder);
    return { kind: "handled", message: "Started a new session." };
  }

  if (name === "model" || name === "m") {
    if (!args) {
      return {
        kind: "error",
        message: "Usage: /model <name> [effort]",
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
        message: `Unknown model: ${args}`,
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
          message: `Unknown effort for ${model.name}: ${effort}`,
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
      return { kind: "error", message: "Usage: /effort <level>" };
    }
    const model = ctx.models.find((m) => m.modelId === ctx.modelId);
    if (!model) {
      return { kind: "error", message: "No active model." };
    }
    if (!model.supportsReasoningEffort) {
      return {
        kind: "error",
        message: `${model.name} does not support reasoning effort.`,
      };
    }
    const level = args.split(/\s+/)[0]!;
    const ok = model.reasoningEfforts?.some(
      (e) => e.id.toLowerCase() === level.toLowerCase(),
    );
    if (!ok) {
      const opts =
        model.reasoningEfforts?.map((e) => e.id).join(", ") || "none";
      return {
        kind: "error",
        message: `Unknown effort "${level}". Options: ${opts}`,
      };
    }
    await ctx.setModel(model.modelId, level);
    return { kind: "handled", message: `Reasoning effort set to ${level}.` };
  }

  if (name === "plan") {
    await ctx.setMode("plan");
    if (args) {
      return { kind: "send", text: args };
    }
    return { kind: "handled", message: "Switched to plan mode." };
  }

  if (name === "ask") {
    await ctx.setMode("ask");
    return { kind: "handled", message: "Switched to ask mode." };
  }

  if (name === "agent" || name === "default") {
    await ctx.setMode("default");
    return { kind: "handled", message: "Switched to agent mode." };
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
        message: "Usage: /always-approve [on|off]",
      };
    }
    await ctx.setAlwaysApprove(next);
    return {
      kind: "handled",
      message: next
        ? "Always-approve enabled — tools run without prompts."
        : "Always-approve disabled — tools will ask for permission.",
    };
  }

  // Known local aliases already handled; everything else (including shell
  // builtins and skills) goes through as a prompt starting with `/`.
  return { kind: "passthrough" };
}
