import type { ResolvedLocale } from "./prefs";

export interface Messages {
  // Sidebar
  newSession: string;
  /** New session under a specific project folder. */
  newSessionInProject: string;
  openWorkspace: string;
  settings: string;
  noSessions: string;
  connecting: string;
  connected: string;
  disconnected: string;
  starting: string;
  searchSessions: string;
  searchNoResults: string;
  searchHits: string;
  renameSession: string;
  deleteSession: string;
  forkSession: string;
  renamePlaceholder: string;
  deleteConfirm: string;
  untitledSession: string;
  sessionActions: string;
  searchIndexing: string;
  /** Sidebar: session is generating / tools running. */
  sessionStatusRunning: string;
  /** Sidebar: session history is loading. */
  sessionStatusLoading: string;
  /** Sidebar: session is waiting for a permission decision. */
  sessionStatusNeedsPermission: string;

  // Home
  greeting: string;
  homeHint: string;
  cantReachAgent: string;
  retryConnect: string;

  // Timeline
  you: string;
  grok: string;
  thought: string;
  thoughtStreaming: string;
  /** Sticky bar: user turn for the scroll section; click jumps to it. */
  currentTurnPin: string;
  currentTurnPinHint: string;
  loadingConversation: string;
  compactRunning: string;
  compactRunningAuto: string;
  compactRunningAutoPct: string;
  compactDone: string;
  compactDoneTokens: string;
  compactFailed: string;
  compactCancelled: string;
  compactManual: string;
  compactAuto: string;
  /** Label above tool stdout / text content. */
  toolOutput: string;
  toolOutputTruncated: string;
  /** e.g. "2 files" for multi-diff tool cards. */
  toolDiffCount: string;
  /** Copy one timeline bubble to clipboard. */
  copyMessage: string;
  /** Short confirm after copy. */
  copied: string;
  copyFailed: string;
  /** Export full conversation. */
  exportConversation: string;
  exportCopyMarkdown: string;
  exportDownloadMarkdown: string;
  exportEmpty: string;
  exportCopied: string;
  exportDownloaded: string;
  /** Markdown section labels used in export (role-like). */
  exportLabelTool: string;
  exportLabelCompact: string;
  exportLabelSystem: string;

  // Composer
  local: string;
  chooseWorkspace: string;
  switchModel: string;
  sessionMode: string;
  reasoningEffort: string;
  openSessionForModels: string;
  modeAgent: string;
  modeAgentHint: string;
  modePlan: string;
  modePlanHint: string;
  modeAsk: string;
  modeAskHint: string;
  effort: string;
  /** Tooltip for context token usage chip (used / window). */
  tokenUsage: string;
  placeholderReady: string;
  placeholderWaiting: string;
  noMatches: string;
  attachFiles: string;
  cancel: string;
  send: string;
  /** Composer placeholder while a turn is running. */
  placeholderBusy: string;
  /** Prompt queue (busy follow-ups). */
  queueTitle: string;
  queueCount: string;
  queueHintBusy: string;
  queueClear: string;
  queueSendNow: string;
  queueSendNowHint: string;
  queueSendNowShortcut: string;
  queueRemove: string;
  queueAction: string;
  queueAttachmentsOnly: string;
  queueEmptyItem: string;
  /** Prompt history (↑ / /history). */
  historyBrowseStatus: string;
  historyBrowseHint: string;
  historySearchTitle: string;
  historySearchPlaceholder: string;
  historySearchClose: string;
  historySearchHint: string;
  historyEmpty: string;
  historyNoMatches: string;
  permissionsMvp: string;
  permissionTitle: string;
  permissionHint: string;
  permissionConfirm: string;
  permissionCancel: string;
  permissionQueued: string;
  alwaysApproveOn: string;
  alwaysApproveOff: string;
  alwaysApproveTitle: string;
  alwaysApproveHint: string;

  // Account menu
  account: string;
  accountMenu: string;

  // Account / auth (CLI parity)
  accountLoginBrowser: string;
  accountLoginDevice: string;
  accountLogout: string;
  accountLogoutConfirm: string;
  accountLoggedOut: string;
  accountCancelLogin: string;
  accountLoginCancelled: string;
  accountLoginInProgress: string;
  accountLoginBrowserStarting: string;
  accountLoginDeviceStarting: string;
  accountLoginHelp: string;
  accountSignedIn: string;
  accountSignedInAs: string;
  accountSessionActive: string;
  accountReconnect: string;
  accountReconnected: string;
  accountAuthMode: string;
  accountExpires: string;
  accountIssuer: string;
  accountTeamId: string;
  accountApiKeyStatus: string;
  accountApiKeyNone: string;
  accountApiKeyFromEnv: string;
  accountApiKeyFromDesktop: string;
  accountApiKeySection: string;
  accountApiKeyDesc: string;
  accountApiKeyLabel: string;
  accountApiKeyPlaceholder: string;
  accountApiKeyPlaceholderSet: string;
  accountSaveApiKey: string;
  accountClearApiKey: string;
  accountApiKeySaved: string;
  accountApiKeyCleared: string;
  accountApiKeyEnvHint: string;
  accountUsageSection: string;
  accountUsageDesc: string;
  accountUsageTier: string;
  accountUsageReset: string;
  accountUsageCredits: string;
  accountUsageAutoTopup: string;
  accountUsageAutoTopupOff: string;
  accountUsagePayg: string;
  accountUsageUpdated: string;
  accountUsageRefresh: string;
  accountUsageRefreshed: string;
  accountUsageManage: string;
  accountUsageDetails: string;
  accountUsageUnavailable: string;
  accountDeviceCode: string;
  accountCopyCode: string;
  accountCopied: string;
  accountCopyFailed: string;
  accountShow: string;
  accountHide: string;

  // Settings
  settingsTitle: string;
  settingsSubtitle: string;
  language: string;
  languageDesc: string;
  theme: string;
  themeDesc: string;
  followSystem: string;
  english: string;
  chinese: string;
  themeDark: string;
  themeLight: string;
  backToChat: string;
  appearanceSection: string;
  languageSection: string;
  accountSection: string;
  accountSectionDesc: string;
  permissionsSection: string;
  permissionsSectionDesc: string;
  alwaysApproveSetting: string;
  alwaysApproveSettingDesc: string;
  alwaysApproveEnabled: string;
  alwaysApproveDisabled: string;
  connectionStatus: string;
  signedInAs: string;
  notSignedIn: string;
  aboutSection: string;
  aboutSectionDesc: string;
  appName: string;
  currentResolved: string;

  // File explorer / viewer
  filesTitle: string;
  filesToggle: string;
  filesToggleHide: string;
  filesNoWorkspace: string;
  filesEmpty: string;
  filesLoading: string;
  filesFilter: string;
  filesNoMatch: string;
  filesRefresh: string;
  filesClose: string;
  filesBinary: string;
  filesTruncated: string;
  filesShowSource: string;
  filesShowPreview: string;
  filesInsertMention: string;
  /** Accessible name for the shell-level file preview column. */
  filesPreview: string;

  // Right side panel + workspace picker
  sidePanelToggle: string;
  sidePanelToggleHide: string;
  sidePanelFiles: string;
  sidePanelTerminal: string;
  sidePanelReview: string;
  sidePanelBrowser: string;
  sidePanelReviewHint: string;
  sidePanelBrowserHint: string;
  sidePanelFilesShortcut: string;
  sidePanelTerminalShortcut: string;
  sidePanelReviewShortcut: string;
  sidePanelBrowserShortcut: string;
  openFileTitle: string;
  openFileEmpty: string;
  openFileEmptyHint: string;
  resizeSidebar: string;
  resizeRightPanel: string;
  resizeViewer: string;
  sidebarExpand: string;
  workspaceLabel: string;
  workspaceEmpty: string;
  workspacePick: string;
  workspaceBrowse: string;
  workspaceRecent: string;
  chooseWorkspaceFirst: string;
  placeholderNeedWorkspace: string;
  termTitle: string;
  termHint: string;
  termPlaceholder: string;
  termStarting: string;
  termRestart: string;
  termClear: string;
  termRun: string;
  termExited: string;

  // Extensions (MCP / Skills / Plugins / Hooks)
  navMcp: string;
  navExtensions: string;
  extTitle: string;
  extSubtitle: string;
  extTabMcp: string;
  extTabSkills: string;
  extTabPlugins: string;
  extTabHooks: string;
  extFilter: string;
  extRefresh: string;
  extAddMcp: string;
  extAddMcpHint: string;
  extMcpName: string;
  extMcpTransport: string;
  extMcpCommand: string;
  extMcpUrl: string;
  extMcpArgs: string;
  extScope: string;
  extScopeUser: string;
  extScopeProject: string;
  extSave: string;
  extCancel: string;
  extSaved: string;
  extRemove: string;
  extRemoveConfirm: string;
  extEnabled: string;
  extDisabled: string;
  extMcpEmpty: string;
  extSkillsEmpty: string;
  extPluginsEmpty: string;
  extHooksEmpty: string;
  extInstallPlugin: string;
  extInstallPluginHint: string;
  extInstall: string;
  extUninstall: string;
  extUninstallConfirm: string;
  extShowMarketplace: string;
  extInstalledOnly: string;
  extAvailable: string;
  extInstalled: string;
  extView: string;
  extFootnote: string;
  /** Composer drop zone hint. */
  dropFilesHint: string;
}

const en: Messages = {
  newSession: "New session",
  newSessionInProject: "New session in this project",
  openWorkspace: "Open workspace",
  settings: "Settings",
  noSessions: "No recent sessions yet. Start a new one.",
  connecting: "Connecting to agent…",
  connected: "Connected",
  disconnected: "Disconnected",
  starting: "Starting…",
  searchSessions: "Search sessions…",
  searchNoResults: "No sessions match your search.",
  searchHits: "Search results",
  renameSession: "Rename",
  deleteSession: "Delete",
  forkSession: "Fork",
  renamePlaceholder: "Session title",
  deleteConfirm: "Delete this session permanently? This cannot be undone.",
  untitledSession: "Untitled",
  sessionActions: "Session actions",
  searchIndexing: "Search index is still building…",
  sessionStatusRunning: "Running",
  sessionStatusLoading: "Loading",
  sessionStatusNeedsPermission: "Needs approval",

  greeting: "What's up next?",
  homeHint:
    "Pick a workspace above the input, then describe a task. Or open a past session from the sidebar.",
  cantReachAgent: "Can't reach agent",
  retryConnect: "Retry connect",

  you: "You",
  grok: "Grok",
  thought: "Thought",
  thoughtStreaming: "Thought · streaming",
  currentTurnPin: "You",
  currentTurnPinHint: "Jump to this message",
  loadingConversation: "Loading conversation…",
  compactRunning: "Compacting conversation…",
  compactRunningAuto: "Auto-compacting conversation…",
  compactRunningAutoPct: "Auto-compacting conversation ({pct}% full)…",
  compactDone: "Conversation compacted",
  compactDoneTokens: "Context compacted: {before} → {after} tokens",
  compactFailed: "Compaction failed",
  compactCancelled: "Compaction cancelled",
  compactManual: "Compact",
  compactAuto: "Auto-compact",
  toolOutput: "Output",
  toolOutputTruncated: "Output truncated for display",
  toolDiffCount: "{n} file(s)",
  copyMessage: "Copy message",
  copied: "Copied",
  copyFailed: "Could not copy",
  exportConversation: "Export",
  exportCopyMarkdown: "Copy as Markdown",
  exportDownloadMarkdown: "Download .md",
  exportEmpty: "Nothing to export yet",
  exportCopied: "Conversation copied as Markdown",
  exportDownloaded: "Markdown file downloaded",
  exportLabelTool: "Tool",
  exportLabelCompact: "Compact",
  exportLabelSystem: "System",

  local: "Local",
  chooseWorkspace: "Choose workspace",
  switchModel: "Switch model",
  sessionMode: "Session mode",
  reasoningEffort: "Reasoning effort",
  openSessionForModels: "Open a session to load models",
  modeAgent: "Agent",
  modeAgentHint: "Full tools",
  modePlan: "Plan",
  modePlanHint: "Plan before code",
  modeAsk: "Ask",
  modeAskHint: "Read-only Q&A",
  effort: "Effort",
  tokenUsage: "Context tokens: {used} used / {total} window",
  placeholderReady: "Describe a task…  / commands  ·  @ files",
  placeholderWaiting: "Waiting for agent…",
  placeholderBusy:
    "Agent is working — Enter to queue · Ctrl+Enter to send now…",
  noMatches: "No matches for",
  attachFiles: "Attach files",
  cancel: "Cancel",
  send: "Send",
  queueTitle: "Queued messages",
  queueCount: "{n} queued",
  queueHintBusy: "Sends when the current turn finishes",
  queueClear: "Clear",
  queueSendNow: "Send now",
  queueSendNowHint: "Cancel current turn and send this next",
  queueSendNowShortcut: "Ctrl+Enter",
  queueRemove: "Remove from queue",
  queueAction: "Queue",
  queueAttachmentsOnly: "{n} attachment(s)",
  queueEmptyItem: "(empty)",
  historyBrowseStatus: "History {i}/{n}",
  historyBrowseHint: "↑↓ step · Esc clear · type to edit",
  historySearchTitle: "Prompt history",
  historySearchPlaceholder: "Filter prompts…",
  historySearchClose: "Close",
  historySearchHint: "↑↓ · Enter insert · Esc close · also /history or Ctrl+R",
  historyEmpty: "No prompts in history yet",
  historyNoMatches: "No matching prompts",
  permissionsMvp: "Permissions: confirm each action",
  permissionTitle: "Permission required",
  permissionHint: "↑↓ to choose · Enter to confirm · Esc to cancel",
  permissionConfirm: "Confirm",
  permissionCancel: "Cancel",
  permissionQueued: "{n} more waiting",
  alwaysApproveOn: "Always",
  alwaysApproveOff: "Ask",
  alwaysApproveTitle: "Always-approve (YOLO)",
  alwaysApproveHint:
    "When on, tools run without permission prompts. Toggle with click or /always-approve.",

  account: "Account",
  accountMenu: "Account menu",

  accountLoginBrowser: "Sign in with browser",
  accountLoginDevice: "Sign in with device code",
  accountLogout: "Sign out",
  accountLogoutConfirm:
    "Sign out and clear cached credentials? The agent connection will stop.",
  accountLoggedOut: "Signed out",
  accountCancelLogin: "Cancel sign-in",
  accountLoginCancelled: "Sign-in cancelled",
  accountLoginInProgress: "Signing in…",
  accountLoginBrowserStarting: "Opening browser for sign-in…",
  accountLoginDeviceStarting: "Starting device-code login…",
  accountLoginHelp:
    "Uses the same OAuth / device flow as `grok login`. Credentials are stored in ~/.grok/auth.json and shared with the CLI. After signing in, the agent reconnects automatically.",
  accountSignedIn: "Signed in",
  accountSignedInAs: "Signed in as {email}",
  accountSessionActive: "Session active",
  accountReconnect: "Reconnect agent",
  accountReconnected: "Agent reconnecting…",
  accountAuthMode: "Auth mode",
  accountExpires: "Token expires",
  accountIssuer: "Issuer",
  accountTeamId: "Team",
  accountApiKeyStatus: "API key",
  accountApiKeyNone: "Not set",
  accountApiKeyFromEnv: "Set (environment)",
  accountApiKeyFromDesktop: "Set (desktop)",
  accountApiKeySection: "API key",
  accountApiKeyDesc:
    "Fallback when no browser session is active (CI / automation). Stored only on this machine under ~/.grok/desktop-api-key (mode 0600). Session tokens from Sign in take precedence.",
  accountApiKeyLabel: "XAI_API_KEY",
  accountApiKeyPlaceholder: "xai-…",
  accountApiKeyPlaceholderSet: "••••••••  (enter new key to replace)",
  accountSaveApiKey: "Save API key",
  accountClearApiKey: "Clear desktop key",
  accountApiKeySaved: "API key saved",
  accountApiKeyCleared: "Desktop API key cleared",
  accountApiKeyEnvHint:
    "XAI_API_KEY is set in the process environment. Unset it in your shell to use a desktop-stored key instead.",
  accountUsageSection: "Usage & subscription",
  accountUsageDesc:
    "Coding credit usage for your account (same as CLI /usage). Refreshes automatically while connected.",
  accountUsageTier: "Plan",
  accountUsageReset: "Next reset",
  accountUsageCredits: "Prepaid credits",
  accountUsageAutoTopup: "Auto top-up",
  accountUsageAutoTopupOff: "Disabled",
  accountUsagePayg: "Pay-as-you-go",
  accountUsageUpdated: "Last updated",
  accountUsageRefresh: "Refresh usage",
  accountUsageRefreshed: "Usage refreshed",
  accountUsageManage: "Manage billing",
  accountUsageDetails: "Details…",
  accountUsageUnavailable:
    "Usage unavailable (sign in with a consumer account, or agent not ready).",
  accountDeviceCode: "Device code",
  accountCopyCode: "Copy code / URL",
  accountCopied: "Copied to clipboard",
  accountCopyFailed: "Could not copy to clipboard",
  accountShow: "Show",
  accountHide: "Hide",

  settingsTitle: "Settings",
  settingsSubtitle: "Language, appearance, and account for this app.",
  language: "Language",
  languageDesc: "UI language for menus, labels, and messages.",
  theme: "Theme",
  themeDesc: "Color scheme for the desktop client.",
  followSystem: "System",
  english: "English",
  chinese: "中文",
  themeDark: "Dark",
  themeLight: "Light",
  backToChat: "Back to chat",
  appearanceSection: "Appearance",
  languageSection: "Language",
  accountSection: "Account",
  accountSectionDesc:
    "Sign in, sign out, API key, and agent connection. Shared with the CLI via ~/.grok.",
  permissionsSection: "Permissions",
  permissionsSectionDesc:
    "How the agent is allowed to run tools and edit files.",
  alwaysApproveSetting: "Always-approve mode",
  alwaysApproveSettingDesc:
    "Skip permission prompts for all tools (YOLO). Synced with ~/.grok/config.toml and the CLI.",
  alwaysApproveEnabled: "On — auto-approve tools",
  alwaysApproveDisabled: "Off — ask each time",
  connectionStatus: "Connection",
  signedInAs: "Signed in as",
  notSignedIn: "Not signed in",
  aboutSection: "About",
  aboutSectionDesc: "Application information.",
  appName: "Grok Build Desktop",
  currentResolved: "Currently",

  filesTitle: "Files",
  filesToggle: "Show files",
  filesToggleHide: "Hide files",
  filesNoWorkspace: "Open a workspace to browse files.",
  filesEmpty: "This folder is empty.",
  filesLoading: "Loading…",
  filesFilter: "Filter files…",
  filesNoMatch: "No matching files.",
  filesRefresh: "Refresh",
  filesClose: "Close file",
  filesBinary: "Binary file — cannot preview as text.",
  filesTruncated: "Preview truncated (first 512 KB).",
  filesShowSource: "Source",
  filesShowPreview: "Preview",
  filesInsertMention: "Insert @path into composer",
  filesPreview: "File preview",

  sidePanelToggle: "Open side panel",
  sidePanelToggleHide: "Close side panel",
  sidePanelFiles: "Files",
  sidePanelTerminal: "Terminal",
  sidePanelReview: "Review",
  sidePanelBrowser: "Browser",
  sidePanelReviewHint: "Review is not available yet.",
  sidePanelBrowserHint: "Browser is not available yet.",
  sidePanelFilesShortcut: "Ctrl+P",
  sidePanelTerminalShortcut: "Ctrl+`",
  sidePanelReviewShortcut: "Ctrl+Shift+C",
  sidePanelBrowserShortcut: "Ctrl+T",
  openFileTitle: "Open file",
  openFileEmpty: "Open a file",
  openFileEmptyHint: "Select a file from the workspace tree",
  resizeSidebar: "Drag to resize sidebar (drag small to collapse). Ctrl+B toggles.",
  resizeRightPanel: "Drag to resize panel (drag small to collapse)",
  resizeViewer: "Drag to resize file preview (drag small to close)",
  sidebarExpand: "Expand sidebar (Ctrl+B)",
  workspaceLabel: "Workspace",
  workspaceEmpty: "No workspace",
  workspacePick: "Select workspace",
  workspaceBrowse: "Browse…",
  workspaceRecent: "Recent",
  chooseWorkspaceFirst: "Select a workspace before chatting.",
  placeholderNeedWorkspace: "Select a workspace first…",
  termTitle: "Terminal",
  termHint: "Interactive shell — type directly in the terminal.",
  termPlaceholder: "Type in the terminal…",
  termStarting: "Starting shell…",
  termRestart: "Restart shell",
  termClear: "Clear terminal",
  termRun: "Run",
  termExited: "Shell exited (code {code})",

  navMcp: "MCP",
  navExtensions: "Skills",
  extTitle: "Skills",
  extSubtitle:
    "Manage MCP servers, skills, plugins, and hooks. Changes write to ~/.grok (and project .grok when scoped).",
  extTabMcp: "MCP Servers",
  extTabSkills: "Skills",
  extTabPlugins: "Plugins",
  extTabHooks: "Hooks",
  extFilter: "Filter…",
  extRefresh: "Refresh",
  extAddMcp: "Add server",
  extAddMcpHint:
    "Adds via `grok mcp add` into user or project config. Restart or open a new session for the agent to pick up changes.",
  extMcpName: "Name",
  extMcpTransport: "Transport",
  extMcpCommand: "Command",
  extMcpUrl: "URL",
  extMcpArgs: "Args (space-separated)",
  extScope: "Scope",
  extScopeUser: "User",
  extScopeProject: "Project",
  extSave: "Save",
  extCancel: "Cancel",
  extSaved: "Saved",
  extRemove: "Remove",
  extRemoveConfirm: 'Remove MCP server "{name}"?',
  extEnabled: "On",
  extDisabled: "Off",
  extMcpEmpty: "No MCP servers configured. Add one above or run `grok mcp add`.",
  extSkillsEmpty: "No skills found under ~/.grok/skills or the workspace.",
  extPluginsEmpty: "No plugins installed. Install from a source or browse the marketplace.",
  extHooksEmpty:
    "No hook files found. Put JSON under ~/.grok/hooks/ or the project .grok/hooks/.",
  extInstallPlugin: "Install plugin",
  extInstallPluginHint:
    "GitHub owner/repo, git URL, or local path. Installs with --trust.",
  extInstall: "Install",
  extUninstall: "Uninstall",
  extUninstallConfirm: 'Uninstall plugin "{name}"?',
  extShowMarketplace: "Marketplace",
  extInstalledOnly: "Installed only",
  extAvailable: "available",
  extInstalled: "installed",
  extView: "View",
  extFootnote:
    "Config is shared with the CLI. Agent sessions may need a new turn or reconnect to reload MCP/plugins.",
  dropFilesHint: "Drop files to attach",
};

const zh: Messages = {
  newSession: "新建会话",
  newSessionInProject: "在此项目新建会话",
  openWorkspace: "打开工作区",
  settings: "设置",
  noSessions: "暂无最近会话，先开始一个新会话吧。",
  connecting: "正在连接 agent…",
  connected: "已连接",
  disconnected: "未连接",
  starting: "启动中…",
  searchSessions: "搜索会话…",
  searchNoResults: "没有匹配的会话。",
  searchHits: "搜索结果",
  renameSession: "重命名",
  deleteSession: "删除",
  forkSession: "分叉",
  renamePlaceholder: "会话标题",
  deleteConfirm: "确定永久删除此会话？此操作无法撤销。",
  untitledSession: "未命名",
  sessionActions: "会话操作",
  searchIndexing: "搜索索引仍在构建…",
  sessionStatusRunning: "运行中",
  sessionStatusLoading: "加载中",
  sessionStatusNeedsPermission: "等待审批",

  greeting: "接下来做什么？",
  homeHint:
    "先在输入框上方选择工作区，再描述任务；也可从侧边栏打开历史会话。",
  cantReachAgent: "无法连接 agent",
  retryConnect: "重新连接",

  you: "你",
  grok: "Grok",
  thought: "思考",
  thoughtStreaming: "思考 · 生成中",
  currentTurnPin: "你",
  currentTurnPinHint: "定位到这条消息",
  loadingConversation: "正在加载对话…",
  compactRunning: "正在压缩对话…",
  compactRunningAuto: "正在自动压缩对话…",
  compactRunningAutoPct: "正在自动压缩对话（上下文已用 {pct}%）…",
  compactDone: "对话已压缩",
  compactDoneTokens: "上下文已压缩：{before} → {after} tokens",
  compactFailed: "压缩失败",
  compactCancelled: "压缩已取消",
  compactManual: "压缩",
  compactAuto: "自动压缩",
  toolOutput: "输出",
  toolOutputTruncated: "输出已截断显示",
  toolDiffCount: "{n} 个文件",
  copyMessage: "复制消息",
  copied: "已复制",
  copyFailed: "复制失败",
  exportConversation: "导出",
  exportCopyMarkdown: "复制为 Markdown",
  exportDownloadMarkdown: "下载 .md",
  exportEmpty: "暂无内容可导出",
  exportCopied: "已复制整段对话为 Markdown",
  exportDownloaded: "已下载 Markdown 文件",
  exportLabelTool: "工具",
  exportLabelCompact: "压缩",
  exportLabelSystem: "系统",

  local: "本地",
  chooseWorkspace: "选择工作区",
  switchModel: "切换模型",
  sessionMode: "会话模式",
  reasoningEffort: "推理力度",
  openSessionForModels: "打开会话后可加载模型列表",
  modeAgent: "Agent",
  modeAgentHint: "完整工具",
  modePlan: "Plan",
  modePlanHint: "先规划再改代码",
  modeAsk: "Ask",
  modeAskHint: "只读问答",
  effort: "力度",
  tokenUsage: "上下文 tokens：已用 {used} / 窗口 {total}",
  placeholderReady: "描述任务…  / 命令  ·  @ 文件",
  placeholderWaiting: "等待 agent…",
  placeholderBusy: "Agent 工作中 — Enter 排队 · Ctrl+Enter 立即发送…",
  noMatches: "没有匹配",
  attachFiles: "添加附件",
  cancel: "取消",
  send: "发送",
  queueTitle: "排队消息",
  queueCount: "已排队 {n} 条",
  queueHintBusy: "当前回合结束后自动发送",
  queueClear: "清空",
  queueSendNow: "立即发送",
  queueSendNowHint: "取消当前回合并紧接着发送这条",
  queueSendNowShortcut: "Ctrl+Enter",
  queueRemove: "从队列移除",
  queueAction: "排队",
  queueAttachmentsOnly: "{n} 个附件",
  queueEmptyItem: "（空）",
  historyBrowseStatus: "历史 {i}/{n}",
  historyBrowseHint: "↑↓ 切换 · Esc 清空 · 输入可编辑",
  historySearchTitle: "Prompt 历史",
  historySearchPlaceholder: "过滤历史…",
  historySearchClose: "关闭",
  historySearchHint: "↑↓ · Enter 填入 · Esc 关闭 · 也可用 /history 或 Ctrl+R",
  historyEmpty: "还没有历史 prompt",
  historyNoMatches: "没有匹配的历史",
  permissionsMvp: "权限：每次操作需确认",
  permissionTitle: "需要确认权限",
  permissionHint: "↑↓ 选择 · Enter 确认 · Esc 取消",
  permissionConfirm: "确认",
  permissionCancel: "取消",
  permissionQueued: "还有 {n} 个待处理",
  alwaysApproveOn: "替我审批",
  alwaysApproveOff: "需审批",
  alwaysApproveTitle: "始终批准（YOLO）",
  alwaysApproveHint:
    "开启后工具无需确认即可执行。点击或输入 /always-approve 切换。",

  account: "账号",
  accountMenu: "账号菜单",

  accountLoginBrowser: "浏览器登录",
  accountLoginDevice: "设备码登录",
  accountLogout: "退出登录",
  accountLogoutConfirm: "退出并清除本地凭据？Agent 连接将断开。",
  accountLoggedOut: "已退出登录",
  accountCancelLogin: "取消登录",
  accountLoginCancelled: "已取消登录",
  accountLoginInProgress: "正在登录…",
  accountLoginBrowserStarting: "正在打开浏览器登录…",
  accountLoginDeviceStarting: "正在启动设备码登录…",
  accountLoginHelp:
    "与 `grok login` 相同的 OAuth / 设备码流程。凭据保存在 ~/.grok/auth.json，与 CLI 共用。登录成功后会自动重连 agent。",
  accountSignedIn: "已登录",
  accountSignedInAs: "已登录为 {email}",
  accountSessionActive: "会话有效",
  accountReconnect: "重连 Agent",
  accountReconnected: "正在重连 Agent…",
  accountAuthMode: "认证方式",
  accountExpires: "令牌过期",
  accountIssuer: "Issuer",
  accountTeamId: "团队",
  accountApiKeyStatus: "API Key",
  accountApiKeyNone: "未设置",
  accountApiKeyFromEnv: "已设置（环境变量）",
  accountApiKeyFromDesktop: "已设置（桌面端）",
  accountApiKeySection: "API Key",
  accountApiKeyDesc:
    "无浏览器会话时的兜底（CI / 自动化）。仅保存在本机 ~/.grok/desktop-api-key（权限 0600）。浏览器登录的 session 优先于 API Key。",
  accountApiKeyLabel: "XAI_API_KEY",
  accountApiKeyPlaceholder: "xai-…",
  accountApiKeyPlaceholderSet: "••••••••  （输入新 key 以替换）",
  accountSaveApiKey: "保存 API Key",
  accountClearApiKey: "清除桌面端 Key",
  accountApiKeySaved: "API Key 已保存",
  accountApiKeyCleared: "桌面端 API Key 已清除",
  accountApiKeyEnvHint:
    "进程环境中已有 XAI_API_KEY。若要用桌面端保存的 key，请先在 shell 中取消该环境变量。",
  accountUsageSection: "用量与订阅",
  accountUsageDesc:
    "账号的 coding credit 用量（与 CLI /usage 相同）。连接 agent 后自动刷新。",
  accountUsageTier: "套餐",
  accountUsageReset: "下次重置",
  accountUsageCredits: "预付 credits",
  accountUsageAutoTopup: "自动充值",
  accountUsageAutoTopupOff: "已关闭",
  accountUsagePayg: "按量付费",
  accountUsageUpdated: "更新时间",
  accountUsageRefresh: "刷新用量",
  accountUsageRefreshed: "用量已刷新",
  accountUsageManage: "管理账单",
  accountUsageDetails: "详情…",
  accountUsageUnavailable:
    "暂无用量数据（需消费者账号登录，或 agent 尚未就绪）。",
  accountDeviceCode: "设备码",
  accountCopyCode: "复制验证码 / URL",
  accountCopied: "已复制到剪贴板",
  accountCopyFailed: "复制失败",
  accountShow: "显示",
  accountHide: "隐藏",

  settingsTitle: "设置",
  settingsSubtitle: "调整语言、外观与账号相关选项。",
  language: "语言",
  languageDesc: "菜单、标签与界面文案的语言。",
  theme: "主题",
  themeDesc: "桌面客户端的配色方案。",
  followSystem: "跟随系统",
  english: "English",
  chinese: "中文",
  themeDark: "深色",
  themeLight: "浅色",
  backToChat: "返回对话",
  appearanceSection: "外观",
  languageSection: "语言",
  accountSection: "账号",
  accountSectionDesc:
    "登录、退出、API Key 与 agent 连接。与 CLI 共用 ~/.grok。",
  permissionsSection: "权限",
  permissionsSectionDesc: "Agent 运行工具与修改文件时的确认策略。",
  alwaysApproveSetting: "始终批准模式",
  alwaysApproveSettingDesc:
    "跳过所有工具权限确认（YOLO）。与 ~/.grok/config.toml 及 CLI 同步。",
  alwaysApproveEnabled: "开启 — 自动批准工具",
  alwaysApproveDisabled: "关闭 — 每次询问",
  connectionStatus: "连接状态",
  signedInAs: "当前账号",
  notSignedIn: "未登录",
  aboutSection: "关于",
  aboutSectionDesc: "应用信息。",
  appName: "Grok Build 桌面端",
  currentResolved: "当前",

  filesTitle: "文件",
  filesToggle: "显示文件树",
  filesToggleHide: "隐藏文件树",
  filesNoWorkspace: "打开工作区后可浏览文件。",
  filesEmpty: "此文件夹为空。",
  filesLoading: "加载中…",
  filesFilter: "筛选文件…",
  filesNoMatch: "没有匹配的文件。",
  filesRefresh: "刷新",
  filesClose: "关闭文件",
  filesBinary: "二进制文件，无法以文本预览。",
  filesTruncated: "预览已截断（仅前 512 KB）。",
  filesShowSource: "源码",
  filesShowPreview: "预览",
  filesInsertMention: "将 @路径 插入输入框",
  filesPreview: "文件预览",

  sidePanelToggle: "打开右侧面板",
  sidePanelToggleHide: "关闭右侧面板",
  sidePanelFiles: "文件",
  sidePanelTerminal: "终端",
  sidePanelReview: "审阅",
  sidePanelBrowser: "浏览器",
  sidePanelReviewHint: "审阅功能暂未开放。",
  sidePanelBrowserHint: "浏览器功能暂未开放。",
  sidePanelFilesShortcut: "Ctrl+P",
  sidePanelTerminalShortcut: "Ctrl+`",
  sidePanelReviewShortcut: "Ctrl+Shift+C",
  sidePanelBrowserShortcut: "Ctrl+T",
  openFileTitle: "打开文件",
  openFileEmpty: "打开文件",
  openFileEmptyHint: "从工作区目录树中选择文件",
  resizeSidebar: "拖动调整左侧宽度（拖到很小可折叠）。Ctrl+B 开关侧栏。",
  resizeRightPanel: "拖动调整右侧宽度（拖到很小可折叠）",
  resizeViewer: "拖动调整文件预览宽度（拖到很小可关闭）",
  sidebarExpand: "展开左侧栏 (Ctrl+B)",
  workspaceLabel: "工作区",
  workspaceEmpty: "未选择工作区",
  workspacePick: "选择工作区",
  workspaceBrowse: "浏览…",
  workspaceRecent: "最近",
  chooseWorkspaceFirst: "请先选择工作区后再对话。",
  placeholderNeedWorkspace: "请先选择工作区…",
  termTitle: "终端",
  termHint: "交互式 shell — 直接在终端中输入。",
  termPlaceholder: "在终端中输入…",
  termStarting: "正在启动 shell…",
  termRestart: "重启 shell",
  termClear: "清屏",
  termRun: "运行",
  termExited: "Shell 已退出（code {code}）",

  navMcp: "MCP",
  navExtensions: "技能",
  extTitle: "技能",
  extSubtitle:
    "管理 MCP 服务器、Skills、Plugins 与 Hooks。写入 ~/.grok（项目作用域时写入工作区 .grok）。",
  extTabMcp: "MCP 服务器",
  extTabSkills: "Skills",
  extTabPlugins: "Plugins",
  extTabHooks: "Hooks",
  extFilter: "筛选…",
  extRefresh: "刷新",
  extAddMcp: "添加服务器",
  extAddMcpHint:
    "通过 `grok mcp add` 写入用户或项目配置。新会话或重连后 agent 才会加载变更。",
  extMcpName: "名称",
  extMcpTransport: "传输",
  extMcpCommand: "命令",
  extMcpUrl: "URL",
  extMcpArgs: "参数（空格分隔）",
  extScope: "作用域",
  extScopeUser: "用户",
  extScopeProject: "项目",
  extSave: "保存",
  extCancel: "取消",
  extSaved: "已保存",
  extRemove: "移除",
  extRemoveConfirm: '移除 MCP 服务器 "{name}"？',
  extEnabled: "开",
  extDisabled: "关",
  extMcpEmpty: "尚未配置 MCP 服务器。可在上方添加，或使用 `grok mcp add`。",
  extSkillsEmpty: "在 ~/.grok/skills 或工作区中未发现 Skills。",
  extPluginsEmpty: "尚未安装插件。可从源安装或浏览 Marketplace。",
  extHooksEmpty:
    "未找到 Hook 文件。请放到 ~/.grok/hooks/ 或项目 .grok/hooks/。",
  extInstallPlugin: "安装插件",
  extInstallPluginHint: "GitHub owner/repo、git URL 或本地路径（使用 --trust）。",
  extInstall: "安装",
  extUninstall: "卸载",
  extUninstallConfirm: '卸载插件 "{name}"？',
  extShowMarketplace: "Marketplace",
  extInstalledOnly: "仅已安装",
  extAvailable: "可安装",
  extInstalled: "已安装",
  extView: "查看",
  extFootnote:
    "配置与 CLI 共享。MCP / 插件变更可能需要新会话或重连后生效。",
  dropFilesHint: "拖入文件以添加附件",
};

const ALL: Record<ResolvedLocale, Messages> = { en, zh };

export function getMessages(locale: ResolvedLocale): Messages {
  return ALL[locale];
}
