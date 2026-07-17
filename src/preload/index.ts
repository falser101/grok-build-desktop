import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from "electron";
import type {
  AccountLoginMethod,
  AccountStatus,
  AccountUiEvent,
  AddMcpServerInput,
  AgentUiEvent,
  AppSnapshot,
  DesktopApi,
  ExtensionsConfigPaths,
  FileEntry,
  FileReadResult,
  ForkSessionResult,
  HookEntry,
  McpServerEntry,
  McpServerScope,
  PathSuggestion,
  PluginEntry,
  PromptAttachment,
  PromptPayload,
  SearchSessionsOptions,
  SessionModeId,
  SessionSearchHit,
  SkillEntry,
  TermHostEvent,
  TermStartResult,
  UsageInfo,
} from "../shared/types";

const api: DesktopApi = {
  getState: () => ipcRenderer.invoke("agent:getState") as Promise<AppSnapshot>,
  connect: () => ipcRenderer.invoke("agent:connect") as Promise<void>,
  newSession: (workspace: string) =>
    ipcRenderer.invoke("agent:newSession", workspace) as Promise<void>,
  prepareNewChat: () =>
    ipcRenderer.invoke("agent:prepareNewChat") as Promise<void>,
  loadSession: (sessionId: string, cwd: string) =>
    ipcRenderer.invoke("agent:loadSession", sessionId, cwd) as Promise<void>,
  refreshHistory: () =>
    ipcRenderer.invoke("agent:refreshHistory") as Promise<void>,
  renameSession: (sessionId: string, title: string, cwd: string) =>
    ipcRenderer.invoke(
      "agent:renameSession",
      sessionId,
      title,
      cwd,
    ) as Promise<void>,
  deleteSession: (sessionId: string, cwd: string) =>
    ipcRenderer.invoke("agent:deleteSession", sessionId, cwd) as Promise<void>,
  forkSession: (sessionId: string, cwd: string) =>
    ipcRenderer.invoke(
      "agent:forkSession",
      sessionId,
      cwd,
    ) as Promise<ForkSessionResult>,
  searchSessions: (query: string, options?: SearchSessionsOptions) =>
    ipcRenderer.invoke(
      "agent:searchSessions",
      query,
      options,
    ) as Promise<SessionSearchHit[]>,
  stop: () => ipcRenderer.invoke("agent:stop") as Promise<void>,
  pickFolder: () =>
    ipcRenderer.invoke("agent:pickFolder") as Promise<string | null>,
  pickFiles: () =>
    ipcRenderer.invoke("agent:pickFiles") as Promise<PromptAttachment[]>,
  attachPaths: (paths: string[]) =>
    ipcRenderer.invoke("agent:attachPaths", paths) as Promise<PromptAttachment[]>,
  getPathForFile: (file: File) => {
    try {
      return webUtils.getPathForFile(file) || "";
    } catch {
      return "";
    }
  },
  pathSuggest: (query: string) =>
    ipcRenderer.invoke("agent:pathSuggest", query) as Promise<PathSuggestion[]>,
  setModel: (modelId: string, reasoningEffort?: string) =>
    ipcRenderer.invoke("agent:setModel", modelId, reasoningEffort) as Promise<void>,
  setMode: (modeId: SessionModeId) =>
    ipcRenderer.invoke("agent:setMode", modeId) as Promise<void>,
  sendPrompt: (payload: PromptPayload | string) =>
    ipcRenderer.invoke("agent:sendPrompt", payload) as Promise<void>,
  cancel: () => ipcRenderer.invoke("agent:cancel") as Promise<void>,
  respondPermission: (requestId: string, optionId: string | null) =>
    ipcRenderer.invoke(
      "agent:respondPermission",
      requestId,
      optionId,
    ) as Promise<void>,
  setAlwaysApprove: (enabled: boolean) =>
    ipcRenderer.invoke("agent:setAlwaysApprove", enabled) as Promise<void>,
  listDir: (relDir?: string) =>
    ipcRenderer.invoke("fs:listDir", relDir) as Promise<FileEntry[]>,
  readFile: (relPath: string) =>
    ipcRenderer.invoke("fs:readFile", relPath) as Promise<FileReadResult>,
  termStart: (cwd?: string, cols?: number, rows?: number) =>
    ipcRenderer.invoke("term:start", cwd, cols, rows) as Promise<TermStartResult>,
  termWrite: (id: string, data: string) =>
    ipcRenderer.invoke("term:write", id, data) as Promise<void>,
  termResize: (id: string, cols: number, rows: number) =>
    ipcRenderer.invoke("term:resize", id, cols, rows) as Promise<void>,
  termKill: (id: string) =>
    ipcRenderer.invoke("term:kill", id) as Promise<void>,
  onTermEvent: (cb) => {
    const listener = (_event: IpcRendererEvent, payload: TermHostEvent) => {
      cb(payload);
    };
    ipcRenderer.on("term:event", listener);
    return () => {
      ipcRenderer.removeListener("term:event", listener);
    };
  },
  listMcpServers: () =>
    ipcRenderer.invoke("ext:listMcp") as Promise<McpServerEntry[]>,
  addMcpServer: (input: AddMcpServerInput) =>
    ipcRenderer.invoke("ext:addMcp", input) as Promise<void>,
  removeMcpServer: (name: string, scope?: McpServerScope) =>
    ipcRenderer.invoke("ext:removeMcp", name, scope) as Promise<void>,
  setMcpEnabled: (name: string, enabled: boolean, scope?: McpServerScope) =>
    ipcRenderer.invoke("ext:setMcpEnabled", name, enabled, scope) as Promise<void>,
  listSkills: () =>
    ipcRenderer.invoke("ext:listSkills") as Promise<SkillEntry[]>,
  setSkillDisabled: (name: string, disabled: boolean) =>
    ipcRenderer.invoke("ext:setSkillDisabled", name, disabled) as Promise<void>,
  listPlugins: (available?: boolean) =>
    ipcRenderer.invoke("ext:listPlugins", available) as Promise<PluginEntry[]>,
  installPlugin: (source: string) =>
    ipcRenderer.invoke("ext:installPlugin", source) as Promise<void>,
  uninstallPlugin: (name: string) =>
    ipcRenderer.invoke("ext:uninstallPlugin", name) as Promise<void>,
  setPluginEnabled: (name: string, enabled: boolean) =>
    ipcRenderer.invoke("ext:setPluginEnabled", name, enabled) as Promise<void>,
  listHooks: () =>
    ipcRenderer.invoke("ext:listHooks") as Promise<HookEntry[]>,
  readHookFile: (path: string) =>
    ipcRenderer.invoke("ext:readHookFile", path) as Promise<string>,
  getExtensionsPaths: () =>
    ipcRenderer.invoke("ext:getPaths") as Promise<ExtensionsConfigPaths>,
  getAccountStatus: () =>
    ipcRenderer.invoke("account:getStatus") as Promise<AccountStatus>,
  login: (method: AccountLoginMethod) =>
    ipcRenderer.invoke("account:login", method) as Promise<AccountStatus>,
  cancelLogin: () => ipcRenderer.invoke("account:cancelLogin") as Promise<void>,
  logout: () =>
    ipcRenderer.invoke("account:logout") as Promise<{
      message: string;
      status: AccountStatus;
    }>,
  setApiKey: (key: string | null) =>
    ipcRenderer.invoke("account:setApiKey", key) as Promise<AccountStatus>,
  reconnectAgent: () =>
    ipcRenderer.invoke("account:reconnect") as Promise<void>,
  refreshUsage: () =>
    ipcRenderer.invoke("account:refreshUsage") as Promise<UsageInfo | null>,
  openExternal: (url: string) =>
    ipcRenderer.invoke("account:openExternal", url) as Promise<void>,
  onEvent: (cb) => {
    const listener = (_event: IpcRendererEvent, payload: AgentUiEvent) => {
      cb(payload);
    };
    ipcRenderer.on("agent:event", listener);
    return () => {
      ipcRenderer.removeListener("agent:event", listener);
    };
  },
  onAccountEvent: (cb) => {
    const listener = (_event: IpcRendererEvent, payload: AccountUiEvent) => {
      cb(payload);
    };
    ipcRenderer.on("account:event", listener);
    return () => {
      ipcRenderer.removeListener("account:event", listener);
    };
  },
};

contextBridge.exposeInMainWorld("desktop", api);
