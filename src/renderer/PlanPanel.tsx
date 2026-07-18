import { useMemo, useState } from "react";
import type {
  PlanApprovalUi,
  TodoItemUi,
  TodoStatus,
} from "@shared/types";
import type { Messages } from "./i18n";
import { MarkdownBody } from "./MarkdownBody";

export type PlanPanelTab = "todos" | "plan";

type Props = {
  todos: TodoItemUi[];
  planContent?: string;
  pendingApproval?: PlanApprovalUi;
  sessionMode?: string;
  m: Messages;
  onClose: () => void;
  onRespondApproval: (
    requestId: string,
    outcome: "approved" | "cancelled" | "abandoned",
    feedback?: string,
  ) => void;
  onRefreshPlan?: () => void;
};

function statusIcon(status: TodoStatus): string {
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

function statusAriaLabel(status: TodoStatus): string {
  switch (status) {
    case "in_progress":
      return "Running";
    case "completed":
      return "Completed";
    case "cancelled":
      return "Cancelled";
    default:
      return "Pending";
  }
}

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

export function PlanPanel({
  todos,
  planContent,
  pendingApproval,
  sessionMode,
  m,
  onClose,
  onRespondApproval,
  onRefreshPlan,
}: Props) {
  const [tab, setTab] = useState<PlanPanelTab>(
    pendingApproval ? "plan" : todos.length > 0 ? "todos" : "plan",
  );
  const [feedback, setFeedback] = useState("");
  const [showFeedback, setShowFeedback] = useState(false);
  const [hideDone, setHideDone] = useState(false);

  const c = useMemo(() => counts(todos), [todos]);
  const visibleTodos = useMemo(() => {
    if (!hideDone) return todos;
    return todos.filter(
      (t) => t.status !== "completed" && t.status !== "cancelled",
    );
  }, [todos, hideDone]);

  const planBody =
    pendingApproval?.planContent?.trim() ||
    planContent?.trim() ||
    "";
  const approval = pendingApproval;
  const progressDenom = c.total - c.cancelled;
  const progressLabel =
    progressDenom > 0
      ? `${c.completed}/${progressDenom}`
      : c.total > 0
        ? `${c.completed}/${c.total}`
        : "";

  return (
    <div className="plan-panel">
      <div className="plan-panel-bar">
        <button
          type="button"
          className="right-panel-back"
          onClick={onClose}
        >
          ← {m.sidePanelToggle}
        </button>
        <div className="plan-panel-title-wrap">
          <span className="plan-panel-title">{m.planPanelTitle}</span>
          {progressLabel ? (
            <span className="plan-panel-badge" title={m.planTodoProgress}>
              {progressLabel}
            </span>
          ) : null}
          {sessionMode === "plan" ? (
            <span className="plan-panel-mode-chip">{m.modePlan}</span>
          ) : null}
          {approval ? (
            <span className="plan-panel-mode-chip warn">
              {m.planApprovalNeeded}
            </span>
          ) : null}
        </div>
      </div>

      <div className="plan-panel-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "todos"}
          className={`plan-panel-tab ${tab === "todos" ? "active" : ""}`}
          onClick={() => setTab("todos")}
        >
          {m.planTabTodos}
          {c.total > 0 ? (
            <span className="plan-panel-tab-count">{c.total}</span>
          ) : null}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "plan"}
          className={`plan-panel-tab ${tab === "plan" ? "active" : ""}`}
          onClick={() => setTab("plan")}
        >
          {m.planTabPlan}
        </button>
        {onRefreshPlan ? (
          <button
            type="button"
            className="plan-panel-refresh"
            title={m.planRefresh}
            onClick={() => onRefreshPlan()}
          >
            ↻
          </button>
        ) : null}
      </div>

      {approval ? (
        <div className="plan-approval-banner">
          <div className="plan-approval-banner-title">
            {approval.hasPlan
              ? m.planApprovalTitle
              : m.planApprovalEmptyTitle}
          </div>
          <div className="plan-approval-banner-hint">
            {approval.hasPlan
              ? m.planApprovalHint
              : m.planApprovalEmptyHint}
          </div>
          {showFeedback ? (
            <div className="plan-approval-feedback">
              <textarea
                className="plan-approval-feedback-input"
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                placeholder={m.planApprovalFeedbackPlaceholder}
                rows={3}
                autoFocus
              />
              <div className="plan-approval-feedback-actions">
                <button
                  type="button"
                  className="plan-approval-btn secondary"
                  onClick={() => {
                    setShowFeedback(false);
                    setFeedback("");
                  }}
                >
                  {m.planApprovalCancelFeedback}
                </button>
                <button
                  type="button"
                  className="plan-approval-btn primary"
                  disabled={!feedback.trim()}
                  onClick={() => {
                    onRespondApproval(
                      approval.requestId,
                      "cancelled",
                      feedback.trim(),
                    );
                    setShowFeedback(false);
                    setFeedback("");
                  }}
                >
                  {m.planApprovalSendFeedback}
                </button>
              </div>
            </div>
          ) : (
            <div className="plan-approval-actions">
              <button
                type="button"
                className="plan-approval-btn primary"
                onClick={() =>
                  onRespondApproval(approval.requestId, "approved")
                }
              >
                {m.planApprovalApprove}
              </button>
              <button
                type="button"
                className="plan-approval-btn secondary"
                onClick={() => setShowFeedback(true)}
              >
                {m.planApprovalRequestChanges}
              </button>
              <button
                type="button"
                className="plan-approval-btn danger"
                onClick={() =>
                  onRespondApproval(approval.requestId, "abandoned")
                }
              >
                {m.planApprovalAbandon}
              </button>
            </div>
          )}
        </div>
      ) : null}

      <div className="plan-panel-body">
        {tab === "todos" ? (
          <div className="todo-list-wrap">
            {c.total > 0 ? (
              <div className="todo-list-toolbar">
                <span className="todo-list-summary">
                  {c.inProgress > 0
                    ? m.planTodoInProgressCount.replace(
                        "{n}",
                        String(c.inProgress),
                      )
                    : null}
                  {c.inProgress > 0 && c.pending > 0 ? " · " : null}
                  {c.pending > 0
                    ? m.planTodoPendingCount.replace(
                        "{n}",
                        String(c.pending),
                      )
                    : null}
                  {c.completed > 0
                    ? `${c.inProgress || c.pending ? " · " : ""}${m.planTodoDoneCount.replace("{n}", String(c.completed))}`
                    : null}
                </span>
                <label className="todo-hide-done">
                  <input
                    type="checkbox"
                    checked={hideDone}
                    onChange={(e) => setHideDone(e.target.checked)}
                  />
                  {m.planTodoHideDone}
                </label>
              </div>
            ) : null}
            {visibleTodos.length === 0 ? (
              <div className="plan-panel-empty">
                {c.total === 0
                  ? m.planTodoEmpty
                  : hideDone
                    ? m.planTodoAllDone
                    : m.planTodoEmpty}
              </div>
            ) : (
              <ul className="todo-list">
                {visibleTodos.map((t) => (
                  <li
                    key={t.id}
                    className={`todo-item status-${t.status} priority-${t.priority}`}
                    data-status={t.status}
                  >
                    <span
                      className={`todo-icon todo-icon-${t.status}`}
                      aria-hidden
                      title={t.status}
                    >
                      {statusIcon(t.status)}
                    </span>
                    <span className="todo-content">{t.content}</span>
                    {t.priority === "high" ? (
                      <span className="todo-priority" title={m.planTodoHigh}>
                        !
                      </span>
                    ) : null}
                    <span className="sr-only">
                      {statusAriaLabel(t.status)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : planBody ? (
          <div className="plan-md-wrap">
            <div className="plan-md-label">plan.md</div>
            <div className="plan-md-body">
              <MarkdownBody text={planBody} className="plan-md" />
            </div>
          </div>
        ) : (
          <div className="plan-panel-empty">
            {sessionMode === "plan"
              ? m.planEmptyInPlanMode
              : m.planEmpty}
          </div>
        )}
      </div>
    </div>
  );
}
