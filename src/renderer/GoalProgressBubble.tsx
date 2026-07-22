import { useState } from "react";
import type { GoalStateSnapshot } from "@shared/types";
import type { Messages } from "./i18n";

type Props = {
  goal: GoalStateSnapshot;
  m: Messages;
  onOpenPanel?: () => void;
  onPause?: () => void;
  onResume?: () => void;
  onClear?: () => void;
};

/**
 * Compact pill shown above the composer while the goal subsystem is
 * working. Mirrors the agent's xAI `goal_updated` snapshot:
 *   - objective text
 *   - phase (planning / executing)
 *   - status (active / paused / blocked / complete)
 *   - progress X/Y (completed / total deliverables)
 *   - current sub-task title
 *   - pause_message when the goal is blocked / paused-with-reason
 *
 * Hidden once the goal is complete. Clicking the chip body opens the
 * right-side plan panel (which shows the goal's plan.md if any).
 * Hover reveals three control buttons (⏸ pause, ▶ resume, 🗑 clear)
 * wired through the `onPause` / `onResume` / `onClear` props — the
 * host sends the corresponding `/goal pause|resume|clear` slash
 * command to the agent.
 */
export function GoalProgressBubble({
  goal,
  m,
  onOpenPanel,
  onPause,
  onResume,
  onClear,
}: Props) {
  const [hovered, setHovered] = useState(false);

  // Don't show for terminal / empty states.
  if (!goal.status) return null;
  if (goal.status === "complete") return null;

  const statusLabel = statusToLabel(goal.status, m);
  const phaseLabel = phaseToLabel(goal.phase, m);
  const progress =
    goal.totalDeliverables > 0
      ? `${goal.completedDeliverables}/${goal.totalDeliverables}`
      : null;

  // Objective strip: drop a leading "/goal " so the chip shows the
  // human intent rather than the raw command.
  const objective = goal.objective.replace(/^\s*\/goal\s*/i, "").trim();
  const isPaused = goal.status !== "active";

  // Which controls to surface depends on status:
  //   active          → pause + clear
  //   user_paused/*    → resume + clear
  //   blocked         → resume + clear (Blocked is technically not paused
  //                    but GoalStatus::is_paused() returns true for it; the
  //                    resume handler falls through to "no active goal" which
  //                    is acceptable UX)
  //   budget_limited  → clear only (terminal-ish)
  const showPause = goal.status === "active" && Boolean(onPause);
  const showResume =
    goal.status !== "active" &&
    goal.status !== "complete" &&
    goal.status !== "budget_limited" &&
    Boolean(onResume);
  const showClear = Boolean(onClear);

  const ariaLabel = [
    objective || statusLabel,
    phaseLabel,
    progress ?? null,
    goal.currentDeliverableTitle,
  ]
    .filter(Boolean)
    .join(" · ");

  const stopBubbleClick = (handler?: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation();
    handler?.();
  };

  return (
    <div
      className="goal-progress-bubble-wrap"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <button
        type="button"
        className={`goal-progress-bubble${isPaused ? " paused" : ""}`}
        onClick={() => onOpenPanel?.()}
        title={goal.pauseMessage || objective || statusLabel}
        aria-label={ariaLabel}
      >
        <span className="goal-progress-icon" aria-hidden="true">
          🎯
        </span>
        {objective ? (
          <span className="goal-progress-objective">{objective}</span>
        ) : (
          <span className="goal-progress-objective">{statusLabel}</span>
        )}
        <span className="goal-progress-phase">{phaseLabel}</span>
        {progress ? (
          <span className="goal-progress-count">· {progress}</span>
        ) : null}
        {goal.currentDeliverableTitle ? (
          <span className="goal-progress-current">
            ↳ {goal.currentDeliverableTitle}
          </span>
        ) : null}
      </button>
      {(showPause || showResume || showClear) && hovered ? (
        <span className="goal-progress-actions" role="group">
          {showPause ? (
            <button
              type="button"
              className="goal-progress-action"
              title={m.goalActionPause}
              aria-label={m.goalActionPause}
              onClick={stopBubbleClick(onPause)}
            >
              ⏸
            </button>
          ) : null}
          {showResume ? (
            <button
              type="button"
              className="goal-progress-action"
              title={m.goalActionResume}
              aria-label={m.goalActionResume}
              onClick={stopBubbleClick(onResume)}
            >
              ▶
            </button>
          ) : null}
          {showClear ? (
            <button
              type="button"
              className="goal-progress-action danger"
              title={m.goalActionClear}
              aria-label={m.goalActionClear}
              onClick={stopBubbleClick(onClear)}
            >
              🗑
            </button>
          ) : null}
        </span>
      ) : null}
      {goal.pauseMessage ? (
        <div className="goal-progress-pause">{goal.pauseMessage}</div>
      ) : null}
    </div>
  );
}

function statusToLabel(status: string, m: Messages): string {
  switch (status) {
    case "active":
      return m.goalStatusActive;
    case "user_paused":
      return m.goalStatusPaused;
    case "back_off_paused":
      return m.goalStatusPaused;
    case "no_progress_paused":
      return m.goalStatusPaused;
    case "infra_paused":
      return m.goalStatusPaused;
    case "blocked":
      return m.goalStatusBlocked;
    case "budget_limited":
      return m.goalStatusBudgetLimited;
    case "complete":
      return m.goalStatusComplete;
    default:
      return status;
  }
}

function phaseToLabel(phase: string, m: Messages): string {
  switch (phase) {
    case "planning":
      return m.goalPhasePlanning;
    case "executing":
      return m.goalPhaseExecuting;
    case "idle":
      return "";
    default:
      return phase;
  }
}