import type {
  AgentActivity,
  NeedsInputReason,
  SessionSummary,
} from "@shared/types";
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
    ): s is SessionSummary & {
      status: "needsInput";
      needsInputReason: NeedsInputReason;
    } =>
      s.sessionId !== focusedSessionId && s.status === "needsInput",
  );
  if (waiting.length === 0) return null;

  return (
    <div
      className="waiting-sessions-banner"
      role="region"
      aria-label={m.waitingSessionsBannerLabel}
    >
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
              title={`${s.title || m.untitledSession} · ${labelForStatus(
                s.status,
                s.needsInputReason,
                m,
              )}`}
            >
              <SessionStatusGlyph
                status={s.status}
                reason={s.needsInputReason}
              />
              <span className="waiting-session-name">
                {s.title || m.untitledSession}
              </span>
              <span className="waiting-session-status">
                {labelForStatus(s.status, s.needsInputReason, m)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function labelForStatus(
  status: AgentActivity,
  reason: NeedsInputReason | undefined,
  m: Messages,
): string {
  switch (status) {
    case "working":
      return m.sessionStatusWorking;
    case "loading":
      return m.sessionStatusLoading;
    case "needsInput":
      if (reason === "permission") return m.needsInputReasonPermission;
      if (reason === "question") return m.needsInputReasonQuestion;
      if (reason === "trust") return m.needsInputReasonTrust;
      if (reason === "plan") return m.needsInputReasonPlan;
      return m.sessionStatusNeedsInput;
    case "completed":
      return m.sessionStatusCompleted;
    case "failed":
      return m.sessionStatusFailed;
    case "cancelled":
      return m.sessionStatusCancelled;
    case "blocked":
      return m.sessionStatusBlocked;
    default:
      return "";
  }
}

function SessionStatusGlyph({
  status,
  reason,
}: {
  status: AgentActivity;
  reason?: NeedsInputReason;
}) {
  if (status === "needsInput") {
    // plan 单独配色(蓝灰),与 permission(橙)/question(紫)/trust(黄)区分
    const variant =
      reason === "question"
        ? "question"
        : reason === "trust"
          ? "trust"
          : reason === "plan"
            ? "plan"
            : reason === "permission"
              ? "permission"
              : "";
    return (
      <span
        className={`waiting-session-glyph warn${variant ? ` ${variant}` : ""}`}
        aria-hidden
      >
        !
      </span>
    );
  }
  return <span className="waiting-session-glyph spin" aria-hidden />;
}