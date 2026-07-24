import { memo } from "react";
import type { TimelineItem } from "@shared/types";
import { AccentBar } from "./AccentBar";

type WorkflowItem = Extract<TimelineItem, { kind: "workflow" }>;

/**
 * Workflow run progress card. Mirrors TUI's WorkflowBlock:
 * - Shows workflow name + phase label
 * - Progress bar (agents launched / completed)
 * - Accent bar for status
 */
export const WorkflowCard = memo(function WorkflowCard({
  item,
}: {
  item: WorkflowItem;
}) {
  const isRunning = item.status === "running";
  const accentStatus = isRunning ? "running" : "neutral";

  const progress = item.progress;
  const hasProgress =
    progress && (progress.budgetTotal > 0 || progress.agentsLaunched > 0);
  const pct =
    hasProgress && progress!.budgetTotal > 0
      ? Math.min(100, Math.round((progress!.budgetUsed / progress!.budgetTotal) * 100))
      : 0;

  return (
    <div className={`activity-workflow status-${item.status || "running"}`}>
      <AccentBar status={accentStatus} />
      <div className="workflow-content">
        <div className="workflow-header">
          <span className="workflow-icon" aria-hidden>⚙</span>
          <span className="workflow-name">{item.name}</span>
          {item.phase ? (
            <span className="workflow-phase">{item.phase}</span>
          ) : null}
          {isRunning ? <span className="workflow-spinner" aria-hidden /> : null}
        </div>
        {hasProgress ? (
          <div className="workflow-progress">
            <div className="workflow-progress-meta">
              {progress!.agentsCompleted}/{progress!.agentsLaunched} agents
              {progress!.budgetTotal > 0
                ? ` · budget ${progress!.budgetUsed}/${progress!.budgetTotal}`
                : ""}
            </div>
            {progress!.budgetTotal > 0 ? (
              <div className="workflow-progress-bar">
                <div
                  className="workflow-progress-fill"
                  style={{ width: `${pct}%` }}
                />
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
});
