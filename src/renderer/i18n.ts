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
  /** Sidebar: session is waiting for structured Q&A answers. */
  sessionStatusNeedsQuestion: string;
  /** Sidebar: session is waiting for a folder-trust grant. */
  sessionStatusNeedsTrust: string;
  /** Composer-anchored banner: another session needs your attention (singular). */
  waitingSessionsBannerSingle: string;
  /** Composer-anchored banner: title when N>1 sessions are waiting. */
  waitingSessionsBannerMany: string;
  /** aria-label for the waiting-sessions banner region. */
  waitingSessionsBannerLabel: string;
  /** Tooltip on the inline cancel button next to a waiting session row. */
  cancelSessionTooltip: string;

  // Home
  greeting: string;
  homeHint: string;
  cantReachAgent: string;
  retryConnect: string;
  /** Caption shown in the error card when the agent CLI is missing. */
  agentMissingTitle: string;
  /** Button label that opens the agent install URL in the system browser. */
  agentInstallButton: string;
  /** Button label that runs the official installer from inside the app. */
  agentInstallAutoButton: string;
  /** Caption shown while the installer is running. */
  agentInstallRunning: string;
  /** Tooltip explaining why the Install button is currently disabled. */
  agentInstallHint: string;
  /** Caption shown after the installer finishes successfully. */
  agentInstallDone: string;
  /** Caption shown after the installer fails (the output is shown too). */
  agentInstallFailed: string;
  /** Settings → Agent section title. */
  agentSectionTitle: string;
  /** Settings → Agent section subtitle. */
  agentSectionSubtitle: string;
  /** Status row label. */
  agentStatusLabel: string;
  /** Install path row label. */
  agentInstallPathLabel: string;
  /** "Last check at" row label. */
  agentLastCheckLabel: string;
  /** "Latest version" row label. */
  agentLatestVersionLabel: string;
  /** Channel sub-section title. */
  agentChannelTitle: string;
  /** Channel: stable. */
  agentChannelStable: string;
  /** Channel: alpha. */
  agentChannelAlpha: string;
  /** Channel: enterprise. */
  agentChannelEnterprise: string;
  /** Stable channel description. */
  agentChannelStableDesc: string;
  /** Button: trigger an update check. */
  agentCheckUpdate: string;
  /** Button label while the check is in flight. */
  agentChecking: string;
  /** Button: trigger a fresh install. */
  agentInstall: string;
  /** Button: trigger an upgrade. */
  agentUpgrade: string;
  /** Button label while the upgrade is in flight. */
  agentUpgrading: string;
  /** Tooltip on the upgrade button when an upgrade is ready. */
  agentUpgradeReady: string;
  /** Tooltip on the upgrade button when there's no update. */
  agentNoUpdate: string;
  /** Banner shown after a successful upgrade. */
  agentUpgradeSuccess: string;
  /** Banner shown after a failed upgrade. */
  agentUpgradeFailed: string;
  /** Status badge: ready (with version). */
  agentStatusReady: string;
  /** Status badge: update available. */
  agentStatusUpdateAvailable: string;
  /** Status badge: installing. */
  agentStatusInstalling: string;
  /** Status badge: upgrading. */
  agentStatusUpgrading: string;
  /** Status badge: rolled back. */
  agentStatusRollback: string;
  /** Status badge: not installed. */
  agentStatusAbsent: string;
  /** Status badge: error. */
  agentStatusError: string;

  // Timeline
  you: string;
  grok: string;
  thought: string;
  thoughtStreaming: string;
  /** Sticky bar: user turn for the scroll section; click jumps to it. */
  currentTurnPin: string;
  currentTurnPinHint: string;
  /** Left-edge history timeline rail: each tick is one user message. */
  historyTimelineTooltip: string;
  historyTimelineJump: string;
  /** Floating button above the composer that returns to the latest message. */
  jumpToBottom: string;
  /** Per-turn collapsible group header (one per assistant response). */
  turnGroupToggle: string;
  /** Short label inside a turn group for the bundled thought + tool list. */
  turnGroupInner: string;
  /** Short label shown when a turn has no intermediate thought/tool calls. */
  turnGroupEmpty: string;
  /** Status text shown after a user message while the agent is preparing
   *  its first response (no timeline output yet, but the agent is busy). */
  turnPending: string;
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
  autoTrustSetting: string;
  autoTrustSettingDesc: string;
  autoTrustDisabled: string;
  autoTrustEnabled: string;

  // Ask user question modal
  askqTitle: string;
  askqKicker: string;
  askqKickerPlan: string;
  /** e.g. "Question {i} of {n}" */
  askqProgress: string;
  askqMultiHint: string;
  askqOther: string;
  askqOtherHint: string;
  askqOtherPlaceholder: string;
  askqBack: string;
  askqNext: string;
  askqSubmit: string;
  askqCancel: string;
  askqChatAbout: string;
  askqChatAboutHint: string;
  askqSkipInterview: string;
  askqSkipInterviewHint: string;
  askqHint: string;

  // Account menu
  account: string;
  accountMenu: string;
  /**
   * Product brand name shown in the left-bottom status when the agent
   * is connected (e.g. "grok-build v0.1.0").
   */
  appBrandName: string;

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
  /**
   * Tooltip on the account menu trigger when the desktop is connected
   * to agent serve but no Grok credentials exist (no `grok login`, no
   * `XAI_API_KEY`, no desktop-stored key). Custom providers can still
   * be used. (Previously used as the tooltip for the red "Not signed in"
   * pill on the account trigger; pill has been removed.)
   */
  accountAvailableFalseHint: string;
  /**
   * Banner on the chat composer when Grok official models are
   * unavailable due to no login. Allows continuing (custom providers work).
   */
  accountRequiredForGrokHint: string;
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
  /** Shown for very large code files (highlight.js disabled). */
  filesHugeFileHint: string;
  /** Shown under very large images that got truncated for inline preview. */
  filesImageTruncated: string;
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
  sidePanelPlan: string;
  sidePanelFilesShortcut: string;
  sidePanelTerminalShortcut: string;
  sidePanelPlanShortcut: string;
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

  // Plan / TODO panel
  planPanelTitle: string;
  planTabTodos: string;
  planTabPlan: string;
  planRefresh: string;
  planTodoEmpty: string;
  planTodoAllDone: string;
  planTodoHideDone: string;
  planTodoProgress: string;
  planTodoInProgressCount: string;
  planTodoPendingCount: string;
  planTodoDoneCount: string;
  planTodoHigh: string;
  planEmpty: string;
  planEmptyInPlanMode: string;
  planApprovalNeeded: string;
  planApprovalTitle: string;
  planApprovalEmptyTitle: string;
  planApprovalHint: string;
  planApprovalEmptyHint: string;
  planApprovalApprove: string;
  planApprovalRequestChanges: string;
  planApprovalAbandon: string;
  planApprovalFeedbackPlaceholder: string;
  planApprovalSendFeedback: string;
  planApprovalCancelFeedback: string;
  /** "{n}/{total}" for the running-plan pill above the composer. */
  planProgressStep: string;
  /** "{n}" pending after the current step in the same pill. */
  planProgressPending: string;

  // Folder-trust prompt (x.ai/folder_trust/request)
  trustKicker: string;
  trustTitle: string;
  trustBadge: string;
  /** {path} → workspace path, when cwd === workspace. */
  trustBodySame: string;
  /** {path} → session cwd. */
  trustBodyCwd: string;
  /** {path} → canonicalized workspace key (git-root of cwd). */
  trustBodyWorkspace: string;
  /** "{mcp, hooks, plugins, lsp, envrc, …}" */
  trustKindsLabel: string;
  trustWarn: string;
  trustHint: string;
  trustGrant: string;
  trustReject: string;
  /** Composer chip when todos exist. */
  planTodosChip: string;

  // Extensions (MCP / Skills / Plugins / Hooks)
  navMcp: string;
  navExtensions: string;
  extTitle: string;
  extSubtitle: string;
  extTabMcp: string;
  extTabSkills: string;
  extTabPlugins: string;
  extTabHooks: string;
  extTabTrust: string;
  extFilter: string;
  /** Trusted folders panel */
  trustPanelTitle: string;
  trustPanelSubtitle: string;
  trustPanelEmpty: string;
  trustEntryTrusted: string;
  trustEntryDeclined: string;
  trustEntryRevoke: string;
  trustEntryRevoked: string;
  trustEntryRevokeConfirm: string;
  trustEntryPathLabel: string;
  trustEntryDecidedAtLabel: string;
  trustEntryRevokeFailed: string;
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

  // Custom model providers
  navModels: string;
  modelsTitle: string;
  modelsSubtitle: string;
  modelsAddProvider: string;
  modelsEditProvider: string;
  modelsChoosePreset: string;
  modelsChoosePresetHint: string;
  modelsRegionIntl: string;
  modelsRegionCn: string;
  modelsRegionLocal: string;
  modelsCustomEndpoint: string;
  modelsPresetAdded: string;
  modelsEmpty: string;
  modelsEdit: string;
  modelsDeleteConfirm: string;
  modelsDeleted: string;
  modelsSaved: string;
  modelsNameRequired: string;
  modelsBaseUrlRequired: string;
  modelsProviderName: string;
  modelsBaseUrl: string;
  modelsApiKey: string;
  modelsApiKeyPlaceholder: string;
  modelsEnvKey: string;
  modelsApiBackend: string;
  modelsAuthStyle: string;
  modelsProviderEnabled: string;
  modelsListTitle: string;
  modelsFetch: string;
  modelsFetchHint: string;
  modelsFetchedCount: string;
  modelsEnableAll: string;
  modelsDisableAll: string;
  modelsAddManual: string;
  modelsManualIdPlaceholder: string;
  modelsManualNamePlaceholder: string;
  modelsFilterModels: string;
  modelsNoModelsYet: string;
  modelsSourceFetched: string;
  modelsSourceManual: string;
  modelsEnabledCount: string;
  modelsReconnect: string;
  modelsReconnectHint: string;
  modelsReconnected: string;
  modelsFootnote: string;
  modelsEditorHint: string;
  /** Built-in / default models group in composer. */
  modelsGroupBuiltin: string;
  modelsManage: string;
  modelsNoModelsInProvider: string;
  /** Composer: switch provider tab */
  modelsAllProviders: string;

  // Tool card (timeline) labels — translate agent-side kind/status ids.
  toolKindEdit: string;
  toolKindSearch: string;
  toolKindThink: string;
  toolKindRead: string;
  toolKindWrite: string;
  toolKindRun: string;
  toolKindWeb: string;
  toolKindTool: string;
  toolStatusPending: string;
  toolStatusRunning: string;
  toolStatusCompleted: string;
  toolStatusFailed: string;
  toolStatusCancelled: string;
  toolStatusAwaiting: string;

  // Reasoning effort values displayed on the composer chip.
  effortLow: string;
  effortMedium: string;
  effortHigh: string;
  effortXhigh: string;
  effortAuto: string;
  /** Fallback label when effort is unset. */
  effortOff: string;

  // Models page sections / hints (mixed-in English in the UI).
  modelsSectionConnection: string;
  modelsSectionAuth: string;
  modelsEndpointFixedHint: string;
  modelsEmptyNoMatches: string;
  modelsEmptyNoMatchesHint: string;
  modelsEnabledModelsStat: string;
  modelsClearSearchAria: string;
  modelsBackendChatCompletions: string;
  modelsBackendChatCompletionsDefault: string;
  modelsBackendResponses: string;
  modelsBackendMessages: string;
  modelsPresetSearchPlaceholder: string;
  modelsGlobalSearchPlaceholder: string;
  modelsProtocolHint: string;
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
  sessionStatusNeedsQuestion: "Needs answers",
  sessionStatusNeedsTrust: "Needs trust",
  waitingSessionsBannerSingle: "Another session needs your attention",
  waitingSessionsBannerMany: "{n} other sessions need your attention",
  waitingSessionsBannerLabel: "Sessions waiting for your input",
  cancelSessionTooltip: "Cancel this session's turn",

  greeting: "What's up next?",
  homeHint:
    "Pick a workspace above the input, then describe a task. Or open a past session from the sidebar.",
  cantReachAgent: "Can't reach agent",
  retryConnect: "Retry connect",
  agentMissingTitle: "Grok CLI not found",
  agentInstallButton: "Open install instructions",
  agentInstallAutoButton: "Install automatically",
  agentInstallRunning: "Running official installer…",
  agentInstallHint: "Install is only available when grok is missing or in an error state.",
  agentInstallDone: "Installed. Connecting…",
  agentInstallFailed: "Installer failed — see output below.",

  agentSectionTitle: "Agent",
  agentSectionSubtitle:
    "Install, upgrade, and pick the release channel for the grok CLI.",
  agentStatusLabel: "Status",
  agentInstallPathLabel: "Install path",
  agentLastCheckLabel: "Last check",
  agentLatestVersionLabel: "Latest version",
  agentChannelTitle: "Update channel",
  agentChannelStable: "Stable",
  agentChannelAlpha: "Alpha",
  agentChannelEnterprise: "Enterprise",
  agentChannelStableDesc: "Recommended for most users.",
  agentCheckUpdate: "Check for updates",
  agentChecking: "Checking…",
  agentInstall: "Install",
  agentUpgrade: "Upgrade",
  agentUpgrading: "Upgrading…",
  agentUpgradeReady: "An update is available — click to upgrade.",
  agentNoUpdate: "No update available.",
  agentUpgradeSuccess: "Upgraded successfully ({path}).",
  agentUpgradeFailed: "Upgrade failed.",
  agentStatusReady: "Ready",
  agentStatusUpdateAvailable: "Update available",
  agentStatusInstalling: "Installing…",
  agentStatusUpgrading: "Upgrading…",
  agentStatusRollback: "Rolled back",
  agentStatusAbsent: "Not installed",
  agentStatusError: "Error",

  you: "You",
  grok: "Grok",
  thought: "Thought",
  thoughtStreaming: "Thought · streaming",
  currentTurnPin: "You",
  currentTurnPinHint: "Jump to this message",
  historyTimelineTooltip: "Message history",
  historyTimelineJump: "Jump to this message",
  jumpToBottom: "Jump to latest message",
  turnGroupToggle: "Thinking & tool calls",
  turnGroupInner: "Show thinking and tool calls",
  turnGroupEmpty: "No intermediate steps",
  turnPending: "Thinking…",
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
  autoTrustSetting: "Auto-trust new sessions",
  autoTrustSettingDesc:
    "When enabled, every new session implicitly trusts its workspace (writes ~/.grok/trusted_folders.toml) so the agent never prompts you. Equivalent to the CLI's `grok --trust <cwd>`.",
  autoTrustDisabled: "Ask on first open",
  autoTrustEnabled: "Auto-grant trust",

  askqTitle: "Questions for you",
  askqKicker: "Agent question",
  askqKickerPlan: "Plan interview",
  askqProgress: "Question {i} of {n}",
  askqMultiHint: "Select one or more options",
  askqOther: "Other",
  askqOtherHint: "Type your own answer",
  askqOtherPlaceholder: "Your answer…",
  askqBack: "Back",
  askqNext: "Next",
  askqSubmit: "Submit",
  askqCancel: "Cancel",
  askqChatAbout: "Chat about this",
  askqChatAboutHint:
    "Send partial answers and keep talking — agent will reformulate questions",
  askqSkipInterview: "Skip interview",
  askqSkipInterviewHint:
    "Stop asking questions and plan with what you already have",
  askqHint: "Enter next/submit · Esc cancel · ← → step",

  account: "Account",
  accountMenu: "Account menu",
  appBrandName: "grok-build",

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
  accountAvailableFalseHint:
    "Not logged in — Grok official models are unavailable. Configure a custom provider in Settings → Models, or sign in.",
  accountRequiredForGrokHint:
    "Grok official models require sign-in (Settings → Account) or XAI_API_KEY. Custom providers still work.",
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
  filesHugeFileHint: "{n} lines · syntax highlighting disabled for performance",
  filesImageTruncated: "Image preview truncated — file is {size} on disk.",
  filesShowSource: "Source",
  filesShowPreview: "Preview",
  filesInsertMention: "Insert @path into composer",
  filesPreview: "File preview",

  sidePanelToggle: "Open side panel",
  sidePanelToggleHide: "Close side panel",
  sidePanelFiles: "Files",
  sidePanelTerminal: "Terminal",
  sidePanelPlan: "Plan / TODO",
  sidePanelFilesShortcut: "Ctrl+P",
  sidePanelTerminalShortcut: "Ctrl+`",
  sidePanelPlanShortcut: "Ctrl+Shift+P",
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

  planPanelTitle: "Plan / TODO",
  planTabTodos: "Todos",
  planTabPlan: "Plan",
  planRefresh: "Reload plan.md",
  planTodoEmpty: "No todo items yet. The agent fills this via todo_write.",
  planTodoAllDone: "All visible todos are done.",
  planTodoHideDone: "Hide done",
  planTodoProgress: "Completed / total (excluding cancelled)",
  planTodoInProgressCount: "{n} in progress",
  planTodoPendingCount: "{n} pending",
  planTodoDoneCount: "{n} done",
  planTodoHigh: "High priority",
  planEmpty:
    "No plan written yet. Enter plan mode with /plan or wait for the agent to write plan.md.",
  planEmptyInPlanMode:
    "Plan mode is active. The agent will write plan.md as it explores.",
  planApprovalNeeded: "Approval",
  planApprovalTitle: "Approve this plan?",
  planApprovalEmptyTitle: "No plan written yet",
  planApprovalHint:
    "Approve to start implementing, request changes to revise, or quit plan mode.",
  planApprovalEmptyHint:
    "The agent exited plan mode without a plan. Approve to continue, request changes, or quit.",
  planApprovalApprove: "Approve",
  planApprovalRequestChanges: "Request changes",
  planApprovalAbandon: "Quit plan",
  planApprovalFeedbackPlaceholder: "Describe what to change…",
  planApprovalSendFeedback: "Send feedback",
  planApprovalCancelFeedback: "Back",
  planProgressStep: "Step {n} / {total}",
  planProgressPending: "{n} more",

  trustKicker: "Trust folder",
  trustTitle: "Trust this workspace?",
  trustBadge: "Trust",
  trustBodySame:
    "This workspace contains repo-local code-exec markers. The agent will only run hooks, MCP servers, plugins, LSP, etc. after you grant trust.",
  trustBodyCwd: "Current session cwd:",
  trustBodyWorkspace: "Granting trust will allow execution across this workspace:",
  trustKindsLabel: "Detected",
  trustWarn:
    "Trust is recorded in ~/.grok/trusted_folders.toml. You can revoke it later from Settings → Extensions → Trusted folders.",
  trustHint: "T/Enter trust · R/Esc reject",
  trustGrant: "Trust workspace",
  trustReject: "Reject",
  planTodosChip: "Todos",

  navMcp: "MCP",
  navExtensions: "Skills",
  extTitle: "Skills",
  extSubtitle:
    "Manage MCP servers, skills, plugins, and hooks. Changes write to ~/.grok (and project .grok when scoped).",
  extTabMcp: "MCP Servers",
  extTabSkills: "Skills",
  extTabPlugins: "Plugins",
  extTabHooks: "Hooks",
  extTabTrust: "Trusted folders",
  extFilter: "Filter…",

  trustPanelTitle: "Trusted folders",
  trustPanelSubtitle:
    "Workspaces that the agent has been granted (or explicitly declined) trust for. Stored in ~/.grok/trusted_folders.toml.",
  trustPanelEmpty:
    "No trust decisions recorded yet. The agent will prompt you the first time you open a workspace with repo-local hooks, MCP servers, plugins, or LSP.",
  trustEntryTrusted: "Trusted",
  trustEntryDeclined: "Declined",
  trustEntryRevoke: "Revoke",
  trustEntryRevoked: "Revoked",
  trustEntryRevokeConfirm: "Revoke trust for this workspace?",
  trustEntryPathLabel: "Path",
  trustEntryDecidedAtLabel: "Decided",
  trustEntryRevokeFailed: "Could not revoke trust",
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

  navModels: "Models",
  modelsTitle: "Models & providers",
  modelsSubtitle:
    "Add domestic and international providers, fetch or enter models, then switch them from the composer. Writes [model.*] into ~/.grok/config.toml (same as CLI).",
  modelsAddProvider: "Add provider",
  modelsEditProvider: "Edit provider",
  modelsChoosePreset: "Choose a provider",
  modelsChoosePresetHint:
    "Pick a preset or a custom OpenAI-compatible endpoint. You can add multiple providers.",
  modelsRegionIntl: "International",
  modelsRegionCn: "China",
  modelsRegionLocal: "Local",
  modelsCustomEndpoint: "Custom endpoint",
  modelsPresetAdded: "Already added",
  modelsEmpty:
    "No providers yet. Add OpenAI, DeepSeek, Moonshot, Ollama, and more.",
  modelsEdit: "Edit",
  modelsDeleteConfirm: 'Remove provider "{name}" and its models from config?',
  modelsDeleted: "Provider removed",
  modelsSaved:
    "Saved to config.toml — reconnect or start a new session to load models",
  modelsNameRequired: "Provider name is required",
  modelsBaseUrlRequired: "Base URL is required",
  modelsProviderName: "Display name",
  modelsBaseUrl: "Base URL",
  modelsApiKey: "API key",
  modelsApiKeyPlaceholder: "Optional if env var is set",
  modelsEnvKey: "Env var for key",
  modelsApiBackend: "API backend",
  modelsAuthStyle: "Auth style",
  modelsProviderEnabled: "Provider enabled",
  modelsListTitle: "Models",
  modelsFetch: "Fetch model list",
  modelsFetchHint:
    "Calls GET {base_url}/models. Check the models you want to enable, or add ids manually below.",
  modelsFetchedCount: "Fetched {n} model(s)",
  modelsEnableAll: "Enable all",
  modelsDisableAll: "Disable all",
  modelsAddManual: "Add model",
  modelsManualIdPlaceholder: "Model id (e.g. gpt-4o)",
  modelsManualNamePlaceholder: "Display name (optional)",
  modelsFilterModels: "Filter models…",
  modelsNoModelsYet:
    "No models yet. Fetch from the API or add a model id manually.",
  modelsSourceFetched: "API",
  modelsSourceManual: "Manual",
  modelsEnabledCount: "{n} enabled",
  modelsReconnect: "Reconnect agent",
  modelsReconnectHint:
    "Reload agent so newly saved models appear in the picker",
  modelsReconnected: "Agent reconnected",
  modelsFootnote:
    "Enabled models are written as [model.dp_*] in ~/.grok/config.toml. Shared with CLI (`grok models`, /model). After saving, reconnect or open a new session.",
  modelsEditorHint:
    "API key is stored in desktop-providers.json and config.toml (mode 0600). Prefer env vars when possible.",
  modelsGroupBuiltin: "Built-in",
  modelsManage: "Manage models…",
  modelsNoModelsInProvider: "No models in this provider",
  modelsAllProviders: "All",

  toolKindEdit: "edit",
  toolKindSearch: "search",
  toolKindThink: "think",
  toolKindRead: "read",
  toolKindWrite: "write",
  toolKindRun: "run",
  toolKindWeb: "web",
  toolKindTool: "tool",
  toolStatusPending: "pending",
  toolStatusRunning: "running",
  toolStatusCompleted: "completed",
  toolStatusFailed: "failed",
  toolStatusCancelled: "cancelled",
  toolStatusAwaiting: "awaiting",

  effortLow: "Low",
  effortMedium: "Medium",
  effortHigh: "High",
  effortXhigh: "Extra high",
  effortAuto: "Auto",
  effortOff: "Off",

  modelsSectionConnection: "Connection",
  modelsSectionAuth: "Auth & protocol",
  modelsEndpointFixedHint:
    "Full endpoint prefix is set by the selected protocol and cannot be edited. Switching protocol swaps the official endpoint.",
  modelsEmptyNoMatches: "No matching providers",
  modelsEmptyNoMatchesHint:
    "Try clearing the search or add a new provider.",
  modelsEnabledModelsStat: "enabled models",
  modelsClearSearchAria: "Clear",
  modelsBackendChatCompletions: "chat_completions (OpenAI-compatible)",
  modelsBackendChatCompletionsDefault:
    "chat_completions (OpenAI-compatible) — default",
  modelsBackendResponses: "responses (OpenAI Responses)",
  modelsBackendMessages: "messages (Anthropic Messages)",
  modelsPresetSearchPlaceholder: "Search providers…",
  modelsGlobalSearchPlaceholder: "Search providers or models…",
  modelsProtocolHint:
    "Each protocol maps to a full base URL. MiniMax messages → https://api.minimaxi.com/anthropic/v1 (POST …/messages); chat_completions → https://api.minimaxi.com/v1.",
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
  sessionStatusNeedsQuestion: "等待回答",
  sessionStatusNeedsTrust: "等待信任",
  waitingSessionsBannerSingle: "另一个会话正在等你的处理",
  waitingSessionsBannerMany: "还有 {n} 个会话等你的处理",
  waitingSessionsBannerLabel: "等待你处理的会话",
  cancelSessionTooltip: "停止该会话的当前轮次",

  greeting: "接下来做什么？",
  homeHint:
    "先在输入框上方选择工作区，再描述任务；也可从侧边栏打开历史会话。",
  cantReachAgent: "无法连接 agent",
  retryConnect: "重新连接",
  agentMissingTitle: "未找到 Grok CLI",
  agentInstallButton: "打开安装指引",
  agentInstallAutoButton: "自动安装",
  agentInstallRunning: "正在运行官方安装脚本…",
  agentInstallHint: "只有在 grok 缺失或处于错误状态时才能安装。",
  agentInstallDone: "安装完成，正在连接…",
  agentInstallFailed: "安装失败，请查看下方输出。",

  agentSectionTitle: "Agent",
  agentSectionSubtitle: "安装、升级 grok CLI，并选择更新通道。",
  agentStatusLabel: "状态",
  agentInstallPathLabel: "安装路径",
  agentLastCheckLabel: "上次检查",
  agentLatestVersionLabel: "最新版本",
  agentChannelTitle: "更新通道",
  agentChannelStable: "Stable",
  agentChannelAlpha: "Alpha",
  agentChannelEnterprise: "Enterprise",
  agentChannelStableDesc: "推荐大多数用户使用。",
  agentCheckUpdate: "检查更新",
  agentChecking: "正在检查…",
  agentInstall: "安装",
  agentUpgrade: "升级",
  agentUpgrading: "正在升级…",
  agentUpgradeReady: "有可用更新，点击升级。",
  agentNoUpdate: "暂无更新。",
  agentUpgradeSuccess: "升级成功（{path}）。",
  agentUpgradeFailed: "升级失败。",
  agentStatusReady: "就绪",
  agentStatusUpdateAvailable: "有可用更新",
  agentStatusInstalling: "正在安装…",
  agentStatusUpgrading: "正在升级…",
  agentStatusRollback: "已回滚",
  agentStatusAbsent: "未安装",
  agentStatusError: "错误",

  you: "你",
  grok: "Grok",
  thought: "思考",
  thoughtStreaming: "思考 · 生成中",
  currentTurnPin: "你",
  currentTurnPinHint: "定位到这条消息",
  historyTimelineTooltip: "消息时间轴",
  historyTimelineJump: "定位到这条消息",
  jumpToBottom: "回到最新消息",
  turnGroupToggle: "思考与工具调用",
  turnGroupInner: "查看思考与工具调用",
  turnGroupEmpty: "没有中间步骤",
  turnPending: "正在思考…",
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
  autoTrustSetting: "新 session 自动信任",
  autoTrustSettingDesc:
    "开启后，每个新 session 会自动信任其工作区（写入 ~/.grok/trusted_folders.toml），Agent 不再弹出询问。等价于 CLI 的 `grok --trust <cwd>`。",
  autoTrustDisabled: "首次打开时询问",
  autoTrustEnabled: "自动授予信任",

  askqTitle: "需要你回答",
  askqKicker: "Agent 提问",
  askqKickerPlan: "计划访谈",
  askqProgress: "第 {i} / {n} 题",
  askqMultiHint: "可多选",
  askqOther: "其他",
  askqOtherHint: "填写自定义答案",
  askqOtherPlaceholder: "输入你的答案…",
  askqBack: "上一步",
  askqNext: "下一步",
  askqSubmit: "提交",
  askqCancel: "取消",
  askqChatAbout: "先聊聊再说",
  askqChatAboutHint: "提交已选部分，继续对话让 Agent 重新提问",
  askqSkipInterview: "跳过访谈",
  askqSkipInterviewHint: "停止追问，用已有信息直接进入规划",
  askqHint: "Enter 下一步/提交 · Esc 取消 · ← → 切换",

  account: "账号",
  accountMenu: "账号菜单",
  appBrandName: "grok-build",

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
  accountAvailableFalseHint:
    "未登录 —— Grok 官方模型不可用。可以前往 设置 → 模型 配置自定义提供商，或登录后再用。",
  accountRequiredForGrokHint:
    "Grok 官方模型需要登录（设置 → 账号）或配置 XAI_API_KEY；自定义提供商仍可使用。",
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
  filesHugeFileHint: "{n} 行 · 为性能关闭了语法高亮",
  filesImageTruncated: "图片预览已截断，原始文件大小 {size}。",
  filesShowSource: "源码",
  filesShowPreview: "预览",
  filesInsertMention: "将 @路径 插入输入框",
  filesPreview: "文件预览",

  sidePanelToggle: "打开右侧面板",
  sidePanelToggleHide: "关闭右侧面板",
  sidePanelFiles: "文件",
  sidePanelTerminal: "终端",
  sidePanelPlan: "计划 / TODO",
  sidePanelFilesShortcut: "Ctrl+P",
  sidePanelTerminalShortcut: "Ctrl+`",
  sidePanelPlanShortcut: "Ctrl+Shift+P",
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

  planPanelTitle: "计划 / TODO",
  planTabTodos: "任务",
  planTabPlan: "计划",
  planRefresh: "重新加载 plan.md",
  planTodoEmpty: "暂无任务。代理通过 todo_write 更新此列表。",
  planTodoAllDone: "可见任务已全部完成。",
  planTodoHideDone: "隐藏已完成",
  planTodoProgress: "已完成 / 总数（不含已取消）",
  planTodoInProgressCount: "{n} 进行中",
  planTodoPendingCount: "{n} 待办",
  planTodoDoneCount: "{n} 完成",
  planTodoHigh: "高优先级",
  planEmpty: "尚无计划。使用 /plan 进入计划模式，或等待代理写入 plan.md。",
  planEmptyInPlanMode: "已处于计划模式。代理探索时会写入 plan.md。",
  planApprovalNeeded: "待审批",
  planApprovalTitle: "批准此计划？",
  planApprovalEmptyTitle: "尚未写入计划",
  planApprovalHint: "批准后开始实现；请求修改可退回规划；退出则放弃计划模式。",
  planApprovalEmptyHint:
    "代理退出计划模式但未写入计划。可批准继续、请求修改或退出。",
  planApprovalApprove: "批准",
  planApprovalRequestChanges: "请求修改",
  planApprovalAbandon: "退出计划",
  planApprovalFeedbackPlaceholder: "说明需要如何修改…",
  planApprovalSendFeedback: "发送反馈",
  planApprovalCancelFeedback: "返回",
  planProgressStep: "第 {n} / {total} 步",
  planProgressPending: "还有 {n} 步",

  trustKicker: "信任文件夹",
  trustTitle: "信任此工作区？",
  trustBadge: "信任",
  trustBodySame:
    "此工作区包含仓库本地的代码执行标记。在你授权信任前，Agent 不会运行其中的 hooks、MCP 服务器、插件、LSP 等。",
  trustBodyCwd: "当前 session 的 cwd：",
  trustBodyWorkspace: "授权后将允许在整个工作区内执行：",
  trustKindsLabel: "检测到",
  trustWarn:
    "信任记录保存在 ~/.grok/trusted_folders.toml，可稍后在 Settings → Extensions → Trusted folders 撤销。",
  trustHint: "T/Enter 信任 · R/Esc 拒绝",
  trustGrant: "信任此工作区",
  trustReject: "拒绝",
  planTodosChip: "任务",

  navMcp: "MCP",
  navExtensions: "技能",
  extTitle: "技能",
  extSubtitle:
    "管理 MCP 服务器、Skills、Plugins 与 Hooks。写入 ~/.grok（项目作用域时写入工作区 .grok）。",
  extTabMcp: "MCP 服务器",
  extTabSkills: "Skills",
  extTabPlugins: "Plugins",
  extTabHooks: "Hooks",
  extTabTrust: "信任文件夹",
  extFilter: "筛选…",

  trustPanelTitle: "信任文件夹",
  trustPanelSubtitle:
    "已授权（或明确拒绝）信任的工作区。记录保存在 ~/.grok/trusted_folders.toml。",
  trustPanelEmpty:
    "暂无任何信任记录。首次打开包含仓库本地 hooks、MCP、plugins 或 LSP 的工作区时，Agent 会弹出询问。",
  trustEntryTrusted: "已信任",
  trustEntryDeclined: "已拒绝",
  trustEntryRevoke: "撤销信任",
  trustEntryRevoked: "已撤销",
  trustEntryRevokeConfirm: "确认撤销此工作区的信任？",
  trustEntryPathLabel: "路径",
  trustEntryDecidedAtLabel: "决定时间",
  trustEntryRevokeFailed: "无法撤销信任",
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

  navModels: "模型",
  modelsTitle: "模型与提供商",
  modelsSubtitle:
    "添加国内外模型提供商，可自动拉取或手动录入模型，并在输入框中切换。写入 ~/.grok/config.toml 的 [model.*]（与 CLI 一致）。",
  modelsAddProvider: "添加提供商",
  modelsEditProvider: "编辑提供商",
  modelsChoosePreset: "选择提供商",
  modelsChoosePresetHint:
    "选择预设或自定义 OpenAI 兼容端点。可同时配置多个提供商。",
  modelsRegionIntl: "国际",
  modelsRegionCn: "国内",
  modelsRegionLocal: "本地",
  modelsCustomEndpoint: "自定义端点",
  modelsPresetAdded: "已添加",
  modelsEmpty: "尚未配置提供商。可添加 OpenAI、DeepSeek、月之暗面、Ollama 等。",
  modelsEdit: "编辑",
  modelsDeleteConfirm: '移除提供商「{name}」及其模型配置？',
  modelsDeleted: "已移除提供商",
  modelsSaved: "已写入 config.toml — 请重连或新开会话以加载模型",
  modelsNameRequired: "请填写提供商名称",
  modelsBaseUrlRequired: "请填写 Base URL",
  modelsProviderName: "显示名称",
  modelsBaseUrl: "Base URL",
  modelsApiKey: "API Key",
  modelsApiKeyPlaceholder: "若已配置环境变量可留空",
  modelsEnvKey: "密钥环境变量",
  modelsApiBackend: "API 协议",
  modelsAuthStyle: "鉴权方式",
  modelsProviderEnabled: "启用此提供商",
  modelsListTitle: "模型列表",
  modelsFetch: "拉取模型列表",
  modelsFetchHint:
    "请求 GET {base_url}/models。勾选要启用的模型，或在下方手动添加 id。",
  modelsFetchedCount: "已拉取 {n} 个模型",
  modelsEnableAll: "全选启用",
  modelsDisableAll: "全部取消",
  modelsAddManual: "添加模型",
  modelsManualIdPlaceholder: "模型 id（如 gpt-4o）",
  modelsManualNamePlaceholder: "显示名（可选）",
  modelsFilterModels: "筛选模型…",
  modelsNoModelsYet: "暂无模型。可从 API 拉取，或手动输入模型 id。",
  modelsSourceFetched: "API",
  modelsSourceManual: "手动",
  modelsEnabledCount: "已启用 {n} 个",
  modelsReconnect: "重连 Agent",
  modelsReconnectHint: "重载 agent 后，新保存的模型会出现在选择器中",
  modelsReconnected: "Agent 已重连",
  modelsFootnote:
    "启用的模型会写入 ~/.grok/config.toml 的 [model.dp_*]。与 CLI（`grok models`、/model）共享。保存后请重连或新开会话。",
  modelsEditorHint:
    "API Key 保存在 desktop-providers.json 与 config.toml（权限 0600）。尽量优先使用环境变量。",
  modelsGroupBuiltin: "内置",
  modelsManage: "管理模型…",
  modelsNoModelsInProvider: "此提供商下暂无模型",
  modelsAllProviders: "全部",

  toolKindEdit: "编辑",
  toolKindSearch: "搜索",
  toolKindThink: "思考",
  toolKindRead: "读取",
  toolKindWrite: "写入",
  toolKindRun: "执行",
  toolKindWeb: "联网",
  toolKindTool: "工具",
  toolStatusPending: "等待",
  toolStatusRunning: "运行中",
  toolStatusCompleted: "已完成",
  toolStatusFailed: "失败",
  toolStatusCancelled: "已取消",
  toolStatusAwaiting: "待审批",

  effortLow: "低",
  effortMedium: "中",
  effortHigh: "高",
  effortXhigh: "极高",
  effortAuto: "自动",
  effortOff: "关",

  modelsSectionConnection: "连接信息",
  modelsSectionAuth: "鉴权与协议",
  modelsEndpointFixedHint:
    "已选提供商的接口地址由协议决定，不可手动修改。切换协议会自动切换到对应的官方地址。",
  modelsEmptyNoMatches: "没有匹配的提供商",
  modelsEmptyNoMatchesHint: "试试清空搜索关键词，或添加新的提供商。",
  modelsEnabledModelsStat: "已启用模型",
  modelsClearSearchAria: "清空",
  modelsBackendChatCompletions: "chat_completions（OpenAI 兼容）",
  modelsBackendChatCompletionsDefault:
    "chat_completions（OpenAI 兼容）— 默认",
  modelsBackendResponses: "responses（OpenAI Responses）",
  modelsBackendMessages: "messages（Anthropic Messages）",
  modelsPresetSearchPlaceholder: "搜索提供商…",
  modelsGlobalSearchPlaceholder: "搜索提供商或模型…",
  modelsProtocolHint:
    "协议与完整 Base URL 一一对应。例如 MiniMax 的 messages 对应 https://api.minimaxi.com/anthropic/v1（实际请求 …/messages）；chat_completions 对应 https://api.minimaxi.com/v1。",
};

const ALL: Record<ResolvedLocale, Messages> = { en, zh };

export function getMessages(locale: ResolvedLocale): Messages {
  return ALL[locale];
}

/**
 * Render a reasoning-effort id (low / medium / high / xhigh / auto / …) using
 * the localized label when possible, otherwise the raw id. Falls back to the
 * generic "effort" / "off" label when no value is set.
 */
export function localizeEffort(raw: string | undefined, m: Messages): string {
  if (!raw) return m.effortOff;
  const key = raw.trim().toLowerCase();
  switch (key) {
    case "low":
      return m.effortLow;
    case "medium":
    case "med":
    case "default":
      return m.effortMedium;
    case "high":
      return m.effortHigh;
    case "xhigh":
    case "extra_high":
    case "extra-high":
    case "max":
      return m.effortXhigh;
    case "auto":
    case "adaptive":
      return m.effortAuto;
    case "off":
    case "none":
    case "disabled":
      return m.effortOff;
    default:
      return raw;
  }
}
