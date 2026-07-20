import { useCallback, useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import type { Messages } from "./i18n";

/**
 * VS Code-style interactive terminal: xterm.js frontend + PTY backend.
 * Full-screen terminal surface (no separate input bar) — type anywhere.
 */
export function TerminalPanel({
  workspace,
  active,
  m,
}: {
  workspace: string | undefined;
  /** When false, keep process alive but do not auto-focus / resize thrash. */
  active: boolean;
  m: Messages;
}) {
  const [termId, setTermId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shellLabel, setShellLabel] = useState<string>("");

  const hostRef = useRef<HTMLDivElement | null>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const termIdRef = useRef<string | null>(null);
  const workspaceRef = useRef(workspace);
  const disposedRef = useRef(false);
  // App-layer batching: PTY `data` events arrive in small IPC chunks. We
  // concatenate into a buffer and flush to xterm once per frame so we don't
  // trigger one parser pass per packet.
  const dataBufRef = useRef<string>("");
  const dataFlushRafRef = useRef<number | null>(null);
  const lastDimsRef = useRef<{ cols: number; rows: number } | null>(null);

  workspaceRef.current = workspace;

  const fitAndResize = useCallback(() => {
    const term = xtermRef.current;
    const fit = fitRef.current;
    const id = termIdRef.current;
    if (!term || !fit || !hostRef.current) return;
    // Skip if host has no layout (hidden panel).
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
      // ResizeObserver sometimes fires with the same dimensions — skip
      // the IPC roundtrip when nothing actually changed.
      const prev = lastDimsRef.current;
      if (
        !prev ||
        prev.cols !== term.cols ||
        prev.rows !== term.rows
      ) {
        lastDimsRef.current = { cols: term.cols, rows: term.rows };
        void window.desktop
          .termResize(id, term.cols, term.rows)
          .catch(() => undefined);
      }
    }
  }, []);

  const start = useCallback(async () => {
    if (disposedRef.current) return;
    setBusy(true);
    setError(null);
    try {
      if (termIdRef.current) {
        await window.desktop.termKill(termIdRef.current).catch(() => undefined);
        termIdRef.current = null;
        setTermId(null);
      }
      xtermRef.current?.reset();
      xtermRef.current?.clear();

      // Prefer measured size; fall back to defaults for first paint.
      let cols = 80;
      let rows = 24;
      const fit = fitRef.current;
      const term = xtermRef.current;
      if (fit && term && hostRef.current) {
        try {
          fit.fit();
          cols = term.cols || 80;
          rows = term.rows || 24;
        } catch {
          /* ignore */
        }
      }

      const res = await window.desktop.termStart(
        workspaceRef.current,
        cols,
        rows,
      );
      if (disposedRef.current) {
        await window.desktop.termKill(res.id).catch(() => undefined);
        return;
      }
      termIdRef.current = res.id;
      setTermId(res.id);
      setShellLabel(res.shell);
      // Sync PTY size after attach.
      if (term) {
        void window.desktop
          .termResize(res.id, term.cols, term.rows)
          .catch(() => undefined);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, []);

  // Create xterm once.
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
      // Convert binary string to raw bytes for PTY. xterm wants binary in
      // the host's charset; we forward the string bytes via onData below.
      let raw = "";
      for (let i = 0; i < data.length; i++) {
        raw += String.fromCharCode(data.charCodeAt(i) & 0xff);
      }
      // Forward as user input to PTY (mirroring onData path).
      void window.desktop.termWrite(id, raw).catch(() => undefined);
    });

    // Initial fit after layout.
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
      const id = termIdRef.current;
      if (id) {
        void window.desktop.termKill(id).catch(() => undefined);
        termIdRef.current = null;
      }
      term.dispose();
      xtermRef.current = null;
      fitRef.current = null;
    };
  }, []);

  // Stream PTY output → xterm. Coalesce small IPC chunks into one
  // `xterm.write()` per animation frame (avoids one parse pass per packet).
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
      if (ev.type === "data") {
        if (termIdRef.current && ev.id !== termIdRef.current) return;
        dataBufRef.current += ev.data;
        scheduleFlush();
      } else if (ev.type === "exit") {
        if (termIdRef.current && ev.id !== termIdRef.current) return;
        const code = ev.code ?? "?";
        xtermRef.current?.writeln(
          `\r\n\x1b[90m[${m.termExited.replace("{code}", String(code))}]\x1b[0m`,
        );
        termIdRef.current = null;
        setTermId(null);
      }
    });
    return () => {
      off();
      // Drain any remaining bytes so we don't drop output on unmount.
      if (dataFlushRafRef.current != null) {
        cancelAnimationFrame(dataFlushRafRef.current);
        dataFlushRafRef.current = null;
        const tail = dataBufRef.current;
        dataBufRef.current = "";
        if (tail) xtermRef.current?.write(tail);
      }
    };
  }, [m.termExited]);

  // Start shell once xterm is ready; restart when workspace changes.
  useEffect(() => {
    // Wait a frame so fit has dimensions.
    const t = window.setTimeout(() => {
      void start();
    }, 0);
    return () => {
      window.clearTimeout(t);
    };
    // Only restart on workspace change (not active toggle).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace]);

  // Focus + fit when panel becomes visible.
  useEffect(() => {
    if (!active) return;
    const t = window.setTimeout(() => {
      fitAndResize();
      xtermRef.current?.focus();
    }, 30);
    return () => window.clearTimeout(t);
  }, [active, fitAndResize, termId]);

  // Observe container resize (panel drag, window resize).
  // Skip while the shell is scrubbing columns — fit once on panel-resize-end.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let raf = 0;
    const scheduleFit = () => {
      if (!active) return;
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
      if (!active) return;
      // Next frame so final CSS vars have been applied.
      requestAnimationFrame(() => fitAndResize());
    };
    window.addEventListener("panel-resize-end", onPanelResizeEnd);
    return () => {
      ro.disconnect();
      window.removeEventListener("panel-resize-end", onPanelResizeEnd);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [active, fitAndResize]);

  // Click anywhere in the terminal area to focus.
  const onHostClick = useCallback(() => {
    xtermRef.current?.focus();
  }, []);

  return (
    <div className="term-panel">
      <div className="term-toolbar">
        <span className="term-title" title={workspace || undefined}>
          {m.termTitle}
          {workspace ? (
            <span className="term-cwd">
              {" "}
              ·{" "}
              {workspace.replace(/\\/g, "/").split("/").filter(Boolean).pop() ||
                workspace}
            </span>
          ) : null}
          {shellLabel ? (
            <span className="term-shell" title={shellLabel}>
              {" "}
              · {shellLabel.split(/[/\\]/).pop()}
            </span>
          ) : null}
        </span>
        <div className="term-toolbar-actions">
          <button
            type="button"
            className="term-action"
            onClick={() => {
              xtermRef.current?.clear();
            }}
            title={m.termClear}
            disabled={busy}
          >
            ⌫
          </button>
          <button
            type="button"
            className="term-action"
            onClick={() => void start()}
            disabled={busy}
            title={m.termRestart}
          >
            ↻
          </button>
        </div>
      </div>
      {error ? <div className="term-error">{error}</div> : null}
      {!termId && busy ? (
        <div className="term-status">{m.termStarting}</div>
      ) : null}
      <div
        className="term-xterm-host"
        ref={hostRef}
        onClick={onHostClick}
        role="application"
        aria-label={m.termTitle}
      />
    </div>
  );
}
