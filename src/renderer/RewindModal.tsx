import { useEffect, useState } from "react";
import type { RewindMode, RewindPointUi } from "@shared/types";
import type { Messages } from "./i18n";

type Props = {
  open: boolean;
  m: Messages;
  onClose: () => void;
  onDone?: (summary: string) => void;
};

/**
 * TUI `/rewind` counterpart — pick a checkpoint, choose mode, confirm.
 * Restores conversation (and optionally files) to an earlier user prompt.
 */
export function RewindModal({ open, m, onClose, onDone }: Props) {
  const [points, setPoints] = useState<RewindPointUi[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [mode, setMode] = useState<RewindMode>("all");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setSelected(null);
    setMode("all");
    void (async () => {
      try {
        const list = await window.desktop.listRewindPoints();
        if (cancelled) return;
        // Newest first for scanning recent mistakes.
        const sorted = [...list].sort(
          (a, b) => b.promptIndex - a.promptIndex,
        );
        setPoints(sorted);
        if (sorted[0]) setSelected(sorted[0].promptIndex);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setPoints([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open, busy, onClose]);

  if (!open) return null;

  const selectedPoint = points.find((p) => p.promptIndex === selected);
  const canFilesOnly = selectedPoint?.hasFileChanges === true;

  const confirm = async () => {
    if (selected == null || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await window.desktop.executeRewind(selected, mode);
      if (!result.success) {
        setError(result.error || m.rewindFailed);
        setBusy(false);
        return;
      }
      const files = result.revertedFiles.length;
      const summary =
        files > 0
          ? m.rewindSuccessWithFiles
              .replace("{n}", String(result.targetPromptIndex + 1))
              .replace("{files}", String(files))
          : m.rewindSuccess.replace(
              "{n}",
              String(result.targetPromptIndex + 1),
            );
      onDone?.(summary);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="rewind-modal-overlay"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div
        className="rewind-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rewind-modal-title"
      >
        <div className="rewind-modal-header">
          <h2 id="rewind-modal-title" className="rewind-modal-title">
            {m.rewindTitle}
          </h2>
          <button
            type="button"
            className="rewind-modal-close"
            onClick={onClose}
            disabled={busy}
            aria-label={m.rewindClose}
          >
            ×
          </button>
        </div>
        <p className="rewind-modal-hint">{m.rewindHint}</p>

        {loading ? (
          <div className="rewind-modal-empty">{m.rewindLoading}</div>
        ) : error && points.length === 0 ? (
          <div className="rewind-modal-empty error">{error}</div>
        ) : points.length === 0 ? (
          <div className="rewind-modal-empty">{m.rewindEmpty}</div>
        ) : (
          <ul className="rewind-modal-list" role="listbox">
            {points.map((p) => {
              const active = p.promptIndex === selected;
              return (
                <li key={p.promptIndex}>
                  <button
                    type="button"
                    className={`rewind-modal-item${active ? " active" : ""}`}
                    role="option"
                    aria-selected={active}
                    disabled={busy}
                    onClick={() => setSelected(p.promptIndex)}
                  >
                    <span className="rewind-modal-item-idx">
                      #{p.promptIndex + 1}
                    </span>
                    <span className="rewind-modal-item-preview">
                      {p.promptPreview?.trim() || m.rewindNoPreview}
                    </span>
                    {p.hasFileChanges ? (
                      <span className="rewind-modal-item-files" title={m.rewindHasFiles}>
                        {m.rewindFilesBadge.replace(
                          "{n}",
                          String(p.numFileSnapshots || "•"),
                        )}
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {points.length > 0 ? (
          <div className="rewind-modal-modes" role="group" aria-label={m.rewindModeLabel}>
            <label className="rewind-mode">
              <input
                type="radio"
                name="rewind-mode"
                checked={mode === "all"}
                disabled={busy}
                onChange={() => setMode("all")}
              />
              <span>{m.rewindModeAll}</span>
            </label>
            <label className="rewind-mode">
              <input
                type="radio"
                name="rewind-mode"
                checked={mode === "conversation_only"}
                disabled={busy}
                onChange={() => setMode("conversation_only")}
              />
              <span>{m.rewindModeConversation}</span>
            </label>
            <label className={`rewind-mode${canFilesOnly ? "" : " disabled"}`}>
              <input
                type="radio"
                name="rewind-mode"
                checked={mode === "files_only"}
                disabled={busy || !canFilesOnly}
                onChange={() => setMode("files_only")}
              />
              <span>{m.rewindModeFiles}</span>
            </label>
          </div>
        ) : null}

        {error && points.length > 0 ? (
          <div className="rewind-modal-error">{error}</div>
        ) : null}

        <div className="rewind-modal-footer">
          <button
            type="button"
            className="rewind-btn secondary"
            onClick={onClose}
            disabled={busy}
          >
            {m.rewindCancel}
          </button>
          <button
            type="button"
            className="rewind-btn danger"
            onClick={() => void confirm()}
            disabled={busy || selected == null || points.length === 0}
          >
            {busy ? m.rewindWorking : m.rewindConfirm}
          </button>
        </div>
      </div>
    </div>
  );
}
