import { useCallback, useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import type { Messages } from "./i18n";

/**
 * Single interactive PTY for one right-panel tab.
 * No internal chrome (tabs / clear / restart) — the host tab bar owns
 * that UX and shows the shell cwd as the chip label.
 */

export function TerminalPanel({
  workspace,
  active,
  m,
  onCwdChange,
}: {
  workspace: string | undefined;
  /** When false, keep the PTY alive but don't auto-focus / thrash resize. */
  active: boolean;
  m: Messages;
  /** Report the PTY working directory so the outer tab chip can show e.g. ~/Projects. */
  onCwdChange?: (cwd: string) => void;
}) {
  const [termId, setTermId] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const hostRef = useRef<HTMLDivElement | null>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const termIdRef = useRef<string | null>(null);
  termIdRef.current = termId;
  const onCwdChangeRef = useRef(onCwdChange);
  onCwdChangeRef.current = onCwdChange;

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

  const startPty = useCallback(async () => {
    setBusy(true);
    setError(null);
    setTermId(null);
    termIdRef.current = null;
    try {
      const res = await window.desktop.termStart(workspace, 80, 24);
      if (disposedRef.current) {
        void window.desktop.termKill(res.id).catch(() => undefined);
        return;
      }
      setTermId(res.id);
      termIdRef.current = res.id;
      const cwd = res.cwd || workspace || "";
      if (cwd) onCwdChangeRef.current?.(cwd);
      setBusy(false);
    } catch (err) {
      if (disposedRef.current) return;
      setBusy(false);
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [workspace]);

  // Spawn once on mount; kill on unmount (outer tab closed).
  useEffect(() => {
    disposedRef.current = false;
    // Seed chip label from workspace before PTY returns.
    if (workspace) onCwdChangeRef.current?.(workspace);
    void startPty();
    return () => {
      disposedRef.current = true;
      const id = termIdRef.current;
      if (id) {
        void window.desktop.termKill(id).catch(() => undefined);
      }
      termIdRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Workspace change → restart in new cwd.
  const lastWorkspaceRef = useRef(workspace);
  useEffect(() => {
    const prev = lastWorkspaceRef.current;
    lastWorkspaceRef.current = workspace;
    if (prev === workspace) return;
    const id = termIdRef.current;
    if (id) {
      void window.desktop.termKill(id).catch(() => undefined);
    }
    termIdRef.current = null;
    setTermId(null);
    if (workspace) onCwdChangeRef.current?.(workspace);
    xtermRef.current?.reset();
    void startPty();
  }, [workspace, startPty]);

  // Build xterm once.
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

  // PTY events.
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
        setTermId(null);
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
  }, [m.termExited]);

  // Focus + fit when panel becomes active or PTY id arrives.
  useEffect(() => {
    if (!active) return;
    const t = window.setTimeout(() => {
      fitAndResize();
      xtermRef.current?.focus();
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
  }, [active, fitAndResize, termId]);

  // ResizeObserver while panel is active.
  useEffect(() => {
    if (!active) return;
    const host = hostRef.current;
    if (!host) return;
    let raf = 0;
    const scheduleFit = () => {
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
      requestAnimationFrame(() => fitAndResize());
    };
    window.addEventListener("panel-resize-end", onPanelResizeEnd);
    return () => {
      ro.disconnect();
      window.removeEventListener("panel-resize-end", onPanelResizeEnd);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [active, fitAndResize]);

  return (
    <div className="term-panel term-panel-bare">
      {error ? <div className="term-error">{error}</div> : null}
      {!termId && busy ? (
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
