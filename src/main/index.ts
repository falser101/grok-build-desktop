import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from "electron";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { AgentBackend } from "./backend";
import {
  runGrokInstaller,
  getInstallerStatus,
  checkForUpdate,
  upgrade as upgradeInstaller,
  getChannel,
  setChannel,
  type InstallerChannel,
} from "./agent-installer";
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
  getProvider as getProviderConfig,
  listPresets,
  listProviders,
  upsertProvider,
} from "./model-providers";
import { queryProviderUsage } from "./provider-usage";
import { listWorkspaceDir, readWorkspaceFile } from "./workspace-fs";
import { TerminalHost } from "./terminal-host";
import {
  listTrustedFolders,
  revokeTrustedFolder,
} from "./trusted-folders-store";
import type {
  AccountLoginMethod,
  AskUserQuestionResponse,
  FetchModelsInput,
  FolderTrustOutcome,
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

  // Wayland detection. Three sources, all worth checking:
  //   - WAYLAND_DISPLAY / WAYLAND_SOCKET: a Wayland session is live.
  //   - XDG_SESSION_TYPE: set by login managers (KDE, GNOME) to the
  //     protocol the user logged in with — most reliable on modern
  //     distros, even when WAYLAND_DISPLAY is unset (some setups).
  const envWayland =
    Boolean(
      process.env.WAYLAND_DISPLAY || process.env.WAYLAND_SOCKET,
    ) || process.env.XDG_SESSION_TYPE === "wayland";

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
    // Default to Wayland on Wayland sessions — "auto" sometimes stays
    // on XWayland where fcitx5 Chinese fails without extra GTK
    // plumbing. Going X11 keeps us on XWayland which makes KWin paint
    // a redundant title bar above our custom one, so preferring
    // Wayland when the session is Wayland-based is the right call.
    (envWayland ? "wayland" : "");

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
      (envWayland && ozone !== "x11"));

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
 * Application menu wiring.
 *
 * Why nothing on Win/Linux: Electron publishes its menu through the
 * freedesktop.org D-Bus `com.canonical.AppMenu.Registrar` interface.
 * Compositors that follow the AppMenu spec — KDE Plasma is the most
 * common — then show the menu as the window's own menu bar, completely
 * separate from the renderer's title bar. That's the "two menu rows"
 * bug you saw in the screenshot.
 *
 * Because we paint our own File / Edit / View / Help / Settings row in
 * the renderer, we intentionally leave the platform menu blank on
 * Win/Linux (`Menu.setApplicationMenu(null)`). The standard accelerators
 * (Ctrl/Cmd+N, Ctrl+Comma, F11, Ctrl+Z/Shift+Z, Ctrl+X/C/V/A, Ctrl+R,
 * Ctrl+Shift+I, …) are implemented in the renderer via a `keydown`
 * listener (see App.tsx `useGlobalMenuAccelerators`).
 *
 * macOS still uses a native menu in the system menu bar (the dock
 * convention) — that's where most users expect File / Edit / View to
 * live, and there's no Plasma-style AppMenu to clash with the
 * renderer's title bar.
 */
function setupApplicationMenu(): void {
  if (process.platform !== "darwin") {
    // Detach completely so KDE/GNOME can't re-host the menu and we
    // avoid the two-row chrome bug.
    Menu.setApplicationMenu(null);
    return;
  }

  // Forward small UI commands (settings / new session) to whichever
  // window owns the desktop so its renderer can react. macOS only.
  const openSettings = (): void => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send("ui:openSettings");
        if (!win.isFocused()) win.focus();
      }
    }
  };
  const newSession = (): void => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send("ui:newSession");
        if (!win.isFocused()) win.focus();
      }
    }
  };

  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { role: "appMenu" },
      {
        label: "File",
        submenu: [
          {
            label: "New session",
            accelerator: "CmdOrCtrl+N",
            click: () => newSession(),
          },
          { type: "separator" },
          { role: "quit" },
        ],
      },
      { role: "editMenu" },
      {
        label: "View",
        submenu: [
          { role: "reload" },
          { role: "toggleDevTools" },
          { type: "separator" },
          { role: "resetZoom" },
          { role: "zoomIn" },
          { role: "zoomOut" },
          { type: "separator" },
          { role: "togglefullscreen" },
        ],
      },
      { role: "windowMenu" },
      { type: "separator" },
      {
        label: "Settings",
        accelerator: "CmdOrCtrl+,",
        click: () => openSettings(),
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
  // Go frameless on every desktop. We paint our own slim title bar in
  // the renderer; KWin's redundant client title bar is the actual
  // source of the "two rows" bug, and Electron alone can't suppress
  // it while the window is on Wayland — only Wayland + frame:false
  // makes KWin respect the app's choice.
  // macOS keeps the OS-painted traffic lights via `titleBarStyle` so
  // users still get the standard close/min/max affordances; we hide
  // our own min/max/close controls there.
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 600,
    title: "Grok Build",
    backgroundColor: "#1a1a1a",
    show: false,
    frame: false,
    titleBarStyle:
      process.platform === "darwin" ? "hiddenInset" : "hidden",
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, "../preload/index.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  attachEditContextMenu(mainWindow);

  // Window control IPC — the renderer's custom title bar buttons
  // call these to act on the browser window.
  ipcMain.handle("win:minimize", () => {
    mainWindow?.minimize();
  });
  ipcMain.handle("win:toggleMaximize", () => {
    if (!mainWindow) return;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  });
  ipcMain.handle("win:close", () => {
    mainWindow?.close();
  });
  ipcMain.handle("win:isMaximized", () => Boolean(mainWindow?.isMaximized()));

  // Keep the renderer's title bar in sync with the OS-driven maximize
  // state (e.g. when the user double-clicks the empty drag region).
  mainWindow.on("maximize", () => {
    mainWindow?.webContents.send("win:maximizeChanged", true);
  });
  mainWindow.on("unmaximize", () => {
    mainWindow?.webContents.send("win:maximizeChanged", false);
  });

  // Bridges from the renderer's custom title-bar menu to existing
  // main-side handlers. Most are re-broadcasts onto the window so
  // the single renderer-side listener (e.g. onUiOpenSettings) is the
  // source of truth, but `reload` and `devtools` are webContents-level
  // APIs that only the main process can call.
  ipcMain.handle("ui:requestOpenSettings", () => {
    mainWindow?.webContents.send("ui:openSettings");
  });
  ipcMain.handle("ui:requestNewSession", () => {
    mainWindow?.webContents.send("ui:newSession");
  });
  ipcMain.handle("ui:requestReload", () => {
    if (mainWindow?.webContents.isLoading()) return;
    mainWindow?.webContents.reload();
  });
  ipcMain.handle("ui:requestToggleDevTools", () => {
    mainWindow?.webContents.toggleDevTools();
  });
  ipcMain.handle("ui:requestAbout", () => {
    dialog.showMessageBox(mainWindow as BrowserWindow, {
      type: "info",
      title: "关于 Grok Build",
      message: "Grok Build",
      detail: `Grok Build Desktop\n版本: ${app.getVersion()}\nElectron ${process.versions.electron}`,
    });
  });

  // The custom title bar in the renderer needs the OS platform to
  // decide whether to draw its own min/max/close controls (Linux +
  // Windows) or leave them to the system (macOS traffic lights).
  ipcMain.handle("ui:platform", () => process.platform);

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
    await backend.prepareNewChat();
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
    // The IPC contract mirrors `SessionModeId`; backend just forwards
    // to the agent which validates against `PermissionMode::VALID_VALUES`.
    if (
      modeId !== "default" &&
      modeId !== "acceptEdits" &&
      modeId !== "auto" &&
      modeId !== "dontAsk" &&
      modeId !== "plan"
    ) {
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
    "agent:cancelSession",
    async (_e, sessionId: string) => {
      await backend.cancelSession(sessionId);
    },
  );

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
    "agent:respondTrustPrompt",
    async (_e, requestId: string, outcome: FolderTrustOutcome) => {
      if (typeof requestId !== "string" || !requestId.trim()) {
        throw new Error("requestId is required");
      }
      if (outcome !== "trust" && outcome !== "reject") {
        throw new Error("outcome must be 'trust' | 'reject'");
      }
      backend.respondTrustPrompt(requestId, outcome);
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

  ipcMain.handle(
    "agent:setAutoTrustNewSessions",
    async (_e, enabled: boolean) => {
      if (typeof enabled !== "boolean") {
        throw new Error("enabled must be a boolean");
      }
      await backend.setAutoTrustNewSessions(enabled);
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

  /** User-message image preview for paths under ~/.grok/sessions only. */
  ipcMain.handle(
    "fs:readSessionImageDataUrl",
    async (_e, absPath: string): Promise<string | null> => {
      if (typeof absPath !== "string" || !absPath.trim()) return null;
      const { readFile } = await import("node:fs/promises");
      const { resolve, relative, extname } = await import("node:path");
      const { homedir } = await import("node:os");
      const sessionsRoot = resolve(homedir(), ".grok", "sessions");
      const resolved = resolve(absPath.trim());
      const rel = relative(sessionsRoot, resolved);
      if (!rel || rel.startsWith("..") || rel.includes("\0")) return null;
      try {
        const buf = await readFile(resolved);
        // Cap ~25 MB raw so a single click can't OOM the process.
        if (buf.length > 25 * 1024 * 1024) return null;
        const ext = extname(resolved).toLowerCase();
        const mime =
          ext === ".jpg" || ext === ".jpeg"
            ? "image/jpeg"
            : ext === ".gif"
              ? "image/gif"
              : ext === ".webp"
                ? "image/webp"
                : "image/png";
        return `data:${mime};base64,${buf.toString("base64")}`;
      } catch {
        return null;
      }
    },
  );

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

  // ── Folder trust store (~/.grok/trusted_folders.toml) ──────────

  ipcMain.handle("trust:list", async () => {
    return listTrustedFolders();
  });
  ipcMain.handle(
    "trust:revoke",
    async (_e, path: string) => {
      if (typeof path !== "string" || !path.trim()) {
        throw new Error("path is required");
      }
      return revokeTrustedFolder(path.trim());
    },
  );

  // ── Custom model providers ──────────────────────────────────────

  ipcMain.handle("models:listPresets", () => listPresets());
  ipcMain.handle("models:listProviders", async () => listProviders());
  ipcMain.handle(
    "models:upsertProvider",
    async (_e, input: UpsertProviderInput) => {
      if (!input || typeof input !== "object") {
        throw new Error("provider input is required");
      }
      const result = await upsertProvider(input);
      // Sync config.toml → agent catalog so composer model chip updates.
      void backend.reloadModelsFromConfig();
      return result;
    },
  );
  ipcMain.handle("models:deleteProvider", async (_e, id: string) => {
    if (typeof id !== "string" || !id.trim()) {
      throw new Error("provider id is required");
    }
    await deleteProvider(id.trim());
    void backend.reloadModelsFromConfig();
  });
  ipcMain.handle(
    "models:addFromPreset",
    async (_e, presetId: string, overrides?: Partial<UpsertProviderInput>) => {
      if (typeof presetId !== "string" || !presetId.trim()) {
        throw new Error("presetId is required");
      }
      const result = await addFromPreset(presetId.trim(), overrides);
      void backend.reloadModelsFromConfig();
      return result;
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
  /** Force agent to re-read config.toml [model.*] (composer refresh). */
  ipcMain.handle("models:reloadAgentModels", async () => {
    await backend.reloadModelsFromConfig();
  });
  /** Query coding-plan usage for a configured provider (currently MiniMax). */
  ipcMain.handle(
    "models:queryProviderUsage",
    async (_e, providerId: string) => {
      if (typeof providerId !== "string" || !providerId.trim()) {
        throw new Error("providerId is required");
      }
      const provider = await getProviderConfig(providerId.trim());
      if (!provider) {
        throw new Error(`Provider not found: ${providerId}`);
      }
      return queryProviderUsage({
        presetId: provider.presetId,
        baseUrl: provider.baseUrl,
        apiKey: provider.apiKey,
        envKey: provider.envKey,
      });
    },
  );

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

  /**
   * Drive the official `grok` CLI installer from inside the desktop app.
   * Called by the renderer when the connection-error card's "Install" button
   * is pressed. Returns the installer's combined stdout/stderr so the UI can
   * show progress / final status without spawning a terminal.
   */
  ipcMain.handle("agent:install", async () => {
    return runGrokInstaller();
  });

  ipcMain.handle("agent:installerStatus", async () => {
    return getInstallerStatus();
  });

  ipcMain.handle("agent:checkForUpdate", async () => {
    return checkForUpdate();
  });

  ipcMain.handle("agent:upgrade", async () => {
    return upgradeInstaller();
  });

  ipcMain.handle("agent:getChannel", async () => {
    return getChannel();
  });

  ipcMain.handle(
    "agent:setChannel",
    async (_e, channel: InstallerChannel) => {
      if (channel !== "stable" && channel !== "alpha" && channel !== "enterprise") {
        throw new Error(`Invalid channel: ${channel}`);
      }
      await setChannel(channel);
      return getChannel();
    },
  );

  // ── "Open in editor…" support ──────────────────────────────────────
  // Phase 1: static known-editor catalogue (no PATH probing yet). The
  // renderer just calls openInEditor with the id and we spawn the
  // launcher detached. `system-default` defers to Electron's shell helper
  // (which uses the OS-registered file association).
  ipcMain.handle("files:listExternalEditors", async () => {
    return [
      { id: "vscode", label: "VS Code", available: true },
      { id: "vscode-insiders", label: "VS Code Insiders", available: true },
      { id: "cursor", label: "Cursor", available: true },
      { id: "sublime", label: "Sublime Text", available: true },
      { id: "zed", label: "Zed", available: true },
      { id: "webstorm", label: "WebStorm", available: true },
      { id: "system-default", label: "System default", available: true },
    ];
  });

  ipcMain.handle(
    "files:openInEditor",
    async (_e, editorId: string, filePath: string) => {
      if (!filePath || typeof filePath !== "string") {
        throw new Error("filePath is required");
      }
      if (editorId === "system-default") {
        const result = await shell.openPath(filePath);
        if (result) throw new Error(result); // shell.openPath returns error string on failure
        return;
      }
      const cmds: Record<string, string[]> = {
        vscode: ["code", "--reuse-window", filePath],
        "vscode-insiders": ["code-insiders", "--reuse-window", filePath],
        cursor: ["cursor", filePath],
        sublime: ["subl", filePath],
        zed: ["zed", filePath],
        webstorm: ["webstorm", filePath],
      };
      const args = cmds[editorId];
      if (!args) throw new Error(`Unknown editor: ${editorId}`);
      const child = spawn(args[0], args.slice(1), {
        detached: true,
        stdio: "ignore",
        shell: false,
      });
      child.on("error", (err) => {
        console.warn(
          `[files:openInEditor] spawn ${args[0]} failed:`,
          err.message,
        );
      });
      child.unref();
    },
  );
}

app.whenReady().then(() => {
  setupApplicationMenu();
  registerIpc();
  createWindow();
  // Installer lifecycle — runs once on boot. Refreshes channel,
  // snapshots installer status, and kicks off a background update probe
  // so the next render has fresh "update available" data.
  void backend.initInstaller();
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
