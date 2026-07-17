import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { randomBytes } from "node:crypto";
import { access } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { basename, relative, isAbsolute, join, resolve } from "node:path";
import { homedir } from "node:os";
import { readdir, stat } from "node:fs/promises";
import { AcpClient, type JsonValue } from "../shared/acp-client";
import {
  readAlwaysApproveFromConfig,
  writeAlwaysApproveToConfig,
} from "./config-permission";
import type {
  AgentUiEvent,
  AppSnapshot,
  AvailableCommand,
  ConnectionState,
  ForkSessionResult,
  ModelInfo,
  PathSuggestion,
  PermissionOptionUi,
  PermissionRequestUi,
  PromptAttachment,
  PromptPayload,
  SearchSessionsOptions,
  SessionModeId,
  SessionRunStatus,
  SessionSearchHit,
  SessionSummary,
  TimelineItem,
  ToolDiff,
  UsageInfo,
} from "../shared/types";

const DEFAULT_USAGE_MANAGE_URL = "https://grok.com/?_s=usage";
/** Poll coding credits while agent is ready (matches CLI ~1 min cadence loosely). */
const USAGE_POLL_MS = 60_000;

/** Cap tool text output stored in timeline (agent already caps; UI safety). */
const MAX_TOOL_OUTPUT_CHARS = 80_000;

/** Wire option id for global always-approve (YOLO) mode. */
const ENABLE_ALWAYS_APPROVE_OPTION_ID = "enable-always-approve";

interface PendingPermissionEntry {
  ui: PermissionRequestUi;
  /** Session that owns this permission prompt (for concurrent multi-session). */
  sessionId?: string;
  resolve: (result: JsonValue) => void;
}

/**
 * Parked / live state for one ACP session so multiple sessions can run turns
 * concurrently while the UI focuses one at a time.
 */
interface SessionRuntime {
  sessionId: string;
  cwd: string;
  title: string;
  timeline: TimelineItem[];
  busy: boolean;
  replaying: boolean;
  compacting: boolean;
  compactTimelineId: string | null;
  streamingAssistantId: string | null;
  streamingThoughtId: string | null;
  tokensUsed?: number;
  contextWindow?: number;
  modelId?: string;
  sessionMode: SessionModeId;
  reasoningEffort?: string;
  availableModels: ModelInfo[];
  toolIndex: Map<string, string>;
  /** True once session/new or session/load finished (or prompt started). */
  hydrated: boolean;
}

function emptyRuntime(sessionId: string, cwd: string): SessionRuntime {
  return {
    sessionId,
    cwd,
    title: "New session",
    timeline: [],
    busy: false,
    replaying: false,
    compacting: false,
    compactTimelineId: null,
    streamingAssistantId: null,
    streamingThoughtId: null,
    sessionMode: "default",
    availableModels: [],
    toolIndex: new Map(),
    hydrated: false,
  };
}

function asRecord(v: JsonValue | undefined): Record<string, JsonValue> | null {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    return v as Record<string, JsonValue>;
  }
  return null;
}

function centVal(v: JsonValue | undefined): number | undefined {
  const rec = asRecord(v);
  if (!rec) return undefined;
  const n = rec.val;
  return typeof n === "number" && Number.isFinite(n) ? n : 0;
}

function formatUsdFromCents(cents: number): string {
  const dollars = Math.abs(cents) / 100;
  if (Number.isInteger(dollars)) return `$${dollars.toFixed(0)}`;
  return `$${dollars.toFixed(2)}`;
}

function formatPeriodEnd(iso: string | undefined): string | undefined {
  if (!iso) return undefined;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return undefined;
  try {
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return d.toISOString();
  }
}

function usageLabelFromPeriodType(periodType?: string): string {
  if (!periodType) return "Usage";
  if (periodType.includes("WEEKLY")) return "Weekly limit";
  if (periodType.includes("MONTHLY")) return "Monthly limit";
  return "Usage";
}

/** Map `x.ai/billing` response into UI-friendly UsageInfo. */
function parseBillingUsage(raw: JsonValue): UsageInfo {
  const root = asRecord(raw) ?? {};
  // Some wires wrap as { result: {...} }
  const body = asRecord(root.result as JsonValue) ?? root;
  const config = asRecord(body.config as JsonValue);
  const subscriptionTier =
    asString(body.subscriptionTier as JsonValue) ||
    asString(body.subscription_tier as JsonValue) ||
    undefined;

  let usagePct = 0;
  let periodEndDisplay: string | undefined;
  let periodType: string | undefined;
  let prepaidCents: number | undefined;
  let onDemandCapCents: number | undefined;
  let onDemandUsedCents: number | undefined;
  let payAsYouGo = false;

  if (config) {
    const creditPct = asNumber(config.creditUsagePercent as JsonValue);
    const monthlyLimit = centVal(config.monthlyLimit as JsonValue);
    const used = centVal(config.used as JsonValue) ?? 0;
    if (creditPct !== undefined) {
      usagePct = Math.min(100, Math.max(0, creditPct));
    } else if (monthlyLimit && monthlyLimit > 0) {
      usagePct = Math.min(100, (used / monthlyLimit) * 100);
    }

    const currentPeriod = asRecord(config.currentPeriod as JsonValue);
    periodType =
      asString(currentPeriod?.type as JsonValue) ||
      asString(currentPeriod?.periodType as JsonValue) ||
      undefined;
    const periodEnd =
      asString(currentPeriod?.end as JsonValue) ||
      asString(config.billingPeriodEnd as JsonValue) ||
      asString(config.billing_period_end as JsonValue);
    periodEndDisplay = formatPeriodEnd(periodEnd);

    prepaidCents = centVal(config.prepaidBalance as JsonValue);
    const cap = centVal(config.onDemandCap as JsonValue) ?? 0;
    payAsYouGo = cap > 0;
    onDemandCapCents = cap > 0 ? cap : undefined;
    onDemandUsedCents =
      centVal(config.onDemandUsed as JsonValue) ??
      (monthlyLimit !== undefined
        ? Math.max(0, used - monthlyLimit)
        : undefined);
  }

  const usageLabel = usageLabelFromPeriodType(periodType);
  const usageFloor = Math.floor(usagePct);
  const usageShort = `${usageFloor}%`;

  const summaryLines: string[] = [`${usageLabel}: ${usageFloor}%`];
  if (periodEndDisplay) {
    summaryLines.push(`Next reset: ${periodEndDisplay}`);
  }

  let prepaidUsd: number | undefined;
  if (prepaidCents !== undefined && Math.abs(prepaidCents) > 0) {
    prepaidUsd = Math.abs(prepaidCents) / 100;
    summaryLines.push("");
    summaryLines.push(`Credits: ${formatUsdFromCents(prepaidCents)}`);
  }

  let onDemandUsedUsd: number | undefined;
  let onDemandCapUsd: number | undefined;
  if (payAsYouGo && onDemandCapCents !== undefined) {
    onDemandUsedUsd = Math.abs(onDemandUsedCents ?? 0) / 100;
    onDemandCapUsd = Math.abs(onDemandCapCents) / 100;
    summaryLines.push("");
    summaryLines.push(
      `Pay-as-you-go: $${onDemandUsedUsd.toFixed(2)} used of $${onDemandCapUsd.toFixed(2)} limit`,
    );
  }

  return {
    usagePct,
    usageLabel,
    usageShort,
    periodEndDisplay,
    subscriptionTier,
    prepaidUsd,
    payAsYouGo: payAsYouGo || undefined,
    onDemandUsedUsd,
    onDemandCapUsd,
    summaryLines,
    manageUrl: DEFAULT_USAGE_MANAGE_URL,
    fetchedAt: new Date().toISOString(),
  };
}

function mergeAutoTopup(usage: UsageInfo, raw: JsonValue): UsageInfo {
  const root = asRecord(raw) ?? {};
  const body = asRecord(root.result as JsonValue) ?? root;
  const rule = asRecord(body.rule as JsonValue);
  if (!rule) {
    return {
      ...usage,
      autoTopupEnabled: false,
      summaryLines: withAutoTopupLines(usage, false),
    };
  }
  const enabled = rule.enabled === true;
  const topup = centVal(rule.topupAmount as JsonValue);
  const max = centVal(rule.maxAmountPerMonth as JsonValue);
  const next: UsageInfo = {
    ...usage,
    autoTopupEnabled: enabled,
    autoTopupAmountUsd:
      topup !== undefined ? Math.abs(topup) / 100 : undefined,
    autoTopupMaxUsd: max !== undefined ? Math.abs(max) / 100 : undefined,
  };
  next.summaryLines = withAutoTopupLines(
    next,
    enabled,
    topup,
    max,
  );
  return next;
}

function withAutoTopupLines(
  usage: UsageInfo,
  enabled: boolean,
  topupCents?: number,
  maxCents?: number,
): string[] {
  // Rebuild credits block with auto top-up when prepaid exists.
  if (usage.prepaidUsd === undefined || usage.prepaidUsd <= 0) {
    return usage.summaryLines;
  }
  const lines = usage.summaryLines.filter(
    (l) =>
      !l.startsWith("Auto topup:") &&
      !l.startsWith("Max monthly topup:") &&
      l !== "Auto topup: disabled",
  );
  const creditsIdx = lines.findIndex((l) => l.startsWith("Credits:"));
  if (creditsIdx < 0) return lines;
  const insert: string[] = [];
  if (enabled && topupCents !== undefined) {
    insert.push(`Auto topup: ${formatUsdFromCents(topupCents)}`);
    if (maxCents !== undefined) {
      insert.push(`Max monthly topup: ${formatUsdFromCents(maxCents)}`);
    }
  } else {
    insert.push("Auto topup: disabled");
  }
  lines.splice(creditsIdx + 1, 0, ...insert);
  return lines;
}

function asString(v: JsonValue | undefined): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function asNumber(v: JsonValue | undefined): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, fsConstants.X_OK);
    return true;
  } catch {
    try {
      await access(path, fsConstants.F_OK);
      return true;
    } catch {
      return false;
    }
  }
}

export async function resolveGrokBinary(): Promise<string> {
  const envPath = process.env.GROK_BINARY;
  if (envPath && (await pathExists(envPath))) {
    return envPath;
  }

  const candidates = [
    join(homedir(), ".grok", "bin", "grok"),
    "/usr/local/bin/grok",
    "/usr/bin/grok",
  ];

  if (process.resourcesPath) {
    candidates.unshift(join(process.resourcesPath, "bin", "grok"));
  }

  for (const c of candidates) {
    if (await pathExists(c)) return c;
  }

  return "grok";
}

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        server.close();
        reject(new Error("Failed to allocate free port"));
        return;
      }
      const port = addr.port;
      server.close((err) => {
        if (err) reject(err);
        else resolve(port);
      });
    });
    server.on("error", reject);
  });
}

function newId(prefix: string): string {
  return `${prefix}-${randomBytes(4).toString("hex")}`;
}

/**
 * Parse ACP `ToolCallContent[]` into diffs + concatenated text output.
 * Wire shapes:
 *   { type: "diff", path, oldText?, newText }
 *   { type: "content", content: { type: "text", text } }
 *   { type: "terminal", terminalId } — ignored for display here
 */
function parseToolContent(raw: JsonValue | undefined): {
  diffs: ToolDiff[];
  outputText?: string;
  outputTruncated?: boolean;
} {
  if (!Array.isArray(raw)) {
    return { diffs: [] };
  }

  const diffs: ToolDiff[] = [];
  const textParts: string[] = [];

  for (const item of raw) {
    const rec = asRecord(item as JsonValue);
    if (!rec) continue;
    const type = asString(rec.type);

    if (type === "diff") {
      const path =
        asString(rec.path) ?? asString(rec.filePath) ?? asString(rec.file_path);
      const newText =
        asString(rec.newText) ??
        asString(rec.new_text) ??
        asString(rec.new);
      if (!path || newText === undefined) continue;
      const oldText =
        asString(rec.oldText) ??
        asString(rec.old_text) ??
        asString(rec.old);
      diffs.push({
        path,
        newText,
        ...(oldText !== undefined ? { oldText } : {}),
      });
      continue;
    }

    if (type === "content" || type === "text") {
      // Nested: { type: "content", content: { type: "text", text } }
      // Flat fallback: { type: "text", text }
      const nested = asRecord(rec.content as JsonValue);
      const text =
        asString(nested?.text) ??
        asString(rec.text) ??
        (typeof rec.content === "string" ? rec.content : undefined);
      if (text) textParts.push(text);
      continue;
    }

    // Some agents may omit type and send a ContentBlock-like object.
    if (!type && typeof rec.text === "string") {
      textParts.push(rec.text);
    }
  }

  let outputText = textParts.length > 0 ? textParts.join("\n") : undefined;
  let outputTruncated = false;
  if (outputText && outputText.length > MAX_TOOL_OUTPUT_CHARS) {
    outputText =
      outputText.slice(0, MAX_TOOL_OUTPUT_CHARS) +
      "\n… [truncated]";
    outputTruncated = true;
  }

  return { diffs, outputText, outputTruncated };
}

/** Fields from tool_call / tool_call_update content that go on the timeline item. */
function toolContentFields(update: Record<string, JsonValue>): {
  diffs?: ToolDiff[];
  outputText?: string;
  outputTruncated?: boolean;
  hasContent: boolean;
} {
  const contentVal = update.content;
  if (contentVal === undefined || contentVal === null) {
    return { hasContent: false };
  }
  const parsed = parseToolContent(contentVal as JsonValue);
  return {
    hasContent: true,
    diffs: parsed.diffs.length > 0 ? parsed.diffs : undefined,
    outputText: parsed.outputText,
    outputTruncated: parsed.outputTruncated,
  };
}

function projectName(cwd: string): string {
  const base = basename(cwd.replace(/[/\\]+$/, "") || cwd);
  return base || cwd;
}

function parseAvailableCommands(
  val: JsonValue | undefined,
): AvailableCommand[] {
  if (!Array.isArray(val)) return [];
  const out: AvailableCommand[] = [];
  for (const item of val) {
    const rec = asRecord(item as JsonValue);
    if (!rec) continue;
    const name = asString(rec.name)?.trim();
    if (!name) continue;
    const description = asString(rec.description) ?? "";
    let inputHint: string | undefined;
    const input = rec.input;
    if (typeof input === "string" && input.trim()) {
      inputHint = input.trim();
    } else {
      const ir = asRecord(input as JsonValue | undefined);
      if (ir) {
        inputHint =
          asString(ir.hint)?.trim() ||
          asString(asRecord(ir.unstructured as JsonValue)?.hint)?.trim() ||
          undefined;
        // ACP UnstructuredCommandInput may serialize as { type, hint } or bare hint
        if (!inputHint) {
          const nested = asRecord(ir.input as JsonValue);
          inputHint = asString(nested?.hint)?.trim() || undefined;
        }
      }
    }
    const meta =
      asRecord(rec._meta as JsonValue) ?? asRecord(rec.meta as JsonValue);
    out.push({
      name,
      description,
      inputHint,
      skillPath: asString(meta?.path),
      skillScope: asString(meta?.scope),
    });
  }
  return out;
}

function titleFromSummary(s: Record<string, JsonValue>): string {
  const title =
    asString(s.title) ||
    asString(s.session_summary) ||
    asString(s.sessionSummary) ||
    "";
  if (title.trim()) return title.trim();
  return "New session";
}

function parseModels(modelsVal: JsonValue | undefined): {
  current?: string;
  available: ModelInfo[];
} {
  const models = asRecord(modelsVal);
  if (!models) return { available: [] };
  const current = asString(models.currentModelId);
  const rawList = Array.isArray(models.availableModels)
    ? models.availableModels
    : [];
  const available: ModelInfo[] = [];
  for (const item of rawList) {
    const rec = asRecord(item as JsonValue);
    if (!rec) continue;
    const modelId = asString(rec.modelId);
    if (!modelId) continue;
    const meta = asRecord(rec._meta);
    const effortsRaw = Array.isArray(meta?.reasoningEfforts)
      ? meta!.reasoningEfforts
      : [];
    const reasoningEfforts = effortsRaw
      .map((e) => {
        const o = asRecord(e as JsonValue);
        if (!o) return null;
        const id = asString(o.id) ?? asString(o.value);
        if (!id) return null;
        return {
          id,
          label: asString(o.label) ?? id,
          description: asString(o.description),
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    const modalities = Array.isArray(meta?.inputModalities)
      ? meta!.inputModalities
      : [];
    const acceptsImages =
      modalities.length === 0
        ? true
        : modalities.some(
            (m) =>
              typeof m === "string" && m.toLowerCase() === "image",
          );

    const contextWindow =
      asNumber(meta?.totalContextTokens) ??
      asNumber(meta?.total_context_tokens) ??
      asNumber(meta?.contextWindow) ??
      asNumber(meta?.context_window);

    available.push({
      modelId,
      name: asString(rec.name) ?? modelId,
      description: asString(rec.description),
      supportsReasoningEffort:
        meta?.supportsReasoningEffort === true || reasoningEfforts.length > 0,
      reasoningEffort: asString(meta?.reasoningEffort),
      reasoningEfforts:
        reasoningEfforts.length > 0 ? reasoningEfforts : undefined,
      acceptsImages,
      contextWindow,
    });
  }
  return { current, available };
}

function workspaceRelative(workspace: string | undefined, absPath: string): string {
  if (!workspace) return absPath;
  try {
    const rel = relative(workspace, absPath);
    if (!rel.startsWith("..") && !isAbsolute(rel)) {
      return rel.split("\\").join("/");
    }
  } catch {
    /* ignore */
  }
  return absPath;
}

export class AgentBackend {
  private child: ChildProcess | null = null;
  private client: AcpClient | null = null;
  private secret = "";
  private port = 0;
  private binaryPath = "";
  private connection: ConnectionState = "idle";
  private error?: string;
  private workspace?: string;
  private sessionId?: string;
  private sessionTitle?: string;
  private modelId?: string;
  private sessionMode: SessionModeId = "default";
  private reasoningEffort?: string;
  private availableModels: ModelInfo[] = [];
  private availableCommands: AvailableCommand[] = [];
  private acceptsImages = true;
  private agentVersion?: string;
  private accountEmail?: string;
  private usage?: UsageInfo;
  private timeline: TimelineItem[] = [];
  private sessions: SessionSummary[] = [];
  private busy = false;
  private replaying = false;
  private compacting = false;
  private compactTimelineId: string | null = null;
  private streamingAssistantId: string | null = null;
  private streamingThoughtId: string | null = null;
  private tokensUsed?: number;
  private contextWindow?: number;
  private toolIndex = new Map<string, string>();
  /**
   * Live/parked runtimes for sessions that have been opened or are mid-turn.
   * The focused session is also mirrored on the fields above for the hot path.
   */
  private runtimes = new Map<string, SessionRuntime>();
  /** Queued permission prompts; only the front is exposed in the snapshot. */
  private permissionQueue: PendingPermissionEntry[] = [];
  /** Always-approve (YOLO) — skip permission UI and auto-allow tools. */
  private alwaysApprove = false;
  private listeners = new Set<(event: AgentUiEvent) => void>();
  private connecting: Promise<void> | null = null;
  private authenticated = false;
  private usagePollTimer: ReturnType<typeof setInterval> | null = null;
  private usageFetching = false;
  /** Coalesce high-frequency stream snapshots (~30fps) so UI stays responsive. */
  private streamSnapTimer: ReturnType<typeof setTimeout> | null = null;
  private streamSnapPending = false;
  /**
   * Serialize session create/load so concurrent switches cannot leave
   * busy/replaying stuck or timelines interleaved.
   */
  private sessionOpChain: Promise<void> = Promise.resolve();

  onEvent(cb: (event: AgentUiEvent) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private emit(event: AgentUiEvent): void {
    for (const cb of this.listeners) {
      try {
        cb(event);
      } catch {
        /* ignore */
      }
    }
  }

  private log(level: "info" | "warn" | "error", message: string): void {
    this.emit({ type: "log", level, message });
  }

  snapshot(): AppSnapshot {
    this.syncActiveIntoRuntimes();
    const activePerm = this.permissionQueue.find(
      (e) =>
        !e.sessionId ||
        !this.sessionId ||
        e.sessionId === this.sessionId,
    );
    return {
      connection: this.connection,
      error: this.error,
      workspace: this.workspace,
      sessionId: this.sessionId,
      sessionTitle: this.sessionTitle,
      modelId: this.modelId,
      sessionMode: this.sessionMode,
      reasoningEffort: this.reasoningEffort,
      availableModels: this.availableModels.map((m) => ({
        ...m,
        reasoningEfforts: m.reasoningEfforts?.map((e) => ({ ...e })),
      })),
      availableCommands: this.availableCommands.map((c) => ({ ...c })),
      acceptsImages: this.acceptsImages,
      agentVersion: this.agentVersion,
      accountEmail: this.accountEmail,
      usage: this.usage ? { ...this.usage, summaryLines: [...this.usage.summaryLines] } : undefined,
      // slice is enough — Electron IPC structured-clones; avoid per-item spreads.
      timeline: this.timeline.slice(),
      sessions: this.sessions.map((s) => ({
        ...s,
        status: this.sessionRunStatus(s.sessionId),
      })),
      busy: this.busy,
      compacting: this.compacting,
      binaryPath: this.binaryPath || undefined,
      replaying: this.replaying,
      tokensUsed: this.tokensUsed,
      contextWindow: this.contextWindow,
      pendingPermission: activePerm
        ? {
            ...activePerm.ui,
            options: activePerm.ui.options.map((o) => ({ ...o })),
          }
        : undefined,
      alwaysApprove: this.alwaysApprove,
    };
  }

  /** Mirror focused session fields into the runtime map (for status + warm switch). */
  private syncActiveIntoRuntimes(): void {
    if (!this.sessionId) return;
    const prev = this.runtimes.get(this.sessionId);
    this.runtimes.set(this.sessionId, {
      sessionId: this.sessionId,
      cwd: this.workspace ?? prev?.cwd ?? "",
      title: this.sessionTitle ?? prev?.title ?? "Session",
      timeline: this.timeline,
      busy: this.busy,
      replaying: this.replaying,
      compacting: this.compacting,
      compactTimelineId: this.compactTimelineId,
      streamingAssistantId: this.streamingAssistantId,
      streamingThoughtId: this.streamingThoughtId,
      tokensUsed: this.tokensUsed,
      contextWindow: this.contextWindow,
      modelId: this.modelId,
      sessionMode: this.sessionMode,
      reasoningEffort: this.reasoningEffort,
      availableModels: this.availableModels,
      toolIndex: this.toolIndex,
      hydrated: prev?.hydrated ?? true,
    });
  }

  private sessionRunStatus(sessionId: string): SessionRunStatus {
    if (
      this.permissionQueue.some(
        (e) => e.sessionId === sessionId,
      )
    ) {
      return "needs_permission";
    }
    const rt =
      this.sessionId === sessionId
        ? {
            busy: this.busy,
            replaying: this.replaying,
            compacting: this.compacting,
          }
        : this.runtimes.get(sessionId);
    if (!rt) return "idle";
    if (rt.replaying) return "loading";
    if (rt.busy || rt.compacting) return "running";
    return "idle";
  }

  /** Capture focused session into the map, then clear focus fields. */
  private parkActiveSession(): void {
    if (!this.sessionId) return;
    this.syncActiveIntoRuntimes();
    // Detach field references so the parked bag keeps its own arrays/maps.
    const rt = this.runtimes.get(this.sessionId);
    if (rt) {
      this.runtimes.set(this.sessionId, {
        ...rt,
        timeline: rt.timeline.slice(),
        toolIndex: new Map(rt.toolIndex),
        availableModels: rt.availableModels.map((m) => ({
          ...m,
          reasoningEfforts: m.reasoningEfforts?.map((e) => ({ ...e })),
        })),
      });
    }
    this.sessionId = undefined;
    this.sessionTitle = undefined;
    this.timeline = [];
    this.toolIndex = new Map();
    this.busy = false;
    this.replaying = false;
    this.compacting = false;
    this.compactTimelineId = null;
    this.streamingAssistantId = null;
    this.streamingThoughtId = null;
    this.tokensUsed = undefined;
    // Keep workspace until next hydrate — UI may still show path briefly.
  }

  private hydrateFromRuntime(rt: SessionRuntime): void {
    this.sessionId = rt.sessionId;
    this.workspace = rt.cwd || this.workspace;
    this.sessionTitle = rt.title;
    this.timeline = rt.timeline;
    this.busy = rt.busy;
    this.replaying = rt.replaying;
    this.compacting = rt.compacting;
    this.compactTimelineId = rt.compactTimelineId;
    this.streamingAssistantId = rt.streamingAssistantId;
    this.streamingThoughtId = rt.streamingThoughtId;
    this.tokensUsed = rt.tokensUsed;
    this.contextWindow = rt.contextWindow ?? this.contextWindow;
    this.modelId = rt.modelId ?? this.modelId;
    this.sessionMode = rt.sessionMode;
    this.reasoningEffort = rt.reasoningEffort;
    if (rt.availableModels.length > 0) {
      this.availableModels = rt.availableModels;
      const cur = this.availableModels.find((m) => m.modelId === this.modelId);
      if (cur) this.acceptsImages = cur.acceptsImages !== false;
    }
    this.toolIndex = rt.toolIndex;
  }

  /**
   * Run `fn` against a non-focused session's runtime by temporarily swapping
   * active fields. Used so background turns keep updating timelines.
   */
  private withParkedRuntime(rt: SessionRuntime, fn: () => void): void {
    if (rt.sessionId === this.sessionId) {
      fn();
      this.syncActiveIntoRuntimes();
      return;
    }
    const focusId = this.sessionId;
    const focusSnap: SessionRuntime | null = focusId
      ? {
          sessionId: focusId,
          cwd: this.workspace ?? "",
          title: this.sessionTitle ?? "Session",
          timeline: this.timeline,
          busy: this.busy,
          replaying: this.replaying,
          compacting: this.compacting,
          compactTimelineId: this.compactTimelineId,
          streamingAssistantId: this.streamingAssistantId,
          streamingThoughtId: this.streamingThoughtId,
          tokensUsed: this.tokensUsed,
          contextWindow: this.contextWindow,
          modelId: this.modelId,
          sessionMode: this.sessionMode,
          reasoningEffort: this.reasoningEffort,
          availableModels: this.availableModels,
          toolIndex: this.toolIndex,
          hydrated: true,
        }
      : null;

    this.hydrateFromRuntime(rt);
    try {
      fn();
      this.syncActiveIntoRuntimes();
    } finally {
      if (focusSnap) {
        this.hydrateFromRuntime(focusSnap);
      } else {
        this.sessionId = undefined;
        this.sessionTitle = undefined;
        this.timeline = [];
        this.toolIndex = new Map();
        this.busy = false;
        this.replaying = false;
        this.compacting = false;
        this.compactTimelineId = null;
        this.streamingAssistantId = null;
        this.streamingThoughtId = null;
        this.tokensUsed = undefined;
      }
    }
  }

  private markRuntimeHydrated(sessionId: string | undefined, hydrated = true): void {
    if (!sessionId) return;
    const rt = this.runtimes.get(sessionId);
    if (rt) rt.hydrated = hydrated;
  }

  /** Session params `_meta` fragment when YOLO should apply to new/load. */
  private sessionYoloMeta(): Record<string, JsonValue> | undefined {
    if (!this.alwaysApprove) return undefined;
    return { yoloMode: true };
  }

  /**
   * Prefer plain "allow once", then any allow_once (skipping YOLO toggle),
   * then the first option.
   */
  private static defaultOptionIndex(options: PermissionOptionUi[]): number {
    if (options.length === 0) return 0;
    const allowOnceIdx = options.findIndex(
      (o) =>
        o.kind === "allow_once" &&
        o.optionId !== ENABLE_ALWAYS_APPROVE_OPTION_ID,
    );
    if (allowOnceIdx >= 0) return allowOnceIdx;
    const anyAllowOnce = options.findIndex((o) => o.kind === "allow_once");
    if (anyAllowOnce >= 0) return anyAllowOnce;
    return 0;
  }

  private parsePermissionRequest(
    params: JsonValue | undefined,
  ): PermissionRequestUi | null {
    const rec = asRecord(params);
    if (!rec) return null;
    const rawOptions = Array.isArray(rec.options) ? rec.options : [];
    const options: PermissionOptionUi[] = [];
    for (const opt of rawOptions) {
      const o = asRecord(opt as JsonValue);
      if (!o) continue;
      const optionId =
        asString(o.optionId) ?? asString(o.option_id) ?? asString(o.id);
      const name = asString(o.name) ?? asString(o.label) ?? optionId;
      const kind = asString(o.kind) ?? "allow_once";
      if (!optionId || !name) continue;
      options.push({ optionId, name, kind });
    }
    if (options.length === 0) return null;

    const toolCall =
      asRecord(rec.toolCall as JsonValue) ??
      asRecord(rec.tool_call as JsonValue);
    const toolCallId =
      asString(toolCall?.toolCallId) ??
      asString(toolCall?.tool_call_id) ??
      asString(toolCall?.id);
    const toolKind =
      asString(toolCall?.kind) ?? asString(toolCall?.toolKind);
    const title =
      asString(toolCall?.title) ??
      asString(rec.title) ??
      asString(rec.toolName) ??
      "Permission required";

    let detail: string | undefined;
    const rawInput =
      asRecord(toolCall?.rawInput as JsonValue) ??
      asRecord(toolCall?.raw_input as JsonValue);
    if (rawInput) {
      const cmd =
        asString(rawInput.command) ??
        asString(rawInput.cmd) ??
        asString(rawInput.script);
      const path =
        asString(rawInput.path) ??
        asString(rawInput.file) ??
        asString(rawInput.file_path) ??
        asString(rawInput.filePath);
      const url = asString(rawInput.url);
      if (cmd) detail = cmd;
      else if (path) detail = path;
      else if (url) detail = url;
      else {
        try {
          const s = JSON.stringify(rawInput);
          if (s.length > 2 && s.length < 400) detail = s;
          else if (s.length >= 400) detail = `${s.slice(0, 397)}…`;
        } catch {
          /* ignore */
        }
      }
    }

    return {
      requestId: newId("perm"),
      title,
      detail,
      toolCallId,
      toolKind,
      options,
      defaultOptionIndex: AgentBackend.defaultOptionIndex(options),
    };
  }

  /**
   * Resolve a pending permission prompt from the renderer.
   * `optionId === null` cancels the request.
   */
  respondPermission(requestId: string, optionId: string | null): void {
    const idx = this.permissionQueue.findIndex(
      (e) => e.ui.requestId === requestId,
    );
    if (idx < 0) {
      this.log("warn", `Permission response for unknown id=${requestId}`);
      return;
    }
    const [entry] = this.permissionQueue.splice(idx, 1);
    if (!entry) return;

    if (optionId === null) {
      this.log("info", `Permission cancelled requestId=${requestId}`);
      entry.resolve({ outcome: { outcome: "cancelled" } });
    } else {
      const ok = entry.ui.options.some((o) => o.optionId === optionId);
      if (!ok) {
        this.log(
          "warn",
          `Invalid permission optionId=${optionId}; cancelling`,
        );
        entry.resolve({ outcome: { outcome: "cancelled" } });
      } else {
        this.log(
          "info",
          `Permission selected optionId=${optionId} requestId=${requestId}`,
        );
        // Client-side YOLO: enable always-approve when user picks that row.
        if (optionId === ENABLE_ALWAYS_APPROVE_OPTION_ID) {
          void this.setAlwaysApprove(true);
        }
        entry.resolve({
          outcome: { outcome: "selected", optionId },
        });
      }
    }
    this.emitSnapshot();
  }

  /**
   * Toggle always-approve (YOLO). Notifies the agent, persists config, and
   * when enabling drains any queued permission prompts with allow-once.
   */
  async setAlwaysApprove(enabled: boolean): Promise<void> {
    const next = Boolean(enabled);
    if (this.alwaysApprove === next) {
      // Still re-sync agent in case process was restarted under us.
      this.notifyYoloMode(next);
      return;
    }
    this.alwaysApprove = next;
    this.log("info", `Always-approve ${next ? "enabled" : "disabled"}`);
    this.notifyYoloMode(next);
    if (next) {
      this.drainPermissionsAllowOnce("always-approve enabled");
    }
    try {
      await writeAlwaysApproveToConfig(next);
    } catch (err) {
      this.log(
        "warn",
        `Failed to persist permission_mode: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    this.emitSnapshot();
  }

  private notifyYoloMode(enabled: boolean): void {
    const client = this.client;
    if (!client?.connected) return;
    const params = {
      yolo_mode: enabled,
      permission_mode: enabled ? "always-approve" : "ask",
    };
    for (const method of [
      "x.ai/yolo_mode_changed",
      "_x.ai/yolo_mode_changed",
    ] as const) {
      try {
        client.notify(method, params);
        this.log("info", `Notified ${method} yolo_mode=${enabled}`);
        return;
      } catch (err) {
        this.log(
          "warn",
          `Failed to notify ${method}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  /** Auto-resolve queued prompts with plain allow-once (skip YOLO row). */
  private drainPermissionsAllowOnce(reason: string): void {
    if (this.permissionQueue.length === 0) return;
    const pending = this.permissionQueue.splice(0);
    for (const entry of pending) {
      const opt =
        entry.ui.options.find(
          (o) =>
            o.kind === "allow_once" &&
            o.optionId !== ENABLE_ALWAYS_APPROVE_OPTION_ID,
        ) ??
        entry.ui.options.find((o) => o.kind === "allow_once") ??
        entry.ui.options[0];
      if (!opt) {
        entry.resolve({ outcome: { outcome: "cancelled" } });
        continue;
      }
      this.log(
        "info",
        `Permission auto-allowed (${reason}) optionId=${opt.optionId}`,
      );
      entry.resolve({
        outcome: { outcome: "selected", optionId: opt.optionId },
      });
    }
  }

  private cancelAllPermissions(reason: string): void {
    if (this.permissionQueue.length === 0) return;
    const pending = this.permissionQueue.splice(0);
    for (const entry of pending) {
      this.log(
        "info",
        `Permission auto-cancelled (${reason}) requestId=${entry.ui.requestId}`,
      );
      entry.resolve({ outcome: { outcome: "cancelled" } });
    }
  }

  private applyModelsFromSession(modelsVal: JsonValue | undefined): void {
    const { current, available } = parseModels(modelsVal);
    if (available.length > 0) {
      this.availableModels = available;
    }
    if (current) this.modelId = current;
    const cur = this.availableModels.find((m) => m.modelId === this.modelId);
    if (cur) {
      this.reasoningEffort = cur.reasoningEffort ?? this.reasoningEffort;
      this.acceptsImages = cur.acceptsImages !== false;
      if (typeof cur.contextWindow === "number" && cur.contextWindow > 0) {
        this.contextWindow = cur.contextWindow;
      }
    }
  }

  /** Pull used/total context tokens from notification `_meta` (camelCase or snake). */
  private noteTokensFromMeta(meta: Record<string, JsonValue> | null): void {
    if (!meta) return;
    const used =
      asNumber(meta.totalTokens) ?? asNumber(meta.total_tokens);
    if (used === undefined) return;
    if (this.tokensUsed === used) return;
    this.tokensUsed = used;
  }

  private setTokensUsed(n: number | undefined): void {
    if (n === undefined || !Number.isFinite(n) || n < 0) return;
    if (this.tokensUsed === n) return;
    this.tokensUsed = n;
  }

  /**
   * Best-effort refresh via `x.ai/session/info` (used after load / prompt).
   * Live turns also update from session/update `_meta.totalTokens`.
   */
  private async refreshContextUsage(): Promise<void> {
    if (!this.sessionId) return;
    try {
      const raw = await this.requestExt(
        "session/info",
        { sessionId: this.sessionId },
        15_000,
      );
      const rec = asRecord(raw);
      if (!rec) return;
      // Wire may wrap as { result: {...} } or flatten SessionInfoResponse.
      const body = asRecord(rec.result) ?? rec;
      const ctx =
        asRecord(body.context) ??
        asRecord(asRecord(body.data)?.context);
      if (!ctx) return;
      const used = asNumber(ctx.used);
      const total = asNumber(ctx.total);
      let changed = false;
      if (used !== undefined && this.tokensUsed !== used) {
        this.tokensUsed = used;
        changed = true;
      }
      if (total !== undefined && total > 0 && this.contextWindow !== total) {
        this.contextWindow = total;
        changed = true;
      }
      if (changed && !this.replaying) this.emitSnapshot();
    } catch {
      /* optional — older agents may not expose session/info */
    }
  }

  private setState(partial: {
    connection?: ConnectionState;
    error?: string;
    busy?: boolean;
  }): void {
    if (partial.connection !== undefined) this.connection = partial.connection;
    if (partial.error !== undefined) this.error = partial.error;
    if (partial.busy !== undefined) this.busy = partial.busy;
    this.emitSnapshot();
  }

  private emitSnapshot(): void {
    // Flush any pending throttled stream frame first so order stays consistent.
    if (this.streamSnapTimer) {
      clearTimeout(this.streamSnapTimer);
      this.streamSnapTimer = null;
    }
    this.streamSnapPending = false;
    this.emit({ type: "snapshot", snapshot: this.snapshot() });
  }

  /** Throttled emit for token-stream text deltas (agent/thought chunks). */
  private emitSnapshotThrottled(): void {
    this.streamSnapPending = true;
    if (this.streamSnapTimer) return;
    this.streamSnapTimer = setTimeout(() => {
      this.streamSnapTimer = null;
      if (!this.streamSnapPending) return;
      this.streamSnapPending = false;
      this.emit({ type: "snapshot", snapshot: this.snapshot() });
    }, 33);
  }

  private pushTimeline(item: TimelineItem): void {
    this.timeline.push(item);
    // Cold session load: accumulate silently. One snapshot at start (empty +
    // replaying) and one at end (full history) — intermediate frames force the
    // renderer to re-parse growing markdown and feel like a hung switch.
    if (this.replaying) return;
    this.emitSnapshot();
  }

  private updateTimeline(
    id: string,
    updater: (item: TimelineItem) => TimelineItem,
    opts?: { throttle?: boolean },
  ): void {
    const idx = this.timeline.findIndex((t) => t.id === id);
    if (idx >= 0) {
      this.timeline[idx] = updater(this.timeline[idx]!);
      if (!this.replaying) {
        if (opts?.throttle) this.emitSnapshotThrottled();
        else this.emitSnapshot();
      }
    }
  }

  private clearTimeline(): void {
    this.timeline = [];
    this.toolIndex.clear();
    this.streamingAssistantId = null;
    this.streamingThoughtId = null;
    this.compactTimelineId = null;
    this.compacting = false;
    this.tokensUsed = undefined;
    // Only drop permissions for the focused session — keep other sessions' queues.
    if (this.sessionId) {
      this.cancelPermissionsForSession(this.sessionId, "timeline clear");
    }
  }

  private beginCompact(mode: "manual" | "auto", percentage?: number): void {
    this.compacting = true;
    // End any open stream carets before the compact card.
    this.finalizeStreaming();

    if (this.compactTimelineId) {
      this.updateTimeline(this.compactTimelineId, (item) => {
        if (item.kind !== "compact") return item;
        return {
          ...item,
          status: "running",
          mode,
          percentage: percentage ?? item.percentage,
        };
      });
      this.emitSnapshot();
      return;
    }

    const id = newId("compact");
    this.compactTimelineId = id;
    this.pushTimeline({
      id,
      kind: "compact",
      status: "running",
      mode,
      percentage,
    });
  }

  private finishCompact(
    status: "completed" | "failed" | "cancelled",
    opts: {
      mode?: "manual" | "auto";
      tokensBefore?: number;
      tokensAfter?: number;
      message?: string;
    } = {},
  ): void {
    this.compacting = false;
    const id = this.compactTimelineId;
    if (id) {
      this.updateTimeline(id, (item) => {
        if (item.kind !== "compact") return item;
        return {
          ...item,
          status,
          mode: opts.mode ?? item.mode,
          tokensBefore: opts.tokensBefore ?? item.tokensBefore,
          tokensAfter: opts.tokensAfter ?? item.tokensAfter,
          message: opts.message ?? item.message,
        };
      });
    } else {
      this.pushTimeline({
        id: newId("compact"),
        kind: "compact",
        status,
        mode: opts.mode ?? "auto",
        tokensBefore: opts.tokensBefore,
        tokensAfter: opts.tokensAfter,
        message: opts.message,
      });
    }
    this.compactTimelineId = null;
    this.emitSnapshot();
  }

  /** Mark open stream bubbles as finished and drop stream tracking ids. */
  private finalizeStreaming(): void {
    this.finalizeStreamingAssistant();
    this.finalizeStreamingThought();
  }

  private finalizeStreamingAssistant(): void {
    if (this.streamingAssistantId) {
      this.updateTimeline(this.streamingAssistantId, (item) =>
        item.kind === "assistant" ? { ...item, streaming: false } : item,
      );
    }
    this.streamingAssistantId = null;
  }

  private finalizeStreamingThought(): void {
    if (this.streamingThoughtId) {
      this.updateTimeline(this.streamingThoughtId, (item) =>
        item.kind === "thought" ? { ...item, streaming: false } : item,
      );
    }
    this.streamingThoughtId = null;
  }

  async connect(): Promise<void> {
    if (this.connecting) {
      await this.connecting;
      return;
    }
    if (this.authenticated && this.client?.connected && this.connection === "ready") {
      return;
    }
    this.connecting = this.connectInner().finally(() => {
      this.connecting = null;
    });
    await this.connecting;
  }

  private async connectInner(): Promise<void> {
    // Tear down previous process if any
    await this.stopProcessOnly();

    this.error = undefined;
    this.authenticated = false;
    // Load YOLO preference from shared CLI config before agent comes up.
    try {
      this.alwaysApprove = await readAlwaysApproveFromConfig();
    } catch {
      this.alwaysApprove = false;
    }
    this.setState({ connection: "starting", busy: false });

    this.binaryPath = await resolveGrokBinary();
    this.secret = randomBytes(12).toString("hex");
    this.port = await getFreePort();

    this.log("info", `Using binary: ${this.binaryPath}`);
    this.log("info", `Starting agent serve on 127.0.0.1:${this.port}`);

    const args = [
      "agent",
      "serve",
      "--bind",
      `127.0.0.1:${this.port}`,
      "--secret",
      this.secret,
    ];

    // Inject desktop-stored API key when process env has none (CLI-compatible).
    let accountEnv: Record<string, string> = {};
    try {
      const { accountEnvOverlay } = await import("./account-manager");
      accountEnv = await accountEnvOverlay();
    } catch {
      accountEnv = {};
    }
    const child = spawn(this.binaryPath, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...accountEnv },
    });
    this.child = child;

    let stderrBuf = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      stderrBuf += text;
      if (stderrBuf.length > 64_000) stderrBuf = stderrBuf.slice(-32_000);
    });

    child.on("exit", (code, signal) => {
      this.log(
        "warn",
        `agent serve exited code=${code ?? "null"} signal=${signal ?? "null"}`,
      );
      this.authenticated = false;
      if (this.connection !== "stopped" && this.connection !== "idle") {
        this.setState({
          connection: "error",
          error: `agent serve exited (code ${code ?? "null"})`,
        });
      }
      this.child = null;
    });

    await this.waitForListen(this.port, 20_000, () => stderrBuf);
    this.setState({ connection: "connecting" });

    const url = `ws://127.0.0.1:${this.port}/ws?server-key=${this.secret}`;
    this.client = new AcpClient({
      onNotification: (method, params) => this.handleNotification(method, params),
      onRequest: (id, method, params) => this.handleReverseRequest(id, method, params),
      onError: (err) => this.log("error", err.message),
      onClose: (code, reason) => {
        this.log("warn", `WS closed ${code} ${reason}`);
        this.authenticated = false;
        this.cancelAllPermissions("ws close");
        if (this.connection === "ready") {
          this.setState({
            connection: "error",
            error: `Connection closed (${code})`,
          });
        }
      },
    });

    await this.client.connect(url);
    this.log("info", "WebSocket connected");

    const initResult = asRecord(
      await this.client.request("initialize", {
        protocolVersion: 1,
        clientCapabilities: {
          fs: { readTextFile: false, writeTextFile: false },
          terminal: false,
        },
        clientInfo: {
          name: "grok-build-desktop",
          version: "0.1.0",
        },
      }),
    );
    if (!initResult) throw new Error("initialize returned empty result");

    const meta = asRecord(initResult._meta);
    this.agentVersion = asString(meta?.agentVersion);
    const bootstrapCmds = parseAvailableCommands(
      meta?.availableCommands as JsonValue | undefined,
    );
    if (bootstrapCmds.length > 0) {
      this.availableCommands = bootstrapCmds;
    }
    const defaultAuth = asString(meta?.defaultAuthMethodId) ?? "cached_token";

    try {
      const authResult = asRecord(
        await this.client.request("authenticate", { methodId: defaultAuth }),
      );
      const authMeta = asRecord(authResult?._meta);
      this.accountEmail = asString(authMeta?.email);
      this.log(
        "info",
        `Authenticated as ${this.accountEmail ?? "(unknown)"} via ${defaultAuth}`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Authentication failed (${defaultAuth}): ${message}. Sign in from Settings → Account, or run \`grok login\`.`,
      );
    }

    this.authenticated = true;
    // Re-apply YOLO so agent serve matches desktop / config preference.
    if (this.alwaysApprove) {
      this.notifyYoloMode(true);
    }
    this.setState({ connection: "ready", error: undefined });
    await this.refreshHistory();
    // Non-blocking: credits / subscription usage (CLI `/usage`).
    void this.refreshUsage().catch((err) => {
      this.log(
        "warn",
        `usage fetch failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
    this.startUsagePoll();
  }

  private startUsagePoll(): void {
    this.stopUsagePoll();
    this.usagePollTimer = setInterval(() => {
      if (!this.authenticated || this.connection !== "ready") return;
      void this.refreshUsage().catch(() => {
        /* keep last */
      });
    }, USAGE_POLL_MS);
  }

  private stopUsagePoll(): void {
    if (this.usagePollTimer) {
      clearInterval(this.usagePollTimer);
      this.usagePollTimer = null;
    }
  }

  /**
   * Fetch coding credit / subscription usage via `x.ai/billing`
   * (same extension as CLI `/usage`).
   */
  async refreshUsage(): Promise<UsageInfo | null> {
    if (!this.client?.connected || !this.authenticated) {
      return this.usage ?? null;
    }
    if (this.usageFetching) return this.usage ?? null;
    this.usageFetching = true;
    try {
      const raw = await this.requestExt("billing", {}, 45_000);
      let usage = parseBillingUsage(raw);
      if (usage.prepaidUsd !== undefined && usage.prepaidUsd > 0) {
        try {
          const topupRaw = await this.requestExt("auto-topup-rule", {}, 20_000);
          usage = mergeAutoTopup(usage, topupRaw);
        } catch {
          // optional
        }
      }
      this.usage = usage;
      this.emitSnapshot();
      return usage;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (this.usage) {
        this.usage = { ...this.usage, error: message };
        this.emitSnapshot();
        return this.usage;
      }
      this.usage = {
        usagePct: 0,
        usageLabel: "Usage",
        usageShort: "—",
        summaryLines: [],
        manageUrl: DEFAULT_USAGE_MANAGE_URL,
        error: message,
      };
      this.emitSnapshot();
      return this.usage;
    } finally {
      this.usageFetching = false;
    }
  }

  private async waitForListen(
    port: number,
    timeoutMs: number,
    stderr: () => string,
  ): Promise<void> {
    const { connect } = await import("node:net");
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (this.child && this.child.exitCode !== null) {
        throw new Error(
          `agent serve exited early (code ${this.child.exitCode}).\n${stderr().slice(-2000)}`,
        );
      }
      const open = await new Promise<boolean>((resolve) => {
        const c = connect({ host: "127.0.0.1", port }, () => {
          c.end();
          resolve(true);
        });
        c.on("error", () => resolve(false));
      });
      if (open) return;
      await new Promise((r) => setTimeout(r, 150));
    }
    throw new Error(
      `Timed out waiting for agent serve on port ${port}.\n${stderr().slice(-2000)}`,
    );
  }

  private requireClient(): AcpClient {
    if (!this.client || !this.client.connected || !this.authenticated) {
      throw new Error("Agent is not connected");
    }
    return this.client;
  }

  /**
   * Call an xAI extension method. Agent serve exposes them as top-level
   * `_x.ai/...` (and sometimes unprefixed `x.ai/...`) rather than nested
   * under JSON-RPC `ext_method`.
   */
  private async requestExt(
    path: string,
    params: Record<string, JsonValue> = {},
    timeoutMs = 60_000,
  ): Promise<JsonValue> {
    const client = this.requireClient();
    const methods = [`_x.ai/${path}`, `x.ai/${path}`] as const;
    let lastErr: Error | undefined;
    for (const method of methods) {
      try {
        return await client.request(method, params, timeoutMs);
      } catch (err) {
        lastErr = err instanceof Error ? err : new Error(String(err));
        const msg = lastErr.message.toLowerCase();
        // Retry alternate wire name when method is missing; rethrow real failures.
        if (
          !msg.includes("method not found") &&
          !msg.includes("-32601") &&
          !msg.includes("unknown method")
        ) {
          throw lastErr;
        }
      }
    }
    throw lastErr ?? new Error(`Extension method failed: ${path}`);
  }

  private clearActiveSessionState(): void {
    if (this.sessionId) {
      this.runtimes.delete(this.sessionId);
    }
    this.sessionId = undefined;
    this.sessionTitle = undefined;
    this.clearTimeline();
    this.resetTurnFlags();
    this.tokensUsed = undefined;
    this.toolIndex.clear();
  }

  /** Clear busy / replay / compact flags (does not touch session id or timeline). */
  private resetTurnFlags(): void {
    this.busy = false;
    this.replaying = false;
    this.compacting = false;
    this.compactTimelineId = null;
    this.streamingAssistantId = null;
    this.streamingThoughtId = null;
  }

  /**
   * Best-effort cancel of one session's in-flight prompt (Stop button / delete).
   * Does **not** run on normal session switch — other sessions keep running.
   */
  private async cancelInFlightPrompt(
    reason: string,
    sessionId = this.sessionId,
  ): Promise<void> {
    const client = this.client;
    if (!sessionId) return;

    const isActive = this.sessionId === sessionId;
    const rt = this.runtimes.get(sessionId);
    const wasBusy = isActive ? this.busy : Boolean(rt?.busy);

    // Drop permission prompts belonging to this session only.
    this.cancelPermissionsForSession(sessionId, reason);

    if (isActive) {
      this.resetTurnFlags();
      this.finalizeStreaming();
      this.syncActiveIntoRuntimes();
    } else if (rt) {
      rt.busy = false;
      rt.replaying = false;
      rt.compacting = false;
      rt.compactTimelineId = null;
      rt.streamingAssistantId = null;
      rt.streamingThoughtId = null;
    }

    if (!wasBusy || !client || this.connection !== "ready") {
      return;
    }
    try {
      await client.request("session/cancel", { sessionId }, 10_000);
      this.log("info", `Cancel sent (${reason}) session=${sessionId}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.log("warn", `Cancel failed (${reason}): ${message}`);
    }
  }

  private cancelPermissionsForSession(sessionId: string, reason: string): void {
    const kept: PendingPermissionEntry[] = [];
    for (const entry of this.permissionQueue) {
      if (entry.sessionId && entry.sessionId !== sessionId) {
        kept.push(entry);
        continue;
      }
      // Entries without sessionId are treated as belonging to the focused session.
      if (!entry.sessionId && this.sessionId !== sessionId) {
        kept.push(entry);
        continue;
      }
      this.log(
        "info",
        `Permission auto-cancelled (${reason}) requestId=${entry.ui.requestId}`,
      );
      entry.resolve({ outcome: { outcome: "cancelled" } });
    }
    this.permissionQueue = kept;
  }

  /** Run session create/load ops one at a time. */
  private async withSessionOp<T>(fn: () => Promise<T>): Promise<T> {
    const prev = this.sessionOpChain;
    let release!: () => void;
    this.sessionOpChain = new Promise<void>((resolve) => {
      release = resolve;
    });
    try {
      await prev.catch(() => {
        /* previous op failed — still run next */
      });
      return await fn();
    } finally {
      release();
    }
  }

  /**
   * Reset to an empty chat with no workspace/session.
   * Parks the previous session without cancelling its in-flight turn.
   */
  prepareNewChat(): void {
    // Keep background turns running; only unfocus the UI.
    this.parkActiveSession();
    this.workspace = undefined;
    this.sessionMode = "default";
    this.sessionTitle = undefined;
    this.modelId = undefined;
    this.reasoningEffort = undefined;
    this.availableCommands = [];
    this.contextWindow = undefined;
    this.emitSnapshot();
    this.log("info", "Prepared empty chat (choose workspace to start)");
  }

  async refreshHistory(): Promise<void> {
    const client = this.requireClient();
    try {
      // Note: xAI extension methods are exposed as top-level `_x.ai/...` methods
      // over agent serve (not nested under JSON-RPC `ext_method`).
      const raw = await client.request(
        "_x.ai/session_summaries/workspace_list_recent",
        { limit: 80 },
        30_000,
      );
      const list = Array.isArray(raw) ? raw : [];
      const sessions: SessionSummary[] = [];
      for (const item of list) {
        const rec = asRecord(item as JsonValue);
        if (!rec) continue;
        const info = asRecord(rec.info);
        const sessionId = asString(info?.id);
        const cwd = asString(info?.cwd);
        if (!sessionId || !cwd) continue;
        sessions.push({
          sessionId,
          cwd,
          project: projectName(cwd),
          title: titleFromSummary(rec),
          updatedAt:
            asString(rec.updated_at) ||
            asString(rec.updatedAt) ||
            asString(rec.last_active_at) ||
            "",
          modelId:
            asString(rec.current_model_id) || asString(rec.currentModelId),
        });
      }
      this.sessions = sessions;
      this.emitSnapshot();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.log("warn", `Failed to refresh history: ${message}`);
    }
  }

  /**
   * Pull slash-command catalog for the current workspace.
   * Prefer `_x.ai/commands/list` (agent-serve wire); fall back to unprefixed.
   */
  async refreshCommands(): Promise<void> {
    if (!this.client || !this.client.connected || !this.authenticated) return;
    const client = this.client;
    const params: Record<string, JsonValue> = {};
    if (this.workspace) params.cwd = this.workspace;
    const methods = ["_x.ai/commands/list", "x.ai/commands/list"] as const;
    for (const method of methods) {
      try {
        const raw = await client.request(method, params, 30_000);
        const rec = asRecord(raw);
        const list =
          parseAvailableCommands(rec?.commands as JsonValue | undefined) ||
          parseAvailableCommands(raw);
        if (list.length > 0 || rec?.commands !== undefined) {
          this.availableCommands = list;
          this.emitSnapshot();
          this.log("info", `Loaded ${list.length} slash commands`);
          return;
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.log("warn", `commands/list via ${method}: ${message}`);
      }
    }
  }

  private applyAvailableCommands(commands: AvailableCommand[]): void {
    this.availableCommands = commands;
    if (!this.replaying) this.emitSnapshot();
  }

  async newSession(workspace: string): Promise<void> {
    return this.withSessionOp(async () => {
      await this.connect();
      const client = this.requireClient();

      // Park previous session — do not cancel its turn (concurrent sessions).
      this.parkActiveSession();
      this.workspace = workspace;
      this.sessionTitle = "New session";
      this.sessionMode = "default";
      this.modelId = undefined;
      this.reasoningEffort = undefined;
      this.availableCommands = [];
      this.contextWindow = undefined;
      this.tokensUsed = undefined;
      this.timeline = [];
      this.toolIndex = new Map();
      this.resetTurnFlags();
      this.emitSnapshot();

      const newParams: Record<string, JsonValue> = {
        cwd: workspace,
        mcpServers: [],
      };
      const yoloMeta = this.sessionYoloMeta();
      if (yoloMeta) newParams._meta = yoloMeta;
      const sessionResult = asRecord(
        await client.request("session/new", newParams),
      );
      if (!sessionResult) throw new Error("session/new returned empty result");

      this.sessionId = asString(sessionResult.sessionId);
      this.applyModelsFromSession(sessionResult.models);
      this.sessionTitle = "New session";
      this.resetTurnFlags();
      this.markRuntimeHydrated(this.sessionId, true);
      this.syncActiveIntoRuntimes();
      this.setState({ connection: "ready", error: undefined });
      await Promise.all([
        this.refreshHistory(),
        this.refreshCommands(),
        this.refreshContextUsage(),
      ]);
      // Final guarantee after async follow-ups.
      this.resetTurnFlags();
      this.syncActiveIntoRuntimes();
      this.emitSnapshot();
      this.log("info", `New session ${this.sessionId}`);
    });
  }

  async loadSession(sessionId: string, cwd: string): Promise<void> {
    return this.withSessionOp(async () => {
      await this.connect();
      const client = this.requireClient();

      // Already focused — nothing to do.
      if (this.sessionId === sessionId) {
        return;
      }

      // Park current; keep its turn running in the background.
      this.parkActiveSession();

      // Warm switch: reuse in-memory runtime (including live streaming state).
      const warm = this.runtimes.get(sessionId);
      if (warm?.hydrated) {
        this.hydrateFromRuntime(warm);
        this.workspace = warm.cwd || cwd;
        const known = this.sessions.find((s) => s.sessionId === sessionId);
        if (known?.title) this.sessionTitle = known.title;
        this.emitSnapshot();
        void this.refreshCommands();
        void this.refreshContextUsage();
        this.log("info", `Switched to warm session ${sessionId}`);
        return;
      }

      // Cold load from agent.
      this.replaying = true;
      this.busy = false;
      this.timeline = [];
      this.toolIndex = new Map();
      this.streamingAssistantId = null;
      this.streamingThoughtId = null;
      this.compactTimelineId = null;
      this.compacting = false;
      this.workspace = cwd;
      this.sessionId = sessionId;
      this.sessionMode = "default";
      this.sessionTitle =
        this.sessions.find((s) => s.sessionId === sessionId)?.title ??
        "Session";
      this.runtimes.set(sessionId, {
        ...emptyRuntime(sessionId, cwd),
        title: this.sessionTitle,
        replaying: true,
        hydrated: false,
      });
      this.emitSnapshot();

      try {
        const loadParams: Record<string, JsonValue> = {
          sessionId,
          cwd,
          mcpServers: [],
        };
        const yoloMeta = this.sessionYoloMeta();
        if (yoloMeta) loadParams._meta = yoloMeta;
        const result = asRecord(
          await client.request("session/load", loadParams, 180_000),
        );
        // User may have switched away while loading — apply to the right bag.
        if (this.sessionId !== sessionId) {
          const bag = this.runtimes.get(sessionId) ?? emptyRuntime(sessionId, cwd);
          this.withParkedRuntime(bag, () => {
            this.applyModelsFromSession(result?.models);
            this.finalizeStreaming();
            this.replaying = false;
            this.busy = false;
            this.compacting = false;
            const known = this.sessions.find((s) => s.sessionId === sessionId);
            if (known) this.sessionTitle = known.title;
            this.markRuntimeHydrated(sessionId, true);
          });
          this.emitSnapshot();
          return;
        }
        this.applyModelsFromSession(result?.models);
        this.finalizeStreaming();
        const known = this.sessions.find((s) => s.sessionId === sessionId);
        if (known) this.sessionTitle = known.title;
        this.markRuntimeHydrated(sessionId, true);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (this.sessionId === sessionId) {
          this.pushTimeline({
            id: newId("sys"),
            kind: "system",
            text: `Failed to load session: ${message}`,
          });
        }
        throw err;
      } finally {
        if (this.sessionId === sessionId) {
          this.replaying = false;
          this.busy = false;
          this.compacting = false;
          this.syncActiveIntoRuntimes();
          this.emitSnapshot();
        }
        void this.refreshHistory();
        if (this.sessionId === sessionId) {
          void this.refreshCommands();
          void this.refreshContextUsage();
        }
      }
    });
  }

  async renameSession(
    sessionId: string,
    title: string,
    cwd: string,
  ): Promise<void> {
    const trimmed = title.trim();
    if (!trimmed) throw new Error("Title must not be blank");
    await this.connect();
    await this.requestExt(
      "session/rename",
      { sessionId, title: trimmed, cwd },
      30_000,
    );
    if (this.sessionId === sessionId) {
      this.sessionTitle = trimmed;
    }
    this.sessions = this.sessions.map((s) =>
      s.sessionId === sessionId ? { ...s, title: trimmed } : s,
    );
    this.emitSnapshot();
    this.log("info", `Renamed session ${sessionId} → ${trimmed}`);
    await this.refreshHistory();
  }

  async deleteSession(sessionId: string, cwd: string): Promise<void> {
    await this.connect();
    // Stop any in-flight turn on the session being deleted.
    await this.cancelInFlightPrompt("delete session", sessionId);
    await this.requestExt("session/delete", { sessionId, cwd }, 60_000);
    const wasCurrent = this.sessionId === sessionId;
    this.sessions = this.sessions.filter((s) => s.sessionId !== sessionId);
    this.runtimes.delete(sessionId);
    if (wasCurrent) {
      this.sessionId = undefined;
      this.sessionTitle = undefined;
      this.clearTimeline();
      this.resetTurnFlags();
      this.tokensUsed = undefined;
      this.toolIndex = new Map();
      this.workspace = cwd;
    }
    this.emitSnapshot();
    this.log("info", `Deleted session ${sessionId}`);
    await this.refreshHistory();
  }

  async forkSession(
    sessionId: string,
    cwd: string,
  ): Promise<ForkSessionResult> {
    await this.connect();
    const raw = await this.requestExt(
      "session/fork",
      {
        sourceSessionId: sessionId,
        sourceCwd: cwd,
        newCwd: cwd,
        sessionKind: "fork",
      },
      120_000,
    );
    const rec = asRecord(raw);
    const newSessionId = asString(rec?.newSessionId);
    const newCwd = asString(rec?.newCwd) ?? cwd;
    if (!newSessionId) {
      throw new Error("Fork response missing newSessionId");
    }
    this.log("info", `Forked ${sessionId} → ${newSessionId}`);
    await this.refreshHistory();
    await this.loadSession(newSessionId, newCwd);
    return {
      newSessionId,
      newCwd,
      parentSessionId: asString(rec?.parentSessionId) ?? sessionId,
    };
  }

  async searchSessions(
    query: string,
    options?: SearchSessionsOptions,
  ): Promise<SessionSearchHit[]> {
    const q = query.trim();
    if (!q) return [];
    await this.connect();
    const params: Record<string, JsonValue> = {
      query: q,
      limit: options?.limit ?? 40,
      includeContent: options?.includeContent !== false,
    };
    if (options?.cwd) params.cwd = options.cwd;
    const raw = await this.requestExt("session/search", params, 30_000);
    const rec = asRecord(raw);
    const list = Array.isArray(rec?.results)
      ? rec!.results
      : Array.isArray(raw)
        ? raw
        : [];
    const hits: SessionSearchHit[] = [];
    for (const item of list) {
      const row = asRecord(item as JsonValue);
      if (!row) continue;
      const sessionId = asString(row.sessionId) ?? asString(row.session_id);
      const hitCwd = asString(row.cwd);
      if (!sessionId || !hitCwd) continue;
      hits.push({
        sessionId,
        cwd: hitCwd,
        summary:
          asString(row.summary) ??
          asString(row.title) ??
          asString(row.generatedTitle) ??
          "Untitled",
        updatedAt:
          asString(row.updatedAt) ?? asString(row.updated_at) ?? "",
        score: asNumber(row.score) ?? 0,
        matchedFields: Array.isArray(row.matchedFields)
          ? (row.matchedFields as JsonValue[])
              .map((f) => (typeof f === "string" ? f : ""))
              .filter(Boolean)
          : Array.isArray(row.matched_fields)
            ? (row.matched_fields as JsonValue[])
                .map((f) => (typeof f === "string" ? f : ""))
                .filter(Boolean)
            : [],
        snippet: asString(row.snippet),
      });
    }
    return hits;
  }

  async setModel(modelId: string, reasoningEffort?: string): Promise<void> {
    if (!this.sessionId) throw new Error("No active session");
    const client = this.requireClient();
    const params: Record<string, JsonValue> = {
      sessionId: this.sessionId,
      modelId,
    };
    if (reasoningEffort) {
      params._meta = { reasoning_effort: reasoningEffort };
    }
    await client.request("session/set_model", params, 60_000);
    this.modelId = modelId;
    if (reasoningEffort) this.reasoningEffort = reasoningEffort;
    const cur = this.availableModels.find((m) => m.modelId === modelId);
    if (cur) {
      this.acceptsImages = cur.acceptsImages !== false;
      if (!reasoningEffort && cur.reasoningEffort) {
        this.reasoningEffort = cur.reasoningEffort;
      }
      // refresh effort options binding
      cur.reasoningEffort = this.reasoningEffort ?? cur.reasoningEffort;
      if (typeof cur.contextWindow === "number" && cur.contextWindow > 0) {
        this.contextWindow = cur.contextWindow;
      }
    }
    this.emitSnapshot();
    this.log("info", `Model set to ${modelId}${reasoningEffort ? ` (${reasoningEffort})` : ""}`);
    void this.refreshContextUsage();
  }

  async setMode(modeId: SessionModeId): Promise<void> {
    if (!this.sessionId) throw new Error("No active session");
    const client = this.requireClient();
    await client.request(
      "session/set_mode",
      { sessionId: this.sessionId, modeId },
      30_000,
    );
    this.sessionMode = modeId;
    this.emitSnapshot();
    this.log("info", `Mode set to ${modeId}`);
  }

  async pathSuggest(query: string): Promise<PathSuggestion[]> {
    const cwd = this.workspace;
    if (!cwd) return [];
    const q = query.replace(/^\//, "");
    const lastSlash = q.lastIndexOf("/");
    const dirPart = lastSlash >= 0 ? q.slice(0, lastSlash) : "";
    const filePart = lastSlash >= 0 ? q.slice(lastSlash + 1) : q;
    const absDir = dirPart ? resolve(cwd, dirPart) : cwd;

    try {
      const entries = await readdir(absDir, { withFileTypes: true });
      const out: PathSuggestion[] = [];
      for (const ent of entries) {
        if (ent.name.startsWith(".") && !filePart.startsWith(".")) continue;
        if (filePart && !ent.name.toLowerCase().startsWith(filePart.toLowerCase())) {
          continue;
        }
        const rel = dirPart ? `${dirPart}/${ent.name}` : ent.name;
        out.push({
          path: rel.split("\\").join("/"),
          isDir: ent.isDirectory(),
        });
        if (out.length >= 40) break;
      }
      out.sort((a, b) => {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
        return a.path.localeCompare(b.path);
      });
      return out;
    } catch {
      return [];
    }
  }

  private handleNotification(
    method: string,
    params: JsonValue | undefined,
  ): void {
    if (method === "session/update") {
      this.handleSessionUpdate(asRecord(params));
      return;
    }
    if (
      method === "_x.ai/sessions/changed" ||
      method === "x.ai/sessions/changed"
    ) {
      void this.refreshHistory();
    }
  }

  private handleSessionUpdate(
    params: Record<string, JsonValue> | null,
  ): void {
    if (!params) return;
    const updateSessionId =
      asString(params.sessionId) ?? asString(params.session_id);

    // Route background-session updates into the parked runtime.
    if (
      updateSessionId &&
      this.sessionId &&
      updateSessionId !== this.sessionId
    ) {
      let bag = this.runtimes.get(updateSessionId);
      if (!bag) {
        // Unexpected update for unknown session — ignore.
        return;
      }
      this.withParkedRuntime(bag, () => {
        this.handleSessionUpdateOnActive(params);
      });
      // Sidebar status (running spinner) must refresh even if UI is elsewhere.
      this.emitSnapshotThrottled();
      return;
    }

    // Update for focused session, or no sessionId on the wire.
    if (
      updateSessionId &&
      !this.sessionId &&
      this.runtimes.has(updateSessionId)
    ) {
      const bag = this.runtimes.get(updateSessionId)!;
      this.withParkedRuntime(bag, () => {
        this.handleSessionUpdateOnActive(params);
      });
      this.emitSnapshotThrottled();
      return;
    }

    this.handleSessionUpdateOnActive(params);
  }

  /** Apply session/update against the currently hydrated (active) fields. */
  private handleSessionUpdateOnActive(
    params: Record<string, JsonValue>,
  ): void {
    // Context usage is stamped on every live (and replay) notification.
    this.noteTokensFromMeta(
      asRecord(params._meta as JsonValue) ??
        asRecord(params.meta as JsonValue),
    );
    const update = asRecord(params.update);
    if (!update) return;
    const kind = asString(update.sessionUpdate);
    if (!kind) return;

    // Skip streaming flag during replay — history should look finished
    const streaming = !this.replaying;

    if (kind === "user_message_chunk") {
      // Live prompts already append the user bubble in sendPrompt — skip echo.
      // Session load replay needs these to rebuild history.
      if (!this.replaying) return;
      const content = asRecord(update.content);
      const text = asString(content?.text) ?? "";
      if (!text) return;
      this.pushTimeline({ id: newId("user"), kind: "user", text });
      this.streamingAssistantId = null;
      this.streamingThoughtId = null;
      return;
    }

    if (kind === "agent_message_chunk") {
      const content = asRecord(update.content);
      const text = asString(content?.text) ?? "";
      if (!text) return;
      // Thought block ended when assistant text starts — clear its caret.
      this.finalizeStreamingThought();
      if (!this.streamingAssistantId) {
        this.streamingAssistantId = newId("asst");
        this.pushTimeline({
          id: this.streamingAssistantId,
          kind: "assistant",
          text,
          streaming,
        });
      } else {
        const id = this.streamingAssistantId;
        this.updateTimeline(
          id,
          (item) => {
            if (item.kind !== "assistant") return item;
            return { ...item, text: item.text + text, streaming };
          },
          { throttle: true },
        );
      }
      return;
    }

    if (kind === "agent_thought_chunk") {
      // Keep thoughts, but they'll be collapsible in UI
      const content = asRecord(update.content);
      const text = asString(content?.text) ?? "";
      if (!text) return;
      // New thought after assistant text (or tools) — close assistant caret.
      if (!this.streamingThoughtId) {
        this.finalizeStreamingAssistant();
        this.streamingThoughtId = newId("th");
        this.pushTimeline({
          id: this.streamingThoughtId,
          kind: "thought",
          text,
          streaming,
        });
      } else {
        const id = this.streamingThoughtId;
        this.updateTimeline(
          id,
          (item) => {
            if (item.kind !== "thought") return item;
            return { ...item, text: item.text + text, streaming };
          },
          { throttle: true },
        );
      }
      return;
    }

    if (kind === "tool_call") {
      const toolCallId = asString(update.toolCallId) ?? newId("tool");
      const title = asString(update.title) ?? "tool";
      const status = asString(update.status) ?? "pending";
      const toolKind = asString(update.kind);
      const content = toolContentFields(update);
      const id = newId("tool");
      this.toolIndex.set(toolCallId, id);
      // Tool interrupts the stream — must clear streaming or the caret sticks.
      this.finalizeStreaming();
      this.pushTimeline({
        id,
        kind: "tool",
        toolCallId,
        title,
        status,
        toolKind,
        ...(content.hasContent
          ? {
              diffs: content.diffs,
              outputText: content.outputText,
              outputTruncated: content.outputTruncated,
            }
          : {}),
      });
      return;
    }

    if (kind === "tool_call_update") {
      const toolCallId = asString(update.toolCallId);
      if (!toolCallId) return;
      const content = toolContentFields(update);
      let id = this.toolIndex.get(toolCallId);
      if (!id) {
        // Late tool card without a prior tool_call — still end open stream carets.
        this.finalizeStreaming();
        id = newId("tool");
        this.toolIndex.set(toolCallId, id);
        this.pushTimeline({
          id,
          kind: "tool",
          toolCallId,
          title: asString(update.title) ?? toolCallId,
          status: asString(update.status) ?? "in_progress",
          toolKind: asString(update.kind),
          ...(content.hasContent
            ? {
                diffs: content.diffs,
                outputText: content.outputText,
                outputTruncated: content.outputTruncated,
              }
            : {}),
        });
        return;
      }
      this.updateTimeline(id, (item) => {
        if (item.kind !== "tool") return item;
        // ACP: content replaces the previous collection when present.
        const next: Extract<TimelineItem, { kind: "tool" }> = {
          ...item,
          title: asString(update.title) ?? item.title,
          status: asString(update.status) ?? item.status,
          toolKind: asString(update.kind) ?? item.toolKind,
        };
        if (content.hasContent) {
          next.diffs = content.diffs;
          next.outputText = content.outputText;
          next.outputTruncated = content.outputTruncated;
        }
        return next;
      });
      return;
    }

    if (
      kind === "available_commands_update" ||
      kind === "availableCommandsUpdate"
    ) {
      // Skip historical catalog spam during session/load replay.
      if (this.replaying) return;
      const cmds = parseAvailableCommands(
        (update.availableCommands ?? update.available_commands) as
          | JsonValue
          | undefined,
      );
      this.applyAvailableCommands(cmds);
      return;
    }

    // ── Compaction lifecycle (auto + manual) ──────────────────────────
    if (kind === "auto_compact_started") {
      if (this.replaying) return;
      const percentage =
        asNumber(update.percentage) ??
        asNumber(update.percent) ??
        asNumber(update.context_window);
      this.beginCompact("auto", percentage);
      return;
    }

    if (
      kind === "compaction_checkpoint" ||
      kind === "CompactionCheckpoint"
    ) {
      // Checkpoint is written mid-compact; treat as "running" if we missed start.
      if (this.replaying) return;
      if (!this.compacting) this.beginCompact(this.compactTimelineId ? "manual" : "auto");
      return;
    }

    if (kind === "auto_compact_completed") {
      const tokensBefore =
        asNumber(update.tokens_before) ?? asNumber(update.tokensBefore);
      const tokensAfter =
        asNumber(update.tokens_after) ?? asNumber(update.tokensAfter);
      const message =
        asString(update.summary_preview) ??
        asString(update.summaryPreview) ??
        undefined;
      if (typeof tokensAfter === "number") {
        this.setTokensUsed(tokensAfter);
      }
      if (this.replaying) {
        // Surface a completed boundary when replaying history.
        this.pushTimeline({
          id: newId("compact"),
          kind: "compact",
          status: "completed",
          mode: "auto",
          tokensBefore,
          tokensAfter,
          message,
        });
        return;
      }
      // Preserve manual/auto from the in-flight card when present.
      this.finishCompact("completed", { tokensBefore, tokensAfter, message });
      return;
    }

    if (kind === "auto_compact_failed") {
      if (this.replaying) return;
      this.finishCompact("failed", {
        message: asString(update.message) ?? asString(update.error) ?? undefined,
      });
      return;
    }

    if (kind === "auto_compact_cancelled") {
      if (this.replaying) return;
      this.finishCompact("cancelled");
      return;
    }

    if (kind === "auto_continue_completed") {
      if (this.replaying) return;
      // Resume banner after auto-compact continues the interrupted turn.
      this.pushTimeline({
        id: newId("sys"),
        kind: "system",
        text: "Resumed after compaction.",
      });
      return;
    }

    if (kind === "memory_flush_started") {
      if (this.replaying || !this.compacting) return;
      // Optional enrichment while compacting — keep card running.
      return;
    }

    if (kind === "current_mode_update" || kind === "currentModeUpdate") {
      if (this.replaying) return;
      const modeId =
        asString(update.currentModeId) ??
        asString(update.current_mode_id) ??
        asString(update.modeId);
      if (
        modeId === "default" ||
        modeId === "plan" ||
        modeId === "ask"
      ) {
        this.sessionMode = modeId;
        this.emitSnapshot();
      }
      return;
    }

    // turn_completed / session_recap / retry_state: ignore for now
  }

  private async handleReverseRequest(
    _id: number | string,
    method: string,
    params: JsonValue | undefined,
  ): Promise<JsonValue> {
    if (
      method === "session/request_permission" ||
      method.endsWith("request_permission")
    ) {
      const ui = this.parsePermissionRequest(params);
      if (!ui) {
        this.log("warn", "Permission request with no options; cancelling");
        return { outcome: { outcome: "cancelled" } };
      }
      const rec = asRecord(params);
      const permSessionId =
        asString(rec?.sessionId) ??
        asString(rec?.session_id) ??
        this.sessionId;
      // YOLO: auto-pick plain allow-once without showing the UI.
      if (this.alwaysApprove) {
        const opt =
          ui.options.find(
            (o) =>
              o.kind === "allow_once" &&
              o.optionId !== ENABLE_ALWAYS_APPROVE_OPTION_ID,
          ) ??
          ui.options.find((o) => o.kind === "allow_once") ??
          ui.options[0];
        if (!opt) return { outcome: { outcome: "cancelled" } };
        this.log(
          "info",
          `Permission auto-allowed (always-approve): ${ui.title} → ${opt.optionId}`,
        );
        return { outcome: { outcome: "selected", optionId: opt.optionId } };
      }
      this.log(
        "info",
        `Permission requested: ${ui.title} (${ui.options.length} options)` +
          (permSessionId ? ` session=${permSessionId}` : ""),
      );
      return await new Promise<JsonValue>((resolve) => {
        this.permissionQueue.push({
          ui,
          sessionId: permSessionId,
          resolve,
        });
        this.emitSnapshot();
      });
    }
    this.log("warn", `Unhandled reverse request: ${method}`);
    return {};
  }

  async sendPrompt(payload: PromptPayload | string): Promise<void> {
    const p: PromptPayload =
      typeof payload === "string" ? { text: payload } : payload;
    const attachments = p.attachments ?? [];
    let text = p.text ?? "";

    // Ensure file attachments appear as @path tokens in text for server expand.
    const mentionBits: string[] = [];
    for (const a of attachments) {
      if (a.kind === "file" || (a.kind === "image" && !this.acceptsImages)) {
        const token = a.displayPath.startsWith("@")
          ? a.displayPath
          : `@${a.displayPath}`;
        if (!text.includes(token) && !text.includes(a.displayPath)) {
          mentionBits.push(token);
        }
      }
    }
    if (mentionBits.length > 0) {
      text = `${mentionBits.join(" ")}${text.trim() ? `\n\n${text}` : ""}`;
    }

    const trimmed = text.trim();
    const imageBlocks = attachments.filter(
      (a) =>
        a.kind === "image" &&
        this.acceptsImages &&
        a.dataBase64 &&
        a.mimeType,
    );
    if (!trimmed && imageBlocks.length === 0) return;

    if (!this.sessionId) {
      throw new Error("No active session — create or open one first");
    }
    const client = this.requireClient();
    if (this.busy) throw new Error("A prompt is already running in this session");

    // Capture so a mid-flight session switch does not let this turn corrupt
    // the next session's busy flag / timeline. Other sessions may run in parallel.
    const promptSessionId = this.sessionId;
    const stillThisSession = () => this.sessionId === promptSessionId;
    const applyToPromptSession = (fn: () => void): void => {
      if (stillThisSession()) {
        fn();
        this.syncActiveIntoRuntimes();
        return;
      }
      const bag = this.runtimes.get(promptSessionId);
      if (!bag) return;
      this.withParkedRuntime(bag, fn);
    };

    this.busy = true;
    this.finalizeStreaming();

    const displayText =
      trimmed ||
      (imageBlocks.length > 0
        ? `[${imageBlocks.length} image${imageBlocks.length > 1 ? "s" : ""}]`
        : "");
    this.pushTimeline({ id: newId("user"), kind: "user", text: displayText });
    if (!this.sessionTitle || this.sessionTitle === "New session") {
      this.sessionTitle =
        displayText.length > 48
          ? `${displayText.slice(0, 48)}…`
          : displayText || "New session";
    }

    // Manual /compact: show progress immediately (agent may only emit
    // compaction_checkpoint / completion events, not a message stream).
    const isManualCompact =
      /^\/compact(?:\s|$)/i.test(trimmed) && imageBlocks.length === 0;
    if (isManualCompact) {
      this.beginCompact("manual");
    }

    this.markRuntimeHydrated(promptSessionId, true);
    this.syncActiveIntoRuntimes();
    this.emitSnapshot();

    const prompt: JsonValue[] = [];
    if (trimmed) {
      prompt.push({ type: "text", text: trimmed });
    }
    for (const img of imageBlocks) {
      const block: Record<string, JsonValue> = {
        type: "image",
        data: img.dataBase64!,
        mimeType: img.mimeType!,
      };
      if (img.path) block.uri = `file://${img.path}`;
      prompt.push(block);
    }

    try {
      const promptResult = asRecord(
        await client.request(
          "session/prompt",
          {
            sessionId: promptSessionId,
            prompt,
          },
          600_000,
        ),
      );
      applyToPromptSession(() => {
        // Some agents stamp final context usage on the prompt response `_meta`.
        this.noteTokensFromMeta(
          asRecord(promptResult?._meta as JsonValue) ??
            asRecord(promptResult?.meta as JsonValue),
        );
        // If agent finished compact without a completion event, close the card.
        if (isManualCompact && this.compacting) {
          this.finishCompact("completed", { mode: "manual" });
        }
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      applyToPromptSession(() => {
        if (isManualCompact && this.compacting) {
          const cancelled = /cancel/i.test(message);
          this.finishCompact(cancelled ? "cancelled" : "failed", {
            mode: "manual",
            message: cancelled ? undefined : message,
          });
        }
        this.pushTimeline({
          id: newId("sys"),
          kind: "system",
          text: `Prompt error: ${message}`,
        });
      });
      throw err;
    } finally {
      applyToPromptSession(() => {
        this.finalizeStreaming();
        this.busy = false;
        // Prompt settled while a compact card is still open (cancel / missed event).
        if (this.compacting) {
          this.finishCompact(isManualCompact ? "cancelled" : "completed");
        }
      });
      // Always refresh list status (running → idle) even if focus moved.
      this.emitSnapshot();
      void this.refreshHistory();
      if (stillThisSession()) {
        void this.refreshContextUsage();
      }
    }
  }

  /** Build PromptAttachment list from absolute file paths. */
  async attachmentsFromPaths(paths: string[]): Promise<PromptAttachment[]> {
    const out: PromptAttachment[] = [];
    for (const abs of paths) {
      try {
        const st = await stat(abs);
        if (!st.isFile()) continue;
        const name = basename(abs);
        const displayPath = workspaceRelative(this.workspace, abs);
        const lower = name.toLowerCase();
        const isImage = /\.(png|jpe?g|gif|webp|bmp)$/i.test(lower);
        if (isImage && this.acceptsImages) {
          const { readFile } = await import("node:fs/promises");
          const buf = await readFile(abs);
          if (buf.length > 12 * 1024 * 1024) {
            // too large — fall back to path mention
            out.push({
              id: newId("att"),
              kind: "file",
              path: abs,
              displayPath,
              name,
              sizeBytes: st.size,
            });
            continue;
          }
          const mime =
            lower.endsWith(".png")
              ? "image/png"
              : lower.endsWith(".gif")
                ? "image/gif"
                : lower.endsWith(".webp")
                  ? "image/webp"
                  : "image/jpeg";
          out.push({
            id: newId("att"),
            kind: "image",
            path: abs,
            displayPath,
            name,
            mimeType: mime,
            dataBase64: buf.toString("base64"),
            sizeBytes: st.size,
          });
        } else {
          out.push({
            id: newId("att"),
            kind: "file",
            path: abs,
            displayPath,
            name,
            sizeBytes: st.size,
          });
        }
      } catch (err) {
        this.log(
          "warn",
          `Skip attachment ${abs}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    return out;
  }

  async cancel(): Promise<void> {
    if (!this.client || !this.sessionId || this.connection !== "ready") return;
    // Only cancel the focused session — other concurrent turns keep running.
    const sid = this.sessionId;
    this.cancelPermissionsForSession(sid, "session cancel");
    this.emitSnapshot();
    try {
      await this.client.request("session/cancel", {
        sessionId: sid,
      });
      this.log("info", `Cancel sent session=${sid}`);
      // Prompt promise will reject/settle; if compact is mid-flight, surface cancel.
      if (this.compacting) {
        this.finishCompact("cancelled");
      }
      this.busy = false;
      this.syncActiveIntoRuntimes();
      this.emitSnapshot();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.log("warn", `Cancel failed: ${message}`);
    }
  }

  private async stopProcessOnly(): Promise<void> {
    this.authenticated = false;
    this.stopUsagePoll();
    try {
      this.client?.close();
    } catch {
      /* ignore */
    }
    this.client = null;

    const child = this.child;
    this.child = null;
    if (child && child.exitCode === null) {
      await new Promise<void>((resolve) => {
        const killTimer = setTimeout(() => {
          try {
            child.kill("SIGKILL");
          } catch {
            /* ignore */
          }
          resolve();
        }, 3000);
        child.once("exit", () => {
          clearTimeout(killTimer);
          resolve();
        });
        try {
          child.kill("SIGTERM");
        } catch {
          clearTimeout(killTimer);
          resolve();
        }
      });
    }
  }

  async stop(): Promise<void> {
    this.connection = "stopped";
    this.busy = false;
    this.sessionId = undefined;
    this.runtimes.clear();
    this.cancelAllPermissions("stop");
    await this.stopProcessOnly();
    this.emitSnapshot();
  }
}
