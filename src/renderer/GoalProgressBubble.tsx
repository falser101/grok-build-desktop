import { useEffect, useState } from "react";
import type { GoalStateSnapshot } from "@shared/types";
import type { Messages } from "./i18n";

type Props = {
  goal: GoalStateSnapshot;
  m: Messages;
  /** Toggle the goal detail overlay (TUI: click chip / `g`). */
  onOpenDetail?: () => void;
};

const SPINNER = ["·", "․", "•", "∙", "•", "․"];

/**
 * Compact TUI-style status chip above the composer while a goal runs.
 *
 * Mirrors pager `goal_status_line`:
 *   [· Goal: Executing]  40.8k tokens  1m
 *
 * Interaction (strict TUI):
 * - Click toggles detail overlay
 * - Hover only bolds/underlines the chip text (clickability cue)
 * - No pause / resume / clear buttons on the chip
 */
export function GoalProgressBubble({ goal, m, onOpenDetail }: Props) {
  const [hovered, setHovered] = useState(false);
  const [tick, setTick] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  const isActive = goal.status === "active";
  const isPaused = isPausedStatus(goal.status);
  const isFailed =
    goal.status === "failed" || goal.status === "interrupted";

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
  const elapsedLabel = formatElapsedCompact(
    liveElapsedMs(goal, isActive ? now : goal.updatedAt),
  );
  const spinner = isActive ? SPINNER[tick % SPINNER.length] : "";

  const chipInner = spinner
    ? `${spinner} ${m.goalChipName}: ${phaseLabel}`
    : `${m.goalChipName}: ${phaseLabel}`;

  const ariaLabel = [
    `Goal: ${phaseLabel}`,
    tokensLabel,
    elapsedLabel,
    goal.objective,
  ]
    .filter(Boolean)
    .join(" · ");

  const toneClass = isPaused
    ? " paused"
    : isFailed
      ? " failed"
      : isActive
        ? " active"
        : "";

  return (
    <div className={`goal-progress-bubble-wrap${toneClass}`}>
      <button
        type="button"
        className={`goal-progress-bubble${toneClass}${hovered ? " hovered" : ""}`}
        onClick={() => onOpenDetail?.()}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        title={goal.pauseMessage || goal.objective || phaseLabel}
        aria-label={ariaLabel}
      >
        <span className="goal-progress-chip-bracket" aria-hidden>
          [
        </span>
        <span className="goal-progress-chip-label">{chipInner}</span>
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

export function isFailedStatus(status: string): boolean {
  return status === "failed" || status === "interrupted";
}

export function phaseChipLabel(goal: GoalStateSnapshot, m: Messages): string {
  if (isPausedStatus(goal.status)) {
    return statusToLabel(goal.status, m);
  }
  if (goal.status === "failed") return m.goalStatusFailed;
  if (goal.status === "interrupted") return m.goalStatusInterrupted;
  if (goal.status === "budget_limited") return m.goalStatusBudgetLimited;
  if (goal.status === "complete") return m.goalStatusComplete;
  if (goal.verifyingCompletion) {
    const a = goal.classifierRunsAttempted;
    const max = goal.classifierMaxRuns;
    // Omit "(0/0)" until a real counter arrives (TUI classifier_attempts_label).
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
    case "failed":
      return m.goalStatusFailed;
    case "interrupted":
      return m.goalStatusInterrupted;
    case "budget_limited":
      return m.goalStatusBudgetLimited;
    case "complete":
      return m.goalStatusComplete;
    default:
      return status;
  }
}

/** TUI `format_tokens_compact`: 500, 1.5k, 50k, 1.5M (strip trailing .0). */
export function formatTokensCompact(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) {
    const m = abs / 1_000_000;
    const s = m.toFixed(1).replace(/\.0$/, "");
    return `${sign}${s}M`;
  }
  if (abs >= 1_000) {
    const k = abs / 1_000;
    const s = k.toFixed(1).replace(/\.0$/, "");
    return `${sign}${s}k`;
  }
  return String(Math.round(n));
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

/** Modal / detail: `5s`, `1m20s`, `1h02m` (TUI goal_detail::format_elapsed). */
export function formatElapsed(ms: number): string {
  const totalSecs = Math.floor(ms / 1000);
  const hours = Math.floor(totalSecs / 3600);
  const mins = Math.floor((totalSecs % 3600) / 60);
  const secs = totalSecs % 60;
  if (hours > 0) return `${hours}h${String(mins).padStart(2, "0")}m`;
  if (mins > 0) return `${mins}m${String(secs).padStart(2, "0")}s`;
  return `${secs}s`;
}

/** Status chip: `5s`, `3m`, `2h` (TUI format_elapsed_compact). */
export function formatElapsedCompact(ms: number): string {
  const secs = Math.floor(ms / 1000);
  if (secs >= 3600) return `${Math.floor(secs / 3600)}h`;
  if (secs >= 60) return `${Math.floor(secs / 60)}m`;
  return `${secs}s`;
}

/**
 * Humanize a wire goal-event name (+ optional detail) for Recent History.
 * Mirrors pager `humanize_goal_event` — folds detail into the label so
 * machine vocabulary never reaches the user.
 */
export function humanizeGoalEvent(
  event: string | undefined,
  m: Messages,
  detail?: string | null,
): string {
  if (!event) return "";
  const phrase = detail
    ? detail.replace(/_/g, " ").replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, " ")
    : "";
  switch (event) {
    case "goal_created":
      return m.goalEventCreated;
    case "planning_started":
      return m.goalEventPlanningStarted;
    case "planning_completed":
      return m.goalEventPlanningCompleted;
    case "planning_failed":
      return m.goalEventPlanningFailed;
    case "worker_started":
      return m.goalEventWorkerStarted;
    case "worker_completed":
      return m.goalEventWorkerCompleted;
    case "worker_failed":
      return m.goalEventWorkerFailed;
    case "context_rotated":
      return m.goalEventContextRotated;
    case "goal_paused":
      if (phrase && phrase !== "user") {
        return m.goalEventPausedWithDetail.replace("{detail}", phrase);
      }
      return m.goalEventPaused;
    case "goal_resumed":
      return m.goalEventResumed;
    case "goal_completed":
      return m.goalEventCompleted;
    case "goal_cleared":
      return m.goalEventCleared;
    case "budget_exceeded":
      return m.goalEventBudgetExceeded;
    case "premature_stop_detected":
      return phrase
        ? m.goalEventPrematureStopWithDetail.replace("{detail}", phrase)
        : m.goalEventPrematureStop;
    default: {
      const deSnake = event.replace(/_/g, " ");
      return deSnake.charAt(0).toUpperCase() + deSnake.slice(1);
    }
  }
}

/** Relative time for RFC3339 event timestamps ("2m ago" / "just now"). */
export function humanizeEventTimestamp(
  ts: string | undefined,
  m: Messages,
  nowMs = Date.now(),
): string {
  if (!ts) return "";
  const parsed = Date.parse(ts);
  if (Number.isNaN(parsed)) {
    return ts.replace(/[\x00-\x1f]/g, " ");
  }
  const secs = Math.max(0, Math.floor((nowMs - parsed) / 1000));
  if (secs < 5) return m.goalEventJustNow;
  if (secs < 60) return m.goalEventAgo.replace("{t}", `${secs}s`);
  if (secs < 3600) return m.goalEventAgo.replace("{t}", `${Math.floor(secs / 60)}m`);
  if (secs < 86400) return m.goalEventAgo.replace("{t}", `${Math.floor(secs / 3600)}h`);
  return m.goalEventAgo.replace("{t}", `${Math.floor(secs / 86400)}d`);
}
