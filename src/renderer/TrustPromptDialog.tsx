import { useEffect, useRef } from "react";
import type { FolderTrustPromptUi } from "@shared/types";
import type { Messages } from "./i18n";

type Props = {
  request: FolderTrustPromptUi;
  /** "trust" | "reject" — wired to `desktopApi.respondTrustPrompt`. */
  onResolve: (outcome: "trust" | "reject") => void;
  m: Messages;
};

/**
 * Inline folder-trust prompt shown above the composer when the agent
 * detects repo-local code-exec markers (hooks/MCP/plugins/LSP/.envrc/…)
 * inside an untrusted workspace. Mirrors the CLI's interactive trust flow.
 *
 * Layout mirrors `PermissionPanel`: same width, same kicker/badge/foot
 * styling so the user gets one consistent prompt surface regardless of
 * the gate type (permission / question / plan / trust).
 *
 * Keys:
 *   T / Enter  → trust
 *   R / Esc    → reject
 */
export function TrustPromptDialog({ request, onResolve, m }: Props) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const trustedRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    rootRef.current?.focus();
    // Default focus: trust (safer to nudge users toward the explicit grant).
    trustedRef.current?.focus();
  }, [request.requestId]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" || e.key === "t" || e.key === "T") {
      e.preventDefault();
      e.stopPropagation();
      onResolve("trust");
      return;
    }
    if (e.key === "Escape" || e.key === "r" || e.key === "R") {
      e.preventDefault();
      e.stopPropagation();
      onResolve("reject");
    }
  };

  const sameWorkspace = request.workspace === request.cwd;
  const kinds = request.configKinds.filter((k) => k && typeof k === "string");

  return (
    <div
      ref={rootRef}
      className="permission-panel trust-prompt-panel"
      role="dialog"
      aria-modal="true"
      aria-label={m.trustTitle}
      tabIndex={0}
      onKeyDown={onKeyDown}
    >
      <div className="permission-head">
        <div className="permission-head-text">
          <div className="permission-kicker">{m.trustKicker}</div>
          <div className="permission-title">{m.trustTitle}</div>
          <div className="trust-prompt-body">
            {sameWorkspace ? (
              <p className="trust-prompt-line">
                {m.trustBodySame.replace("{path}", request.workspace)}
              </p>
            ) : (
              <>
                <p className="trust-prompt-line">
                  {m.trustBodyCwd.replace("{path}", request.cwd)}
                </p>
                <p className="trust-prompt-line">
                  {m.trustBodyWorkspace.replace(
                    "{path}",
                    request.workspace,
                  )}
                </p>
              </>
            )}
            {kinds.length > 0 ? (
              <p className="trust-prompt-kinds">
                {m.trustKindsLabel}: {kinds.join(", ")}
              </p>
            ) : null}
            <p className="trust-prompt-warn">{m.trustWarn}</p>
          </div>
        </div>
        <span className="permission-kind-badge">{m.trustBadge}</span>
      </div>

      <div className="permission-foot">
        <span className="permission-hint">{m.trustHint}</span>
        <div className="permission-actions">
          <button
            type="button"
            className="btn ghost"
            onClick={() => onResolve("reject")}
          >
            {m.trustReject}
          </button>
          <button
            ref={trustedRef}
            type="button"
            className="btn primary"
            onClick={() => onResolve("trust")}
          >
            {m.trustGrant}
          </button>
        </div>
      </div>
    </div>
  );
}