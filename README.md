# Grok Build Desktop

> English | [简体中文](./README.zh-CN.md)

**Electron desktop client for [Grok Build](https://x.ai/cli)** — a Claude Desktop–style shell over the same Rust agent your CLI uses.

```text
Electron UI  →  ACP / JSON-RPC  →  grok agent serve  (loopback WebSocket)
```

Sessions, auth, and config live under `~/.grok` and stay compatible with the Grok CLI / TUI.

| Doc | Link |
|-----|------|
| Design | [`docs/DESIGN.md`](./docs/DESIGN.md) |
| Feature checklist (✅ / 🟡 / ⬜) | [`docs/FEATURES.md`](./docs/FEATURES.md) |
| Screenshot assets | [`docs/screenshots/`](./docs/screenshots/) |

---

## Screenshots

> Replace files under `docs/screenshots/` (see [screenshot guide](./docs/screenshots/README.md)). Links below are ready once you drop in the PNGs.

### Main window — chat & layout

Claude-style sidebar, streaming timeline, model/mode chips, and composer.

<!-- SCREENSHOT: 01-main-chat.png -->
![Main chat window](./docs/screenshots/01-main-chat.png)

*Placeholder — capture: full app window with an active conversation (dark theme recommended).*

### Multi-session concurrency & run status

Switch sessions without cancelling other turns. Running sessions show a **spinner** in the sidebar; loading and permission-wait states use distinct indicators.

<!-- SCREENSHOT: 02-sessions-running.png -->
![Session list with running status](./docs/screenshots/02-sessions-running.png)

*Placeholder — capture: two projects; one session with loading spinner, another idle.*

### Workspace file tree & preview

Browse the project, open files with line numbers and syntax highlighting; Markdown can toggle rendered vs source.

<!-- SCREENSHOT: 03-file-tree.png -->
![File tree and preview](./docs/screenshots/03-file-tree.png)

*Placeholder — capture: Files panel open + code preview side-by-side with chat.*

### Tool cards & diff viewer

Tool calls stream as cards; expand for output and multi-file line-level diffs.

<!-- SCREENSHOT: 04-tool-diff.png -->
![Tool cards and diff](./docs/screenshots/04-tool-diff.png)

*Placeholder — capture: expanded tool card with `+/-` diff gutter.*

### Permission confirmation

Approve or deny sensitive actions; queue shows how many requests are waiting. **Always-approve (YOLO)** skips prompts when enabled.

<!-- SCREENSHOT: 05-permission.png -->
![Permission panel](./docs/screenshots/05-permission.png)

*Placeholder — capture: permission panel above the composer with options list.*

### Settings — language, theme, permissions

English / 中文 / system language; dark / light / system theme; YOLO synced with `~/.grok/config.toml`.

<!-- SCREENSHOT: 06-settings.png -->
![Settings](./docs/screenshots/06-settings.png)

*Placeholder — capture: Settings page with language + theme + permissions blocks.*

### Extensions — MCP, Skills, Plugins, Hooks

Manage MCP servers, skills, plugins, and hooks from the sidebar Extensions view.

<!-- SCREENSHOT: 07-extensions.png -->
![Extensions](./docs/screenshots/07-extensions.png)

*Placeholder — capture: Extensions tab with MCP list and a skill row.*

### Account & usage

In-app login (OAuth / device code), logout, API key, and billing/usage (same source as CLI `/usage`).

<!-- SCREENSHOT: 08-account-usage.png -->
![Account and usage](./docs/screenshots/08-account-usage.png)

*Placeholder — capture: account menu or settings account section with usage meters.*

---

## Highlights

| Area | What you get |
|------|----------------|
| **Agent** | Spawns `grok agent serve` on `127.0.0.1` with a per-process secret |
| **Chat** | Streaming assistant text, collapsible thoughts, Markdown (GFM) |
| **Sessions** | New / load / rename / delete / fork / search; group by project; **concurrent turns** |
| **Sidebar status** | Running (spinner), loading, needs permission |
| **Tools** | Tool cards, expandable output, line-level diff viewer |
| **Workspace** | File tree, syntax-highlighted preview, `@` path insert |
| **Input** | Attachments, drag-and-drop, paste images, slash commands |
| **Models** | Model / Agent·Plan·Ask mode / reasoning effort / token usage |
| **Permissions** | Confirm panel + queue + Always-approve (YOLO) |
| **Account** | Login, logout, API key, subscription/credit usage |
| **Extensions** | MCP servers, Skills, Plugins, Hooks |
| **Prefs** | Language (en / zh / system), theme (dark / light / system) |

Full inventory: [`docs/FEATURES.md`](./docs/FEATURES.md).

### Not in this client yet

- Attach to an external live TUI / leader-socket session  
- Bundled installers with embedded `grok` binary  
- Auto-update, code signing  
- Embedded terminal, full command palette (`Ctrl+K`), Plan/TODO panel  

---

## Architecture

```text
┌─────────────────────────────────────────────────────────────┐
│  Electron Main                                              │
│  · Resolve grok binary · Spawn agent serve · ACP client     │
│  · IPC whitelist · Kill child on quit                       │
└────────────────────────────┬────────────────────────────────┘
                             │ contextBridge (preload)
┌────────────────────────────▼────────────────────────────────┐
│  Renderer (React + Vite)                                    │
│  · Sessions · Timeline · Composer · Files · Settings · Ext  │
└────────────────────────────┬────────────────────────────────┘
                             │ WebSocket + JSON-RPC (ACP)
                             ▼
                    grok agent serve
                    127.0.0.1 only + random secret
```

Desktop does **not** rewrite the agent: one local serve process, multiple sessions can prompt concurrently; switching focus parks UI state without cancelling background turns.

---

## Requirements

- **Node.js 20+**
- Working **Grok CLI** (`grok`) and login (`grok login`)
- Binary resolution order:
  1. `GROK_BINARY` environment variable  
  2. `~/.grok/bin/grok`  
  3. Packaged `resources/bin/grok` (reserved, not shipped yet)  
  4. `grok` on `PATH`  

---

## Develop

```bash
cd ~/Projects/grok-build-desktop
pnpm install    # or: npm install
pnpm dev        # or: npm run dev
```

1. **Open workspace** and choose a project folder.  
2. Wait until status is **Ready**.  
3. Send a message — or resume a session from the sidebar.

### Useful scripts

| Command | Description |
|---------|-------------|
| `pnpm dev` | Electron + Vite HMR |
| `pnpm dev:wayland` | Dev with Wayland + IME hints (Linux) |
| `pnpm dev:x11` | Dev forced to X11 (Linux) |
| `pnpm build` | Production main / preload / renderer |
| `pnpm typecheck` | TypeScript (`node` + `web`) |

### Packaging (skeleton)

[`electron-builder.yml`](./electron-builder.yml) defines AppImage / DMG / NSIS targets. Full release CI and bundled binary are still TODO.

---

## Safety

- Agent binds **127.0.0.1** only, with a random per-process secret.  
- Renderer: no Node integration; **contextIsolation** + fixed IPC whitelist.  
- Closing the app stops the child `grok agent serve` process.  
- Auth stays in CLI-compatible `~/.grok` (desktop API key file uses mode `0600`).

---

## Project layout

```text
grok-build-desktop/
├── docs/
│   ├── DESIGN.md
│   ├── FEATURES.md
│   └── screenshots/          ← drop PNGs here
├── src/
│   ├── main/                 ← Electron main, agent, FS, account
│   ├── preload/
│   ├── renderer/             ← React UI
│   └── shared/               ← ACP client + types
├── scripts/
├── package.json
├── README.md                 ← this file (English)
└── README.zh-CN.md           ← 简体中文
```

---

## Contributing notes

- Keep [`docs/FEATURES.md`](./docs/FEATURES.md) in sync when you ship or drop a capability.  
- Architecture and protocol details live in [`docs/DESIGN.md`](./docs/DESIGN.md).  
- Prefer small, focused PRs; match existing TypeScript / React style.

---

## License / product

Private MVP shell around the Grok Build agent. Product name and branding follow xAI / Grok Build. See your org’s license for distribution rules.
