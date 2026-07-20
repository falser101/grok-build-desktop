import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import type { Messages } from "./i18n";

/**
 * VS Code-style interactive terminal with multiple tabs.
 *
 * Tab model:
 *   - tabs[]: array of Tab objects (id = local React key, termId = backend PTY id).
 *   - activeId: which tab is rendered.
 *   - "+" button spawns a new PTY + tab.
 *   - "×" on each tab closes that PTY and removes it.
 *
 * The backend already supports multiple terminals (termStart returns a new
 * id per call; events are keyed by id), so this is purely a renderer
 * refactor. Inactive tabs are unmounted (xterm is cheap to recreate on
 * switch) but their PTY processes keep running.
 */

interface Tab {
  /** React-side local key (also used to identify Tab records internally). */
  id: string;
  /** Backend PTY id. null while the shell is starting. */
  termId: string | null;
  /** Shell basename (e.g. "bash", "zsh") shown in the tab label. */
  shell: string;
  /** Last working directory for label. */
  cwd: string;
  /** True while termStart is in flight. */
  busy: boolean;
  /** Last error message for this tab. */
  error: string | null;
  /** True after the shell exits (until user closes the tab). */
  exited: boolean;
}

const newTabId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

const shellBasename = (s: string) => s.split(/[/\\]/).pop() || s;

export function TerminalPanel({
  workspace,
  active,
  m,
  onLastTabClosed,
  onOpenFile,
}: {
  workspace: string | undefined;
  /** When false, keep PTYs alive but don't auto-focus / thrash resize. */
  active: boolean;
  m: Messages;
  /**
   * Fired when the user closes the last remaining terminal tab. Lets the
   * host switch the right panel back to its entry menu.
   */
  onLastTabClosed?: () => void;
  /**
   * Fired when the user picks "Open file" from the "+" dropdown. The host
   * navigates the right panel to the file picker.
   */
  onOpenFile?: () => void;
}) {
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [plusMenuOpen, setPlusMenuOpen] = useState(false);
  const plusMenuRef = useRef<HTMLDivElement | null>(null);
  /**
   * True after the user has explicitly closed the last tab. Suppresses the
   * "auto-spawn when empty" behavior so we don't fight the user's choice;
   * reset whenever the user opens a new tab via "+".
   */
  const userClosedAllRef = useRef(false);
  /**
   * True while the initial mount-time spawn is in flight (between effect
   * fire and React state settling). Prevents the auto-spawn-if-empty
   * effect from firing a duplicate spawn in the same render cycle.
   */
  const initialSpawnPendingRef = useRef(false);

  // ─────────────────────────────────────────────────────────────────────
  // Tab mutators
  // ─────────────────────────────────────────────────────────────────────

  const updateTab = useCallback((id: string, patch: Partial<Tab>) => {
    setTabs((prev) =>
      prev.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    );
  }, []);

  const spawnTab = useCallback(async () => {
    const id = newTabId();
    const tab: Tab = {
      id,
      termId: null,
      shell: "",
      cwd: workspace || "",
      busy: true,
      error: null,
      exited: false,
    };
    // User explicitly created a tab — clear the "closed all" flag.
    userClosedAllRef.current = false;
    setTabs((prev) => [...prev, tab]);
    setActiveId(id);

    try {
      const res = await window.desktop.termStart(workspace, 80, 24);
      // The component may have unmounted by the time the IPC returns.
      setTabs((prev) => {
        if (!prev.some((t) => t.id === id)) {
          // Orphan PTY — kill it.
          void window.desktop.termKill(res.id).catch(() => undefined);
          return prev;
        }
        return prev.map((t) =>
          t.id === id
            ? {
                ...t,
                termId: res.id,
                shell: res.shell,
                cwd: res.cwd || t.cwd,
                busy: false,
                error: null,
              }
            : t,
        );
      });
    } catch (err) {
      setTabs((prev) =>
        prev.map((t) =>
          t.id === id
            ? {
                ...t,
                busy: false,
                error: err instanceof Error ? err.message : String(err),
              }
            : t,
        ),
      );
    }
  }, [workspace]);

  const closeTab = useCallback(
    (id: string) => {
      setTabs((prev) => {
        const idx = prev.findIndex((t) => t.id === id);
        if (idx < 0) return prev;
        const tab = prev[idx];
        if (tab.termId) {
          void window.desktop.termKill(tab.termId).catch(() => undefined);
        }
        const next = prev.filter((t) => t.id !== id);

        // If we just closed the active tab, pick a sensible next active.
        setActiveId((curr) => {
          if (curr !== id) return curr;
          if (next.length === 0) return null;
          const fallback = next[Math.min(idx, next.length - 1)];
          return fallback.id;
        });

        if (next.length === 0) {
          // The user explicitly closed the last tab — suppress the
          // "auto-spawn a fresh one" behavior and tell the host so it
          // can switch the right panel back to its entry menu.
          userClosedAllRef.current = true;
          onLastTabClosed?.();
        }

        return next;
      });
    },
    [onLastTabClosed],
  );

  const restartActive = useCallback(async () => {
    if (!activeId) return;
    const tab = tabs.find((t) => t.id === activeId);
    if (!tab) return;

    if (tab.termId) {
      void window.desktop.termKill(tab.termId).catch(() => undefined);
    }
    updateTab(tab.id, {
      termId: null,
      shell: "",
      busy: true,
      error: null,
      exited: false,
    });

    try {
      const res = await window.desktop.termStart(workspace, 80, 24);
      setTabs((prev) => {
        if (!prev.some((t) => t.id === tab.id)) {
          void window.desktop.termKill(res.id).catch(() => undefined);
          return prev;
        }
        return prev.map((t) =>
          t.id === tab.id
            ? { ...t, termId: res.id, shell: res.shell, cwd: res.cwd || t.cwd, busy: false }
            : t,
        );
      });
    } catch (err) {
      updateTab(tab.id, {
        busy: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }, [activeId, tabs, workspace, updateTab]);

  // ─────────────────────────────────────────────────────────────────────
  // Initial tab: when the panel first mounts with no tabs, spawn one.
  // ─────────────────────────────────────────────────────────────────────

  // Track whether we've already auto-spawned so this effect doesn't fight
  // with explicit user actions.
  const autoSpawnedRef = useRef(false);

  useEffect(() => {
    if (autoSpawnedRef.current) return;
    if (tabs.length > 0) {
      autoSpawnedRef.current = true;
      return;
    }
    autoSpawnedRef.current = true;
    initialSpawnPendingRef.current = true;
    void spawnTab().finally(() => {
      initialSpawnPendingRef.current = false;
    });
    // Run once on mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When workspace changes (user picks a new directory), restart the
  // currently active tab in the new cwd. This matches the old single-tab
  // behavior.
  const lastWorkspaceRef = useRef(workspace);
  useEffect(() => {
    const prev = lastWorkspaceRef.current;
    lastWorkspaceRef.current = workspace;
    if (prev === workspace) return;
    if (!activeId) return;
    // Restart the active tab in the new cwd.
    void restartActive();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace]);

  // ─────────────────────────────────────────────────────────────────────
  // Close "+" dropdown on outside click / Escape.
  useEffect(() => {
    if (!plusMenuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (
        plusMenuRef.current &&
        !plusMenuRef.current.contains(e.target as Node)
      ) {
        setPlusMenuOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setPlusMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [plusMenuOpen]);

  // Active tab bookkeeping
  // ─────────────────────────────────────────────────────────────────────

  const activeTab = useMemo(
    () => tabs.find((t) => t.id === activeId) ?? null,
    [tabs, activeId],
  );

  // If we have tabs but no active id (e.g. right after first spawn race),
  // pick the last one.
  useEffect(() => {
    if (!activeId && tabs.length > 0) {
      setActiveId(tabs[tabs.length - 1].id);
    }
  }, [activeId, tabs]);

  // If the list emptied because the user closed the last tab, do NOT
  // auto-spawn a fresh one — the host has been notified and should switch
  // back to its entry menu. Initial mount is handled separately above.
  useEffect(() => {
    if (!autoSpawnedRef.current) return;
    if (userClosedAllRef.current) return;
    if (initialSpawnPendingRef.current) return;
    if (tabs.length === 0 && !activeId) {
      void spawnTab();
    }
  }, [tabs.length, activeId, spawnTab]);

  return (
    <div className="term-panel">
      <div className="term-toolbar">
        <div className="term-tabs">
          {tabs.map((tab, i) => (
            <TabChip
              key={tab.id}
              index={i + 1}
              tab={tab}
              isActive={tab.id === activeId}
              onSelect={() => setActiveId(tab.id)}
              onClose={() => closeTab(tab.id)}
              m={m}
            />
          ))}
        </div>
        <div className="term-tab-add-wrap" ref={plusMenuRef}>
          <button
            type="button"
            className="term-tab-add"
            onClick={() => setPlusMenuOpen((v) => !v)}
            title={m.termNewTab}
            aria-label={m.termNewTab}
            aria-haspopup="menu"
            aria-expanded={plusMenuOpen}
          >
            +
          </button>
          {plusMenuOpen ? (
            <div className="dropdown" role="menu">
              <button
                type="button"
                className="term-tab-add-item"
                role="menuitem"
                onClick={() => {
                  setPlusMenuOpen(false);
                  onOpenFile?.();
                }}
              >
                <span className="di-icon" aria-hidden>
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 16 16"
                    fill="none"
                  >
                    <path
                      d="M2.5 4.2A1.2 1.2 0 0 1 3.7 3h2.4l1.1 1.3h5.1A1.2 1.2 0 0 1 13.5 5.5v6.3a1.2 1.2 0 0 1-1.2 1.2H3.7a1.2 1.2 0 0 1-1.2-1.2V4.2Z"
                      stroke="currentColor"
                      strokeWidth="1.2"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
                <span>{m.termAddOpenFile}</span>
              </button>
              <button
                type="button"
                className="term-tab-add-item"
                role="menuitem"
                onClick={() => {
                  setPlusMenuOpen(false);
                  void spawnTab();
                }}
              >
                <span className="di-icon" aria-hidden>
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 16 16"
                    fill="none"
                  >
                    <rect
                      x="2.5"
                      y="3"
                      width="11"
                      height="10"
                      rx="1.5"
                      stroke="currentColor"
                      strokeWidth="1.2"
                    />
                    <path
                      d="M5 7.2 6.6 8.5 5 9.8M8.2 10.2h2.6"
                      stroke="currentColor"
                      strokeWidth="1.2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
                <span>{m.termAddNewTerminal}</span>
              </button>
            </div>
          ) : null}
        </div>
        <div className="term-toolbar-actions">
          <button
            type="button"
            className="term-action"
            onClick={() => {
              // Clear active xterm — this is wired up inside TermInstance
              // via a custom event so we don't have to plumb refs up.
              window.dispatchEvent(
                new CustomEvent("termpanel:clear-active", {
                  detail: { tabId: activeId },
                }),
              );
            }}
            title={m.termClear}
            disabled={!activeTab || activeTab.busy}
          >
            ⌫
          </button>
          <button
            type="button"
            className="term-action"
            onClick={() => void restartActive()}
            disabled={!activeTab || activeTab.busy}
            title={m.termRestart}
          >
            ↻
          </button>
        </div>
      </div>

      {tabs.map((tab) => (
        <TermInstance
          key={tab.id}
          tab={tab}
          visible={tab.id === activeId}
          panelActive={active}
          m={m}
          onExit={() => updateTab(tab.id, { exited: true })}
          onError={(msg) => updateTab(tab.id, { error: msg })}
        />
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Per-tab xterm instance. Owns one xterm + binds to one PTY id.
// ─────────────────────────────────────────────────────────────────────

function TermInstance({
  tab,
  visible,
  panelActive,
  m,
  onExit,
  onError,
}: {
  tab: Tab;
  /** True only for the active tab. */
  visible: boolean;
  /** True while the parent right-panel is open and this tab is mounted. */
  panelActive: boolean;
  m: Messages;
  onExit: () => void;
  onError: (msg: string) => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const termIdRef = useRef<string | null>(tab.termId);
  termIdRef.current = tab.termId;

  const dataBufRef = useRef<string>("");
  const dataFlushRafRef = useRef<number | null>(null);
  const lastDimsRef = useRef<{ cols: number; rows: number } | null>(null);
  const disposedRef = useRef(false);

  const fitAndResize = useCallback(() => {
    const term = xtermRef.current;
    const fit = fitRef.current;
    const id = termIdRef.current;
    if (!term || !fit || !hostRef.current) return;
    if (
      hostRef.current.clientWidth < 4 ||
      hostRef.current.clientHeight < 4
    ) {
      return;
    }
    try {
      fit.fit();
    } catch {
      /* ignore */
    }
    if (id && term.cols > 0 && term.rows > 0) {
      const prev = lastDimsRef.current;
      if (!prev || prev.cols !== term.cols || prev.rows !== term.rows) {
        lastDimsRef.current = { cols: term.cols, rows: term.rows };
        void window.desktop
          .termResize(id, term.cols, term.rows)
          .catch(() => undefined);
      }
    }
  }, []);

  // Build the xterm once per TermInstance lifetime. It mounts into the
  // hidden host and is wired up to its PTY via the termIdRef.
  useEffect(() => {
    disposedRef.current = false;
    const host = hostRef.current;
    if (!host) return;

    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: "bar",
      fontFamily:
        'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
      fontSize: 13,
      lineHeight: 1.2,
      letterSpacing: 0,
      scrollback: 5000,
      allowProposedApi: true,
      theme: {
        background: "#0e0e0e",
        foreground: "#d4d4d4",
        cursor: "#aeafad",
        cursorAccent: "#0e0e0e",
        selectionBackground: "rgba(255, 255, 255, 0.18)",
        black: "#000000",
        red: "#cd3131",
        green: "#0dbc79",
        yellow: "#e5e510",
        blue: "#2472c8",
        magenta: "#bc3fbc",
        cyan: "#11a8cd",
        white: "#e5e5e5",
        brightBlack: "#666666",
        brightRed: "#f14c4c",
        brightGreen: "#23d18b",
        brightYellow: "#f5f543",
        brightBlue: "#3b8eea",
        brightMagenta: "#d670d6",
        brightCyan: "#29b8db",
        brightWhite: "#e5e5e5",
      },
    });

    const fit = new FitAddon();
    const links = new WebLinksAddon();
    term.loadAddon(fit);
    term.loadAddon(links);
    term.open(host);

    xtermRef.current = term;
    fitRef.current = fit;

    const flushData = () => {
      dataFlushRafRef.current = null;
      const buf = dataBufRef.current;
      if (!buf) return;
      dataBufRef.current = "";
      xtermRef.current?.write(buf);
    };
    const scheduleFlush = () => {
      if (dataFlushRafRef.current != null) return;
      dataFlushRafRef.current = requestAnimationFrame(flushData);
    };

    const onData = term.onData((data) => {
      const id = termIdRef.current;
      if (!id) return;
      void window.desktop.termWrite(id, data).catch(() => undefined);
    });
    const onBinary = term.onBinary((data) => {
      const id = termIdRef.current;
      if (!id) return;
      let raw = "";
      for (let i = 0; i < data.length; i++) {
        raw += String.fromCharCode(data.charCodeAt(i) & 0xff);
      }
      void window.desktop.termWrite(id, raw).catch(() => undefined);
    });

    requestAnimationFrame(() => {
      try {
        fit.fit();
      } catch {
        /* ignore */
      }
    });

    return () => {
      disposedRef.current = true;
      onData.dispose();
      onBinary.dispose();
      term.dispose();
      xtermRef.current = null;
      fitRef.current = null;
    };
  }, []);

  // Subscribe to PTY events for THIS tab's termId only.
  useEffect(() => {
    const flushData = () => {
      dataFlushRafRef.current = null;
      const buf = dataBufRef.current;
      if (!buf) return;
      dataBufRef.current = "";
      xtermRef.current?.write(buf);
    };
    const scheduleFlush = () => {
      if (dataFlushRafRef.current != null) return;
      dataFlushRafRef.current = requestAnimationFrame(flushData);
    };
    const off = window.desktop.onTermEvent((ev) => {
      const id = termIdRef.current;
      if (!id || ev.id !== id) return;
      if (ev.type === "data") {
        dataBufRef.current += ev.data;
        scheduleFlush();
      } else if (ev.type === "exit") {
        const code = ev.code ?? "?";
        xtermRef.current?.writeln(
          `\r\n\x1b[90m[${m.termExited.replace("{code}", String(code))}]\x1b[0m`,
        );
        termIdRef.current = null;
        onExit();
      }
    });
    return () => {
      off();
      if (dataFlushRafRef.current != null) {
        cancelAnimationFrame(dataFlushRafRef.current);
        dataFlushRafRef.current = null;
        const tail = dataBufRef.current;
        dataBufRef.current = "";
        if (tail) xtermRef.current?.write(tail);
      }
    };
  }, [m.termExited, onExit]);

  // When the tab becomes the active visible tab and the panel is open,
  // fit + focus it. Also handles the case where the termId was set after
  // mount (the spawn IPC completes later).
  useEffect(() => {
    if (!visible || !panelActive) return;
    const t = window.setTimeout(() => {
      fitAndResize();
      xtermRef.current?.focus();
      // After spawn completes, sync PTY size to current xterm dims.
      const id = termIdRef.current;
      const term = xtermRef.current;
      if (id && term && term.cols > 0 && term.rows > 0) {
        void window.desktop
          .termResize(id, term.cols, term.rows)
          .catch(() => undefined);
        lastDimsRef.current = { cols: term.cols, rows: term.rows };
      }
    }, 30);
    return () => window.clearTimeout(t);
  }, [visible, panelActive, fitAndResize, tab.termId]);

  // ResizeObserver while this instance is visible.
  useEffect(() => {
    if (!visible) return;
    const host = hostRef.current;
    if (!host) return;
    let raf = 0;
    const scheduleFit = () => {
      if (!panelActive) return;
      if (document.body.classList.contains("is-resizing-panels")) return;
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        fitAndResize();
      });
    };
    const ro = new ResizeObserver(scheduleFit);
    ro.observe(host);
    const onPanelResizeEnd = () => {
      if (!panelActive) return;
      requestAnimationFrame(() => fitAndResize());
    };
    window.addEventListener("panel-resize-end", onPanelResizeEnd);
    return () => {
      ro.disconnect();
      window.removeEventListener("panel-resize-end", onPanelResizeEnd);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [visible, panelActive, fitAndResize]);

  // Listen for the toolbar "clear active" signal — only the visible
  // (active) instance acts, and only if the signaled tabId matches us.
  useEffect(() => {
    if (!visible) return;
    const handler = (ev: Event) => {
      const detail = (ev as CustomEvent<{ tabId: string | null }>).detail;
      if (detail?.tabId !== tab.id) return;
      xtermRef.current?.clear();
    };
    window.addEventListener("termpanel:clear-active", handler);
    return () => window.removeEventListener("termpanel:clear-active", handler);
  }, [visible, tab.id]);

  return (
    <div
      className="term-instance"
      style={{ display: visible ? "flex" : "none" }}
      aria-hidden={!visible}
    >
      {tab.error ? <div className="term-error">{tab.error}</div> : null}
      {!tab.termId && tab.busy ? (
        <div className="term-status">{m.termStarting}</div>
      ) : null}
      <div
        className="term-xterm-host"
        ref={hostRef}
        onClick={() => xtermRef.current?.focus()}
        role="application"
        aria-label={m.termTitle}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Tab chip — label + status dot + close button.
// ─────────────────────────────────────────────────────────────────────

function TabChip({
  index,
  tab,
  isActive,
  onSelect,
  onClose,
  m,
}: {
  index: number;
  tab: Tab;
  isActive: boolean;
  onSelect: () => void;
  onClose: () => void;
  m: Messages;
}) {
  const label =
    shellBasename(tab.shell || "?") || String(index);
  const title = tab.cwd ? `${shellBasename(tab.shell || "")} · ${tab.cwd}` : label;
  const cls =
    "term-tab" +
    (isActive ? " active" : "") +
    (tab.exited ? " exited" : "");
  return (
    <div
      className={cls}
      onClick={onSelect}
      title={title}
      role="tab"
      aria-selected={isActive}
    >
      <span className="term-tab-dot" aria-hidden />
      <span className="term-tab-label">
        {index} · {label}
      </span>
      <button
        type="button"
        className="term-tab-close"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        title={m.termCloseTab}
        aria-label={m.termCloseTab}
      >
        ×
      </button>
    </div>
  );
}