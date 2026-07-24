import { memo, useState } from "react";
import type { TimelineItem } from "@shared/types";
import { AccentBar } from "./AccentBar";

type SubagentItem = Extract<TimelineItem, { kind: "subagent" }>;

/**
 * Subagent lifecycle card. Mirrors TUI's SubagentBlock:
 * - Shows subagent type badge + role name
 * - Running metrics (tokens/turns/toolCalls)
 * - Collapsible with accent bar
 */
export const SubagentCard = memo(function SubagentCard({
  item,
}: {
  item: SubagentItem;
}) {
  const isRunning = item.status === "running";
  const isFailed = item.status === "failed" || item.status === "cancelled";
  const accentStatus = isRunning ? "running" :
    isFailed ? "failed" :
    item.status === "completed" ? "completed" : "neutral";

  // Role display
  const roleLabel = item.role || item.persona || item.subagentType || "Subagent";
  const typeLabel = item.subagentType ? item.subagentType.replace(/-/g, " ") : "";

  // Progress metrics
  const progress = item.progress;
  const metrics: string[] = [];
  if (progress?.tokens != null) metrics.push(`${fmtNum(progress.tokens)} tokens`);
  if (progress?.turns != null) metrics.push(`${progress.turns} turns`);
  if (progress?.toolCalls != null) metrics.push(`${progress.toolCalls} tools`);

  return (
    <div className={`activity-subagent status-${item.status}`}>
      <AccentBar status={accentStatus} />
      <div className="subagent-content">
        <div className="subagent-header">
          <span className="subagent-badge">{typeLabel}</span>
          <span className="subagent-role">{roleLabel}</span>
          {isRunning ? <span className="subagent-spinner" aria-hidden /> : null}
          {isFailed ? <span className="subagent-flag fail">Failed</span> : null}
          {item.status === "completed" ? <span className="subagent-flag ok">Done</span> : null}
        </div>
        {metrics.length > 0 ? (
          <div className="subagent-metrics">{metrics.join("  ·  ")}</div>
        ) : null}
      </div>
    </div>
  );
});

function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}
