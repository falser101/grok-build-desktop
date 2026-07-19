export type ConnectionState =
  | "idle"
  | "starting"
  | "connecting"
  | "ready"
  | "error"
  | "stopped";

/** ACP session mode wire ids. */
export type SessionModeId = "default" | "plan" | "ask";

export type CompactStatus =
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type CompactMode = "manual" | "auto";

/** File diff from ACP `ToolCallContent::Diff`. */
export interface ToolDiff {
  path: string;
  /** Original content; omitted/empty for new files. */
  oldText?: string;
  newText: string;
}

export type TimelineItem =
  | { id: string; kind: "user"; text: string; createdAt?: number }
  | { id: string; kind: "thought"; text: string; streaming?: boolean; createdAt?: number }
  | { id: string; kind: "assistant"; text: string; streaming?: boolean; createdAt?: number }
  | {
      id: string;
      kind: "tool";
      toolCallId: string;
      title: string;
      status: string;
      toolKind?: string;
      /** File diffs from tool content (search_replace, apply_patch, …). */
      diffs?: ToolDiff[];
      /**
       * Text / stdout-style output extracted from content blocks
       * (`type: "content"` → text). Replaced when a later update sends content.
       */
      outputText?: string;
      /** True when UI truncated large output for display. */
      outputTruncated?: boolean;
      createdAt?: number;
    }
  | {
      id: string;
      kind: "compact";
      status: CompactStatus;
      mode: CompactMode;
      /** Context window fill percentage when auto-compact starts. */
      percentage?: number;
      tokensBefore?: number;
      tokensAfter?: number;
      message?: string;
      createdAt?: number;
    }
  | { id: string; kind: "system"; text: string; createdAt?: number };

/** Live status for a session in the sidebar (desktop multi-session). */
export type SessionRunStatus =
  | "idle"
  | "running"
  | "loading"
  | "needs_permission"
  /** Waiting on `x.ai/ask_user_question` (interview / structured Q&A). */
  | "needs_question"
  /** Waiting on `x.ai/folder_trust/request` (workspace has repo-local
   *  hooks/MCP/plugins/LSP/etc. that need an explicit trust grant). */
  | "needs_trust";

export interface SessionSummary {
  sessionId: string;
  cwd: string;
  project: string;
  title: string;
  updatedAt: string;
  modelId?: string;
  /**
   * Whether this session has an in-flight turn (or is loading / waiting on
   * permission). Populated by the desktop backend from live runtime state.
   */
  status?: SessionRunStatus;
}

/** Outcome string accepted by the agent for `x.ai/folder_trust/request`. */
export type FolderTrustOutcome = "trust" | "reject";

/** Single repo-local code-exec marker detected by the agent. */
export type FolderTrustConfigKind =
  | "mcp"
  | "plugins"
  | "lsp"
  | "envrc"
  | "claude"
  | "hooks"
  | "agents"
  | string;

/**
 * Active folder-trust request surfaced to the renderer. Mirrors the
 * ACP `x.ai/folder_trust/request` payload (camelCase on the wire).
 */
export interface FolderTrustPromptUi {
  requestId: string;
  /** Session this prompt belongs to (for per-session scoping). */
  sessionId?: string;
  /** The session cwd the prompt applies to. */
  cwd: string;
  /**
   * Display path of the canonical workspace key — the actual scope of
   * the trust grant (usually the git-root of `cwd`).
   */
  workspace: string;
  /** Detected repo-local config kinds driving the gate. */
  configKinds: FolderTrustConfigKind[];
}

/**
 * Single entry from `~/.grok/trusted_folders.toml` — surfaced to the
 * renderer's "Trusted folders" panel so users can see what they've
 * granted and revoke individual decisions.
 */
export interface TrustedFolderEntry {
  /** Canonical absolute workspace key. */
  path: string;
  /** true = grant; false = explicit decline. */
  trusted: boolean;
  /** ISO 8601 timestamp of the most recent decision (if recorded). */
  decidedAt?: string;
}

/** Hit from `x.ai/session/search` (full-text). */
export interface SessionSearchHit {
  sessionId: string;
  cwd: string;
  summary: string;
  updatedAt: string;
  score: number;
  matchedFields: string[];
  snippet?: string;
}

export interface ForkSessionResult {
  newSessionId: string;
  newCwd: string;
  parentSessionId?: string;
}

export interface SearchSessionsOptions {
  cwd?: string;
  limit?: number;
  includeContent?: boolean;
}

export interface ReasoningEffortOption {
  id: string;
  label: string;
  description?: string;
}

export interface ModelInfo {
  modelId: string;
  name: string;
  description?: string;
  supportsReasoningEffort?: boolean;
  reasoningEffort?: string;
  reasoningEfforts?: ReasoningEffortOption[];
  /** From model _meta.inputModalities or similar; default true if unknown. */
  acceptsImages?: boolean;
  /** Context window size from model `_meta.totalContextTokens`. */
  contextWindow?: number;
}

export type AttachmentKind = "file" | "image";

export interface PromptAttachment {
  id: string;
  kind: AttachmentKind;
  /** Absolute path when from disk. */
  path?: string;
  /** Relative path for @ mention (workspace-relative preferred). */
  displayPath: string;
  name: string;
  /** Image payload (base64, no data: prefix). */
  mimeType?: string;
  dataBase64?: string;
  sizeBytes?: number;
}

export interface PromptPayload {
  text: string;
  attachments?: PromptAttachment[];
}

/** ACP AvailableCommand (slash autocomplete). */
export interface AvailableCommand {
  name: string;
  description: string;
  /** Argument hint when the command accepts input. */
  inputHint?: string;
  /** Skill metadata from command _meta (optional). */
  skillPath?: string;
  skillScope?: string;
}

/** ACP PermissionOptionKind wire values. */
export type PermissionOptionKind =
  | "allow_once"
  | "allow_always"
  | "reject_once"
  | "reject_always"
  | string;

export interface PermissionOptionUi {
  optionId: string;
  name: string;
  kind: PermissionOptionKind;
}

/** Front-of-queue permission request awaiting user choice. */
export interface PermissionRequestUi {
  requestId: string;
  /** Short heading, e.g. tool title. */
  title: string;
  /** Optional detail (command snippet, path, etc.). */
  detail?: string;
  toolCallId?: string;
  toolKind?: string;
  options: PermissionOptionUi[];
  /** Index of the option pre-selected when the prompt opens. */
  defaultOptionIndex: number;
}

/** ACP Plan entry status (todo list via sessionUpdate "plan"). */
export type TodoStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "cancelled";

export type TodoPriority = "high" | "medium" | "low";

/** One todo / plan entry from ACP `sessionUpdate: "plan"`. */
export interface TodoItemUi {
  /** Stable-ish id for React keys (meta.id or index-based). */
  id: string;
  content: string;
  status: TodoStatus;
  priority: TodoPriority;
}

/**
 * Pending `x.ai/exit_plan_mode` approval (not YOLO-auto-allowed).
 * User must approve, request changes, or abandon.
 */
export interface PlanApprovalUi {
  requestId: string;
  sessionId?: string;
  toolCallId?: string;
  /** Markdown body of the proposed plan (may be empty). */
  planContent?: string;
  hasPlan: boolean;
}

/** Outcomes for `x.ai/exit_plan_mode` reverse request. */
export type PlanApprovalOutcome = "approved" | "cancelled" | "abandoned";

/** One option inside an `ask_user_question` question. */
export interface AskUserQuestionOptionUi {
  label: string;
  description: string;
  /** Optional focused preview (single-select only). */
  preview?: string;
}

/** One structured question from `x.ai/ask_user_question`. */
export interface AskUserQuestionItemUi {
  question: string;
  options: AskUserQuestionOptionUi[];
  multiSelect: boolean;
}

/** Mode for the question UI (plan mode shows extra actions). */
export type AskUserQuestionMode = "default" | "plan";

/**
 * Pending `x.ai/ask_user_question` questionnaire (blocks the tool call).
 * Never YOLO-auto-answered.
 */
export interface AskUserQuestionUi {
  requestId: string;
  sessionId?: string;
  toolCallId?: string;
  questions: AskUserQuestionItemUi[];
  mode: AskUserQuestionMode;
}

/** Per-question freeform notes / option preview annotations. */
export interface AskUserQuestionAnnotation {
  preview?: string;
  notes?: string;
}

/**
 * Client response for `x.ai/ask_user_question`
 * (wire-compatible with AskUserQuestionExtResponse).
 */
export type AskUserQuestionResponse =
  | {
      outcome: "accepted";
      /** Question text → selected label(s). Freeform-only → `["Other"]`. */
      answers: Record<string, string[]>;
      annotations?: Record<string, AskUserQuestionAnnotation>;
    }
  | {
      outcome: "chat_about_this";
      /** Partial answers (label only, no notes). Plan mode only. */
      partial_answers?: Record<string, string>;
    }
  | {
      outcome: "skip_interview";
      partial_answers?: Record<string, string>;
    }
  | { outcome: "cancelled" };

/**
 * Subscription / coding-credit usage from agent `x.ai/billing`
 * (same source as CLI `/usage`).
 */
export interface UsageInfo {
  /** Included allowance used, 0–100. */
  usagePct: number;
  /** "Weekly limit" | "Monthly limit" | "Usage" */
  usageLabel: string;
  /** Compact short label for sidebar, e.g. "42%". */
  usageShort: string;
  /** Local wall-clock next reset, if known. */
  periodEndDisplay?: string;
  /** Subscription tier display name (e.g. SuperGrok). */
  subscriptionTier?: string;
  /** Remaining prepaid credits in USD (absolute). */
  prepaidUsd?: number;
  /** Legacy pay-as-you-go. */
  payAsYouGo?: boolean;
  onDemandUsedUsd?: number;
  onDemandCapUsd?: number;
  autoTopupEnabled?: boolean;
  autoTopupAmountUsd?: number;
  autoTopupMaxUsd?: number;
  /** Multi-line summary matching CLI `/usage` style. */
  summaryLines: string[];
  /** Billing management URL. */
  manageUrl: string;
  /** ISO time of last successful fetch. */
  fetchedAt?: string;
  /** Last fetch error (keeps previous data if any). */
  error?: string;
}

export interface AppSnapshot {
  connection: ConnectionState;
  error?: string;
  workspace?: string;
  sessionId?: string;
  sessionTitle?: string;
  modelId?: string;
  sessionMode: SessionModeId;
  reasoningEffort?: string;
  availableModels: ModelInfo[];
  /** Shell/skills slash commands (from initialize / list / available_commands_update). */
  availableCommands: AvailableCommand[];
  acceptsImages: boolean;
  agentVersion?: string;
  accountEmail?: string;
  /**
   * False when no Grok credentials are configured anywhere. Connection
   * stays ready; users can still use custom model providers. Renderer
   * surfaces "未登录" hint in this state.
   */
  accountAvailable?: boolean;
  /** Coding credit / subscription usage (from `x.ai/billing`). */
  usage?: UsageInfo;
  timeline: TimelineItem[];
  sessions: SessionSummary[];
  busy: boolean;
  /** True while conversation compaction is in progress. */
  compacting?: boolean;
  binaryPath?: string;
  /**
   * URL pointing to installation instructions for the `grok` CLI.
   * Surfaced in the connection-error card so the user can install the
   * missing agent with one click.
   */
  agentInstallUrl?: string;
  replaying?: boolean;
  /**
   * Estimated tokens currently filling the context window
   * (from session/update `_meta.totalTokens` / session info).
   */
  tokensUsed?: number;
  /** Model context window size (tokens). */
  contextWindow?: number;
  /** Active permission prompt (front of queue), if any. */
  pendingPermission?: PermissionRequestUi;
  /**
   * Active structured questionnaire (`x.ai/ask_user_question`) for the
   * focused session. Takes UI priority over permission prompts.
   */
  pendingQuestion?: AskUserQuestionUi;
  /**
   * Always-approve (YOLO) mode: tools run without permission prompts.
   * Synced with agent via `x.ai/yolo_mode_changed` and `~/.grok/config.toml`.
   */
  alwaysApprove: boolean;
  /**
   * Settings → Permissions: when true, the desktop grants folder trust
   * for the workspace cwd before each `session/new` (equivalent to the
   * CLI's `grok --trust <cwd>`). Persisted in `~/.grok/config.toml
   * [ui].auto_trust_new_sessions`.
   */
  autoTrustNewSessions: boolean;
  /**
   * Active folder-trust prompt (`x.ai/folder_trust/request`) for the
   * focused session. Only the front of the queue is surfaced to the UI.
   */
  pendingTrustPrompt?: FolderTrustPromptUi;
  /**
   * Live todo list for the focused session
   * (from ACP `sessionUpdate: "plan"` / `todo_write`).
   */
  todos: TodoItemUi[];
  /**
   * Latest plan.md body for the focused session (from approval request
   * or `~/.grok/sessions/.../plan.md` on load).
   */
  planContent?: string;
  /** Pending plan-mode exit approval for the focused session. */
  pendingPlanApproval?: PlanApprovalUi;
  /**
   * Installer state — surfaced to Settings → Agent and to the connection
   * error card so the user can see "absent / ready / update-available /
   * installing / upgrading / rollback / error" at a glance.
   */
  installerStatus: InstallerStatus;
  /** Currently-selected installer channel. Defaults to `stable`. */
  installerChannel: InstallerChannel;
  /** ISO timestamp of the last successful background update check. */
  lastUpdateCheckAt?: string;
}

/** Channels the desktop exposes for the `grok` CLI release stream. */
export type InstallerChannel = "stable" | "alpha" | "enterprise";

/**
 * Installer state machine. Kinds are mutually exclusive; the renderer
 * picks UI elements based on `kind`. Transitions are driven by the
 * `agent-installer` module and the renderer-initiated install / upgrade
 * IPC calls.
 */
export type InstallerStatus =
  | { kind: "absent" }
  | { kind: "ready"; version: string; path: string }
  | {
      kind: "update-available";
      current: string;
      latest: string;
      path: string;
    }
  | { kind: "installing"; startedAt: number }
  | { kind: "upgrading"; from: string; to: string; startedAt: number }
  | { kind: "rollback"; fromVersion: string; reason: string }
  | { kind: "error"; message: string };

/** Result envelope returned by the `agent:install` / `agent:upgrade` IPC. */
export interface InstallerResult {
  ok: boolean;
  path?: string;
  output: string;
  code: number | null;
  durationMs: number;
  error?: string;
}

export type AgentUiEvent =
  | { type: "snapshot"; snapshot: AppSnapshot }
  | { type: "log"; level: "info" | "warn" | "error"; message: string };

export interface PathSuggestion {
  path: string;
  isDir: boolean;
}

/** One entry in the workspace file tree. */
export interface FileEntry {
  name: string;
  /** Workspace-relative POSIX path ("" for root children use name only as path). */
  path: string;
  isDir: boolean;
  size?: number;
}

/** Result of reading a workspace file for the preview pane. */
export interface FileReadResult {
  path: string;
  name: string;
  ext: string;
  size: number;
  encoding: "utf8" | "binary";
  content: string;
  truncated: boolean;
  binary: boolean;
  /** highlight.js language id */
  language: string;
  /** When the file is an image, the detected MIME type (e.g. "image/png"). */
  imageMime?: string;
  /** When the file is an image, base64 payload (no `data:` prefix) for inline rendering. */
  imageBase64?: string;
}

/** MCP server row for management UI. */
export type McpServerScope = "user" | "project";

export interface McpServerEntry {
  name: string;
  enabled: boolean;
  scope: McpServerScope;
  transport: "stdio" | "http" | "sse";
  /** Command line or URL. */
  detail: string;
}

export interface AddMcpServerInput {
  name: string;
  transport: "stdio" | "http" | "sse";
  commandOrUrl: string;
  args?: string[];
  /** KEY=value entries for stdio. */
  env?: string[];
  /** "Name: value" headers for http/sse. */
  headers?: string[];
  scope?: McpServerScope;
}

export interface SkillEntry {
  name: string;
  description: string;
  path: string;
  scope: "local" | "user" | "bundled" | "compat";
  disabled: boolean;
}

export interface PluginEntry {
  status: "installed" | "available";
  name: string;
  version?: string;
  path?: string;
  source?: string;
  marketplace?: string;
  description?: string;
  skillCount?: number;
  hasHooks?: boolean;
  hasAgents?: boolean;
  hasMcp?: boolean;
  enabled?: boolean;
}

export interface HookEntry {
  name: string;
  path: string;
  scope: "user" | "project" | "compat";
  events: string[];
  commandCount?: number;
}

export interface ExtensionsConfigPaths {
  userConfig: string;
  projectConfig?: string;
  skillsUser: string;
  hooksUser: string;
}

// ── Custom model providers ──────────────────────────────────────────

/** OpenAI / Anthropic wire protocol for a custom model. */
export type ApiBackend = "chat_completions" | "responses" | "messages";

export type ModelProviderRegion = "intl" | "cn" | "local";

export type ModelProviderAuthStyle = "bearer" | "x-api-key";

/** Built-in catalog entry for quick add. */
export interface ModelProviderPreset {
  id: string;
  name: string;
  nameZh: string;
  region: ModelProviderRegion;
  /** Default base URL for the default apiBackend (full prefix; agent appends protocol path). */
  baseUrl: string;
  apiBackend: ApiBackend;
  /**
   * Optional full base URLs for each protocol this vendor exposes.
   * Selecting a protocol in the UI sets `baseUrl` to the matching entry
   * (e.g. MiniMax messages → `…/anthropic/v1`, chat_completions → `…/v1`).
   */
  protocolEndpoints?: Partial<Record<ApiBackend, string>>;
  /**
   * Base URL used for `GET …/models` listing when it differs from the
   * active inference base (e.g. Anthropic-compatible path has no /models).
   */
  modelsListBaseUrl?: string;
  envKey?: string;
  authStyle?: ModelProviderAuthStyle;
  extraHeaders?: Record<string, string>;
  popularModels?: { id: string; name: string }[];
}

/** One model enabled (or listed) under a provider. */
export interface ModelProviderModel {
  /** Model id sent to the provider API. */
  id: string;
  /** Display name. */
  name: string;
  /** config.toml section key (`[model.<configKey>]`), also agent modelId. */
  configKey: string;
  source: "fetched" | "manual";
  enabled: boolean;
}

/** User-configured provider instance (may have multiple models). */
export interface ModelProviderConfig {
  id: string;
  presetId?: string;
  name: string;
  baseUrl: string;
  apiBackend: ApiBackend;
  /** Stored API key (also written into config.toml for the agent). */
  apiKey?: string;
  envKey?: string;
  enabled: boolean;
  extraHeaders?: Record<string, string>;
  authStyle?: ModelProviderAuthStyle;
  models: ModelProviderModel[];
  createdAt: number;
  updatedAt: number;
}

export interface UpsertProviderInput {
  id?: string;
  presetId?: string;
  name?: string;
  baseUrl?: string;
  apiBackend?: ApiBackend;
  apiKey?: string | null;
  envKey?: string | null;
  enabled?: boolean;
  extraHeaders?: Record<string, string>;
  authStyle?: ModelProviderAuthStyle;
  models?: Array<{
    id: string;
    name: string;
    configKey?: string;
    source?: "fetched" | "manual";
    enabled?: boolean;
  }>;
}

export interface FetchedModelInfo {
  id: string;
  name: string;
  ownedBy?: string;
}

export interface FetchModelsInput {
  baseUrl: string;
  apiKey?: string;
  envKey?: string;
  authStyle?: ModelProviderAuthStyle;
  extraHeaders?: Record<string, string>;
}

/** configKey → provider identity (for composer grouping). */
export type ModelConfigKeyIndex = Record<
  string,
  { providerId: string; providerName: string }
>;

// ── Account / auth ──────────────────────────────────────────────────

/** Browser OAuth (default) or RFC 8628 device-code flow. */
export type AccountLoginMethod = "oauth" | "device";

export interface AccountStatus {
  signedIn: boolean;
  email?: string;
  displayName?: string;
  userId?: string;
  teamId?: string;
  authMode?: string;
  expiresAt?: string;
  issuer?: string;
  /** True if XAI_API_KEY is available (env or desktop-stored). */
  apiKeySet: boolean;
  apiKeySource: "env" | "desktop" | null;
  loginInProgress: boolean;
  loginMethod?: AccountLoginMethod;
  deviceUrl?: string;
  deviceUserCode?: string;
  loginMessage?: string;
}

export type AccountUiEvent =
  | { type: "status"; status: AccountStatus }
  | {
      type: "loginProgress";
      message: string;
      deviceUrl?: string;
      deviceUserCode?: string;
    }
  | {
      type: "loginDone";
      ok: boolean;
      message: string;
      status: AccountStatus;
    };

/** Events from the embedded terminal host. */
export type TermHostEvent =
  | { type: "data"; id: string; data: string }
  | { type: "exit"; id: string; code: number | null };

export interface TermStartResult {
  id: string;
  cwd: string;
  shell: string;
}

export interface DesktopApi {
  getState: () => Promise<AppSnapshot>;
  connect: () => Promise<void>;
  newSession: (workspace: string) => Promise<void>;
  /**
   * Clear active session/workspace so the UI shows an empty chat.
   * User must pick a workspace before chatting.
   */
  prepareNewChat: () => Promise<void>;
  loadSession: (sessionId: string, cwd: string) => Promise<void>;
  refreshHistory: () => Promise<void>;
  renameSession: (
    sessionId: string,
    title: string,
    cwd: string,
  ) => Promise<void>;
  deleteSession: (sessionId: string, cwd: string) => Promise<void>;
  forkSession: (sessionId: string, cwd: string) => Promise<ForkSessionResult>;
  searchSessions: (
    query: string,
    options?: SearchSessionsOptions,
  ) => Promise<SessionSearchHit[]>;
  stop: () => Promise<void>;
  pickFolder: () => Promise<string | null>;
  pickFiles: () => Promise<PromptAttachment[]>;
  /** Build attachments from absolute paths (e.g. drag-and-drop). */
  attachPaths: (paths: string[]) => Promise<PromptAttachment[]>;
  /**
   * Resolve a dropped/selected File to an absolute filesystem path
   * (Electron webUtils; empty string if unavailable).
   */
  getPathForFile: (file: File) => string;
  pathSuggest: (query: string) => Promise<PathSuggestion[]>;
  setModel: (modelId: string, reasoningEffort?: string) => Promise<void>;
  setMode: (modeId: SessionModeId) => Promise<void>;
  sendPrompt: (payload: PromptPayload | string) => Promise<void>;
  /**
   * User prompt history for a workspace (newest first).
   * Uses agent `x.ai/prompt_history`; optional session filter.
   */
  listPromptHistory: (
    cwd: string,
    filterSessionId?: string,
  ) => Promise<string[]>;
  cancel: () => Promise<void>;
  /** Cancel a background session's in-flight turn without switching focus. */
  cancelSession: (sessionId: string) => Promise<void>;
  /**
   * Resolve a pending permission prompt.
   * Pass optionId to select; pass null to cancel.
   */
  respondPermission: (
    requestId: string,
    optionId: string | null,
  ) => Promise<void>;
  /**
   * Resolve a pending `x.ai/ask_user_question` questionnaire.
   * Wire body matches AskUserQuestionExtResponse (accepted / chat / skip / cancelled).
   */
  respondAskUserQuestion: (
    requestId: string,
    response: AskUserQuestionResponse,
  ) => Promise<void>;
  /**
   * Resolve a pending plan-mode approval (`x.ai/exit_plan_mode`).
   * - approved: leave plan mode and implement
   * - cancelled: request changes (optional feedback text)
   * - abandoned: quit plan without implementing
   */
  respondPlanApproval: (
    requestId: string,
    outcome: PlanApprovalOutcome,
    feedback?: string,
  ) => Promise<void>;
  /** Re-read plan.md for the focused session from disk. */
  refreshPlanContent: () => Promise<string | null>;
  /** Enable or disable always-approve (YOLO) mode. */
  setAlwaysApprove: (enabled: boolean) => Promise<void>;
  /**
   * Toggle "auto-grant folder trust for new sessions" (the desktop
   * equivalent of `grok --trust <cwd>`). When enabled, every new session
   * implicitly trusts the chosen workspace; the agent's interactive
   * trust prompt will NOT fire for that workspace.
   */
  setAutoTrustNewSessions: (enabled: boolean) => Promise<void>;
  /**
   * Resolve a pending folder-trust prompt (`x.ai/folder_trust/request`).
   * Pass `"trust"` to grant; `"reject"` to keep the workspace gated.
   */
  respondTrustPrompt: (
    requestId: string,
    outcome: FolderTrustOutcome,
  ) => Promise<void>;
  /** List every recorded entry in `~/.grok/trusted_folders.toml`. */
  listTrustedFolders: () => Promise<TrustedFolderEntry[]>;
  /**
   * Revoke (or explicitly decline) trust for `path`. Mirrors the agent's
   * `set_untrusted`: refuses non-absolute / `$HOME` / `/` paths and
   * always persists an explicit `trusted = false` record so future
   * prompts can tell declined apart from undecided.
   *
   * Returns `true` if the entry was actually flipped from trusted to
   * untrusted; `false` for no-op cases.
   */
  revokeTrustedFolder: (path: string) => Promise<boolean>;
  /**
   * List a directory under the active workspace.
   * `relDir` is workspace-relative ("" = workspace root).
   */
  listDir: (relDir?: string) => Promise<FileEntry[]>;
  /**
   * Read a text file under the active workspace for preview.
   * Binary / oversized files return metadata with empty content.
   */
  readFile: (relPath: string) => Promise<FileReadResult>;
  /** Start an interactive PTY shell in cwd (defaults to workspace). */
  termStart: (
    cwd?: string,
    cols?: number,
    rows?: number,
  ) => Promise<TermStartResult>;
  termWrite: (id: string, data: string) => Promise<void>;
  termResize: (id: string, cols: number, rows: number) => Promise<void>;
  termKill: (id: string) => Promise<void>;
  onTermEvent: (cb: (event: TermHostEvent) => void) => () => void;
  // ── Extensions (MCP / Skills / Plugins / Hooks) ──
  listMcpServers: () => Promise<McpServerEntry[]>;
  addMcpServer: (input: AddMcpServerInput) => Promise<void>;
  removeMcpServer: (name: string, scope?: McpServerScope) => Promise<void>;
  setMcpEnabled: (
    name: string,
    enabled: boolean,
    scope?: McpServerScope,
  ) => Promise<void>;
  listSkills: () => Promise<SkillEntry[]>;
  setSkillDisabled: (name: string, disabled: boolean) => Promise<void>;
  listPlugins: (available?: boolean) => Promise<PluginEntry[]>;
  installPlugin: (source: string) => Promise<void>;
  uninstallPlugin: (name: string) => Promise<void>;
  setPluginEnabled: (name: string, enabled: boolean) => Promise<void>;
  listHooks: () => Promise<HookEntry[]>;
  readHookFile: (path: string) => Promise<string>;
  getExtensionsPaths: () => Promise<ExtensionsConfigPaths>;
  // ── Custom model providers ──
  listModelPresets: () => Promise<ModelProviderPreset[]>;
  listModelProviders: () => Promise<ModelProviderConfig[]>;
  upsertModelProvider: (
    input: UpsertProviderInput,
  ) => Promise<ModelProviderConfig>;
  deleteModelProvider: (id: string) => Promise<void>;
  addModelProviderFromPreset: (
    presetId: string,
    overrides?: Partial<UpsertProviderInput>,
  ) => Promise<ModelProviderConfig>;
  fetchProviderModels: (input: FetchModelsInput) => Promise<FetchedModelInfo[]>;
  /** Map agent modelId (configKey) → provider for composer grouping. */
  getModelConfigKeyIndex: () => Promise<ModelConfigKeyIndex>;
  // ── Account ──
  getAccountStatus: () => Promise<AccountStatus>;
  /** Browser OAuth (`--oauth`) or device-code (`--device-auth`). */
  login: (method: AccountLoginMethod) => Promise<AccountStatus>;
  cancelLogin: () => Promise<void>;
  logout: () => Promise<{ message: string; status: AccountStatus }>;
  /** Persist API key for agent (desktop file); pass null to clear. */
  setApiKey: (key: string | null) => Promise<AccountStatus>;
  /** Re-run agent connect after credentials change. */
  reconnectAgent: () => Promise<void>;
  /** Refresh subscription / credit usage via agent `x.ai/billing`. */
  refreshUsage: () => Promise<UsageInfo | null>;
  /** Open URL in the system browser (billing manage page, etc.). */
  openExternal: (url: string) => Promise<void>;
  /**
   * Drive the official `grok` CLI installer from the desktop. Returns the
   * installer's combined stdout/stderr so the UI can show progress.
   * After a successful install the next `connect` will pick up the binary
   * at `~/.grok/bin/grok{,.exe}` automatically.
   */
  installAgent: () => Promise<InstallerResult>;
  /**
   * Re-resolve the installer state from disk. Cheap; safe to call on a
   * tight loop when the UI wants to refresh status badges.
   */
  getInstallerStatus: () => Promise<InstallerStatus>;
  /**
   * Run an update check against the configured channel. Network call;
   * returns `hasUpdate: false` on failure (so the UI doesn't flash an
   * error banner every time the user is offline).
   */
  checkForUpdate: () => Promise<{
    hasUpdate: boolean;
    current: string;
    latest: string;
  }>;
  /**
   * Backup the current binary, run the installer, and remember that we
   * just upgraded so the next `connect` can verify health and roll back
   * if needed.
   */
  upgradeAgent: () => Promise<InstallerResult>;
  /** Read the configured channel from `~/.grok/config.toml`. */
  getInstallerChannel: () => Promise<InstallerChannel>;
  /**
   * Persist the channel. Does NOT trigger an upgrade — the user must
   * explicitly click Upgrade for that. This keeps "I switched to alpha"
   * from silently pulling a different release stream on the next boot.
   */
  setInstallerChannel: (channel: InstallerChannel) => Promise<InstallerChannel>;
  onEvent: (cb: (event: AgentUiEvent) => void) => () => void;
  onAccountEvent: (cb: (event: AccountUiEvent) => void) => () => void;
}

declare global {
  interface Window {
    desktop: DesktopApi;
  }
}
