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
  | { id: string; kind: "user"; text: string }
  | { id: string; kind: "thought"; text: string; streaming?: boolean }
  | { id: string; kind: "assistant"; text: string; streaming?: boolean }
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
    }
  | { id: string; kind: "system"; text: string };

/** Live status for a session in the sidebar (desktop multi-session). */
export type SessionRunStatus =
  | "idle"
  | "running"
  | "loading"
  | "needs_permission";

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
  /** Coding credit / subscription usage (from `x.ai/billing`). */
  usage?: UsageInfo;
  timeline: TimelineItem[];
  sessions: SessionSummary[];
  busy: boolean;
  /** True while conversation compaction is in progress. */
  compacting?: boolean;
  binaryPath?: string;
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
   * Always-approve (YOLO) mode: tools run without permission prompts.
   * Synced with agent via `x.ai/yolo_mode_changed` and `~/.grok/config.toml`.
   */
  alwaysApprove: boolean;
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
  cancel: () => Promise<void>;
  /**
   * Resolve a pending permission prompt.
   * Pass optionId to select; pass null to cancel.
   */
  respondPermission: (
    requestId: string,
    optionId: string | null,
  ) => Promise<void>;
  /** Enable or disable always-approve (YOLO) mode. */
  setAlwaysApprove: (enabled: boolean) => Promise<void>;
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
  onEvent: (cb: (event: AgentUiEvent) => void) => () => void;
  onAccountEvent: (cb: (event: AccountUiEvent) => void) => () => void;
}

declare global {
  interface Window {
    desktop: DesktopApi;
  }
}
