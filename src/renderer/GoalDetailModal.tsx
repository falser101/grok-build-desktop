import { useEffect, useState } from "react";
import type { GoalStateSnapshot, TodoItemUi } from "@shared/types";
import type { Messages } from "./i18n";
import {
  formatElapsed,
  formatTokensLine,
  humanizeGoalEvent,
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
  onPause?: () => void;
  onResume?: () => void;
  onClear?: () => void;
};

const MAX_TODO = 15;

/**
 * TUI-aligned goal detail overlay (see pager goal_detail.rs).
 * Progress uses goal-scoped goalTodos (not the turn-scoped checklist).
 */
export function GoalDetailModal({
  goal,
  goalTodos,
  m,
  open,
  onClose,
  onPause,
  onResume,
  onClear,
}: Props) {
  const [now, setNow] = useState(() => Date.now());
  const isActive = goal.status === "active";
  const isPaused = isPausedStatus(goal.status);

  useEffect(() => {
    if (!open || !isActive) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
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

  if (!open) return null;

  const phase = phaseChipLabel(goal, m);
  const statusText = statusToLabel(
    isPaused ? goal.status : "active",
    m,
  );
  const statusLine =
    isActive || goal.phase
      ? `${statusText} — ${phase}`
      : statusText;
  const tokens = formatTokensLine(goal, m);
  const elapsed = formatElapsed(
    liveElapsedMs(goal, isActive ? now : goal.updatedAt),
  );
  const budgetPct =
    goal.tokenBudget != null &&
    goal.tokenBudget > 0 &&
    goal.tokensUsed != null
      ? Math.min(1, goal.tokensUsed / goal.tokenBudget)
      : null;

  const todos = goalTodos.slice(0, MAX_TODO);
  const todoOverflow = Math.max(0, goalTodos.length - MAX_TODO);
  const historyLabel = humanizeGoalEvent(goal.lastEvent, m);

  return (
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
            {goal.objective || m.goalChipName}
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
          <div className="goal-detail-row">
            <span className="goal-detail-k">{m.goalDetailStatus}</span>
            <span
              className={`goal-detail-status-v${
                isPaused ? " warn" : isActive ? " ok" : ""
              }`}
            >
              {statusLine}
            </span>
          </div>
          {isPaused ? (
            <div className="goal-detail-hint warn">
              {goal.pauseMessage || m.goalPausedResumeHint}
            </div>
          ) : null}

          <div className="goal-detail-row meta">
            {tokens ? (
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
              className="goal-detail-budget-bar"
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

          <div className="goal-detail-section">
            <div className="goal-detail-section-title">
              {m.goalProgressSection}
            </div>
            {todos.length === 0 ? (
              <div className="goal-detail-empty">{m.goalNoProgressItems}</div>
            ) : (
              <ul className="goal-detail-todo-list">
                {todos.map((t) => (
                  <li
                    key={t.id}
                    className={`goal-detail-todo status-${t.status}`}
                  >
                    <span className="goal-detail-todo-icon" aria-hidden>
                      {t.status === "in_progress" ? (
                        <span className="goal-detail-todo-spinner" />
                      ) : (
                        todoIcon(t.status)
                      )}
                    </span>
                    <span className="goal-detail-todo-text">{t.content}</span>
                  </li>
                ))}
              </ul>
            )}
            {todoOverflow > 0 ? (
              <div className="goal-detail-more">
                {m.goalProgressMore.replace("{n}", String(todoOverflow))}
              </div>
            ) : null}
          </div>

          {goal.currentSubagentRole ? (
            <div className="goal-detail-row">
              <span className="goal-detail-k">{m.goalActiveSubagent}</span>
              <span>{goal.currentSubagentRole}</span>
            </div>
          ) : null}

          {historyLabel ? (
            <div className="goal-detail-section">
              <div className="goal-detail-section-title">
                {m.goalRecentHistory}
              </div>
              <div className="goal-detail-history">
                {historyLabel}
                {goal.lastEventDetail ? (
                  <span className="goal-detail-history-detail">
                    {" "}
                    — {goal.lastEventDetail}
                  </span>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>

        <footer className="goal-detail-footer">
          <div className="goal-detail-actions">
            {isActive && onPause ? (
              <button type="button" className="btn subtle" onClick={onPause}>
                {m.goalActionPause}
              </button>
            ) : null}
            {isPaused && onResume ? (
              <button type="button" className="btn subtle" onClick={onResume}>
                {m.goalActionResume}
              </button>
            ) : null}
            {onClear ? (
              <button type="button" className="btn subtle danger" onClick={onClear}>
                {m.goalActionClear}
              </button>
            ) : null}
          </div>
          <span className="goal-detail-esc-hint">{m.goalDetailEscHint}</span>
        </footer>
      </div>
    </div>
  );
}

function todoIcon(status: string): string {
  switch (status) {
    case "in_progress":
      // Spinner is a CSS element (`.goal-detail-todo-spinner`), not a glyph.
      return "";
    case "completed":
      return "✓";
    case "cancelled":
      return "✕";
    default:
      return "□";
  }
}
