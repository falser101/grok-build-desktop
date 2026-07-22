import { useMemo } from "react";
import type {
  PlanApprovalUi,
  TodoItemUi,
} from "@shared/types";
import type { Messages } from "./i18n";
import { MarkdownBody } from "./MarkdownBody";

/**
 * Plan side-panel — now displays ONLY the plan.md body (the agent's
 * proposed plan text). The task list was moved to the composer's
 * task progress button (hover to expand). This keeps the right rail
 * focused on plan content while still allowing the user to view
 * approval controls when a plan-mode exit is pending.
 */
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
  const c = useMemo(() => counts(todos), [todos]);

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

      {approval ? (
        <div className="plan-approval-callout">
          <div className="plan-approval-callout-title">
            {m.planApprovalNeeded}
          </div>
          <div className="plan-approval-callout-hint">
            {approval.hasPlan
              ? m.planApprovalHint
              : m.planApprovalEmptyHint}
          </div>
        </div>
      ) : null}

      <div className="plan-panel-body">
        {planBody ? (
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