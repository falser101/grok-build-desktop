import { useCallback, useEffect, useRef, useState } from "react";
import type { Messages } from "./i18n";

/**
 * Strip common ANSI CSI sequences for plain-text terminal display.
 * (We are not embedding a full VT emulator.)
 */
function stripAnsi(s: string): string {
  return s
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "")
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b[()][0-9A-Za-z]/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
}

export function TerminalPanel({
  workspace,
  active,
  m,
}: {
  workspace: string | undefined;
  /** When false, keep process alive but do not auto-focus. */
  active: boolean;
  m: Messages;
}) {
  const [output, setOutput] = useState("");
  const [line, setLine] = useState("");
  const [termId, setTermId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const preRef = useRef<HTMLPreElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const termIdRef = useRef<string | null>(null);

  const scrollBottom = useCallback(() => {
    const el = preRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, []);

  const start = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      // Kill previous shell if any
      if (termIdRef.current) {
        await window.desktop.termKill(termIdRef.current).catch(() => undefined);
        termIdRef.current = null;
        setTermId(null);
      }
      setOutput("");
      const res = await window.desktop.termStart(workspace);
      termIdRef.current = res.id;
      setTermId(res.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [workspace]);

  // Subscribe to term events once.
  useEffect(() => {
    return window.desktop.onTermEvent((ev) => {
      if (ev.type === "data") {
        if (termIdRef.current && ev.id !== termIdRef.current) return;
        setOutput((o) => o + stripAnsi(ev.data));
      } else if (ev.type === "exit") {
        if (termIdRef.current && ev.id !== termIdRef.current) return;
        setOutput(
          (o) =>
            o +
            `\n[${m.termExited.replace("{code}", String(ev.code ?? "?"))}]\n`,
        );
        termIdRef.current = null;
        setTermId(null);
      }
    });
  }, [m.termExited]);

  // Start / restart when panel becomes active or workspace changes.
  useEffect(() => {
    if (!active) return;
    void start();
    return () => {
      const id = termIdRef.current;
      if (id) {
        void window.desktop.termKill(id).catch(() => undefined);
        termIdRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- restart only on active/workspace
  }, [active, workspace]);

  useEffect(() => {
    scrollBottom();
  }, [output, scrollBottom]);

  useEffect(() => {
    if (active) inputRef.current?.focus();
  }, [active, termId]);

  const sendLine = useCallback(async () => {
    const id = termIdRef.current;
    if (!id) return;
    const text = line;
    setLine("");
    // Echo local input for shells that don't echo over pipes.
    setOutput((o) => o + text + "\n");
    try {
      await window.desktop.termWrite(id, text + "\n");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [line]);

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
        </span>
        <button
          type="button"
          className="term-restart"
          onClick={() => void start()}
          disabled={busy}
          title={m.termRestart}
        >
          ↻
        </button>
      </div>
      {error ? <div className="term-error">{error}</div> : null}
      <pre className="term-output" ref={preRef} tabIndex={-1}>
        {output || (busy ? m.termStarting : m.termHint)}
      </pre>
      <form
        className="term-input-row"
        onSubmit={(e) => {
          e.preventDefault();
          void sendLine();
        }}
      >
        <span className="term-prompt">›</span>
        <input
          ref={inputRef}
          className="term-input"
          value={line}
          disabled={!termId}
          onChange={(e) => setLine(e.target.value)}
          placeholder={termId ? m.termPlaceholder : m.termStarting}
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
        />
        <button
          type="submit"
          className="term-send"
          disabled={!termId || !line.trim()}
          title={m.termRun}
        >
          ↵
        </button>
      </form>
    </div>
  );
}
