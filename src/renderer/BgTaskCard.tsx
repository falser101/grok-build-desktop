import { memo } from "react";
import type { TimelineItem } from "@shared/types";
import { AccentBar } from "./AccentBar";

type BgTaskItem = Extract<TimelineItem, { kind: "bgTask" }>;

/**
 * Background task card. Mirrors TUI's BgTaskBlock:
 * - Shows task description + status
 * - Running/completed/failed state with accent bar
 */
export const BgTaskCard = memo(function BgTaskCard({
  item,
}: {
  item: BgTaskItem;
}) {
  const isRunning = item.status === "running";
  const isFailed = item.status === "failed";
  const accentStatus = isRunning ? "running" :
    isFailed ? "failed" :
    item.status === "completed" ? "completed" : "neutral";

  return (
    <div className={`activity-bgtask status-${item.status}`}>
      <AccentBar status={accentStatus} />
      <div className="bgtask-content">
        <div className="bgtask-header">
          <span className="bgtask-icon" aria-hidden>⏳</span>
          <span className="bgtask-desc">{item.description}</span>
          {isRunning ? <span className="bgtask-spinner" aria-hidden /> : null}
          {isFailed ? <span className="bgtask-flag fail">Failed</span> : null}
          {item.status === "completed" ? <span className="bgtask-flag ok">Done</span> : null}
        </div>
      </div>
    </div>
  );
});
