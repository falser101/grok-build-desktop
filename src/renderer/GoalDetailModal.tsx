import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { GoalStateSnapshot, TodoItemUi } from "@shared/types";
import type { Messages } from "./i18n";
import {
  formatElapsed,
  formatTokensCompact,
  formatTokensLine,
  humanizeEventTimestamp,
  humanizeGoalEvent,
  isFailedStatus,
  isPausedStatus,
  liveElapsedMs,
  phaseChipLabel,
  statusToLabel,
} from "./GoalProgressBubble";

type Props = {
  goal: GoalStateSnapshot;
  goalTodos: TodoItemUi[];
  m: Messages;
  open: boolean;
  onClose: () => void;
};

const MAX_TODO = 15;
const MAX_MODEL = 6;
const SPINNER = ["·", "․", "•", "∙", "•", "․"];

/**
 * TUI-aligned goal detail overlay (pager `goal_detail.rs`).
 *
 * Strict TUI interaction:
 * - Esc / backdrop / [x] close
 * - Footer shows slash-command hints (no Pause/Resume/Clear buttons)
 * - Progress uses goal-scoped `goalTodos`
 *
 * Positioning: portaled into `.main` (conversation column) with absolute
 * fill so the dialog stays centered on the chat page — not the full
 * window — when the sidebar or right panel is open.
 */
export function GoalDetailModal({
  goal,
  goalTodos,
  m,
  open,
  onClose,
}: Props) {
  const [now, setNow] = useState(() => Date.now());
  const [tick, setTick] = useState(0);
  /** Host for the portal — `.main` conversation column when present. */
  const [host, setHost] = useState<HTMLElement | null>(null);
  const isActive = goal.status === "active";
  const isPaused = isPausedStatus(goal.status);
  const isFailed = isFailedStatus(goal.status);

  useEffect(() => {
    if (!open) {
      setHost(null);
      return;
    }
    const main = document.querySelector(".main");
    setHost(main instanceof HTMLElement ? main : document.body);
  }, [open]);

  useEffect(() => {
    if (!open || !isActive) return;
    const id = window.setInterval(() => {
      setNow(Date.now());
      setTick((t) => t + 1);
    }, 250);
    return () => window.clearInterval(id);
  }, [open, isActive]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open, onClose]);

  if (!open || !host) return null;

  const phase = phaseChipLabel(goal, m);
  const statusText = statusToLabel(
    isPaused || isFailed ? goal.status : "active",
    m,
  );
  // TUI status_label: paused/failed variants render status only (empty phase).
  const statusLine =
    isPaused || isFailed
      ? statusText
      : isActive || goal.phase
        ? `${statusText} — ${phase}`
        : statusText;

  const tokens = formatTokensLine(goal, m);
  const elapsed = formatElapsed(
    liveElapsedMs(goal, isActive ? now : goal.updatedAt),
  );
  const hasBudget =
    goal.tokenBudget != null &&
    goal.tokenBudget > 0 &&
    goal.tokensUsed != null;
  const budgetPct = hasBudget
    ? Math.min(1, (goal.tokensUsed as number) / (goal.tokenBudget as number))
    : null;

  const todos = goalTodos.slice(0, MAX_TODO);
  const todoOverflow = Math.max(0, goalTodos.length - MAX_TODO);

  const historyLabel = humanizeGoalEvent(
    goal.lastEvent,
    m,
    goal.lastEventDetail,
  );
  const historyTs = humanizeEventTimestamp(goal.lastEventTimestamp, m, now);

  const hasClassifier =
    goal.classifierRunsAttempted != null ||
    goal.classifierMaxRuns != null ||
    Boolean(goal.lastClassifierVerdict) ||
    Boolean(goal.lastClassifierDetailsPath);

  const showModels =
    Boolean(goal.currentSubagentRole) &&
    Array.isArray(goal.liveTokensByModel) &&
    goal.liveTokensByModel.length >= 2;

  const models = showModels
    ? goal.liveTokensByModel!.slice(0, MAX_MODEL)
    : [];
  const modelOverflow = showModels
    ? Math.max(0, goal.liveTokensByModel!.length - MAX_MODEL)
    : 0;

  const titleSpinner = isActive ? SPINNER[tick % SPINNER.length] : "";
  const titleText = goal.objective || m.goalChipName;

  const footerHint = isFailed
    ? m.goalDetailCommandsFailed
    : m.goalDetailCommands;

  return createPortal(
    <div
      className="goal-detail-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={m.goalDetailAria}
      onClick={onClose}
    >
      <div
        className="goal-detail-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="goal-detail-header">
          <h2 className="goal-detail-title" title={goal.objective}>
            {titleSpinner ? (
              <span className="goal-detail-title-spinner" aria-hidden>
                {titleSpinner}{" "}
              </span>
            ) : null}
            {titleText}
          </h2>
          <button
            type="button"
            className="goal-detail-close"
            onClick={onClose}
            aria-label={m.goalDetailClose}
            title={m.goalDetailClose}
          >
            ×
          </button>
        </header>

        <div className="goal-detail-body">
          {/* Status */}
          <div className="goal-detail-row">
            <span className="goal-detail-k">{m.goalDetailStatus}:</span>
            <span
              className={`goal-detail-status-v${
                isPaused || isFailed
                  ? " warn"
                  : isActive
                    ? " ok"
                    : ""
              }`}
            >
              {statusLine}
            </span>
          </div>

          {/* Recovery hint + reason (paused / failed / interrupted) */}
          {isPaused ? (
            <>
              <div className="goal-detail-hint warn">
                {m.goalPausedResumeLine.replace("{status}", statusText)}
              </div>
              {goal.pauseMessage ? (
                <div className="goal-detail-reason">
                  <span className="goal-detail-reason-label">
                    {m.goalPauseReasonLabel}
                  </span>
                  <span className="goal-detail-reason-text">
                    {goal.pauseMessage}
                  </span>
                </div>
              ) : null}
            </>
          ) : null}
          {isFailed ? (
            <>
              <div className="goal-detail-hint warn">
                {m.goalFailedClearLine.replace("{status}", statusText)}
              </div>
              {goal.pauseMessage ? (
                <div className="goal-detail-reason">
                  <span className="goal-detail-reason-label">
                    {m.goalPauseReasonLabel}
                  </span>
                  <span className="goal-detail-reason-text">
                    {goal.pauseMessage}
                  </span>
                </div>
              ) : null}
            </>
          ) : null}

          {/* Budget / tokens + elapsed */}
          <div className="goal-detail-row meta">
            {hasBudget ? (
              <span>
                {m.goalDetailBudget}: {tokens}
                {budgetPct != null
                  ? ` (${Math.round(budgetPct * 100)}%)`
                  : ""}
              </span>
            ) : tokens ? (
              <span>
                {m.goalDetailTokens}: {tokens}
              </span>
            ) : null}
            <span>
              {m.goalDetailElapsed}: {elapsed}
            </span>
          </div>

          {budgetPct != null ? (
            <div
              className={`goal-detail-budget-bar${
                budgetPct > 0.8
                  ? " high"
                  : budgetPct >= 0.5
                    ? " mid"
                    : " low"
              }`}
              role="progressbar"
              aria-valuenow={Math.round(budgetPct * 100)}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div
                className="goal-detail-budget-fill"
                style={{ width: `${Math.round(budgetPct * 100)}%` }}
              />
              <span className="goal-detail-budget-pct">
                {Math.round(budgetPct * 100)}%
              </span>
            </div>
          ) : null}

          {/* Progress (todos) */}
          <div className="goal-detail-section">
            {todos.length === 0 ? (
              <div className="goal-detail-empty">{m.goalNoProgressItems}</div>
            ) : (
              <>
                <div className="goal-detail-section-title">
                  {m.goalProgressSection}:
                </div>
                <ul className="goal-detail-todo-list">
                  {todos.map((t) => (
                    <li
                      key={t.id}
                      className={`goal-detail-todo status-${t.status}`}
                    >
                      <span className="goal-detail-todo-icon" aria-hidden>
                        {todoIcon(t.status)}
                      </span>
                      <span className="goal-detail-todo-text">{t.content}</span>
                    </li>
                  ))}
                </ul>
                {todoOverflow > 0 ? (
                  <div className="goal-detail-more">
                    {m.goalProgressMore.replace("{n}", String(todoOverflow))}
                  </div>
                ) : null}
              </>
            )}
          </div>

          {/* Active subagent + live metrics + per-model (≥2) */}
          {goal.currentSubagentRole ? (
            <div className="goal-detail-section">
              <div className="goal-detail-row">
                <span className="goal-detail-k">{m.goalActiveSubagent}:</span>
                <span className="goal-detail-subagent-role">
                  {goal.currentSubagentRole}
                  {(goal.totalWorkerRounds ?? 0) +
                    (goal.totalVerifyRounds ?? 0) >
                  0
                    ? ` (round ${(goal.totalWorkerRounds ?? 0) + (goal.totalVerifyRounds ?? 0)})`
                    : ""}
                </span>
              </div>
              {(goal.liveSubagentTokens != null ||
                goal.liveContextPct != null ||
                goal.liveTurnCount != null ||
                goal.liveToolCallCount != null) && (
                <div className="goal-detail-row meta goal-detail-subagent-metrics">
                  {goal.liveSubagentTokens != null ? (
                    <span>
                      Tokens: {formatTokensCompact(goal.liveSubagentTokens)}
                    </span>
                  ) : null}
                  {goal.liveContextPct != null ? (
                    <span>Context: {goal.liveContextPct}%</span>
                  ) : null}
                  {goal.liveTurnCount != null ? (
                    <span>Turns: {goal.liveTurnCount}</span>
                  ) : null}
                  {goal.liveToolCallCount != null ? (
                    <span>Tools: {goal.liveToolCallCount}</span>
                  ) : null}
                </div>
              )}
              {models.length > 0 ? (
                <div className="goal-detail-token-breakdown">
                  {models.map((row, i) => (
                    <div key={i} className="goal-detail-token-model">
                      <span className="goal-detail-token-model-name">
                        {row.model}
                      </span>
                      <span className="goal-detail-token-model-tokens">
                        {formatTokensCompact(row.tokens)}
                      </span>
                    </div>
                  ))}
                  {modelOverflow > 0 ? (
                    <div className="goal-detail-more">
                      +{modelOverflow} more
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}

          {/* Completion review */}
          {hasClassifier ? (
            <div className="goal-detail-section">
              <div className="goal-detail-section-title">
                {m.goalCompletionReview}:
              </div>
              <div className="goal-detail-row">
                <span className="goal-detail-k">{m.goalLastVerdict}</span>
                <span
                  className={
                    goal.lastClassifierVerdict === "Achieved"
                      ? "goal-detail-ok"
                      : goal.lastClassifierVerdict === "NotAchieved"
                        ? "goal-detail-warn"
                        : ""
                  }
                >
                  {goal.lastClassifierVerdict === "Achieved"
                    ? m.goalVerdictAchieved
                    : goal.lastClassifierVerdict === "NotAchieved"
                      ? m.goalVerdictNotAchieved
                      : m.goalVerdictPending}
                </span>
              </div>
              <div className="goal-detail-row">
                <span className="goal-detail-k">{m.goalAttempts}</span>
                <span>
                  {goal.classifierRunsAttempted != null &&
                  goal.classifierMaxRuns != null &&
                  (goal.classifierRunsAttempted > 0 ||
                    goal.classifierMaxRuns > 0)
                    ? `${goal.classifierRunsAttempted} / ${goal.classifierMaxRuns}`
                    : "—"}
                </span>
              </div>
              <div className="goal-detail-row">
                <span className="goal-detail-k">{m.goalDetails}</span>
                <span className="goal-detail-mono">
                  {goal.lastClassifierDetailsPath || "—"}
                </span>
              </div>
            </div>
          ) : null}

          {/* Recent history */}
          {historyLabel ? (
            <div className="goal-detail-section">
              <div className="goal-detail-section-title">
                {m.goalRecentHistory}:
              </div>
              <div className="goal-detail-history">
                {historyTs ? (
                  <span className="goal-detail-history-ts">{historyTs}  </span>
                ) : null}
                <span>{historyLabel}</span>
              </div>
            </div>
          ) : null}
        </div>

        <footer className="goal-detail-footer">
          <span className="goal-detail-esc-hint">{footerHint}</span>
        </footer>
      </div>
    </div>,
    host,
  );
}

function todoIcon(status: string): string {
  switch (status) {
    case "in_progress":
      return "▶";
    case "completed":
      return "✓";
    case "cancelled":
      return "✕";
    default:
      return "□";
  }
}
