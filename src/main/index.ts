import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from "electron";
import { join } from "node:path";
import { AgentBackend } from "./backend";
import {
  cancelLogin,
  getAccountStatus,
  logout as accountLogout,
  setApiKey,
  startLogin,
} from "./account-manager";
import {
  addMcpServer,
  getConfigPaths,
  installPlugin,
  listHooks,
  listMcpServers,
  listPlugins,
  listSkills,
  readHookPreview,
  removeMcpServer,
  setMcpEnabled,
  setPluginEnabled,
  setSkillDisabled,
  uninstallPlugin,
  type AddMcpInput,
} from "./extensions-manager";
import {
  addFromPreset,
  deleteProvider,
  fetchProviderModels,
  getConfigKeyIndex,
  listPresets,
  listProviders,
  upsertProvider,
} from "./model-providers";
import { listWorkspaceDir, readWorkspaceFile } from "./workspace-fs";
import { TerminalHost } from "./terminal-host";
import type {
  AccountLoginMethod,
  AskUserQuestionResponse,
  FetchModelsInput,
  McpServerScope,
  PlanApprovalOutcome,
  PromptPayload,
  SearchSessionsOptions,
  SessionModeId,
  UpsertProviderInput,
} from "../shared/types";

const backend = new AgentBackend();
const terminalHost = new TerminalHost();
let mainWindow: BrowserWindow | null = null;

/**
 * Linux display / IME setup — must run before app.whenReady().
 *
 * fcitx5 Chinese on Wayland needs native Ozone Wayland + Wayland IME.
 * XWayland path also needs GTK/Qt IM modules (often empty in pure Wayland
 * sessions — which breaks Chinese entirely).
 *
 * Override:
 *   GROK_DESKTOP_OZONE / ELECTRON_OZONE_PLATFORM_HINT = wayland|x11|auto
 *   GROK_DESKTOP_WAYLAND_IME=0  — skip Wayland IME flags
 *
 * Launch: pnpm dev:wayland
 * See: https://fcitx-im.org/wiki/Using_Fcitx_5_on_Wayland
 */
function configureLinuxDisplayAndIme(): void {
  if (process.platform !== "linux") return;

  const onWayland = Boolean(
    process.env.WAYLAND_DISPLAY || process.env.WAYLAND_SOCKET,
  );

  // Session often only sets XMODIFIERS; Chromium/Electron still need these
  // for XWayland GTK IM and some plugin paths.
  if (!process.env.XMODIFIERS?.trim()) {
    process.env.XMODIFIERS = "@im=fcitx";
  }
  if (!process.env.GTK_IM_MODULE?.trim()) {
    process.env.GTK_IM_MODULE = "fcitx";
  }
  if (!process.env.QT_IM_MODULE?.trim()) {
    process.env.QT_IM_MODULE = "fcitx";
  }
  if (!process.env.SDL_IM_MODULE?.trim()) {
    process.env.SDL_IM_MODULE = "fcitx";
  }

  const ozoneRaw =
    process.env.GROK_DESKTOP_OZONE?.trim() ||
    process.env.ELECTRON_OZONE_PLATFORM_HINT?.trim() ||
    // Prefer real Wayland on Wayland sessions — "auto" sometimes stays on
    // XWayland where fcitx5 Chinese fails without extra GTK plumbing.
    (onWayland ? "wayland" : "");

  const ozone = ozoneRaw.toLowerCase();

  if (
    ozone &&
    !app.commandLine.hasSwitch("ozone-platform") &&
    !app.commandLine.hasSwitch("ozone-platform-hint")
  ) {
    if (ozone === "wayland" || ozone === "x11") {
      // Force platform (more reliable for IME than hint-only).
      app.commandLine.appendSwitch("ozone-platform", ozone);
      app.commandLine.appendSwitch("ozone-platform-hint", ozone);
    } else {
      app.commandLine.appendSwitch("ozone-platform-hint", ozone);
    }
  }

  const wantWaylandIme =
    process.env.GROK_DESKTOP_WAYLAND_IME !== "0" &&
    (ozone === "wayland" ||
      ozone === "auto" ||
      (onWayland && ozone !== "x11"));

  if (wantWaylandIme) {
    if (!app.commandLine.hasSwitch("enable-wayland-ime")) {
      app.commandLine.appendSwitch("enable-wayland-ime");
    }
    // text-input-v3 — needed on many compositors (KWin/labwc/Hyprland).
    if (!app.commandLine.hasSwitch("wayland-text-input-version")) {
      app.commandLine.appendSwitch("wayland-text-input-version", "3");
    }

    // appendSwitch does not override an existing switch — set features once.
    if (!app.commandLine.hasSwitch("enable-features")) {
      app.commandLine.appendSwitch(
        "enable-features",
        "UseOzonePlatform,WaylandWindowDecorations",
      );
    }
  }

  console.log(
    `[ime] ozone=${ozone || "(default)"} waylandIme=${wantWaylandIme} ` +
      `GTK_IM_MODULE=${process.env.GTK_IM_MODULE} ` +
      `XMODIFIERS=${process.env.XMODIFIERS}`,
  );
}

configureLinuxDisplayAndIme();

/**
 * Application menu wires platform accelerators (Ctrl/Cmd+C/V/X/A, Undo…).
 *
 * On Win/Linux, `Menu.setApplicationMenu(null)` removes those roles entirely —
 * selection copy/paste stops working. Keep a minimal Edit menu and hide the
 * native bar via `autoHideMenuBar` so we don't flash a light File/Edit strip.
 * macOS still needs app + window menus in the system menu bar.
 */
function setupApplicationMenu(): void {
  if (process.platform === "darwin") {
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        { role: "appMenu" },
        { role: "editMenu" },
        { role: "windowMenu" },
      ]),
    );
    return;
  }

  // Explicit roles (not only role: "editMenu") so accelerators are registered
  // even when the menu bar is auto-hidden.
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: "Edit",
        submenu: [
          { role: "undo" },
          { role: "redo" },
          { type: "separator" },
          { role: "cut" },
          { role: "copy" },
          { role: "paste" },
          { role: "delete" },
          { type: "separator" },
          { role: "selectAll" },
        ],
      },
    ]),
  );
}

/**
 * Native right-click Edit menu for selected text and editable fields.
 * Only pops when there is something useful to do (avoids clashing with
 * in-app session context menus on empty non-editable clicks).
 */
function attachEditContextMenu(win: BrowserWindow): void {
  win.webContents.on("context-menu", (_event, params) => {
    const { editFlags, isEditable, selectionText } = params;
    const hasSelection = Boolean(selectionText && selectionText.trim());
    if (!isEditable && !hasSelection) return;

    const items: Electron.MenuItemConstructorOptions[] = [];

    if (isEditable) {
      items.push(
        { role: "undo", enabled: editFlags.canUndo },
        { role: "redo", enabled: editFlags.canRedo },
        { type: "separator" },
        { role: "cut", enabled: editFlags.canCut },
        { role: "copy", enabled: editFlags.canCopy },
        { role: "paste", enabled: editFlags.canPaste },
        { role: "delete", enabled: editFlags.canDelete },
        { type: "separator" },
        { role: "selectAll", enabled: editFlags.canSelectAll },
      );
    } else {
      items.push(
        { role: "copy", enabled: editFlags.canCopy },
        { role: "selectAll", enabled: editFlags.canSelectAll },
      );
    }

    Menu.buildFromTemplate(items).popup({ window: win });
  });
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 600,
    title: "Grok Build",
    backgroundColor: "#1a1a1a",
    show: false,
    // Keep Edit accelerators from setupApplicationMenu without a permanent
    // system light menu strip (press Alt to reveal on Win/Linux).
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, "../preload/index.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  attachEditContextMenu(mainWindow);

  backend.onEvent((event) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("agent:event", event);
    }
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function registerIpc(): void {
  ipcMain.handle("agent:getState", () => backend.snapshot());

  ipcMain.handle("agent:connect", async () => {
    await backend.connect();
  });

  ipcMain.handle("agent:newSession", async (_e, workspace: string) => {
    if (typeof workspace !== "string" || !workspace.trim()) {
      throw new Error("workspace is required");
    }
    await backend.newSession(workspace.trim());
  });

  ipcMain.handle("agent:prepareNewChat", async () => {
    backend.prepareNewChat();
  });

  ipcMain.handle(
    "agent:loadSession",
    async (_e, sessionId: string, cwd: string) => {
      if (typeof sessionId !== "string" || typeof cwd !== "string") {
        throw new Error("sessionId and cwd are required");
      }
      await backend.loadSession(sessionId, cwd);
    },
  );

  ipcMain.handle("agent:refreshHistory", async () => {
    await backend.refreshHistory();
  });

  ipcMain.handle(
    "agent:renameSession",
    async (_e, sessionId: string, title: string, cwd: string) => {
      if (
        typeof sessionId !== "string" ||
        typeof title !== "string" ||
        typeof cwd !== "string"
      ) {
        throw new Error("sessionId, title, and cwd are required");
      }
      await backend.renameSession(sessionId, title, cwd);
    },
  );

  ipcMain.handle(
    "agent:deleteSession",
    async (_e, sessionId: string, cwd: string) => {
      if (typeof sessionId !== "string" || typeof cwd !== "string") {
        throw new Error("sessionId and cwd are required");
      }
      await backend.deleteSession(sessionId, cwd);
    },
  );

  ipcMain.handle(
    "agent:forkSession",
    async (_e, sessionId: string, cwd: string) => {
      if (typeof sessionId !== "string" || typeof cwd !== "string") {
        throw new Error("sessionId and cwd are required");
      }
      return backend.forkSession(sessionId, cwd);
    },
  );

  ipcMain.handle(
    "agent:searchSessions",
    async (_e, query: string, options?: SearchSessionsOptions) => {
      if (typeof query !== "string") return [];
      return backend.searchSessions(query, options);
    },
  );

  ipcMain.handle("agent:stop", async () => {
    await backend.stop();
  });

  ipcMain.handle("agent:pickFolder", async () => {
    const win = BrowserWindow.getFocusedWindow() ?? mainWindow ?? undefined;
    const result = await dialog.showOpenDialog(win ?? undefined!, {
      properties: ["openDirectory", "createDirectory"],
      title: "Choose workspace",
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0] ?? null;
  });

  ipcMain.handle("agent:pickFiles", async () => {
    const win = BrowserWindow.getFocusedWindow() ?? mainWindow ?? undefined;
    const snap = backend.snapshot();
    const result = await dialog.showOpenDialog(win ?? undefined!, {
      properties: ["openFile", "multiSelections"],
      title: "Attach files",
      defaultPath: snap.workspace,
    });
    if (result.canceled || result.filePaths.length === 0) return [];
    return backend.attachmentsFromPaths(result.filePaths);
  });

  ipcMain.handle("agent:attachPaths", async (_e, paths: unknown) => {
    if (!Array.isArray(paths)) return [];
    const list = paths.filter((p): p is string => typeof p === "string" && p.trim().length > 0);
    if (list.length === 0) return [];
    return backend.attachmentsFromPaths(list);
  });

  ipcMain.handle("agent:pathSuggest", async (_e, query: string) => {
    if (typeof query !== "string") return [];
    return backend.pathSuggest(query);
  });

  ipcMain.handle(
    "agent:setModel",
    async (_e, modelId: string, reasoningEffort?: string) => {
      if (typeof modelId !== "string" || !modelId.trim()) {
        throw new Error("modelId is required");
      }
      await backend.setModel(
        modelId.trim(),
        typeof reasoningEffort === "string" ? reasoningEffort : undefined,
      );
    },
  );

  ipcMain.handle("agent:setMode", async (_e, modeId: SessionModeId) => {
    if (modeId !== "default" && modeId !== "plan" && modeId !== "ask") {
      throw new Error("invalid modeId");
    }
    await backend.setMode(modeId);
  });

  ipcMain.handle(
    "agent:sendPrompt",
    async (_e, payload: PromptPayload | string) => {
      await backend.sendPrompt(payload);
    },
  );

  ipcMain.handle(
    "agent:listPromptHistory",
    async (_e, cwd: string, filterSessionId?: string) => {
      if (typeof cwd !== "string" || !cwd.trim()) return [];
      return backend.listPromptHistory(
        cwd.trim(),
        typeof filterSessionId === "string" ? filterSessionId : undefined,
      );
    },
  );

  ipcMain.handle("agent:cancel", async () => {
    await backend.cancel();
  });

  ipcMain.handle(
    "agent:respondPermission",
    async (_e, requestId: string, optionId: string | null) => {
      if (typeof requestId !== "string" || !requestId.trim()) {
        throw new Error("requestId is required");
      }
      if (optionId !== null && typeof optionId !== "string") {
        throw new Error("optionId must be a string or null");
      }
      backend.respondPermission(requestId, optionId);
    },
  );

  ipcMain.handle(
    "agent:respondAskUserQuestion",
    async (_e, requestId: string, response: AskUserQuestionResponse) => {
      if (typeof requestId !== "string" || !requestId.trim()) {
        throw new Error("requestId is required");
      }
      if (!response || typeof response !== "object") {
        throw new Error("response is required");
      }
      const outcome = (response as { outcome?: string }).outcome;
      if (
        outcome !== "accepted" &&
        outcome !== "chat_about_this" &&
        outcome !== "skip_interview" &&
        outcome !== "cancelled"
      ) {
        throw new Error(
          "outcome must be accepted | chat_about_this | skip_interview | cancelled",
        );
      }
      backend.respondAskUserQuestion(requestId, response);
    },
  );

  ipcMain.handle(
    "agent:respondPlanApproval",
    async (
      _e,
      requestId: string,
      outcome: PlanApprovalOutcome,
      feedback?: string,
    ) => {
      if (typeof requestId !== "string" || !requestId.trim()) {
        throw new Error("requestId is required");
      }
      if (
        outcome !== "approved" &&
        outcome !== "cancelled" &&
        outcome !== "abandoned"
      ) {
        throw new Error("outcome must be approved | cancelled | abandoned");
      }
      backend.respondPlanApproval(
        requestId,
        outcome,
        typeof feedback === "string" ? feedback : undefined,
      );
    },
  );

  ipcMain.handle("agent:refreshPlanContent", async () => {
    return backend.refreshPlanContent();
  });

  ipcMain.handle(
    "agent:setAlwaysApprove",
    async (_e, enabled: boolean) => {
      if (typeof enabled !== "boolean") {
        throw new Error("enabled must be a boolean");
      }
      await backend.setAlwaysApprove(enabled);
    },
  );

  ipcMain.handle("fs:listDir", async (_e, relDir?: string) => {
    const root = backend.snapshot().workspace;
    if (!root) throw new Error("No workspace open");
    const dir = typeof relDir === "string" ? relDir : "";
    return listWorkspaceDir(root, dir);
  });

  ipcMain.handle("fs:readFile", async (_e, relPath: string) => {
    const root = backend.snapshot().workspace;
    if (!root) throw new Error("No workspace open");
    if (typeof relPath !== "string" || !relPath.trim()) {
      throw new Error("path is required");
    }
    return readWorkspaceFile(root, relPath.trim());
  });

  // ── Terminal panel ──
  terminalHost.onEvent((ev) => {
    const win = mainWindow;
    if (win && !win.isDestroyed()) {
      win.webContents.send("term:event", ev);
    }
  });

  ipcMain.handle(
    "term:start",
    (_e, cwd?: string, cols?: number, rows?: number) => {
      const root =
        (typeof cwd === "string" && cwd.trim()) ||
        backend.snapshot().workspace ||
        undefined;
      const c = typeof cols === "number" && cols > 0 ? cols : 80;
      const r = typeof rows === "number" && rows > 0 ? rows : 24;
      return terminalHost.start(root, c, r);
    },
  );

  ipcMain.handle("term:write", (_e, id: string, data: string) => {
    if (typeof id !== "string" || typeof data !== "string") return;
    terminalHost.write(id, data);
  });

  ipcMain.handle(
    "term:resize",
    (_e, id: string, cols: number, rows: number) => {
      if (typeof id !== "string") return;
      if (typeof cols !== "number" || typeof rows !== "number") return;
      terminalHost.resize(id, cols, rows);
    },
  );

  ipcMain.handle("term:kill", (_e, id: string) => {
    if (typeof id !== "string") return;
    terminalHost.kill(id);
  });

  // ── Extensions: MCP / Skills / Plugins / Hooks ──

  const workspaceCwd = () => backend.snapshot().workspace || process.cwd();

  ipcMain.handle("ext:listMcp", async () => {
    return listMcpServers(workspaceCwd());
  });

  ipcMain.handle("ext:addMcp", async (_e, input: AddMcpInput) => {
    if (!input || typeof input.name !== "string" || !input.commandOrUrl) {
      throw new Error("name and commandOrUrl are required");
    }
    await addMcpServer({ ...input, cwd: workspaceCwd() });
  });

  ipcMain.handle(
    "ext:removeMcp",
    async (_e, name: string, scope?: McpServerScope) => {
      if (typeof name !== "string" || !name.trim()) {
        throw new Error("name is required");
      }
      await removeMcpServer(name.trim(), scope, workspaceCwd());
    },
  );

  ipcMain.handle(
    "ext:setMcpEnabled",
    async (_e, name: string, enabled: boolean, scope?: McpServerScope) => {
      if (typeof name !== "string" || !name.trim()) {
        throw new Error("name is required");
      }
      if (typeof enabled !== "boolean") throw new Error("enabled must be boolean");
      await setMcpEnabled(
        name.trim(),
        enabled,
        scope === "project" ? "project" : "user",
        workspaceCwd(),
      );
    },
  );

  ipcMain.handle("ext:listSkills", async () => {
    return listSkills(workspaceCwd());
  });

  ipcMain.handle(
    "ext:setSkillDisabled",
    async (_e, name: string, disabled: boolean) => {
      if (typeof name !== "string" || !name.trim()) {
        throw new Error("name is required");
      }
      if (typeof disabled !== "boolean") {
        throw new Error("disabled must be boolean");
      }
      await setSkillDisabled(name.trim(), disabled);
    },
  );

  ipcMain.handle("ext:listPlugins", async (_e, available?: boolean) => {
    return listPlugins(Boolean(available));
  });

  ipcMain.handle("ext:installPlugin", async (_e, source: string) => {
    if (typeof source !== "string" || !source.trim()) {
      throw new Error("source is required");
    }
    await installPlugin(source.trim());
  });

  ipcMain.handle("ext:uninstallPlugin", async (_e, name: string) => {
    if (typeof name !== "string" || !name.trim()) {
      throw new Error("name is required");
    }
    await uninstallPlugin(name.trim());
  });

  ipcMain.handle(
    "ext:setPluginEnabled",
    async (_e, name: string, enabled: boolean) => {
      if (typeof name !== "string" || !name.trim()) {
        throw new Error("name is required");
      }
      if (typeof enabled !== "boolean") throw new Error("enabled must be boolean");
      await setPluginEnabled(name.trim(), enabled);
    },
  );

  ipcMain.handle("ext:listHooks", async () => {
    return listHooks(workspaceCwd());
  });

  ipcMain.handle("ext:readHookFile", async (_e, filePath: string) => {
    if (typeof filePath !== "string" || !filePath.trim()) {
      throw new Error("path is required");
    }
    return readHookPreview(filePath.trim());
  });

  ipcMain.handle("ext:getPaths", async () => {
    return getConfigPaths(workspaceCwd());
  });

  // ── Custom model providers ──────────────────────────────────────

  ipcMain.handle("models:listPresets", () => listPresets());
  ipcMain.handle("models:listProviders", async () => listProviders());
  ipcMain.handle(
    "models:upsertProvider",
    async (_e, input: UpsertProviderInput) => {
      if (!input || typeof input !== "object") {
        throw new Error("provider input is required");
      }
      return upsertProvider(input);
    },
  );
  ipcMain.handle("models:deleteProvider", async (_e, id: string) => {
    if (typeof id !== "string" || !id.trim()) {
      throw new Error("provider id is required");
    }
    await deleteProvider(id.trim());
  });
  ipcMain.handle(
    "models:addFromPreset",
    async (_e, presetId: string, overrides?: Partial<UpsertProviderInput>) => {
      if (typeof presetId !== "string" || !presetId.trim()) {
        throw new Error("presetId is required");
      }
      return addFromPreset(presetId.trim(), overrides);
    },
  );
  ipcMain.handle(
    "models:fetchModels",
    async (_e, input: FetchModelsInput) => {
      if (!input || typeof input.baseUrl !== "string") {
        throw new Error("baseUrl is required");
      }
      return fetchProviderModels(input);
    },
  );
  ipcMain.handle("models:getConfigKeyIndex", async () => getConfigKeyIndex());

  // ── Account ─────────────────────────────────────────────────────

  const sendAccount = (payload: unknown) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("account:event", payload);
    }
  };

  ipcMain.handle("account:getStatus", async () => {
    return getAccountStatus();
  });

  ipcMain.handle("account:login", async (_e, method: AccountLoginMethod) => {
    const m: AccountLoginMethod = method === "device" ? "device" : "oauth";
    try {
      const status = await startLogin(m, (progress) => {
        sendAccount({
          type: "loginProgress",
          message: progress.message,
          deviceUrl: progress.deviceUrl,
          deviceUserCode: progress.deviceUserCode,
        });
      });
      sendAccount({
        type: "loginDone",
        ok: true,
        message: status.email
          ? `Signed in as ${status.email}`
          : "Signed in",
        status,
      });
      sendAccount({ type: "status", status });
      // Reconnect agent so ACP re-authenticates with fresh credentials.
      try {
        await backend.connect();
      } catch (err) {
        console.error("reconnect after login failed:", err);
      }
      return status;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const status = await getAccountStatus();
      sendAccount({
        type: "loginDone",
        ok: false,
        message,
        status,
      });
      sendAccount({ type: "status", status });
      throw err;
    }
  });

  ipcMain.handle("account:cancelLogin", async () => {
    cancelLogin();
    const status = await getAccountStatus();
    sendAccount({ type: "status", status });
  });

  ipcMain.handle("account:logout", async () => {
    const result = await accountLogout();
    sendAccount({ type: "status", status: result.status });
    // Stop agent session auth; user may re-login later.
    try {
      await backend.stop();
    } catch {
      // ignore
    }
    return result;
  });

  ipcMain.handle("account:setApiKey", async (_e, key: string | null) => {
    const status = await setApiKey(
      typeof key === "string" ? key : key === null ? null : null,
    );
    sendAccount({ type: "status", status });
    return status;
  });

  ipcMain.handle("account:reconnect", async () => {
    await backend.connect();
  });

  ipcMain.handle("account:refreshUsage", async () => {
    return backend.refreshUsage();
  });

  ipcMain.handle("account:openExternal", async (_e, url: string) => {
    if (typeof url !== "string" || !url.trim()) {
      throw new Error("url is required");
    }
    const u = url.trim();
    if (!/^https?:\/\//i.test(u)) {
      throw new Error("Only http(s) URLs are allowed");
    }
    await shell.openExternal(u);
  });
}

app.whenReady().then(() => {
  setupApplicationMenu();
  registerIpc();
  createWindow();
  void backend.connect().catch((err) => {
    console.error("auto-connect failed:", err);
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  terminalHost.killAll();
  void backend.stop();
});
