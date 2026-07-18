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

---

## Screenshot

<!-- Replace this file to update the hero image. -->
![Grok Build Desktop](./docs/screenshots/screenshot.png)

*Full app window: session sidebar, chat timeline, optional file preview column, and composer.*

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
| **Input** | Attachments, drag-and-drop, paste images, slash commands; **queue while busy**; **prompt history** (↑ / `/history` / Ctrl+R) |
| **Models** | Model / Agent·Plan·Ask mode / reasoning effort / token usage |
| **Plan / TODO** | Todo list + plan.md panel; plan-mode exit approval; `/view-plan` · Ctrl+Shift+P |
| **Permissions** | Confirm panel + queue + Always-approve (YOLO) |
| **Account** | Login, logout, API key, subscription/credit usage |
| **Extensions** | MCP servers, Skills, Plugins, Hooks |
| **Prefs** | Language (en / zh / system), theme (dark / light / system) |

Full inventory: [`docs/FEATURES.md`](./docs/FEATURES.md).

### Not in this client yet

- Attach to an external live TUI / leader-socket session  
- Bundled installers with embedded `grok` binary  
- Auto-update, code signing  
- Full command palette (`Ctrl+K`), `/rewind`
 

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

### Packaging

[`electron-builder.yml`](./electron-builder.yml) defines the full set of release targets.
A Vite production build runs first, then `electron-builder` produces per-platform
artifacts under `dist/`.

| Script | Output |
|--------|--------|
| `pnpm dist:linux`            | AppImage + `.deb` + `.rpm` for x64 and arm64 |
| `pnpm dist:linux:deb`        | only `.deb` |
| `pnpm dist:linux:rpm`        | only `.rpm` |
| `pnpm dist:linux:appimage`   | only AppImage |
| `pnpm dist:mac`              | `.dmg` + `.zip` for arm64 and x64 |
| `pnpm dist:mac:dmg`          | only `.dmg` |
| `pnpm dist:mac:zip`          | only `.zip` |
| `pnpm dist:win`              | NSIS installer + portable `.exe` for x64 and arm64 |
| `pnpm dist:win:nsis`         | only NSIS installer |
| `pnpm dist:win:portable`     | only portable `.exe` |
| `pnpm dist:all`              | everything above (run on each host OS) |
| `pnpm dist:dir`              | unpacked app directory (no installer) |

Artifacts are named `Grok Build Desktop-0.1.0-<arch>.<ext>` and land in
`dist/` (or `dist_<arch>/` if you set `CSC_IDENTITY_AUTO_DISCOVERY=false`).

#### Notes

- **Linux** — `.deb` targets Debian / Ubuntu, `.rpm` targets Fedora / RHEL /
  openSUSE. Post-install hooks (`resources/scripts/`) refresh the desktop /
  MIME / icon caches so the launcher appears immediately.
- **macOS** — Builds run only on macOS. Replace `resources/icon.icns` with
  your artwork; entitlements live in `resources/macos/entitlements.plist`.
  Signing and notarization are still TODO.
- **Windows** — Builds run only on Windows (or under Wine). Replace
  `resources/icon.ico` with multi-resolution artwork. NSIS gives a normal
  installer; the portable target produces a self-extracting `.exe` that runs
  without installation.

Full release CI and the bundled `grok` binary are still TODO.

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
│   └── screenshots/          ← screenshot.png
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
