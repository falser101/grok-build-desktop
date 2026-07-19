import type { SessionRunStatus, SessionSummary } from "@shared/types";
import type { Messages } from "./i18n";

type Props = {
  /** All sessions known to the desktop. */
  sessions: SessionSummary[];
  /** Currently focused session id (excluded from the banner). */
  focusedSessionId?: string | null;
  m: Messages;
  onJumpToSession: (session: SessionSummary) => void;
  onCancelSession: (sessionId: string) => void;
};

/**
 * Banner that surfaces background sessions that need user attention
 * while the user is reading another session. Click a row to jump to
 * that session (loads it), or hit the inline stop button to cancel the
 * session's in-flight turn without leaving the current focus.
 *
 * Hides automatically when the focused session is itself waiting on
 * something — the focused-session banner / modal already covers that.
 */
export function WaitingSessionsBanner({
  sessions,
  focusedSessionId,
  m,
  onJumpToSession,
  onCancelSession,
}: Props) {
  const waiting = sessions.filter(
    (s) =>
      s.sessionId !== focusedSessionId &&
      s.status &&
      s.status !== "idle" &&
      s.status !== "loading",
  );
  if (waiting.length === 0) return null;

  return (
    <div className="waiting-sessions-banner" role="region" aria-label={m.waitingSessionsBannerLabel}>
      <div className="waiting-sessions-banner-head">
        <span className="waiting-sessions-banner-title">
          {waiting.length === 1
            ? m.waitingSessionsBannerSingle
            : m.waitingSessionsBannerMany.replace("{n}", String(waiting.length))}
        </span>
      </div>
      <ul className="waiting-sessions-list">
        {waiting.map((s) => (
          <li key={s.sessionId} className="waiting-session-row">
            <button
              type="button"
              className="waiting-session-jump"
              onClick={() => onJumpToSession(s)}
              title={`${s.title || m.untitledSession} · ${labelForStatus(s.status, m)}`}
            >
              <SessionStatusGlyph status={s.status} />
              <span className="waiting-session-name">
                {s.title || m.untitledSession}
              </span>
              <span className="waiting-session-status">
                {labelForStatus(s.status, m)}
              </span>
            </button>
            {s.status === "running" || s.status === "loading" ? (
              <button
                type="button"
                className="waiting-session-cancel"
                onClick={() => onCancelSession(s.sessionId)}
                title={m.cancelSessionTooltip}
                aria-label={m.cancelSessionTooltip}
              >
                ■
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function labelForStatus(
  status: SessionRunStatus,
  m: Messages,
): string {
  switch (status) {
    case "running":
      return m.sessionStatusRunning;
    case "loading":
      return m.sessionStatusLoading;
    case "needs_question":
      return m.sessionStatusNeedsQuestion;
    case "needs_permission":
      return m.sessionStatusNeedsPermission;
    case "needs_trust":
      return m.sessionStatusNeedsTrust;
    default:
      return "";
  }
}

function SessionStatusGlyph({ status }: { status: SessionRunStatus }) {
  if (
    status === "needs_permission" ||
    status === "needs_question" ||
    status === "needs_trust"
  ) {
    return (
      <span className="waiting-session-glyph warn" aria-hidden>
        !
      </span>
    );
  }
  return <span className="waiting-session-glyph spin" aria-hidden />;
}