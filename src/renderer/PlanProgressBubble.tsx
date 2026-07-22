import { useEffect, useMemo, useRef, useState } from "react";
import type { TodoItemUi, TodoStatus } from "@shared/types";
import type { Messages } from "./i18n";
import {
  currentTaskHoverText,
  selectCurrentTodoIndex,
  shouldShowPlanProgress,
} from "./planProgressCurrent";

type Props = {
  todos: TodoItemUi[];
  m: Messages;
  /** Optional: open right-side Plan panel (link inside expanded list). */
  onOpenPanel?: () => void;
};

/**
 * Compact pill above the composer while a plan is executing ("Step X / Y").
 *
 * - Hover: surfaces only the currently running (or next pending) task
 *   (native title + compact tip) — not the full multi-item list.
 * - Click: toggles an expanded popup listing every todo with status.
 * - Hidden when the plan is finished (all completed/cancelled).
 */
export function PlanProgressBubble({ todos, m, onOpenPanel }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [hovered, setHovered] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const stats = useMemo(() => {
    let inProgress = 0;
    let pending = 0;
    let completed = 0;
    let cancelled = 0;
    for (const t of todos) {
      if (t.status === "in_progress") inProgress++;
      else if (t.status === "pending") pending++;
      else if (t.status === "completed") completed++;
      else cancelled++;
    }
    const total = todos.length;
    const denom = total - cancelled;
    const done = completed + cancelled;
    return { inProgress, pending, completed, cancelled, total, denom, done };
  }, [todos]);

  const currentIdx = useMemo(() => selectCurrentTodoIndex(todos), [todos]);
  const show = shouldShowPlanProgress(todos);

  // Close expanded popup when todos clear / pill unmounts path.
  useEffect(() => {
    if (!show) setExpanded(false);
  }, [show]);

  // Outside click + Escape dismiss expanded list.
  useEffect(() => {
    if (!expanded) return;
    const onDoc = (e: MouseEvent) => {
      const el = wrapRef.current;
      if (!el) return;
      if (e.target instanceof Node && el.contains(e.target)) return;
      setExpanded(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpanded(false);
    };
    document.addEventListener("mousedown", onDoc, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDoc, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [expanded]);

  if (!show || currentIdx < 0) return null;

  const current = todos[currentIdx]!;
  const stepNum = currentIdx + 1;
  const stepLabel = m.planProgressStep
    .replace("{n}", String(stepNum))
    .replace("{total}", String(stats.denom || stats.total));
  const hoverText = currentTaskHoverText(todos, current.content);

  const onToggle = () => {
    setExpanded((v) => !v);
  };

  return (
    <div
      ref={wrapRef}
      className="plan-progress-bubble-wrap"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <button
        type="button"
        className={`plan-progress-bubble${expanded ? " expanded" : ""}`}
        onClick={onToggle}
        title={hoverText}
        aria-expanded={expanded}
        aria-haspopup="dialog"
        aria-label={`${stepLabel} · ${current.content}`}
      >
        <span className="plan-progress-bubble-spinner" aria-hidden />
        <span className="plan-progress-bubble-text">{stepLabel}</span>
        {stats.pending > 0 ? (
          <span className="plan-progress-bubble-pending">
            · {m.planProgressPending.replace("{n}", String(stats.pending))}
          </span>
        ) : null}
      </button>

      {/* Hover: current task only (not the full list). */}
      {hovered && !expanded ? (
        <div className="plan-progress-bubble-hover-tip" role="tooltip">
          <span className="plan-progress-bubble-hover-step">
            {stepLabel}
          </span>
          <span className="plan-progress-bubble-hover-content">
            {current.content}
          </span>
        </div>
      ) : null}

      {/* Click: full todo list. */}
      {expanded ? (
        <div
          className="plan-progress-bubble-tasks"
          role="dialog"
          aria-label={m.planProgressTasksTitle}
        >
          <div className="plan-progress-bubble-tasks-title">
            {m.planProgressTasksTitle}
          </div>
          <ul className="plan-progress-bubble-tasks-list">
            {todos.map((t, i) => (
              <li
                key={t.id}
                className={`plan-progress-bubble-task status-${t.status}${
                  i === currentIdx ? " current" : ""
                }`}
              >
                <span
                  className={`plan-progress-bubble-task-icon status-${t.status}`}
                  aria-hidden
                >
                  {todoStatusIcon(t.status)}
                </span>
                <span className="plan-progress-bubble-task-step">
                  {i + 1}.
                </span>
                <span className="plan-progress-bubble-task-content">
                  {t.content}
                </span>
              </li>
            ))}
          </ul>
          {onOpenPanel ? (
            <button
              type="button"
              className="plan-progress-bubble-open-panel"
              onClick={() => {
                setExpanded(false);
                onOpenPanel();
              }}
            >
              {m.sidePanelPlan}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function todoStatusIcon(status: TodoStatus): string {
  switch (status) {
    case "in_progress":
      return "↻";
    case "completed":
      return "✓";
    case "cancelled":
      return "✕";
    default:
      return "○";
  }
}
