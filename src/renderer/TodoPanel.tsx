import { useMemo } from "react";
import type { TodoItemUi, TodoPriority, TodoStatus } from "@shared/types";
import type { Messages } from "./i18n";

/**
 * Dedicated todo checklist panel (TUI `TodoPane` counterpart).
 * Shows turn-scoped or goal-scoped todos with status + priority.
 */
type Props = {
  todos: TodoItemUi[];
  /** Optional subtitle e.g. goal objective. */
  subtitle?: string;
  m: Messages;
  onClose: () => void;
  /** Optional: jump to plan.md panel. */
  onOpenPlan?: () => void;
};

function counts(todos: TodoItemUi[]) {
  let pending = 0;
  let inProgress = 0;
  let completed = 0;
  let cancelled = 0;
  for (const t of todos) {
    if (t.status === "pending") pending++;
    else if (t.status === "in_progress") inProgress++;
    else if (t.status === "completed") completed++;
    else cancelled++;
  }
  return { pending, inProgress, completed, cancelled, total: todos.length };
}

function statusIcon(status: TodoStatus): string {
  switch (status) {
    case "in_progress":
      return "…";
    case "completed":
      return "✓";
    case "cancelled":
      return "✕";
    default:
      return "○";
  }
}

function priorityLabel(p: TodoPriority, m: Messages): string {
  if (p === "high") return m.todoPriorityHigh;
  if (p === "low") return m.todoPriorityLow;
  return m.todoPriorityMedium;
}

export function TodoPanel({
  todos,
  subtitle,
  m,
  onClose,
  onOpenPlan,
}: Props) {
  const c = useMemo(() => counts(todos), [todos]);
  const progressDenom = c.total - c.cancelled;
  const progressLabel =
    progressDenom > 0
      ? `${c.completed}/${progressDenom}`
      : c.total > 0
        ? `${c.completed}/${c.total}`
        : "";

  return (
    <div className="todo-panel">
      <div className="todo-panel-bar">
        <button type="button" className="right-panel-back" onClick={onClose}>
          ← {m.sidePanelToggle}
        </button>
        <div className="todo-panel-title-wrap">
          <span className="todo-panel-title">{m.todoPanelTitle}</span>
          {progressLabel ? (
            <span className="todo-panel-badge" title={m.planTodoProgress}>
              {progressLabel}
            </span>
          ) : null}
        </div>
        {onOpenPlan ? (
          <button
            type="button"
            className="todo-panel-plan-link"
            onClick={onOpenPlan}
          >
            {m.sidePanelPlan}
          </button>
        ) : null}
      </div>

      {subtitle ? (
        <div className="todo-panel-subtitle" title={subtitle}>
          {subtitle}
        </div>
      ) : null}

      {c.total > 0 ? (
        <div className="todo-panel-stats" aria-hidden>
          {c.inProgress > 0 ? (
            <span className="todo-stat in_progress">
              {m.todoStatInProgress.replace("{n}", String(c.inProgress))}
            </span>
          ) : null}
          {c.pending > 0 ? (
            <span className="todo-stat pending">
              {m.todoStatPending.replace("{n}", String(c.pending))}
            </span>
          ) : null}
          {c.completed > 0 ? (
            <span className="todo-stat completed">
              {m.todoStatCompleted.replace("{n}", String(c.completed))}
            </span>
          ) : null}
          {c.cancelled > 0 ? (
            <span className="todo-stat cancelled">
              {m.todoStatCancelled.replace("{n}", String(c.cancelled))}
            </span>
          ) : null}
        </div>
      ) : null}

      <div className="todo-panel-body">
        {todos.length === 0 ? (
          <div className="todo-panel-empty">{m.todoPanelEmpty}</div>
        ) : (
          <ol className="todo-panel-list">
            {todos.map((t, i) => (
              <li
                key={t.id}
                className={`todo-panel-item status-${t.status}`}
              >
                <span
                  className={`todo-panel-item-icon status-${t.status}`}
                  aria-hidden
                >
                  {t.status === "in_progress" ? (
                    <span className="todo-panel-spinner" />
                  ) : (
                    statusIcon(t.status)
                  )}
                </span>
                <span className="todo-panel-item-index">{i + 1}.</span>
                <span className="todo-panel-item-content">{t.content}</span>
                {t.priority && t.priority !== "medium" ? (
                  <span
                    className={`todo-panel-item-priority priority-${t.priority}`}
                  >
                    {priorityLabel(t.priority, m)}
                  </span>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
