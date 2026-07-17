# Grok Build Desktop (MVP)

Electron desktop shell for [Grok Build](https://x.ai/cli). Talks to the existing Rust agent via:

```text
Electron UI  →  ACP/JSON-RPC  →  `grok agent serve` (loopback WebSocket)
```

Docs:

- Design: [`docs/DESIGN.md`](./docs/DESIGN.md)
- Feature status (✅ / 🟡 / ⬜): [`docs/FEATURES.md`](./docs/FEATURES.md)

## Requirements

- Node.js 20+
- A working Grok CLI install (`grok`) and login (`grok login`)
- Binary resolution order:
  1. `GROK_BINARY` env
  2. `~/.grok/bin/grok`
  3. packaged `resources/bin/grok` (later)
  4. `grok` on `PATH`

## Develop

```bash
cd ~/Projects/grok-build-desktop
pnpm install   # or: npm install
pnpm dev       # or: npm run dev
```

1. Click **Open workspace** and pick a folder.
2. Wait until status is **Ready**.
3. Send a message.

## Feature scope (summary)

| Done | Not yet |
|------|---------|
| Layout, agent serve, streaming chat | Auto-update, embedded terminal |
| Sessions: load / rename / delete / search / fork | Bundled `grok` binary installers |
| New session per project (＋ on project row) | Full command palette (`Ctrl+K`) |
| Model / mode / effort / token usage | Auto-update, embedded terminal |
| Attach / drag-drop files, `@` paths, paste image | Code signing / notarization |
| Permission panel + always-approve (YOLO) | Multi-window / live CLI attach |
| Slash commands (local + ACP passthrough) | Plan/TODO panel, copy/export |
| Tool cards + diff viewer + expandable output | In-app file edit / full IDE |
| Workspace file tree + syntax-highlighted preview | Frameless / custom title bar |
| MCP + Skills / Plugins / Hooks management UI | |
| Settings: language, theme, permissions | |
| No stock File/Edit/… menu bar (Win/Linux) | |

Full inventory: [`docs/FEATURES.md`](./docs/FEATURES.md).

### Why was there a white File / Edit / View bar?

Electron’s **default application menu**. It is drawn by the OS (often light GTK/Win chrome), not by the React theme. Desktop now clears that menu on Linux/Windows; restart `pnpm dev` after pull to pick up the main-process change.

## Scripts

| Command | Description |
|---------|-------------|
| `pnpm dev` | Electron + Vite HMR |
| `pnpm build` | Production main/preload/renderer |
| `pnpm typecheck` | TypeScript check |

## Safety

- Agent binds **127.0.0.1** only with a random per-process secret.
- Renderer has no Node integration; IPC is a fixed whitelist.
- Closing the app stops the child `grok agent serve` process.
