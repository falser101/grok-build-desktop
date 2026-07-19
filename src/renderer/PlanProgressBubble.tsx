import { useMemo, useState } from "react";
import type { TodoItemUi } from "@shared/types";
import type { Messages } from "./i18n";

type Props = {
  todos: TodoItemUi[];
  m: Messages;
  onOpenPanel?: () => void;
};

/**
 * Compact pill shown above the composer while a plan is being executed.
 * Format: "Step X / Y" with a spinner for the currently running item.
 *
 * Hidden when the plan has finished (all items completed/cancelled) or
 * when the user has dismissed it for this session — we trust the right
 * Plan panel to be the canonical view, this is just a heads-up display.
 */
export function PlanProgressBubble({ todos, m, onOpenPanel }: Props) {
  const [expanded, setExpanded] = useState(false);

  const stats = useMemo(() => {
    let inProgress = 0;
    let pending = 0;
    let completed = 0;
    let cancelled = 0;
    let firstInProgressIdx = -1;
    for (let i = 0; i < todos.length; i++) {
      const t = todos[i];
      if (t.status === "in_progress") {
        inProgress++;
        if (firstInProgressIdx < 0) firstInProgressIdx = i;
      } else if (t.status === "pending") pending++;
      else if (t.status === "completed") completed++;
      else cancelled++;
    }
    const total = todos.length;
    const denom = total - cancelled;
    const done = completed + cancelled;
    return {
      inProgress,
      pending,
      completed,
      cancelled,
      total,
      denom,
      done,
      firstInProgressIdx,
    };
  }, [todos]);

  // Hide once everything is finished.
  if (stats.total === 0) return null;
  if (stats.done >= stats.total) return null;

  const currentIdx =
    stats.firstInProgressIdx >= 0
      ? stats.firstInProgressIdx
      : // No item is in_progress yet — show the first still-pending one.
        todos.findIndex((t) => t.status === "pending");
  if (currentIdx < 0) return null;

  const current = todos[currentIdx];
  const stepNum = currentIdx + 1;

  const onClick = () => {
    if (onOpenPanel) {
      onOpenPanel();
      return;
    }
    setExpanded((e) => !e);
  };

  return (
    <div className="plan-progress-bubble-wrap">
      <button
        type="button"
        className="plan-progress-bubble"
        onClick={onClick}
        title={current.content}
        aria-label={`${m.planProgressStep.replace("{n}", String(stepNum)).replace("{total}", String(stats.denom || stats.total))} · ${current.content}`}
      >
        <span className="plan-progress-bubble-spinner" aria-hidden />
        <span className="plan-progress-bubble-text">
          {m.planProgressStep
            .replace("{n}", String(stepNum))
            .replace("{total}", String(stats.denom || stats.total))}
        </span>
        {stats.pending > 0 ? (
          <span className="plan-progress-bubble-pending">
            · {m.planProgressPending.replace("{n}", String(stats.pending))}
          </span>
        ) : null}
      </button>
      {expanded && !onOpenPanel ? (
        <div className="plan-progress-bubble-detail" role="tooltip">
          {current.content}
        </div>
      ) : null}
    </div>
  );
}