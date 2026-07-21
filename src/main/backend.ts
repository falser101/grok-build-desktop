import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { randomBytes } from "node:crypto";
import { access, readFile, readdir, stat } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { basename, relative, isAbsolute, join, resolve } from "node:path";
import { homedir } from "node:os";
import {
  AcpClient,
  isAbsorbedByStream,
  type JsonValue,
} from "../shared/acp-client";
import {
  readAlwaysApproveFromConfig,
  readAutoTrustNewSessionsFromConfig,
  writeAlwaysApproveToConfig,
  writeAutoTrustNewSessionsToConfig,
} from "./config-permission";
import type {
  AgentUiEvent,
  AppSnapshot,
  AskUserQuestionItemUi,
  AskUserQuestionMode,
  AskUserQuestionOptionUi,
  AskUserQuestionResponse,
  AskUserQuestionUi,
  AvailableCommand,
  ConnectionState,
  FolderTrustConfigKind,
  FolderTrustOutcome,
  FolderTrustPromptUi,
  ForkSessionResult,
  InstallerChannel,
  InstallerStatus,
  ModelInfo,
  PathSuggestion,
  PermissionOptionUi,
  PermissionRequestUi,
  PlanApprovalOutcome,
  PlanApprovalUi,
  PromptAttachment,
  PromptPayload,
  SearchSessionsOptions,
  SessionModeId,
  SessionRunStatus,
  SessionSearchHit,
  SessionSummary,
  TimelineItem,
  TodoItemUi,
  TodoPriority,
  TodoStatus,
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

/** Max base64 payload size we mirror back onto a timeline user item.
 *  Larger images are stored as file-kind without dataBase64 — the user
 *  bubble will render a file chip instead of an inline preview, but
 *  the timeline snapshot stays reasonable. ~8 MB base64 ≈ 6 MB raw
 *  — comfortably fits a 4K screenshot. */
const TIMELINE_ATTACHMENT_DATA_B64_MAX = 8_000_000;

/** Strip / downscale attachment payloads before stamping them on a
 *  TimelineItem. The agent has already received the full payload via
 *  `session/prompt`; this is purely for UI mirror. */
function stripAttachmentForTimeline(a: PromptAttachment): PromptAttachment {
  if (a.kind !== "image" || !a.dataBase64) return a;
  if (a.dataBase64.length <= TIMELINE_ATTACHMENT_DATA_B64_MAX) return a;
  // Oversized image: keep metadata, drop the inline bytes. Bubble will
  // render a file-style chip with the filename only.
  const { dataBase64: _drop, ...rest } = a;
  return { ...rest, dataBase64: undefined };
}

interface PendingPermissionEntry {
  ui: PermissionRequestUi;
  /** Session that owns this permission prompt (for concurrent multi-session). */
  sessionId?: string;
  resolve: (result: JsonValue) => void;
}

interface PendingPlanApprovalEntry {
  ui: PlanApprovalUi;
  resolve: (result: JsonValue) => void;
}

interface PendingQuestionEntry {
  ui: AskUserQuestionUi;
  resolve: (result: JsonValue) => void;
}

interface PendingTrustPromptEntry {
  ui: FolderTrustPromptUi;
  /** Session this prompt belongs to (matches `request.sessionId`). */
  sessionId?: string;
  resolve: (result: JsonValue) => void;
  /** Timer for the 30 min client-decision timeout (mirrors agent side). */
  timer: ReturnType<typeof setTimeout> | null;
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
  suppressStreamingAfterCancel: boolean;
  tokensUsed?: number;
  contextWindow?: number;
  modelId?: string;
  sessionMode: SessionModeId;
  reasoningEffort?: string;
  availableModels: ModelInfo[];
  toolIndex: Map<string, string>;
  todos: TodoItemUi[];
  planContent?: string;
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
    suppressStreamingAfterCancel: false,
    sessionMode: "default",
    availableModels: [],
    toolIndex: new Map(),
    todos: [],
    hydrated: false,
  };
}

/** Same encoding as CLI `urlencoding::encode` for session dir names. */
function encodeSessionCwd(cwd: string): string {
  return encodeURIComponent(cwd);
}

function planFilePath(cwd: string, sessionId: string): string {
  return join(
    homedir(),
    ".grok",
    "sessions",
    encodeSessionCwd(cwd),
    sessionId,
    "plan.md",
  );
}

function parseTodoStatus(raw: string | undefined): TodoStatus {
  const s = (raw ?? "pending").toLowerCase().replace(/-/g, "_");
  if (s === "in_progress" || s === "inprogress") return "in_progress";
  if (s === "completed" || s === "complete" || s === "done") return "completed";
  if (s === "cancelled" || s === "canceled") return "cancelled";
  return "pending";
}

function parseTodoPriority(raw: string | undefined): TodoPriority {
  const s = (raw ?? "medium").toLowerCase();
  if (s === "high") return "high";
  if (s === "low") return "low";
  return "medium";
}

/** Parse ACP Plan entries into UI todos. */
function parsePlanEntries(raw: JsonValue | undefined): TodoItemUi[] {
  if (!Array.isArray(raw)) return [];
  const out: TodoItemUi[] = [];
  for (let i = 0; i < raw.length; i++) {
    const rec = asRecord(raw[i] as JsonValue);
    if (!rec) continue;
    const content =
      asString(rec.content) ?? asString(rec.text) ?? asString(rec.title);
    if (!content?.trim()) continue;
    const meta = asRecord(rec.meta as JsonValue);
    const cancelled =
      meta?.cancelled === true ||
      meta?.canceled === true ||
      asString(meta?.status)?.toLowerCase() === "cancelled";
    let status = parseTodoStatus(
      asString(rec.status) ?? asString(rec.planEntryStatus),
    );
    if (cancelled && status === "completed") status = "cancelled";
    const id =
      asString(meta?.id) ??
      asString(rec.id) ??
      `todo-${i}-${content.slice(0, 24)}`;
    out.push({
      id,
      content: content.trim(),
      status,
      priority: parseTodoPriority(
        asString(rec.priority) ?? asString(rec.planEntryPriority),
      ),
    });
  }
  return out;
}

function asRecord(v: unknown): Record<string, JsonValue> | null {
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
function parseBillingUsage(raw: unknown): UsageInfo {
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

function mergeAutoTopup(usage: UsageInfo, raw: unknown): UsageInfo {
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

// Installer-related helpers live in `./agent-installer.ts` so this file can
// stay focused on the agent process lifecycle (spawn / connect / teardown).
import {
  resolveGrokBinary,
  resolveGrokBinaryDetailed,
  runGrokInstaller as runGrokInstallerImpl,
  upgrade as upgradeInstallerImpl,
  checkForUpdate as checkForUpdateImpl,
  getInstallerStatus as getInstallerStatusImpl,
  getChannel as getChannelImpl,
  setChannel as setChannelImpl,
  rollbackBinary,
  ensureBackupExists,
  grokInstallCommand,
  GROK_INSTALL_URL_SH,
  GROK_INSTALL_URL_PS1,
} from "./agent-installer";
export { resolveGrokBinary, resolveGrokBinaryDetailed, grokInstallCommand };
// Back-compat: keep old names so existing imports (notably index.ts and
// account-manager.ts) keep working without churn.
export { runGrokInstallerImpl as runGrokInstaller };
export const GROK_INSTALL_URL_SH_EXPORTED = GROK_INSTALL_URL_SH;
export const GROK_INSTALL_URL_PS1_EXPORTED = GROK_INSTALL_URL_PS1;
export type { ResolveGrokResult } from "./agent-installer";
// Back-compat alias: old code referenced `GrogInstallerResult` (typo); the
// canonical name in the new module is `InstallerResult`. Re-export under
// both names so older imports keep working.
export type InstallerResult = import("./agent-installer").InstallerResult;
export type GrogInstallerResult = InstallerResult;

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
 * Length of the longest suffix of `buf` (starting at `from`) that is also
 * a strict prefix of `tag`. Used to decide how many trailing characters
 * of a streaming chunk look like the start of an unclosed <think>/</think>
 * and should be held until the next chunk arrives.
 */
function tailPrefixLen(buf: string, from: number, tag: string): number {
  const end = buf.length;
  const max = Math.min(tag.length - 1, end - from);
  for (let h = max; h >= 1; h--) {
    if (tag.startsWith(buf.slice(end - h))) return h;
  }
  return 0;
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
  val: unknown,
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
  /**
   * True iff SOMETHING lets the agent authenticate to the official Grok
   * account — `grok login` cached token, desktop-stored API key, or
   * inline env var. When false, the desktop stays connected but skips
   * the agent's `authenticate` step, and the renderer shows "未登录" so
   * users know Grok official models won't work but custom providers can
   * still be used.
   */
  private accountAvailable = false;
  private usage?: UsageInfo;
  private timeline: TimelineItem[] = [];
  private sessions: SessionSummary[] = [];
  private busy = false;
  private replaying = false;
  private compacting = false;
  private compactTimelineId: string | null = null;
  private streamingAssistantId: string | null = null;
  private streamingThoughtId: string | null = null;
  /**
   * When true, suppress agent_message_chunk / agent_thought_chunk
   * from reaching the timeline. Armed by cancel() / cancelSession()
   * so that in-flight model chunks arriving after the user clicks
   * "stop" don't keep appending to the conversation UI. Reset when
   * the next user prompt starts (busy flips to true).
   */
  private suppressStreamingAfterCancel = false;
  /**
   * Some custom models (DeepSeek R1, Qwen QwQ, MiniMax, …) emit
   * `<think>...</think>` inline in the assistant content instead of using
   * a separate thought channel. Track state across chunks so we can split
   * those tags into their own collapsible thought bubbles.
   */
  private inThinkTag = false;
  private thinkHold = "";
  private tokensUsed?: number;
  private contextWindow?: number;
  private toolIndex = new Map<string, string>();
  /** Todo list for the focused session (ACP plan updates). */
  private todos: TodoItemUi[] = [];
  /** plan.md body for the focused session. */
  private planContent?: string;
  /**
   * Live/parked runtimes for sessions that have been opened or are mid-turn.
   * The focused session is also mirrored on the fields above for the hot path.
   */
  private runtimes = new Map<string, SessionRuntime>();
  /** Queued permission prompts; only the front is exposed in the snapshot. */
  private permissionQueue: PendingPermissionEntry[] = [];
  /**
   * Pending plan-mode exit approvals (not YOLO-auto-allowed).
   * Only the focused-session (or unscoped) entry is exposed in the snapshot.
   */
  private planApprovalQueue: PendingPlanApprovalEntry[] = [];
  /**
   * Pending `x.ai/ask_user_question` questionnaires (not YOLO-auto-answered).
   * Only the focused-session (or unscoped) entry is exposed in the snapshot.
   */
  private questionQueue: PendingQuestionEntry[] = [];
  /**
   * Pending folder-trust prompts (`x.ai/folder_trust/request`).
   * Mirrors the agent-side `interactive_trust_prompted` set; only the front
   * of the queue is surfaced via the snapshot.
   */
  private trustPromptQueue: PendingTrustPromptEntry[] = [];
  /** Always-approve (YOLO) — skip permission UI and auto-allow tools. */
  private alwaysApprove = false;
  /**
   * Auto-grant folder trust before opening a new session (the desktop
   * equivalent of `grok --trust <cwd>`). Read from / written to
   * `~/.grok/config.toml [ui].auto_trust_new_sessions`. Default false:
   * the agent's gate stays interactive by default, matching CLI behaviour.
   */
  private autoTrustNewSessions = false;
  /**
   * Snapshot of the grok CLI installer. Refreshed:
   *   - on app start (background, non-blocking)
   *   - after every install / upgrade IPC round-trip
   *   - after each successful `connect` (resyncs against what's on disk)
   * Renderer reads this from `AppSnapshot.installerStatus`.
   */
  private installerStatus: InstallerStatus = { kind: "absent" };
  /** Channel the user picked in Settings → Agent. */
  private installerChannel: InstallerChannel = "stable";
  /** ISO timestamp of the last background update probe. */
  private lastUpdateCheckAt?: string;
  /**
   * True between `upgradeAgent()` returning success and the next
   * `connectInner()` confirming the new agent is healthy. Used to gate
   * the rollback hook so we only fire on upgrade-induced crashes, not
   * on normal in-session agent crashes.
   */
  private upgradePending = false;
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
    const activePerm = this.sessionId
      ? this.permissionQueue.find(
          (e) => !e.sessionId || e.sessionId === this.sessionId,
        )
      : undefined;
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
      /**
       * True iff the desktop thinks the agent can reach an account.
       * When false the renderer shows "未登录" and warns that official
       * Grok models need a login (or XAI_API_KEY); custom providers
       * configured with their own keys still work.
       */
      accountAvailable: this.accountAvailable,
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
      agentInstallUrl: GROK_INSTALL_URL_SH_EXPORTED,
      replaying: this.replaying,
      tokensUsed: this.tokensUsed,
      contextWindow: this.contextWindow,
      pendingPermission: activePerm
        ? {
            ...activePerm.ui,
            options: activePerm.ui.options.map((o) => ({ ...o })),
          }
        : undefined,
      pendingQuestion: this.activeQuestion()
        ? this.cloneQuestionUi(this.activeQuestion()!)
        : undefined,
      pendingTrustPrompt: this.activeTrustPrompt()
        ? { ...this.activeTrustPrompt()! }
        : undefined,
      alwaysApprove: this.alwaysApprove,
    /**
     * Settings → Permissions: when true, the desktop grants trust for the
     * workspace cwd before each `session/new`. Equivalent to `grok --trust
     * <cwd>` for the CLI. Persisted in `~/.grok/config.toml [ui].
     * auto_trust_new_sessions` so the setting survives restarts.
     */
    autoTrustNewSessions: this.autoTrustNewSessions,
      // Todos / planContent are turn-scoped UI artifacts: only expose them
      // while the agent is running the current turn. Once `busy` flips to
      // false, the previous turn's checklist must not linger in the UI
      // (matches codex / claude desktop behavior). plan.md on disk is
      // untouched — see planFilePath().
      todos: this.busy ? this.todos.map((t) => ({ ...t })) : [],
      planContent: this.busy ? this.planContent : undefined,
      pendingPlanApproval: this.activePlanApproval()
        ? { ...this.activePlanApproval()! }
        : undefined,
      installerStatus: this.installerStatus,
      installerChannel: this.installerChannel,
      lastUpdateCheckAt: this.lastUpdateCheckAt,
    };
  }

  /**
   * Drop the per-turn todos / planContent so the next snapshot (even if it
   * races ahead of the busy=false write) reports an empty checklist. Safe
   * to call on the active or a parked session.
   */
  private clearTurnPlanArtifacts(): void {
    this.todos = [];
    this.planContent = undefined;
    this.syncActiveIntoRuntimes();
  }

  /** Front-of-queue plan approval for the focused session (if any). */
  private activePlanApproval(): PlanApprovalUi | undefined {
    if (!this.sessionId) return undefined;
    const entry = this.planApprovalQueue.find(
      (e) => !e.ui.sessionId || e.ui.sessionId === this.sessionId,
    );
    return entry?.ui;
  }

  /** Front-of-queue questionnaire for the focused session (if any). */
  private activeQuestion(): AskUserQuestionUi | undefined {
    if (!this.sessionId) return undefined;
    const entry = this.questionQueue.find(
      (e) => !e.ui.sessionId || e.ui.sessionId === this.sessionId,
    );
    return entry?.ui;
  }

  private cloneQuestionUi(ui: AskUserQuestionUi): AskUserQuestionUi {
    return {
      ...ui,
      questions: ui.questions.map((q) => ({
        ...q,
        options: q.options.map((o) => ({ ...o })),
      })),
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
      suppressStreamingAfterCancel: this.suppressStreamingAfterCancel,
      tokensUsed: this.tokensUsed,
      contextWindow: this.contextWindow,
      modelId: this.modelId,
      sessionMode: this.sessionMode,
      reasoningEffort: this.reasoningEffort,
      availableModels: this.availableModels,
      toolIndex: this.toolIndex,
      todos: this.todos,
      planContent: this.planContent,
      hydrated: prev?.hydrated ?? true,
    });
  }

  private sessionRunStatus(sessionId: string): SessionRunStatus {
    if (
      this.trustPromptQueue.some(
        (e) => e.sessionId === sessionId,
      )
    ) {
      return "needs_trust";
    }
    if (
      this.questionQueue.some(
        (e) => e.ui.sessionId === sessionId,
      )
    ) {
      return "needs_question";
    }
    if (
      this.permissionQueue.some(
        (e) => e.sessionId === sessionId,
      ) ||
      this.planApprovalQueue.some(
        (e) => e.ui.sessionId === sessionId,
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
        todos: rt.todos.map((t) => ({ ...t })),
        planContent: rt.planContent,
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
    this.todos = [];
    this.planContent = undefined;
    this.busy = false;
    this.replaying = false;
    this.compacting = false;
    this.compactTimelineId = null;
    this.streamingAssistantId = null;
    this.streamingThoughtId = null;
    this.inThinkTag = false;
    this.thinkHold = "";
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
    this.suppressStreamingAfterCancel = rt.suppressStreamingAfterCancel;
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
    this.todos = rt.todos;
    this.planContent = rt.planContent;
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
          suppressStreamingAfterCancel: this.suppressStreamingAfterCancel,
          tokensUsed: this.tokensUsed,
          contextWindow: this.contextWindow,
          modelId: this.modelId,
          sessionMode: this.sessionMode,
          reasoningEffort: this.reasoningEffort,
          availableModels: this.availableModels,
          toolIndex: this.toolIndex,
          todos: this.todos,
          planContent: this.planContent,
          hydrated: true,
        }
      : null;

    this.hydrateFromRuntime(rt);
    this.parkedDepth++;
    try {
      fn();
      this.syncActiveIntoRuntimes();
    } finally {
      this.parkedDepth--;
      if (focusSnap) {
        this.hydrateFromRuntime(focusSnap);
      } else {
        this.sessionId = undefined;
        this.sessionTitle = undefined;
        this.timeline = [];
        this.toolIndex = new Map();
        this.todos = [];
        this.planContent = undefined;
        this.busy = false;
        this.replaying = false;
        this.compacting = false;
        this.compactTimelineId = null;
        this.streamingAssistantId = null;
        this.streamingThoughtId = null;
        this.inThinkTag = false;
        this.thinkHold = "";
        this.tokensUsed = undefined;
      }
      // Background timeline mutations are kept in the parked runtime only.
      // Do not flush a full snapshot here: that would make the renderer clone
      // and reconcile the focused conversation for every background token.
      // Sidebar status is emitted explicitly by the caller when it changes.
      if (this.parkedDepth === 0) {
        this.parkedEmitPending = false;
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
   * Resolve a pending `x.ai/ask_user_question` questionnaire.
   * Never auto-answered by YOLO.
   */
  respondAskUserQuestion(
    requestId: string,
    response: AskUserQuestionResponse,
  ): void {
    const idx = this.questionQueue.findIndex(
      (e) => e.ui.requestId === requestId,
    );
    if (idx < 0) {
      this.log("warn", `Ask-user-question response for unknown id=${requestId}`);
      return;
    }
    const [entry] = this.questionQueue.splice(idx, 1);
    if (!entry) return;

    const wire = this.toAskUserQuestionWire(response);
    this.log(
      "info",
      `Ask-user-question ${response.outcome} requestId=${requestId}` +
        (entry.ui.sessionId ? ` session=${entry.ui.sessionId}` : ""),
    );
    entry.resolve(wire);
    this.emitSnapshot();
  }

  /**
   * Resolve a pending `x.ai/folder_trust/request` prompt.
   * `outcome === "trust"` grants the workspace; `"reject"` keeps it gated.
   * Auto-rejected on cancel/timeout, never auto-answered by YOLO unless
   * `alwaysApprove` was on at receive time (handled inside the handler).
   */
  respondTrustPrompt(requestId: string, outcome: FolderTrustOutcome): void {
    const idx = this.trustPromptQueue.findIndex(
      (e) => e.ui.requestId === requestId,
    );
    if (idx < 0) {
      this.log(
        "warn",
        `Trust-prompt response for unknown id=${requestId} outcome=${outcome}`,
      );
      return;
    }
    const [entry] = this.trustPromptQueue.splice(idx, 1);
    if (!entry) return;
    if (entry.timer) clearTimeout(entry.timer);
    this.log(
      "info",
      `Trust prompt ${outcome} requestId=${requestId} workspace=${entry.ui.workspace}` +
        (entry.ui.sessionId ? ` session=${entry.ui.sessionId}` : ""),
    );
    entry.resolve({ outcome });
    this.emitSnapshot();
  }

  /** Map UI response → ACP wire JSON (AskUserQuestionExtResponse). */
  private toAskUserQuestionWire(response: AskUserQuestionResponse): JsonValue {
    if (response.outcome === "accepted") {
      const body: Record<string, JsonValue> = {
        outcome: "accepted",
        answers: response.answers as unknown as JsonValue,
      };
      if (response.annotations && Object.keys(response.annotations).length > 0) {
        body.annotations = response.annotations as unknown as JsonValue;
      }
      return body;
    }
    if (response.outcome === "chat_about_this") {
      return {
        outcome: "chat_about_this",
        partial_answers: (response.partial_answers ?? {}) as unknown as JsonValue,
      };
    }
    if (response.outcome === "skip_interview") {
      return {
        outcome: "skip_interview",
        partial_answers: (response.partial_answers ?? {}) as unknown as JsonValue,
      };
    }
    return { outcome: "cancelled" };
  }

  /**
   * Resolve a pending `x.ai/exit_plan_mode` approval.
   * Never auto-approved by YOLO — plan mode always needs an explicit decision.
   */
  respondPlanApproval(
    requestId: string,
    outcome: PlanApprovalOutcome,
    feedback?: string,
  ): void {
    const idx = this.planApprovalQueue.findIndex(
      (e) => e.ui.requestId === requestId,
    );
    if (idx < 0) {
      this.log("warn", `Plan approval response for unknown id=${requestId}`);
      return;
    }
    const [entry] = this.planApprovalQueue.splice(idx, 1);
    if (!entry) return;

    const fb =
      outcome === "cancelled" && feedback?.trim()
        ? feedback.trim()
        : undefined;
    const result: Record<string, JsonValue> = { outcome };
    if (fb) result.feedback = fb;

    this.log(
      "info",
      `Plan approval ${outcome} requestId=${requestId}` +
        (fb ? ` feedback=${fb.slice(0, 80)}` : ""),
    );
    entry.resolve(result);
    this.emitSnapshot();
  }

  /**
   * Re-read plan.md for the focused session from `~/.grok/sessions/...`.
   */
  async refreshPlanContent(): Promise<string | null> {
    const body = await this.readPlanFile(
      this.workspace,
      this.sessionId,
    );
    if (body !== null) {
      this.planContent = body || undefined;
      this.syncActiveIntoRuntimes();
      this.emitSnapshot();
    }
    return this.planContent ?? null;
  }

  private async readPlanFile(
    cwd: string | undefined,
    sessionId: string | undefined,
  ): Promise<string | null> {
    if (!cwd?.trim() || !sessionId?.trim()) return null;
    try {
      const path = planFilePath(cwd, sessionId);
      const text = await readFile(path, "utf8");
      return text;
    } catch {
      return null;
    }
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

  /**
   * Toggle "auto-trust workspace before new session". When enabled, the
   * desktop grants `~/.grok/trusted_folders.toml` trust for the new
   * session's cwd right before sending `session/new`, mirroring CLI's
   * `grok --trust <cwd>` opt-in.
   *
   * Persisted in `~/.grok/config.toml [ui].auto_trust_new_sessions` so the
   * choice survives restarts and matches what the agent would do if it
   * read the same flag (forward-compat if the agent grows one).
   */
  async setAutoTrustNewSessions(enabled: boolean): Promise<void> {
    const next = Boolean(enabled);
    if (this.autoTrustNewSessions === next) {
      this.emitSnapshot();
      return;
    }
    this.autoTrustNewSessions = next;
    this.log(
      "info",
      `Auto-trust new sessions ${next ? "enabled" : "disabled"}`,
    );
    try {
      await writeAutoTrustNewSessionsToConfig(next);
    } catch (err) {
      this.log(
        "warn",
        `Failed to persist auto_trust_new_sessions: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    this.emitSnapshot();
  }

  /** Front-of-queue trust prompt scoped to the focused session. */
  private activeTrustPrompt(): FolderTrustPromptUi | undefined {
    if (!this.sessionId) return undefined;
    const front = this.trustPromptQueue.find(
      (e) => !e.sessionId || e.sessionId === this.sessionId,
    );
    return front?.ui;
  }

  /**
   * Cancel trust prompts belonging to `sessionId` (or all when `null`).
   * Same scope rules as `cancelPermissionsForSession`: only entries whose
   * `sessionId` matches are auto-rejected with `outcome: "reject"`, mirroring
   * the agent's fail-closed behavior when the client never answers.
   */
  private cancelTrustPromptsForSession(
    sessionId: string | null,
    reason: string,
  ): void {
    const kept: PendingTrustPromptEntry[] = [];
    for (const entry of this.trustPromptQueue) {
      const belongsToSession =
        sessionId === null
          ? true
          : entry.sessionId === sessionId ||
            (!entry.sessionId && this.sessionId === sessionId);
      if (sessionId !== null && !belongsToSession) {
        kept.push(entry);
        continue;
      }
      if (entry.timer) clearTimeout(entry.timer);
      this.log(
        "info",
        `Trust prompt auto-rejected (${reason}) requestId=${entry.ui.requestId}`,
      );
      entry.resolve({ outcome: "reject" });
    }
    this.trustPromptQueue = kept;
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

  private cancelAllQuestions(reason: string): void {
    if (this.questionQueue.length === 0) return;
    const pending = this.questionQueue.splice(0);
    for (const entry of pending) {
      this.log(
        "info",
        `Ask-user-question auto-cancelled (${reason}) requestId=${entry.ui.requestId}`,
      );
      entry.resolve({ outcome: "cancelled" });
    }
  }

  private cancelQuestionsForSession(sessionId: string, reason: string): void {
    const kept: PendingQuestionEntry[] = [];
    for (const entry of this.questionQueue) {
      if (entry.ui.sessionId && entry.ui.sessionId !== sessionId) {
        kept.push(entry);
        continue;
      }
      if (!entry.ui.sessionId && this.sessionId !== sessionId) {
        kept.push(entry);
        continue;
      }
      this.log(
        "info",
        `Ask-user-question auto-cancelled (${reason}) requestId=${entry.ui.requestId}`,
      );
      entry.resolve({ outcome: "cancelled" });
    }
    this.questionQueue = kept;
  }

  private applyModelsFromSession(
    modelsVal: JsonValue | undefined,
    opts?: { replaceEmpty?: boolean },
  ): void {
    const { current, available } = parseModels(modelsVal);
    // session/new often omits models on partial results — keep previous list.
    // models/update after config reload must replace even when empty.
    if (available.length > 0 || opts?.replaceEmpty) {
      this.availableModels = available;
    }
    // Only adopt the agent's "current" when we don't already have one
    // (initial session/new). After the user explicitly switches models via
    // setModel(), `this.modelId` is the source of truth — overwriting it on
    // every models/update notification would silently revert the user's pick
    // (e.g. switching back to MiniMax would get clobbered to the agent
    // default the next time models/update fires).
    if (!this.modelId && current) this.modelId = current;
    const cur = this.availableModels.find((m) => m.modelId === this.modelId);
    if (cur) {
      this.reasoningEffort = cur.reasoningEffort ?? this.reasoningEffort;
      this.acceptsImages = cur.acceptsImages !== false;
      if (typeof cur.contextWindow === "number" && cur.contextWindow > 0) {
        this.contextWindow = cur.contextWindow;
      }
    }
  }

  /**
   * Ask the agent to re-read `[model.*]` from config.toml and push a fresh
   * catalog (`x.ai/models/update`). Used after desktop provider save/delete.
   * No-op when the agent is not connected.
   */
  async reloadModelsFromConfig(): Promise<void> {
    if (!this.client?.connected || this.connection !== "ready") {
      this.log("info", "reloadModels: agent not ready — skipped");
      return;
    }
    try {
      await this.requestExt("internal/reload_models", {}, 30_000);
      this.log("info", "reloadModels: agent reloaded model list from config.toml");
      // apply_config notifies clients; if notification is delayed/lost, still
      // try a soft wait — snapshot will update when models/update arrives.
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.log("warn", `reloadModels failed: ${message}`);
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

  /**
   * Reentrancy guard for emitSnapshot / emitSnapshotThrottled. While we are
   * inside a withParkedRuntime block the active fields are temporarily the
   * parked session's data — emitting a snapshot at that moment would cause
   * the renderer's focused session to flip to the parked one, "scrambling"
   * the chat the user is currently reading. We suppress emits while parked
   * and flush a single emit on the way out (after focus is restored).
   */
  private parkedDepth = 0;
  private parkedEmitPending = false;

  private emitSnapshot(): void {
    // Flush any pending throttled stream frame first so order stays consistent.
    if (this.streamSnapTimer) {
      clearTimeout(this.streamSnapTimer);
      this.streamSnapTimer = null;
    }
    this.streamSnapPending = false;
    if (this.parkedDepth > 0) {
      // Don't emit while focus is hijacked — defer until withParkedRuntime
      // restores the user's focused session.
      this.parkedEmitPending = true;
      return;
    }
    this.emit({ type: "snapshot", snapshot: this.snapshot() });
  }

  /** Throttled emit for token-stream text deltas (agent/thought chunks). */
  private emitSnapshotThrottled(): void {
    if (this.parkedDepth > 0) {
      // Same guard as emitSnapshot: avoid emitting a snapshot whose
      // sessionId/timeline points at the parked session.
      this.parkedEmitPending = true;
      return;
    }
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
    // Stamp creation time for UI hover-tooltips. Live pushes get the real
    // wall-clock at send/receive time; replayed items get the load time
    // (the agent protocol doesn't carry historical timestamps yet).
    const stamped: TimelineItem =
      typeof item.createdAt === "number"
        ? item
        : { ...item, createdAt: Date.now() };
    this.timeline.push(stamped);
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
      this.cancelQuestionsForSession(this.sessionId, "timeline clear");
      this.cancelTrustPromptsForSession(this.sessionId, "timeline clear");
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
    // Flush any held unclosed <think> tail as thought text (best-effort).
    if (this.thinkHold) {
      if (this.streamingThoughtId) {
        const tail = this.thinkHold;
        this.updateTimeline(this.streamingThoughtId, (item) =>
          item.kind === "thought"
            ? { ...item, text: item.text + tail }
            : item,
        );
      } else {
        this.streamingThoughtId = newId("th");
        this.pushTimeline({
          id: this.streamingThoughtId,
          kind: "thought",
          text: this.thinkHold,
          streaming: false,
        });
      }
      this.thinkHold = "";
      this.inThinkTag = false;
    }
    this.finalizeStreamingAssistant();
    this.finalizeStreamingThought();
    this.inThinkTag = false;
    this.thinkHold = "";
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

  /**
   * Stateful parser for `<think>...</think>` tags embedded in assistant
   * content. Returns deltas to push to the thought/assistant bubbles
   * plus flags indicating whether a thought region just opened/closed.
   * Holds any partial tag at the end of the buffer for the next chunk.
   */
  private ingestThinkTags(chunk: string): {
    thoughtDelta: string;
    assistantDelta: string;
    openThought: boolean;
    closeThought: boolean;
  } {
    const OPEN = "<think>";
    const CLOSE = "</think>";
    const buf0 = this.thinkHold + chunk;
    this.thinkHold = "";
    let thoughtDelta = "";
    let assistantDelta = "";
    let openThought = false;
    let closeThought = false;
    let i = 0;

    while (i < buf0.length) {
      if (!this.inThinkTag) {
        // Find next <think> starting at i.
        const open = buf0.indexOf(OPEN, i);
        if (open === -1) {
          // No complete <think> in the rest of the buffer. Check the very
          // end for a partial prefix we should defer to the next chunk.
          const held = tailPrefixLen(buf0, i, OPEN);
          if (held > 0) {
            assistantDelta += buf0.slice(i, buf0.length - held);
            this.thinkHold = buf0.slice(buf0.length - held);
          } else {
            assistantDelta += buf0.slice(i);
          }
          return { thoughtDelta, assistantDelta, openThought, closeThought };
        }
        // If the tag itself spills past the end of buf0, hold the whole
        // tail and let the next chunk complete it.
        if (open + OPEN.length > buf0.length) {
          if (open > i) assistantDelta += buf0.slice(i, open);
          this.thinkHold = buf0.slice(open);
          return { thoughtDelta, assistantDelta, openThought, closeThought };
        }
        // Full <think> present.
        if (open > i) assistantDelta += buf0.slice(i, open);
        i = open + OPEN.length;
        this.inThinkTag = true;
        openThought = true;
      } else {
        // Find next </think> starting at i.
        const close = buf0.indexOf(CLOSE, i);
        if (close === -1) {
          const held = tailPrefixLen(buf0, i, CLOSE);
          if (held > 0) {
            thoughtDelta += buf0.slice(i, buf0.length - held);
            this.thinkHold = buf0.slice(buf0.length - held);
          } else {
            thoughtDelta += buf0.slice(i);
          }
          return { thoughtDelta, assistantDelta, openThought, closeThought };
        }
        if (close + CLOSE.length > buf0.length) {
          if (close > i) thoughtDelta += buf0.slice(i, close);
          this.thinkHold = buf0.slice(close);
          return { thoughtDelta, assistantDelta, openThought, closeThought };
        }
        // Full </think> present.
        if (close > i) thoughtDelta += buf0.slice(i, close);
        i = close + CLOSE.length;
        this.inThinkTag = false;
        closeThought = true;
      }
    }

    return { thoughtDelta, assistantDelta, openThought, closeThought };
  }

  async connect(): Promise<void> {
    if (this.connecting) {
      await this.connecting;
      return;
    }
    // Skip only when the WebSocket is alive AND we're already ready.
    // Soft-auth users (`authenticated=false` because no Grok creds) have
    // a perfectly usable connection — we just skip the agent's
    // `authenticate` step, so don't gate on `authenticated` here.
    if (this.client?.connected && this.connection === "ready") {
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
    try {
      this.autoTrustNewSessions = await readAutoTrustNewSessionsFromConfig();
    } catch {
      this.autoTrustNewSessions = false;
    }
    this.setState({ connection: "starting", busy: false });

    this.binaryPath = await resolveGrokBinary();
    this.secret = randomBytes(12).toString("hex");
    this.port = await getFreePort();

    this.log("info", `Using binary: ${this.binaryPath}`);
    this.log("info", `Starting agent serve on 127.0.0.1:${this.port}`);

    // Upgrade-flow safety net: if the previous upgradeAgent() left a
    // .bak behind, confirm it's still on disk (the user might have
    // manually wiped it; that's fine, we just won't be able to roll
    // back later). Then record the version we're upgrading from so
    // waitForHealthyAgent() can confirm the new agent reports higher.
    let upgradeFromVersion: string | undefined;
    if (this.upgradePending) {
      const ok = await ensureBackupExists(this.binaryPath).catch(() => false);
      if (!ok) {
        this.log(
          "warn",
          "Upgrade pending but no .bak found — rollback will be a no-op.",
        );
      }
      const cur = this.installerStatus;
      if (cur.kind === "upgrading") upgradeFromVersion = cur.from;
    }

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
    let child: ChildProcess;
    try {
      child = spawn(this.binaryPath, args, {
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, ...accountEnv },
      });
    } catch (err) {
      throw new Error(
        `Failed to launch ${this.binaryPath}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    this.child = child;

    // If the binary is missing, spawn emits 'error' asynchronously with
    // ENOENT. Translate it into a user-friendly diagnostic before the
    // generic "agent serve exited" message.
    const missingBinaryError = await new Promise<NodeJS.ErrnoException | null>(
      (resolveMissing) => {
        const timer = setTimeout(() => resolveMissing(null), 1500);
        child.once("error", (err: NodeJS.ErrnoException) => {
          clearTimeout(timer);
          resolveMissing(err);
        });
      },
    );
    if (missingBinaryError) {
      const detailed = await resolveGrokBinaryDetailed();
      const searchedHint =
        detailed.kind === "missing"
          ? `\n\nSearched:\n  ${detailed.searched.map((p) => `• ${p}`).join("\n  ")}`
          : "";
      const envHint = process.env.GROK_BINARY
        ? `\n\nGROK_BINARY is set to ${process.env.GROK_BINARY} but no file exists there.`
        : "";
      const cmd = grokInstallCommand(process.platform);
      throw new Error(
        `The 'grok' CLI was not found on this machine.${searchedHint}${envHint}\n\n` +
          `Install it with the official one-liner:\n\n  ${cmd}\n\n` +
          `Both installers place the binary at ~/.grok/bin/grok, which the desktop already searches.\n` +
          `Or set the GROK_BINARY environment variable to the absolute path of an existing grok binary.`,
      );
    }

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
      // Upgrade safety net: if the freshly-installed agent dies within
      // its first 30s, treat that as a failed upgrade and roll back to
      // the .bak copy.
      if (this.upgradePending && code !== 0) {
        void this.rollbackAfterFailedUpgrade(
          `New agent crashed during startup (exit code ${code})`,
        );
      }
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
        this.cancelAllQuestions("ws close");
        this.cancelTrustPromptsForSession(null, "ws close");
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
          // Advertise interactive folder-trust support so the agent prompts
          // the desktop (rather than auto-granting or going headless) when a
          // workspace has repo-local hooks/MCP/plugins/LSP/etc.
          meta: {
            "x.ai/folderTrust": { interactive: true },
          },
        },
        clientInfo: {
          name: "grok-build-desktop",
          version: "0.1.0",
        },
      }),
    );
    if (!initResult) throw new Error("initialize returned empty result");

    const meta = asRecord(initResult._meta);
    const previousAgentVersion = this.agentVersion;
    this.agentVersion = asString(meta?.agentVersion);
    const bootstrapCmds = parseAvailableCommands(
      meta?.availableCommands as JsonValue | undefined,
    );
    if (bootstrapCmds.length > 0) {
      this.availableCommands = bootstrapCmds;
    }
    const defaultAuth = asString(meta?.defaultAuthMethodId) ?? "cached_token";

    // Soft auth: only require a Grok credential when one is actually
    // configured. If the user hasn't logged in AND there's no API key
    // anywhere (env / desktop-store / auth.json), we leave the connection
    // alive, skip `authenticate`, and surface "未登录" to the UI. Custom
    // providers configured in Settings → Models can still be used; only
    // official Grok models will be unusable.
    const { hasAnyAuth } = await import("./account-manager");
    this.accountAvailable = await hasAnyAuth();
    if (this.accountAvailable) {
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
        this.authenticated = true;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(
          `Authentication failed (${defaultAuth}): ${message}. Sign in from Settings → Account, or run \`grok login\`.`,
        );
      }
    } else {
      this.authenticated = false;
      this.accountEmail = undefined;
      this.log(
        "warn",
        "No Grok credentials configured — skipping agent authenticate. " +
          "Custom providers still work; official Grok models will be unavailable until you log in or set XAI_API_KEY.",
      );
    }
    // Re-apply YOLO so agent serve matches desktop / config preference.
    if (this.alwaysApprove) {
      this.notifyYoloMode(true);
    }
    // Upgrade-flow health check: if we just upgraded, confirm the new
    // agent reports a higher version than the one we replaced. If not,
    // roll back. `previousAgentVersion` is the version the OLD agent
    // reported before the upgrade (or undefined on a fresh install —
    // in which case the new version is necessarily higher).
    if (this.upgradePending) {
      const expected = upgradeFromVersion ?? previousAgentVersion ?? "0.0.0";
      const currentVer = this.agentVersion ?? "";
      if (!currentVer) {
        await this.rollbackAfterFailedUpgrade(
          "New agent reported no agentVersion in initialize response",
        );
        return;
      }
      const healthy = await this.waitForHealthyAgent(30_000, expected);
      if (!healthy) {
        // rollbackAfterFailedUpgrade already ran inside waitForHealthyAgent.
        // We still let this connection finish so the (rolled-back) agent
        // is usable; the snapshot reflects the rollback.
        this.log(
          "warn",
          "Upgrade rolled back; continuing with the restored binary.",
        );
      } else {
        await this.refreshInstallerStatus();
        this.log(
          "info",
          `Upgrade verified: agent now reports ${this.agentVersion}`,
        );
      }
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
    // `authenticated` is intentionally NOT part of this check. It tracks
    // "is the user signed into a Grok account" — unrelated to whether the
    // WebSocket to agent serve is alive. When the user has no Grok
    // credential but wants to use custom providers, `authenticated` is
    // false but the client is connected and usable. Methods that genuinely
    // need a logged-in account (e.g. usage polling) gate on
    // `authenticated` separately.
    if (!this.client || !this.client.connected) {
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
  ): Promise<JsonValue | typeof import("../shared/acp-client").ABSORBED_BY_STREAM> {
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
    this.inThinkTag = false;
    this.thinkHold = "";
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

    // Drop permission prompts / questionnaires belonging to this session only.
    this.cancelPermissionsForSession(sessionId, reason);
    this.cancelQuestionsForSession(sessionId, reason);
    this.cancelTrustPromptsForSession(sessionId, reason);

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
    // Skip only when the WebSocket isn't up. Custom-provider users can
    // legitimately use slash commands without a Grok account.
    if (!this.client || !this.client.connected) return;
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

      // Auto-trust: when the user opted in via Settings, grant trust for
      // this workspace BEFORE sending `session/new` so the agent's
      // `prompt_warranted` gate never fires. Symmetric with `grok --trust
      // <cwd>` from the CLI. Failures here are non-fatal — falling through
      // to the interactive prompt is the agent's default behaviour.
      if (this.autoTrustNewSessions && workspace) {
        try {
          const { grantTrustedFolder } = await import(
            "./trusted-folders-store"
          );
          await grantTrustedFolder(workspace);
          this.log(
            "info",
            `Auto-trust granted for workspace=${workspace}`,
          );
        } catch (err) {
          this.log(
            "warn",
            `Auto-trust failed (will fall back to prompt): ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      }

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
      this.todos = [];
      this.planContent = undefined;
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

      // A queued switch can become stale while another cold load is running.
      // Re-check after acquiring the session-op lock so an old click cannot
      // switch the renderer back and make two conversations appear to flash.
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
      this.todos = [];
      this.planContent = undefined;
      this.streamingAssistantId = null;
      this.streamingThoughtId = null;
      this.inThinkTag = false;
      this.thinkHold = "";
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
        // Best-effort plan.md restore (session load may also replay Plan updates).
        const planBody = await this.readPlanFile(cwd, sessionId);
        // User may have switched away while loading — apply to the right bag.
        if (this.sessionId !== sessionId) {
          const bag = this.runtimes.get(sessionId) ?? emptyRuntime(sessionId, cwd);
          this.withParkedRuntime(bag, () => {
            this.applyModelsFromSession(result?.models);
            this.finalizeStreaming();
            this.replaying = false;
            this.busy = false;
            this.compacting = false;
            if (planBody?.trim()) this.planContent = planBody;
            const known = this.sessions.find((s) => s.sessionId === sessionId);
            if (known) this.sessionTitle = known.title;
            this.markRuntimeHydrated(sessionId, true);
          });
          this.emitSnapshot();
          return;
        }
        this.applyModelsFromSession(result?.models);
        this.finalizeStreaming();
        if (planBody?.trim()) this.planContent = planBody;
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

  /**
   * Resolve file/directory path suggestions for @-mention in the composer.
   *
   * Delegates to the CLI's `x.ai/suggest` endpoint which provides nucleo
   * fuzzy matching (exact-prefix → CI-prefix → fuzzy), shell escaping /
   * `~` / `$VAR` expansion, and scans up to 1000 entries per directory.
   */
  async pathSuggest(query: string): Promise<PathSuggestion[]> {
    const cwd = this.workspace;
    if (!cwd) return [];
    if (!this.client?.connected || this.connection !== "ready") return [];

    try {
      const results = await this.pathSuggestViaCli(query, cwd);

      // Always run the recursive walk as well, so nested matches show up
      // regardless of whether the query has a slash:
      //   "@docs"   finds "yak/docs/"
      //   "@docs/"  finds "yak/docs/", "dify/docs/", ...
      //   "@dify/d" finds anything under dify/ starting with "d"
      // The recursive matcher scores paths by substring / fuzzy against
      // both basename and full path, so trailing slashes are fine.
      const deep = await this.pathSuggestRecursive(query, cwd);

      // Merge CLI + recursive results into one list, deduplicating by
      // canonicalized path so the same dir doesn't show up twice when
      // both sources surface it (e.g. "@grok" → "grok-build/" from CLI
      // and from `find`, leading to two identical entries otherwise).
      const seen = new Set<string>();
      const merged: PathSuggestion[] = [];
      for (const item of [...results, ...deep]) {
        const key = `${item.isDir ? "d:" : "f:"}${item.path}`;
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push(item);
      }
      return merged;
    } catch {
      return [];
    }
  }

  /**
   * Use `find` to list the full project tree (excluding heavy dirs),
   * then fuzzy-match filenames against the query. Returns both files
   * and directories. Cached for 30 s.
   */
  private async pathSuggestRecursive(
    query: string,
    cwd: string,
  ): Promise<PathSuggestion[]> {
    if (!query) return [];
    const cacheKey = cwd;
    const now = Date.now();
    const cached = this.fileListCache?.get(cacheKey);
    let entries: string[];

    if (cached && now - cached.at < FILE_LIST_CACHE_TTL) {
      entries = cached.entries;
    } else {
      entries = await this.listProjectEntries(cwd);
      if (!this.fileListCache) this.fileListCache = new Map();
      this.fileListCache.set(cacheKey, { entries, at: now });
    }

    const out: PathSuggestion[] = [];
    const max = 50;
    // Rank: exact prefix > case-insensitive prefix > fuzzy subsequence
    const scored: { path: string; isDir: boolean; score: number }[] = [];
    const qLower = query.toLowerCase();

    for (const rel of entries) {
      const clean = rel.endsWith("/") ? rel.slice(0, -1) : rel;
      const name = clean.split("/").pop() ?? clean;
      const nameLower = name.toLowerCase();
      const isDir = rel.endsWith("/");

      let score = 0;
      if (nameLower.startsWith(qLower)) {
        score = 300;
      } else if (nameLower.includes(qLower)) {
        score = 200;
      } else if (clean.toLowerCase().includes(qLower)) {
        score = 100;  // path contains query but filename doesn't
      } else if (matchesPath(rel, query)) {
        score = 50;   // fuzzy subsequence match
      } else {
        continue;
      }

      // Prefer shorter paths (closer to root)
      score -= rel.split("/").length;
      scored.push({ path: isDir ? rel.slice(0, -1) : rel, isDir, score });
    }

    scored.sort((a, b) => b.score - a.score);
    for (const s of scored) {
      if (out.length >= max) break;
      out.push({ path: s.path, isDir: s.isDir });
    }
    return out;
  }

  /**
   * List all files and directories under `cwd` using the system `find`.
   * Excludes common heavy directories. Directories have trailing `/`.
   */
  private listProjectEntries(cwd: string): Promise<string[]> {
    const excludeArgs = [
      "(", "-name", "node_modules", "-o", "-name", ".git", "-o",
      "-name", "target", "-o", "-name", "dist", "-o",
      "-name", "build", "-o", "-name", ".next", "-o",
      "-name", ".nuxt", "-o", "-name", "__pycache__", "-o",
      "-name", ".cache", "-o", "-name", "out",
      ")", "-prune", "-o",
    ];

    const runFind = (typeArgs: string[], suffix: string): Promise<string[]> =>
      new Promise((resolve) => {
        const child = spawn("find", [cwd, ...excludeArgs, ...typeArgs], {
          stdio: ["ignore", "pipe", "ignore"],
          timeout: 15_000,
        });
        let stdout = "";
        child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
        child.on("close", () => {
          const prefix = cwd.endsWith("/") ? cwd : cwd + "/";
          resolve(
            stdout
              .split("\n")
              .filter((l) => l.startsWith(prefix))
              .map((l) => l.slice(prefix.length) + suffix)
              .filter(Boolean),
          );
        });
        child.on("error", () => resolve([]));
      });

    return Promise.all([
      runFind(["-type", "f", "-print"], ""),    // files: no suffix
      runFind(["-type", "d", "-print"], "/"),   // dirs: trailing /
    ]).then(([files, dirs]) => [...files, ...dirs]);
  }

  private fileListCache?: Map<string, { entries: string[]; at: number }>;

  /** Call the CLI `x.ai/suggest` endpoint for fuzzy file completions.
   *  The CLI runs nucleo fuzzy matching which is too permissive for
   *  directory prefixes (e.g. typing "docs" surfaces "docker", "docx",
   *  "doc-paths"). We post-filter so the renderer only sees paths where
   *  the query is an actual substring of either the basename or any
   *  parent directory segment — exact-token matching, no fuzzy. */
  private async pathSuggestViaCli(
    query: string,
    cwd: string,
  ): Promise<PathSuggestion[]> {
    const text = `cat ${query}`;
    const q = query.toLowerCase();
    // Strip a trailing slash so the filter is identical for "@docs" and
    // "@docs/" — the user is still typing the same prefix.
    const qStripped = q.endsWith("/") ? q.slice(0, -1) : q;
    if (!qStripped) return [];

    try {
      const raw = await this.requestExt(
        "suggest",
        { text, cursor: text.length, cwd, limit: 50, generation: 0, tokenOnly: true },
        5000,
      );
      const obj = asRecord(raw);
      if (!obj) return [];
      const completions = Array.isArray(obj.completions) ? obj.completions : [];

      const out: PathSuggestion[] = [];
      const seen = new Set<string>();
      for (const c of completions) {
        const comp = asRecord(c as JsonValue);
        if (!comp) continue;
        if (asString(comp.source) !== "file") continue;
        const token =
          asString(comp.tokenText) ?? asString(comp.token_text);
        if (!token) continue;

        const isDir = token.endsWith("/");
        const rawPath = isDir ? token.slice(0, -1) : token;
        const path = rawPath.replace(/\\(.)/g, "$1");

        // Exact-token filter: the query must be a substring of the
        // path as a whole, or of any path segment. The first branch
        // handles path-shaped queries ("yak/docs" → "yak/docs"); the
        // second handles bare names ("docs" → "yak/docs/readme.md").
        // Rejects CLI-fuzzy noise like "docker" / "docx.svg" for "docs".
        const pLower = path.toLowerCase();
        if (!pLower.includes(qStripped)) {
          const segments = pLower.split("/").filter(Boolean);
          if (!segments.some((seg) => seg.includes(qStripped))) continue;
        }

        if (seen.has(path)) continue;
        seen.add(path);
        out.push({ path, isDir });
      }
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
      return;
    }
    // Agent model catalog hot-reload (config.toml [model.*] / models_cache).
    // Without this, custom providers written by Models settings never appear
    // in the composer chip until a full agent restart.
    if (
      method === "_x.ai/models/update" ||
      method === "x.ai/models/update"
    ) {
      this.applyModelsFromSession(params as JsonValue, { replaceEmpty: true });
      // Keep parked runtimes' catalogs in sync so warm switches see new models.
      for (const rt of this.runtimes.values()) {
        rt.availableModels = this.availableModels.map((m) => ({
          ...m,
          reasoningEfforts: m.reasoningEfforts?.map((e) => ({ ...e })),
        }));
      }
      this.emitSnapshot();
      this.log(
        "info",
        `models/update: ${this.availableModels.length} model(s) available`,
      );
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
      this.inThinkTag = false;
      this.thinkHold = "";
      return;
    }

    if (kind === "agent_message_chunk") {
      if (this.suppressStreamingAfterCancel) return;
      const content = asRecord(update.content);
      const text = asString(content?.text) ?? "";
      if (!text) return;
      // Close any open native thought caret before assistant text resumes.
      this.finalizeStreamingThought();
      // Some custom models (DeepSeek R1, Qwen QwQ, MiniMax, …) embed
      // `<think>...</think>` inline in the assistant content. Split it
      // out into its own collapsible thought bubble, leaving only the
      // user-visible response text on the assistant bubble.
      const parsed = this.ingestThinkTags(text);

      // Thought side
      if (parsed.thoughtDelta) {
        if (!this.streamingThoughtId) {
          this.streamingThoughtId = newId("th");
          this.pushTimeline({
            id: this.streamingThoughtId,
            kind: "thought",
            text: parsed.thoughtDelta,
            streaming,
          });
        } else {
          const id = this.streamingThoughtId;
          this.updateTimeline(
            id,
            (item) =>
              item.kind === "thought"
                ? { ...item, text: item.text + parsed.thoughtDelta, streaming }
                : item,
            { throttle: true },
          );
        }
      }
      if (parsed.closeThought) {
        this.finalizeStreamingThought();
      }

      // Assistant side
      if (parsed.assistantDelta) {
        if (!this.streamingAssistantId) {
          this.streamingAssistantId = newId("asst");
          this.pushTimeline({
            id: this.streamingAssistantId,
            kind: "assistant",
            text: parsed.assistantDelta,
            streaming,
          });
        } else {
          const id = this.streamingAssistantId;
          this.updateTimeline(
            id,
            (item) =>
              item.kind === "assistant"
                ? { ...item, text: item.text + parsed.assistantDelta, streaming }
                : item,
            { throttle: true },
          );
        }
      }
      return;
    }

    if (kind === "agent_thought_chunk") {
      if (this.suppressStreamingAfterCancel) return;
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
      if (this.suppressStreamingAfterCancel) return;
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
      if (this.suppressStreamingAfterCancel) return;
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

    // ACP Plan = todo list from todo_write (and turn-end cleanup).
    if (kind === "plan") {
      const entries =
        (update.entries as JsonValue | undefined) ??
        (update.planEntries as JsonValue | undefined);
      this.todos = parsePlanEntries(entries);
      this.syncActiveIntoRuntimes();
      // Replay can restore the last plan list; live updates always emit.
      this.emitSnapshot();
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

    // Structured questionnaire: top-level `x.ai/ask_user_question` or nested
    // under `ext_method` / `_x.ai/ask_user_question`.
    if (
      method === "ext_method" ||
      method === "x.ai/ask_user_question" ||
      method === "_x.ai/ask_user_question" ||
      method.endsWith("ask_user_question")
    ) {
      const handled = await this.handleAskUserQuestionRequest(method, params);
      if (handled !== undefined) return handled;
    }

    // Folder-trust prompt: top-level `x.ai/folder_trust/request` or nested
    // under `ext_method` / `_x.ai/folder_trust/request`. The agent only sends
    // this when we advertised `x.ai/folderTrust.interactive = true`.
    if (
      method === "ext_method" ||
      method === "x.ai/folder_trust/request" ||
      method === "_x.ai/folder_trust/request" ||
      method.endsWith("folder_trust/request")
    ) {
      const handled = await this.handleFolderTrustRequest(method, params);
      if (handled !== undefined) return handled;
    }

    // Plan approval: JSON-RPC method may be top-level `x.ai/exit_plan_mode`
    // or nested under ACP `ext_method` with method field.
    if (
      method === "ext_method" ||
      method === "x.ai/exit_plan_mode" ||
      method.endsWith("exit_plan_mode")
    ) {
      const handled = await this.handleExitPlanModeRequest(method, params);
      if (handled !== undefined) return handled;
    }

    this.log("warn", `Unhandled reverse request: ${method}`);
    return {};
  }

  /**
   * Handle `x.ai/ask_user_question` reverse request.
   * Returns the ExtResponse body, or `undefined` if params are not a questionnaire
   * (so `ext_method` can fall through to exit_plan_mode).
   */
  private async handleAskUserQuestionRequest(
    method: string,
    params: JsonValue | undefined,
  ): Promise<JsonValue | undefined> {
    let body = asRecord(params);

    // Wrapped shapes:
    //   ext_method / _x.ai/ask_user_question:
    //     { method: "x.ai/ask_user_question", params: { sessionId, questions, … } }
    // Top-level x.ai/ask_user_question already has the ExtRequest fields as params.
    if (body) {
      const nestedMethod =
        asString(body.method) ?? asString(body.extMethod);
      const looksWrapped =
        nestedMethod === "x.ai/ask_user_question" ||
        (typeof nestedMethod === "string" &&
          nestedMethod.endsWith("ask_user_question"));
      const hasNestedParams =
        asRecord(body.params as JsonValue) != null ||
        asRecord(body.arguments as JsonValue) != null ||
        (typeof body.params === "string" &&
          body.params.trim().startsWith("{"));

      if (method === "ext_method" || method === "_x.ai/ask_user_question") {
        if (
          nestedMethod &&
          nestedMethod !== "x.ai/ask_user_question" &&
          !nestedMethod.endsWith("ask_user_question")
        ) {
          return undefined;
        }
        if (looksWrapped || hasNestedParams) {
          const nested =
            asRecord(body.params as JsonValue) ??
            asRecord(body.arguments as JsonValue);
          if (nested) {
            body = nested;
          } else if (
            typeof body.params === "string" &&
            body.params.trim().startsWith("{")
          ) {
            try {
              body = asRecord(JSON.parse(body.params) as JsonValue);
            } catch {
              /* keep body */
            }
          }
        }
      } else if (looksWrapped && hasNestedParams) {
        // Some gateways nest even on top-level method names.
        const nested =
          asRecord(body.params as JsonValue) ??
          asRecord(body.arguments as JsonValue);
        if (nested) body = nested;
      }
    }

    if (!body) {
      if (method === "ext_method") return undefined;
      this.log("warn", "ask_user_question with empty params; cancelling");
      return { outcome: "cancelled" };
    }

    const questionsRaw =
      (body.questions as JsonValue | undefined) ??
      (body.Questions as JsonValue | undefined);

    // For generic ext_method, require a questions array so we don't steal
    // exit_plan_mode or other extensions.
    if (method === "ext_method" && !Array.isArray(questionsRaw)) {
      return undefined;
    }

    const sessionId =
      asString(body.sessionId) ??
      asString(body.session_id) ??
      this.sessionId;
    const toolCallId =
      asString(body.toolCallId) ?? asString(body.tool_call_id);
    const modeRaw = asString(body.mode)?.toLowerCase() ?? "default";
    const mode: AskUserQuestionMode =
      modeRaw === "plan" ? "plan" : "default";

    const questions = this.parseAskUserQuestions(questionsRaw);
    if (questions.length === 0) {
      this.log(
        "warn",
        "ask_user_question with no parseable questions; cancelling",
      );
      return { outcome: "cancelled" };
    }

    const ui: AskUserQuestionUi = {
      requestId: newId("askq"),
      sessionId,
      toolCallId,
      questions,
      mode,
    };

    this.log(
      "info",
      `Ask-user-question requested (${questions.length} q, mode=${mode})` +
        (sessionId ? ` session=${sessionId}` : "") +
        (toolCallId ? ` toolCallId=${toolCallId}` : ""),
    );

    // Never YOLO-auto-answer questionnaires.
    return await new Promise<JsonValue>((resolve) => {
      // Replace any prior questionnaire for the same session.
      for (let i = this.questionQueue.length - 1; i >= 0; i--) {
        const prev = this.questionQueue[i];
        if (
          prev &&
          prev.ui.sessionId &&
          sessionId &&
          prev.ui.sessionId === sessionId
        ) {
          prev.resolve({ outcome: "cancelled" });
          this.questionQueue.splice(i, 1);
        }
      }
      this.questionQueue.push({ ui, resolve });
      this.emitSnapshot();
    });
  }

  private parseAskUserQuestions(
    raw: JsonValue | undefined,
  ): AskUserQuestionItemUi[] {
    if (!Array.isArray(raw)) return [];
    const out: AskUserQuestionItemUi[] = [];
    for (const item of raw) {
      const rec = asRecord(item as JsonValue);
      if (!rec) continue;
      const question =
        asString(rec.question) ?? asString(rec.Question) ?? "";
      if (!question.trim()) continue;
      const optsRaw =
        (rec.options as JsonValue | undefined) ??
        (rec.Options as JsonValue | undefined);
      const options: AskUserQuestionOptionUi[] = [];
      if (Array.isArray(optsRaw)) {
        for (const o of optsRaw) {
          const or = asRecord(o as JsonValue);
          if (!or) continue;
          const label = asString(or.label) ?? asString(or.Label) ?? "";
          if (!label.trim()) continue;
          options.push({
            label,
            description:
              asString(or.description) ??
              asString(or.Description) ??
              "",
            preview:
              asString(or.preview) ?? asString(or.Preview) ?? undefined,
          });
        }
      }
      const multi =
        rec.multiSelect === true ||
        rec.multi_select === true ||
        asString(rec.multiSelect)?.toLowerCase() === "true" ||
        asString(rec.multi_select)?.toLowerCase() === "true";
      out.push({
        question,
        options,
        multiSelect: multi,
      });
    }
    return out;
  }

  /**
   * Handle `x.ai/folder_trust/request` reverse request.
   * Returns the ExtResponse body, or `undefined` if params don't describe
   * a folder-trust prompt (so `ext_method` can fall through to other
   * extensions like `x.ai/exit_plan_mode`).
   *
   * Mirrors the agent-side `maybe_spawn_interactive_trust_prompt`:
   *   - accepts `cwd`, `workspace` (canonicalized git-root or cwd),
   *     `sessionId`, `configKinds` (`mcp`/`plugins`/`lsp`/`envrc`/…)
   *   - surfaces a single in-flight prompt at a time per session
   *   - applies a 30 min client-side decision timeout (matches agent);
   *     on timeout we fail closed with `outcome: "reject"`
   */
  private async handleFolderTrustRequest(
    method: string,
    params: JsonValue | undefined,
  ): Promise<JsonValue | undefined> {
    let body = asRecord(params);

    // Wrapped shapes:
    //   ext_method / _x.ai/folder_trust/request:
    //     { method: "x.ai/folder_trust/request", params: { sessionId, cwd, … } }
    if (body) {
      const nestedMethod =
        asString(body.method) ?? asString(body.extMethod);
      const looksWrapped =
        nestedMethod === "x.ai/folder_trust/request" ||
        (typeof nestedMethod === "string" &&
          nestedMethod.endsWith("folder_trust/request"));

      if (method === "ext_method" || method === "_x.ai/folder_trust/request") {
        if (
          nestedMethod &&
          nestedMethod !== "x.ai/folder_trust/request" &&
          !nestedMethod.endsWith("folder_trust/request")
        ) {
          return undefined;
        }
        if (looksWrapped) {
          const nested =
            asRecord(body.params as JsonValue) ??
            asRecord(body.arguments as JsonValue);
          if (nested) body = nested;
          else if (
            typeof body.params === "string" &&
            body.params.trim().startsWith("{")
          ) {
            try {
              body = asRecord(JSON.parse(body.params) as JsonValue);
            } catch {
              /* keep body */
            }
          }
        }
      } else if (looksWrapped) {
        const nested =
          asRecord(body.params as JsonValue) ??
          asRecord(body.arguments as JsonValue);
        if (nested) body = nested;
      }
    }

    if (!body) {
      if (method === "ext_method") return undefined;
      this.log("warn", "folder_trust/request with empty params; rejecting");
      return { outcome: "reject" };
    }

    const cwd = asString(body.cwd) ?? asString(body.workspace);
    const workspace = asString(body.workspace) ?? cwd;
    const sessionId =
      asString(body.sessionId) ?? asString(body.session_id) ?? this.sessionId;
    const configKindsRaw =
      (body.configKinds as JsonValue | undefined) ??
      (body.config_kinds as JsonValue | undefined);
    const configKinds: FolderTrustConfigKind[] = Array.isArray(configKindsRaw)
      ? (configKindsRaw.filter(
          (k): k is string => typeof k === "string",
        ) as FolderTrustConfigKind[])
      : [];

    if (!cwd || !workspace) {
      if (method === "ext_method") return undefined;
      this.log(
        "warn",
        `folder_trust/request missing cwd/workspace (cwd=${cwd} workspace=${workspace}); rejecting`,
      );
      return { outcome: "reject" };
    }

    const requestId = newId("trust");
    const ui: FolderTrustPromptUi = {
      requestId,
      sessionId,
      cwd,
      workspace,
      configKinds,
    };
    this.log(
      "info",
      `Folder-trust prompt: cwd=${cwd} workspace=${workspace}` +
        (sessionId ? ` session=${sessionId}` : "") +
        (configKinds.length ? ` kinds=${configKinds.join(",")}` : ""),
    );

    // Queue the prompt. If YOLO is on, auto-grant without showing UI.
    if (this.alwaysApprove) {
      this.log(
        "info",
        `Folder-trust auto-granted (always-approve) workspace=${workspace}`,
      );
      this.emitSnapshot();
      return { outcome: "trust" };
    }

    return await new Promise<JsonValue>((resolve) => {
      const entry: PendingTrustPromptEntry = {
        ui,
        sessionId,
        resolve,
        timer: null,
      };
      entry.timer = setTimeout(() => {
        // Fail-closed: 30 min without a decision ⇒ reject.
        const idx = this.trustPromptQueue.indexOf(entry);
        if (idx >= 0) this.trustPromptQueue.splice(idx, 1);
        this.log(
          "warn",
          `Folder-trust prompt timed out (30min) workspace=${workspace} requestId=${requestId}; rejecting`,
        );
        resolve({ outcome: "reject" });
        this.emitSnapshot();
      }, 30 * 60 * 1000);
      this.trustPromptQueue.push(entry);
      this.emitSnapshot();
    });
  }

  /**
   * Handle `x.ai/exit_plan_mode` reverse request.
   * Returns the ExtResponse body, or `undefined` if params are not plan-approval.
   */
  private async handleExitPlanModeRequest(
    method: string,
    params: JsonValue | undefined,
  ): Promise<JsonValue | undefined> {
    let body = asRecord(params);
    // ACP ExtRequest shape: { method: "x.ai/exit_plan_mode", params: {...} }
    if (method === "ext_method" && body) {
      const nestedMethod =
        asString(body.method) ?? asString(body.extMethod);
      if (
        nestedMethod &&
        nestedMethod !== "x.ai/exit_plan_mode" &&
        !nestedMethod.endsWith("exit_plan_mode")
      ) {
        return undefined;
      }
      const nested =
        asRecord(body.params as JsonValue) ??
        asRecord(body.arguments as JsonValue);
      if (nested) body = nested;
      else if (
        typeof body.params === "string" &&
        body.params.trim().startsWith("{")
      ) {
        try {
          body = asRecord(JSON.parse(body.params) as JsonValue);
        } catch {
          /* keep body */
        }
      }
    }
    if (!body) {
      this.log("warn", "exit_plan_mode with empty params; cancelling");
      return { outcome: "cancelled" };
    }

    const sessionId =
      asString(body.sessionId) ??
      asString(body.session_id) ??
      this.sessionId;
    const toolCallId =
      asString(body.toolCallId) ?? asString(body.tool_call_id);
    const planContent =
      asString(body.planContent) ??
      asString(body.plan_content) ??
      undefined;
    const hasPlan = Boolean(planContent?.trim());

    // Apply plan body to the owning session (may be background).
    const applyPlan = () => {
      if (hasPlan && planContent) {
        this.planContent = planContent;
      }
    };
    if (
      sessionId &&
      this.sessionId &&
      sessionId !== this.sessionId &&
      this.runtimes.has(sessionId)
    ) {
      const bag = this.runtimes.get(sessionId)!;
      this.withParkedRuntime(bag, applyPlan);
    } else {
      applyPlan();
    }

    const ui: PlanApprovalUi = {
      requestId: newId("plan"),
      sessionId,
      toolCallId,
      planContent: hasPlan ? planContent : undefined,
      hasPlan,
    };

    this.log(
      "info",
      `Plan approval requested` +
        (sessionId ? ` session=${sessionId}` : "") +
        (hasPlan ? ` (${planContent!.length} chars)` : " (empty plan)"),
    );

    // Never YOLO-auto-approve plan exits — same as CLI.
    return await new Promise<JsonValue>((resolve) => {
      // Replace any prior approval for the same session.
      for (let i = this.planApprovalQueue.length - 1; i >= 0; i--) {
        const prev = this.planApprovalQueue[i];
        if (
          prev &&
          prev.ui.sessionId &&
          sessionId &&
          prev.ui.sessionId === sessionId
        ) {
          prev.resolve({ outcome: "cancelled" });
          this.planApprovalQueue.splice(i, 1);
        }
      }
      this.planApprovalQueue.push({ ui, resolve });
      this.emitSnapshot();
    });
  }

  /**
   * Load user prompt history for a workspace (newest first).
   * Prefer session-scoped fast path when `filterSessionId` is set.
   */
  async listPromptHistory(
    cwd: string,
    filterSessionId?: string,
  ): Promise<string[]> {
    const trimmed = cwd.trim();
    if (!trimmed) return [];
    try {
      const params: Record<string, JsonValue> = { cwd: trimmed };
      if (filterSessionId?.trim()) {
        params.filter_session_id = filterSessionId.trim();
      }
      const raw = await this.requestExt("prompt_history", params, 30_000);
      const rec = asRecord(raw);
      const prompts = rec?.prompts;
      if (!Array.isArray(prompts)) return [];
      const out: string[] = [];
      for (const p of prompts) {
        if (typeof p !== "string") continue;
        const t = p.trim();
        if (!t) continue;
        // Keep API order (newest first); consecutive dedupe only.
        if (out.length > 0 && out[out.length - 1] === t) continue;
        out.push(t);
      }
      return out;
    } catch (err) {
      this.log(
        "warn",
        `prompt_history failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return [];
    }
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

    // Soft-auth note: when `accountAvailable` is false the agent has no
    // Grok credential, so any prompt sent against an official Grok model
    // will be rejected with "auth required" by the agent itself. We let
    // that error bubble up; the dropdown notice in the renderer already
    // nudges the user to switch to a custom provider.
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
    // Re-enable streaming chunks for the new turn. Cancel arms this
    // guard so in-flight model chunks don't keep appending to the
    // timeline after the user clicks stop.
    this.suppressStreamingAfterCancel = false;
    this.finalizeStreaming();

    // Drop any todos / plan body left over from the previous turn. They
    // are turn-scoped UI artifacts: the snapshot guard (`busy ? todos :
    // []`) only hides them between turns, but a fresh prompt emits a
    // snapshot before the agent publishes its own todo_write — if we
    // don't clear here, the renderer briefly shows the previous turn's
    // (or a stale cross-session) checklist as if it belonged to the new
    // turn. Clearing now keeps the panel clean until the agent emits.
    this.todos = [];
    this.planContent = undefined;
    this.syncActiveIntoRuntimes();

    const displayText =
      trimmed ||
      (imageBlocks.length > 0
        ? `[${imageBlocks.length} image${imageBlocks.length > 1 ? "s" : ""}]`
        : "");
    this.pushTimeline({
      id: newId("user"),
      kind: "user",
      text: displayText,
      // Mirror attachments onto the timeline item so the user bubble can
      // render image previews. Strip base64 if the payload was already
      // huge — the timeline is serialized to the renderer.
      attachments: attachments.length > 0 ? attachments.map(stripAttachmentForTimeline) : undefined,
    });
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
      const promptResult = await client.request(
        "session/prompt",
        {
          sessionId: promptSessionId,
          prompt,
        },
        600_000,
      );
      // Client-side timeout fired but the agent is already streaming
      // `session/update` for this session — the RPC is still in flight
      // and the turn is progressing. Treat as a successful no-result
      // response: do nothing visible, just log so we can spot bad agents.
      if (isAbsorbedByStream(promptResult)) {
        applyToPromptSession(() => {
          if (isManualCompact && this.compacting) {
            this.finishCompact("completed", { mode: "manual" });
          }
        });
        this.log(
          "info",
          `session/prompt result not received in time; absorbed by stream for ${promptSessionId}`,
        );
        return;
      }
      const promptResultRecord = asRecord(promptResult);
      applyToPromptSession(() => {
        // Some agents stamp final context usage on the prompt response `_meta`.
        this.noteTokensFromMeta(
          asRecord(promptResultRecord?._meta as JsonValue) ??
            asRecord(promptResultRecord?.meta as JsonValue),
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
        // Drop turn-scoped todo checklist so the next snapshot reports an
        // empty list. plan.md on disk is preserved; only the UI mirror is
        // cleared (plan mode approvals in planApprovalQueue stay).
        this.clearTurnPlanArtifacts();
        // Prompt settled while a compact card is still open (cancel / missed event).
        if (this.compacting) {
          this.finishCompact(isManualCompact ? "cancelled" : "completed");
        }
      });
      // Only the focused session needs a full conversation snapshot. A parked
      // session has already updated its runtime bag; publishing here would
      // needlessly re-render the conversation the user is currently reading.
      if (stillThisSession()) {
        this.emitSnapshot();
      }
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
    if (!this.client || !this.sessionId || this.connection !== "ready") {
      // No active session to cancel — force-clear busy so the UI stop
      // button does not stay stuck even if the prompt RPC never settles.
      this.busy = false;
      this.clearTurnPlanArtifacts();
      this.emitSnapshot();
      return;
    }
    // Only cancel the focused session — other concurrent turns keep running.
    const sid = this.sessionId;
    // Suppress any in-flight model chunks arriving after the user
    // clicked stop so the timeline doesn't keep growing. Reset when
    // the next user prompt starts (busy → true in sendPrompt).
    this.suppressStreamingAfterCancel = true;
    this.cancelPermissionsForSession(sid, "session cancel");
    this.cancelQuestionsForSession(sid, "session cancel");
    this.cancelTrustPromptsForSession(sid, "session cancel");
    this.emitSnapshot();
    try {
      const cancelResult = await this.client.request("session/cancel", {
        sessionId: sid,
      });
      // session/cancel timed out but the stream was active — the cancel
      // RPC was still sent over the wire and the agent should have received
      // it. Treat as success.
      if (isAbsorbedByStream(cancelResult)) {
        this.log("info", `Cancel absorbed by stream for ${sid}`);
      } else {
        this.log("info", `Cancel sent session=${sid}`);
      }
      if (this.compacting) {
        this.finishCompact("cancelled");
      }
      this.busy = false;
      this.clearTurnPlanArtifacts();
      this.emitSnapshot();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.log("warn", `Cancel failed: ${message}`);
      // Even if the cancel RPC itself threw, force-clear busy so the
      // stop button does not remain stuck. The prompt's finally block
      // will also run when its RPC settles.
      this.busy = false;
      this.clearTurnPlanArtifacts();
      this.emitSnapshot();
    }
  }

  /**
   * Cancel a background session's turn (one the user is not currently
   * focused on). The active session is preserved: we temporarily hydrate
   * the target session's runtime, send `session/cancel`, clear its
   * pending prompts, then restore the user's focus. No-op if the target
   * is already idle / unknown.
   */
  async cancelSession(targetSessionId: string): Promise<void> {
    if (!this.client || !this.client.connected || this.connection !== "ready") {
      return;
    }
    if (!targetSessionId) return;
    // No-op when the target is the focused session — UI should call
    // `cancel()` directly in that case.
    if (targetSessionId === this.sessionId) {
      await this.cancel();
      return;
    }
    const bag = this.runtimes.get(targetSessionId);
    if (!bag) return;
    if (!bag.busy && !bag.compacting) return;

    // Park the user's focused session, hydrate the target session, run
    // the cancel, then restore focus. We do this manually (instead of
    // withParkedRuntime) because the work is async — the request promise
    // needs focus kept on the target session until it settles.
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
          suppressStreamingAfterCancel: this.suppressStreamingAfterCancel,
          tokensUsed: this.tokensUsed,
          contextWindow: this.contextWindow,
          modelId: this.modelId,
          sessionMode: this.sessionMode,
          reasoningEffort: this.reasoningEffort,
          availableModels: this.availableModels,
          toolIndex: this.toolIndex,
          todos: this.todos,
          planContent: this.planContent,
          hydrated: true,
        }
      : null;

    this.hydrateFromRuntime(bag);
    this.parkedDepth++;
    try {
      this.cancelPermissionsForSession(targetSessionId, "session cancel");
      this.cancelQuestionsForSession(targetSessionId, "session cancel");
      this.cancelTrustPromptsForSession(targetSessionId, "session cancel");
      this.emitSnapshot();
      try {
        await this.client.request("session/cancel", {
          sessionId: targetSessionId,
        });
        this.log(
          "info",
          `Background cancel sent session=${targetSessionId}`,
        );
        if (this.compacting) {
          this.finishCompact("cancelled");
        }
        this.busy = false;
        this.clearTurnPlanArtifacts();
        this.emitSnapshot();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.log(
          "warn",
          `Background cancel failed session=${targetSessionId}: ${message}`,
        );
      }
    } finally {
      this.parkedDepth--;
      if (focusSnap) {
        this.hydrateFromRuntime(focusSnap);
      } else {
        this.sessionId = undefined;
        this.sessionTitle = undefined;
        this.timeline = [];
        this.toolIndex = new Map();
        this.todos = [];
        this.planContent = undefined;
        this.busy = false;
        this.replaying = false;
        this.compacting = false;
        this.compactTimelineId = null;
        this.streamingAssistantId = null;
        this.streamingThoughtId = null;
        this.inThinkTag = false;
        this.thinkHold = "";
        this.tokensUsed = undefined;
      }
      this.parkedEmitPending = false;
      this.emitSnapshot();
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
    this.cancelAllQuestions("stop");
    this.cancelTrustPromptsForSession(null, "stop");
    await this.stopProcessOnly();
    this.emitSnapshot();
  }

  // ────────────────────────────────────────────────────────────────────
  // Installer lifecycle — desktop-driven install / upgrade / channel /
  // background update checks. Everything here is fire-and-forget from the
  // renderer's perspective; status flows back through `installerStatus`.
  // ────────────────────────────────────────────────────────────────────

  /**
   * First call from the renderer. Resolves the channel from disk, snapshots
   * the installer state, then kicks off a single background update probe
   * so the next connect can show "update available" without blocking.
   */
  async initInstaller(): Promise<void> {
    try {
      this.installerChannel = await getChannelImpl();
    } catch {
      this.installerChannel = "stable";
    }
    await this.refreshInstallerStatus();
    // Background update probe — never throws; failures are silent so we
    // don't pop a banner every time the user is offline.
    void this.probeUpdateChannel();
  }

  /** Re-read the installer status from disk and push it to the snapshot. */
  async refreshInstallerStatus(): Promise<InstallerStatus> {
    try {
      const status = await getInstallerStatusImpl();
      this.installerStatus = status;
      this.emitSnapshot();
      return status;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.installerStatus = { kind: "error", message };
      this.emitSnapshot();
      return this.installerStatus;
    }
  }

  /**
   * Background update probe. Runs once on init. We don't poll: each
   * desktop session already gets a fresh probe, and we don't want to
   * spam the channel-pointer endpoint from every open window.
   */
  private async probeUpdateChannel(): Promise<void> {
    try {
      const check = await checkForUpdateImpl();
      this.lastUpdateCheckAt = new Date().toISOString();
      const current = await getInstallerStatusImpl();
      if (current.kind === "ready" && check.hasUpdate && check.latest) {
        this.installerStatus = {
          kind: "update-available",
          current: current.version,
          latest: check.latest,
          path: current.path,
        };
      } else {
        this.installerStatus = current;
      }
      this.emitSnapshot();
    } catch {
      /* network failure — leave the previous status in place */
    }
  }

  /**
   * Triggered from Settings → Agent → "Install" button. Used for both
   * first-time installs and explicit channel-driven installs. Marks the
   * status as `installing` while the script runs.
   */
  async installAgent(): Promise<import("./agent-installer").InstallerResult> {
    this.installerStatus = { kind: "installing", startedAt: Date.now() };
    this.emitSnapshot();
    const result = await runGrokInstallerImpl();
    if (result.ok) {
      await this.refreshInstallerStatus();
    } else {
      this.installerStatus = {
        kind: "error",
        message: result.error ?? `Installer exited with code ${result.code}`,
      };
      this.emitSnapshot();
    }
    return result;
  }

  /**
   * Triggered from Settings → Agent → "Upgrade" button. Backs up the
   * current binary first, then runs the installer. On success we mark
   * `upgradePending = true` so the next `connectInner()` will verify
   * the new agent is healthy within 30s — and roll back if it isn't.
   */
  async upgradeAgent(): Promise<import("./agent-installer").InstallerResult> {
    const before = await getInstallerStatusImpl();
    if (before.kind !== "ready") {
      const err: import("./agent-installer").InstallerResult = {
        ok: false,
        output: "",
        code: null,
        durationMs: 0,
        error: `Cannot upgrade: grok is not currently installed (status: ${before.kind}).`,
      };
      this.installerStatus = { kind: "error", message: err.error! };
      this.emitSnapshot();
      return err;
    }
    this.installerStatus = {
      kind: "upgrading",
      from: before.version,
      to: "(checking)",
      startedAt: Date.now(),
    };
    this.emitSnapshot();
    // Tear down any in-flight process so the upgrade can replace the
    // binary file. We preserve `connection = idle` so the renderer
    // knows to auto-reconnect after the upgrade completes.
    await this.stopProcessOnly();
    const result = await upgradeInstallerImpl();
    if (!result.ok) {
      this.installerStatus = {
        kind: "error",
        message: result.error ?? `Installer exited with code ${result.code}`,
      };
      this.emitSnapshot();
      return result;
    }
    // Find out what version we just landed on so the UI shows the right
    // "from → to" delta while the next connect runs.
    const after = await getInstallerStatusImpl();
    const newVersion =
      after.kind === "ready" ? after.version : "(unknown)";
    this.upgradePending = true;
    this.installerStatus = {
      kind: "upgrading",
      from: before.version,
      to: newVersion,
      startedAt: Date.now(),
    };
    this.emitSnapshot();
    // Kick a fresh connect so the new binary is exercised. The hook
    // installed by `connectInner` will clear `upgradePending` once the
    // new agent answers or roll back if it can't.
    void this.connect().catch((err) => {
      this.log("warn", `Post-upgrade connect failed: ${String(err)}`);
    });
    return result;
  }

  /**
   * Persist the chosen channel and refresh the update probe so the UI
   * updates immediately (a user who just switched to alpha probably
   * wants to see "alpha is newer than your install").
   */
  async setInstallerChannel(
    channel: InstallerChannel,
  ): Promise<InstallerChannel> {
    await setChannelImpl(channel);
    this.installerChannel = channel;
    this.emitSnapshot();
    void this.probeUpdateChannel();
    return channel;
  }

  /**
   * If the freshly-installed agent crashes within the health-check window
   * (30s), swap the binary back to its .bak and surface the rollback in
   * the snapshot. Only fires when `upgradePending === true` so we don't
   * punish a normal session crash by reverting the version.
   */
  private async rollbackAfterFailedUpgrade(
    reason: string,
  ): Promise<void> {
    if (!this.upgradePending) return;
    this.upgradePending = false;
    const resolved = await resolveGrokBinaryDetailed();
    const binPath = resolved.kind === "found" ? resolved.path : undefined;
    if (!binPath) {
      this.installerStatus = {
        kind: "rollback",
        fromVersion: "(unknown)",
        reason,
      };
      this.emitSnapshot();
      return;
    }
    const ok = await rollbackBinary(binPath);
    await this.refreshInstallerStatus();
    if (this.installerStatus.kind === "ready") {
      this.installerStatus = {
        kind: "rollback",
        fromVersion: this.installerStatus.version,
        reason: ok
          ? `${reason}. Restored the previous version.`
          : `${reason}. Could not restore the backup — please reinstall manually.`,
      };
      this.emitSnapshot();
    }
  }

  /**
   * Upgrade-flow health check. Runs after spawn; resolves once the
   * agent answers `initialize` and reports an `agentVersion` higher
   * than the pre-upgrade version. Bails out at 30s and triggers a
   * rollback.
   */
  private async waitForHealthyAgent(
    timeoutMs: number,
    expectedNewerThan: string,
  ): Promise<boolean> {
    // The new connectInner() will overwrite agentVersion when the
    // initialize response arrives. We watch that field for up to
    // `timeoutMs`.
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (!this.upgradePending) return true;
      if (this.agentVersion && this.agentVersion !== expectedNewerThan) {
        this.upgradePending = false;
        return true;
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    await this.rollbackAfterFailedUpgrade(
      `New agent did not respond with a higher version within ${Math.round(
        timeoutMs / 1000,
      )}s`,
    );
    return false;
  }
}

/** Cache project file list for 30 s — avoids re-running `find`
 *  on every keystroke of the @-mention query. */
const FILE_LIST_CACHE_TTL = 30_000;

/**
 * Check whether a relative path matches the query. Used for deep-tree
 * file search: the query must be a substring of the path as a whole
 * (handles path-shaped queries like "yak/docs") OR of any path segment
 * (handles bare names like "docs"). E.g. "docs" matches
 * "yak/docs/" (dir) and "any-agent/docs/readme.md" (file inside) but
 * NOT "dify/web/assets/docx.svg" or "dify/api/docker/".
 */
function matchesPath(relPath: string, query: string): boolean {
  const q = query.toLowerCase().replace(/\/$/, "");
  if (!q) return true;
  const clean = relPath.endsWith("/") ? relPath.slice(0, -1) : relPath;
  const lower = clean.toLowerCase();
  if (lower.includes(q)) return true;
  const segments = lower.split("/").filter(Boolean);
  return segments.some((seg) => seg.includes(q));
}
