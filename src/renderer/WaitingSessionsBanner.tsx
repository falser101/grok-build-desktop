import type { SessionRunStatus, SessionSummary } from "@shared/types";
import type { Messages } from "./i18n";

type Props = {
  /** All sessions known to the desktop. */
  sessions: SessionSummary[];
  /** Currently focused session id (excluded from the banner). */
  focusedSessionId?: string | null;
  m: Messages;
  onJumpToSession: (session: SessionSummary) => void;
};

/**
 * Banner that surfaces background sessions that need user input while the
 * user is reading another session. Merely running/loading sessions stay in
 * the sidebar and are intentionally not promoted above the composer.
 * Click a row to jump to that session.
 *
 * Hides automatically when the focused session is itself waiting on
 * something — the focused-session banner / modal already covers that.
 */
export function WaitingSessionsBanner({
  sessions,
  focusedSessionId,
  m,
  onJumpToSession,
}: Props) {
  const waiting = sessions.filter(
    (
      s,
    ): s is SessionSummary & { status: Exclude<SessionRunStatus, "idle" | "running" | "loading"> } =>
      s.sessionId !== focusedSessionId &&
      (s.status === "needs_question" ||
        s.status === "needs_permission" ||
        s.status === "needs_trust"),
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