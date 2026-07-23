import { useEffect, useState } from "react";
import type { GoalStateSnapshot } from "@shared/types";
import type { Messages } from "./i18n";

type Props = {
  goal: GoalStateSnapshot;
  m: Messages;
  /** Open the goal detail modal (TUI: click chip). */
  onOpenDetail?: () => void;
  onPause?: () => void;
  onResume?: () => void;
  onClear?: () => void;
};

const SPINNER = ["·", "․", "•", "∙", "•", "․"];

/**
 * Compact TUI-style status chip above the composer while a goal runs.
 * Format mirrors pager `goal_status_line`:
 *   [· Goal: Executing]  40.8k tokens  ·  1m20s
 * Click opens detail; hover still reveals pause/resume/clear.
 */
export function GoalProgressBubble({
  goal,
  m,
  onOpenDetail,
  onPause,
  onResume,
  onClear,
}: Props) {
  const [hovered, setHovered] = useState(false);
  const [tick, setTick] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  const isActive = goal.status === "active";
  const isPaused = isPausedStatus(goal.status);

  useEffect(() => {
    if (!isActive) return;
    const id = window.setInterval(() => {
      setTick((t) => t + 1);
      setNow(Date.now());
    }, 250);
    return () => window.clearInterval(id);
  }, [isActive]);

  if (!goal.status) return null;
  if (goal.status === "complete" || goal.status === "cleared") return null;

  const phaseLabel = phaseChipLabel(goal, m);
  const tokensLabel = formatTokensLine(goal, m);
  const elapsedLabel = formatElapsed(
    liveElapsedMs(goal, isActive ? now : goal.updatedAt),
  );
  const spinner = isActive ? SPINNER[tick % SPINNER.length] : "";

  const showPause = isActive && Boolean(onPause);
  const showResume = isPaused && Boolean(onResume);
  const showClear = Boolean(onClear);

  const ariaLabel = [
    `Goal: ${phaseLabel}`,
    tokensLabel,
    elapsedLabel,
    goal.objective,
  ]
    .filter(Boolean)
    .join(" · ");

  const stop = (handler?: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation();
    handler?.();
  };

  return (
    <div
      className={`goal-progress-bubble-wrap${isPaused ? " paused" : ""}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <button
        type="button"
        className={`goal-progress-bubble${isPaused ? " paused" : ""}${
          isActive ? " active" : ""
        }`}
        onClick={() => onOpenDetail?.()}
        title={goal.pauseMessage || goal.objective || phaseLabel}
        aria-label={ariaLabel}
      >
        <span className="goal-progress-chip-bracket" aria-hidden>
          [
        </span>
        {spinner ? (
          <span className="goal-progress-spinner" aria-hidden>
            {spinner}
          </span>
        ) : null}
        <span className="goal-progress-chip-label">
          {m.goalChipName}: {phaseLabel}
        </span>
        <span className="goal-progress-chip-bracket" aria-hidden>
          ]
        </span>
        {tokensLabel ? (
          <span className="goal-progress-meta">{tokensLabel}</span>
        ) : null}
        {elapsedLabel ? (
          <span className="goal-progress-meta">{elapsedLabel}</span>
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
              onClick={stop(onPause)}
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
              onClick={stop(onResume)}
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
              onClick={stop(onClear)}
            >
              🗑
            </button>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}

export function isPausedStatus(status: string): boolean {
  return (
    status === "user_paused" ||
    status === "back_off_paused" ||
    status === "no_progress_paused" ||
    status === "infra_paused" ||
    status === "blocked" ||
    status === "paused"
  );
}

export function phaseChipLabel(goal: GoalStateSnapshot, m: Messages): string {
  if (isPausedStatus(goal.status)) {
    return statusToLabel(goal.status, m);
  }
  if (goal.status === "budget_limited") return m.goalStatusBudgetLimited;
  if (goal.status === "complete") return m.goalStatusComplete;
  if (goal.verifyingCompletion) {
    const a = goal.classifierRunsAttempted;
    const max = goal.classifierMaxRuns;
    if (a != null && max != null && (a > 0 || max > 0)) {
      return `${m.goalPhaseVerifying} (${a}/${max})`;
    }
    return m.goalPhaseVerifying;
  }
  if (goal.planning) return m.goalPhasePlanning;
  switch (goal.phase) {
    case "planning":
      return m.goalPhasePlanning;
    case "executing":
      return m.goalPhaseExecuting;
    case "idle":
      return m.goalPhaseIdle;
    default:
      return goal.phase || m.goalStatusActive;
  }
}

export function statusToLabel(status: string, m: Messages): string {
  switch (status) {
    case "active":
      return m.goalStatusActive;
    case "user_paused":
    case "paused":
      return m.goalStatusPaused;
    case "back_off_paused":
      return m.goalStatusPausedBackoff;
    case "no_progress_paused":
      return m.goalStatusPausedNoProgress;
    case "infra_paused":
      return m.goalStatusPausedError;
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

export function formatTokensCompact(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "0";
  if (n < 1000) return String(Math.round(n));
  if (n < 10_000) return `${(n / 1000).toFixed(1)}k`;
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

export function formatTokensLine(goal: GoalStateSnapshot, m: Messages): string {
  const used = goal.tokensUsed;
  if (used == null) return "";
  const u = formatTokensCompact(used);
  if (goal.tokenBudget != null && goal.tokenBudget > 0) {
    return m.goalTokensBudget
      .replace("{used}", u)
      .replace("{budget}", formatTokensCompact(goal.tokenBudget));
  }
  return m.goalTokensOnly.replace("{used}", u);
}

export function liveElapsedMs(goal: GoalStateSnapshot, nowMs: number): number {
  const base = goal.elapsedMs ?? 0;
  if (goal.status !== "active") return base;
  const delta = Math.max(0, nowMs - (goal.updatedAt || nowMs));
  return base + delta;
}

export function formatElapsed(ms: number): string {
  const totalSecs = Math.floor(ms / 1000);
  const hours = Math.floor(totalSecs / 3600);
  const mins = Math.floor((totalSecs % 3600) / 60);
  const secs = totalSecs % 60;
  if (hours > 0) return `${hours}h${String(mins).padStart(2, "0")}m`;
  if (mins > 0) return `${mins}m${String(secs).padStart(2, "0")}s`;
  return `${secs}s`;
}

export function humanizeGoalEvent(event: string | undefined, m: Messages): string {
  if (!event) return "";
  const map: Record<string, string> = {
    goal_created: m.goalEventCreated,
    planning_started: m.goalEventPlanningStarted,
    planning_completed: m.goalEventPlanningCompleted,
    planning_failed: m.goalEventPlanningFailed,
    worker_started: m.goalEventWorkerStarted,
    worker_completed: m.goalEventWorkerCompleted,
    worker_failed: m.goalEventWorkerFailed,
    goal_paused: m.goalEventPaused,
    goal_resumed: m.goalEventResumed,
    goal_completed: m.goalEventCompleted,
    goal_cleared: m.goalEventCleared,
    budget_exceeded: m.goalEventBudgetExceeded,
  };
  return map[event] ?? event.replace(/_/g, " ");
}
