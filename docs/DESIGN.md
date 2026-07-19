# grok-build-desktop — Design Document

**Status:** Living design for MVP → Alpha  
**Sibling of:** `/home/falser/Projects/grok-build` (Rust Grok Build CLI/TUI)  
**Shell:** Electron  
**Backend strategy:** Path B — new Web frontend, reuse existing Rust agent (no agent rewrite)  
**Capability checklist:** [`FEATURES.md`](./FEATURES.md)

---

## 1. Goals

Ship a desktop app that ordinary (non-terminal) users can use like Claude Desktop / Codex Desktop:

- Chat with Grok coding agent in a windowed UI
- Stream assistant text, tool calls, and file diffs
- Approve/deny sensitive tool actions
- Create and resume local sessions
- Share auth and session store with the CLI (`~/.grok`)

### Non-goals (v1 / MVP)

- Rewriting the agent runtime in TypeScript
- Embedding the TUI (ratatui) inside Electron
- ~~Full MCP / plugins / skills management UI~~ (shipped: Extensions page + sidebar)
- Remote multi-machine agent hosting
- Sharing a live `leader` process with an open TUI (later)

---

## 2. Architecture

```
┌──────────────────────────────────────────────────────────────┐
│ Electron Main (Node)                                         │
│  • Resolve grok binary (bundled | GROK_BINARY | PATH)         │
│  • Spawn: grok agent serve --bind 127.0.0.1:<port> --secret  │
│  • Own ACP WebSocket client + reverse-request handlers       │
│  • Map wire events → typed app events                        │
│  • App menu: hide stock File/Edit/… on Win/Linux             │
│  • Lifecycle: start / reconnect / kill on quit               │
└────────────────────────────┬─────────────────────────────────┘
                             │ contextBridge IPC (whitelist)
┌────────────────────────────▼─────────────────────────────────┐
│ Renderer (React + Vite)                                      │
│  • Timeline: user / thought / assistant / tools / diffs      │
│  • Composer, status bar, workspace picker                    │
│  • Permission modal (post-MVP hardening)                     │
└──────────────────────────────────────────────────────────────┘
                             │
                             │ ACP JSON-RPC over WebSocket
                             ▼
┌──────────────────────────────────────────────────────────────┐
│ grok agent serve  (Rust, xai-grok-pager / xai-grok-shell)    │
│  ws://127.0.0.1:<port>/ws?server-key=<secret>                │
│  MvpAgent: tools, sessions, auth, inference                  │
└──────────────────────────────────────────────────────────────┘
```

### Why `agent serve` (not leader IPC)

| Option | Pros | Cons |
|--------|------|------|
| **`grok agent serve` (chosen)** | First-class WS; same wire on all OS; Electron-native | Extra local port (loopback only) |
| Leader Unix socket / named pipe | Same path as TUI multi-client | Node framing + Windows pipes; higher complexity |
| `agent stdio` child | Simple pipes | Harder multi-window / reconnect story |

**Decision:** MVP and Alpha use **loopback `agent serve`**. Leader multi-client is a later optional mode.

### Window chrome & application menu

Electron ships a **default application menu** (`File` / `Edit` / `View` / `Window` / `Help`) when the main process never calls `Menu.setApplicationMenu`. On **Linux** (and often Windows) that menu is drawn as a **native light-themed bar** above the dark React UI — it looks “stuck white” and is unrelated to the app theme tokens in `styles.css`.

**Important:** On Win/Linux, `Menu.setApplicationMenu(null)` also removes **Edit role accelerators** (`Ctrl+C/V/X/A`, Undo…). Selection copy/paste then fails. Keep a minimal **Edit** menu for roles; hide the strip with `autoHideMenuBar` (Alt reveals it briefly). Also attach a `webContents` **context-menu** with Copy/Paste when there is a selection or an editable field.

| Platform | Behavior |
|----------|----------|
| **Linux / Windows** | Minimal `Edit` menu (undo/redo/cut/copy/paste/selectAll) + `autoHideMenuBar: true` + selection/editable right-click Edit menu |
| **macOS** | Minimal menu: `appMenu` + `editMenu` + `windowMenu` (system expects an app menu) + same right-click Edit menu |

Window `backgroundColor` is `#1a1a1a` so the frame flash before first paint matches dark theme. In-app theme (dark/light/system) only styles the **renderer**; the OS title bar still follows the desktop environment unless we later adopt `titleBarOverlay` / frameless chrome.

---

## 3. Security model

1. Bind **only** `127.0.0.1` (never `0.0.0.0` in product defaults).
2. Generate a **random secret per process**; pass via `--secret`. Do not put the secret in renderer code or logs beyond main debug.
3. Renderer: `nodeIntegration: false`, `contextIsolation: true`, preload whitelist only.
4. Auth tokens stay in **`~/.grok`** (CLI-compatible). Desktop does not invent a second credential store in MVP.
5. Kill the serve child when the app quits or crashes (best-effort process-group cleanup).
6. Optional later: OS keychain for secret ephemeral storage; code signing / notarization.

---

## 4. Protocol contract (ACP + xAI)

Wire format: **JSON-RPC 2.0 text frames** on WebSocket.

Auth for WS: `Authorization: Bearer <secret>` **or** query `?server-key=<secret>` (serve supports both).

### 4.1 Startup sequence

```
Client                          Agent (serve)
  |  WS connect + secret           |
  |------------------------------->|
  |  initialize                    |
  |------------------------------->|
  |  result: authMethods, caps     |
  |<-------------------------------|
  |  authenticate { methodId }     |
  |------------------------------->|
  |  result: account meta          |
  |<-------------------------------|
  |  session/new { cwd, mcpServers }|
  |------------------------------->|
  |  result: sessionId, models     |
  |<-------------------------------|
  |  session/prompt { sessionId, prompt[] }|
  |------------------------------->|
  |  session/update* (stream)      |
  |<-------------------------------|
  |  session/prompt result         |
  |<-------------------------------|
```

Verified against `grok` **v0.2.101** on Linux (2026-07-16):

- `initialize` → `protocolVersion: 1`, `defaultAuthMethodId: cached_token`
- `authenticate` with `cached_token` when `~/.grok/auth.json` exists
- `session/new` returns `sessionId` + model list
- Stream uses `session/update` with `sessionUpdate` discriminators

### 4.2 Methods (MVP surface)

| Direction | Method | MVP |
|-----------|--------|-----|
| → Agent | `initialize` | Required |
| → Agent | `authenticate` | Required (prefer `cached_token`) |
| → Agent | `session/new` | Required |
| → Agent | `session/prompt` | Required |
| → Agent | `session/cancel` | Required |
| → Agent | `session/load` | Alpha (not MVP) |
| ← Agent | `session/update` | Required (stream) |
| ← Agent | `session/request_permission` | MVP: auto-allow + log; Alpha: modal |
| → Agent | `ext_method` (`x.ai/session/search`, …) | Alpha |

### 4.3 `session/update` discriminators (observed / expected)

| `sessionUpdate` | UI handling |
|-----------------|-------------|
| `agent_message_chunk` | Append to assistant bubble (`content.text`) |
| `agent_thought_chunk` | Collapsible “thinking” block |
| `user_message_chunk` | Echo / confirm user message |
| `tool_call` | Insert/update tool card |
| `tool_call_update` | Merge status, content, diffs |
| `available_commands_update` | Status/debug only in MVP |
| others | Ignore or log |

### 4.4 Prompt payload

```json
{
  "sessionId": "<uuid>",
  "prompt": [{ "type": "text", "text": "hello" }]
}
```

Images: ACP `ImageContent` when agent `promptCapabilities.image` is true (currently false on tested binary — text only in MVP).

### 4.5 Client capabilities (MVP)

```json
{
  "fs": { "readTextFile": false, "writeTextFile": false },
  "terminal": false
}
```

Agent performs FS/shell locally. Desktop does not implement ACP terminal reverse channel in MVP.

---

## 5. Process model

### Spawn

```bash
grok agent serve \
  --bind 127.0.0.1:<ephemeral-port> \
  --secret <random> \
  [--debug-file <log>]
```

Environment overrides:

| Env | Meaning |
|-----|---------|
| `GROK_BINARY` | Absolute path to `grok` / `xai-grok-pager` |
| `PATH` | Fallback search for `grok` |
| (bundled) | `process.resourcesPath/bin/grok` in packaged builds |

### Port selection

Pick a free TCP port on loopback (default range starting at 19200+random) to avoid clashing with a user-run `127.0.0.1:2419`.

### Readiness

1. Spawn process  
2. Poll TCP connect or wait until stderr contains `WebSocket URL:`  
3. Open WS  
4. Run initialize → authenticate → ready

### Shutdown

- Window `before-quit` → close WS → `SIGTERM` child → timeout → `SIGKILL`
- Windows: use `taskkill /T` or tree-kill if needed

---

## 6. Repository layout

Target monorepo (full Alpha):

```text
grok-build-desktop/
  docs/DESIGN.md              # this file
  apps/desktop/               # Electron main + renderer package
  packages/acp-client/        # pure TS ACP client
  packages/protocol/          # shared types
  packages/ui/                # design system components
```

**MVP layout (current):** single Electron-Vite package for speed:

```text
grok-build-desktop/
  docs/DESIGN.md
  package.json
  electron.vite.config.ts
  src/main/                   # process spawn + ACP + IPC
  src/preload/
  src/renderer/               # React UI
  src/shared/                 # types + ACP client used by main
  resources/
  README.md
```

Split into `packages/*` when a second consumer appears.

---

## 7. Product slices

> **Living capability checklist:** [`FEATURES.md`](./FEATURES.md)  
> (status legend: ✅ done · 🟡 partial · ⬜ not started)

### MVP (this iteration) — “最小可用”

- [x] Design doc
- [x] Electron window + dark chat shell
- [x] Spawn `agent serve` + ACP handshake
- [x] Pick workspace (folder dialog) → `session/new`
- [x] Send text prompt → stream thought + assistant text
- [x] Show basic tool cards (title/status)
- [x] Cancel in-flight prompt
- [x] Status line: connected / model / session id short
- [x] README: how to run with local `grok`
- [x] Permission panel (queue + keyboard) — superseded auto-allow-only MVP
- [x] Always-approve / YOLO (chip, settings, slash, `config.toml`, agent notify)

### Alpha (in progress / next)

- [x] Permission modal (Allow / Deny / options from agent)
- [x] Session list via `x.ai/session/search` + load / fork / rename / delete
- [x] Per-project new session control
- [x] Model / mode / effort pickers + context token usage
- [x] Custom multi-provider models UI (presets, fetch `/models`, config.toml sync, composer grouped by provider)
- [x] Attachments, `@` path suggest, paste image, slash autocomplete
- [x] Diff viewer for `ToolCallContent` diffs
- [x] Expandable tool output details
- [x] Suppress default Electron menu bar on Win/Linux (dark UI)
- [x] Workspace file tree + read-only preview with syntax highlight
- [ ] Bundled binary per platform + electron-builder packaging
- [ ] Login UX when no `cached_token` (`grok.com` method / open browser)
- [ ] Three-platform CI packages

### Later

- [x] MCP / settings UI
- [x] Skills / plugins / hooks management UI
- [x] Embedded terminal (right panel, xterm + PTY)
- [x] Folder trust gate (`x.ai/folder_trust/request` + interactive prompt + 30 min fail-closed + YOLO auto-grant)
- [x] Trusted folders panel (Settings → 扩展 → Trusted folders; list + revoke; 直接读写 `~/.grok/trusted_folders.toml`，与 agent 共享单一权威文件)
- [x] Auto-trust new sessions (Settings → Permissions；持久化 `[ui].auto_trust_new_sessions`)
- [ ] Optional leader-socket multi-client mode
- [ ] Auto-update of app + binary
- [x] Message queue while busy (Enter queue / Ctrl+Enter send-now / auto-drain)
- [x] Prompt history (↑ browse / `/history` + Ctrl+R search via `x.ai/prompt_history`)
- [x] Copy / export conversation as Markdown
- [x] Plan/TODO panel (todos + plan.md + exit_plan_mode approval)
- [ ] Full command palette + global shortcut system

---

## 8. Renderer state model

```ts
type ConnectionState =
  | "starting"
  | "connecting"
  | "ready"
  | "error"
  | "stopped";

type TimelineItem =
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
      diffs?: Array<{ path: string; oldText?: string; newText: string }>;
      outputText?: string;
      outputTruncated?: boolean;
    }
  | { id: string; kind: "system"; text: string };

interface AppState {
  connection: ConnectionState;
  error?: string;
  workspace?: string;
  sessionId?: string;
  modelId?: string;
  agentVersion?: string;
  accountEmail?: string;
  timeline: TimelineItem[];
  busy: boolean;
}
```

Main process is source of truth for wire; renderer receives **already reduced** events via IPC (`agent:event`).

---

## 9. IPC API (preload)

```ts
interface DesktopApi {
  getState(): Promise<AppSnapshot>;
  start(workspace: string): Promise<void>;
  stop(): Promise<void>;
  pickFolder(): Promise<string | null>;
  sendPrompt(text: string): Promise<void>;
  cancel(): Promise<void>;
  /** Workspace-scoped FS (path must resolve under active workspace). */
  listDir(relDir?: string): Promise<FileEntry[]>;
  readFile(relPath: string): Promise<FileReadResult>;
  onEvent(cb: (event: AgentUiEvent) => void): () => void;
}
```

File preview is **read-only** in the desktop shell (no write-back). Paths are constrained to the session workspace root to avoid arbitrary FS access from the renderer.

No raw WebSocket, no secret, no child stdin exposed to renderer.

---

## 10. Packaging (Alpha+)

| Platform   | Artifact                                                       |
|------------|-----------------------------------------------------------------|
| macOS      | `.dmg` + `.zip` (arm64 + x64)                                   |
| Windows    | NSIS installer + portable `.exe` (x64 + arm64)                  |
| Linux      | AppImage + `.deb` (Debian/Ubuntu) + `.rpm` (Fedora/RHEL/openSUSE) — both x64 and arm64 |

Build scripts:

```bash
pnpm dist:mac          # dmg + zip
pnpm dist:linux        # AppImage + deb + rpm
pnpm dist:win          # NSIS + portable
```

All three scripts first run `pnpm build` (electron-vite production build) and
then invoke `electron-builder` with the right `--mac` / `--linux` / `--win`
flag. Per-target scripts (`dist:linux:deb`, `dist:win:portable`, etc.) build
a single artifact type.

`electron-builder.yml` references:

- Linux icons + `.desktop` entry → `resources/icon.png`
- macOS icon + entitlements → `resources/icon.icns`, `resources/macos/entitlements.plist`
- Windows icon → `resources/icon.ico`
- Linux post-install hooks → `resources/scripts/after-install.sh`, `before-remove.sh`

Bundle `resources/bin/grok` matching the platform. Pin Desktop app version to a known good `grok` version.

---

## 11. Risks & mitigations

| Risk | Mitigation |
|------|------------|
| Protocol drift with `grok` upgrades | Pin tested version; smoke test initialize/prompt in CI |
| Auth missing | Clear error + instructions to run `grok login` |
| Port conflict | Ephemeral free port |
| Zombie serve processes | Process group kill + quit hooks |
| Large tool output | Truncate in UI; agent already caps tool output |
| Permission options IDs | Log full request; map known options in Alpha modal |

---

## 12. Success criteria

### MVP

1. Developer machine with `grok` on PATH and valid `~/.grok` login opens the app.
2. User selects a folder, sends a message, sees streaming reply.
3. Tools (if triggered) appear as cards; run completes without hanging on permission.
4. Quit leaves no `grok agent serve` child.

### Alpha

1. Installable build works without global `grok` (bundled).
2. Permission modal + diffs + session resume.
3. macOS / Windows / Linux smoke.

---

## 13. Open questions

1. Should Desktop force `always-approve` via session meta for power users, or always show modals?  
   → Alpha: modal default; optional toggle.
2. One window ↔ one serve process, or multi-window sharing one serve?  
   → MVP/Alpha: **one process per app instance**.
3. Product branding / store distribution — deferred.

---

## 14. References (in grok-build)

- `crates/codegen/xai-grok-shell/src/agent/server.rs` — WebSocket serve
- `crates/codegen/xai-grok-pager/src/app/cli.rs` — `ServeArgs` (`--bind`, `--secret`)
- `crates/codegen/xai-acp-lib/` — ACP gateway
- ACP crate: `agent-client-protocol` **0.10.4**
- CLI binary name: `grok` (build artifact `xai-grok-pager`)
