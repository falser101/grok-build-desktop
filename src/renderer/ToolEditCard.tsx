import { memo, useState } from "react";
import type { TimelineItem } from "@shared/types";
import type { Messages } from "./i18n";
import { DiffList } from "./DiffView";

type ToolItem = Extract<TimelineItem, { kind: "tool" }>;

function statusClass(status: string): string {
  const s = status.toLowerCase();
  if (s === "completed" || s === "complete" || s === "success") return "ok";
  if (s === "failed" || s === "error") return "fail";
  if (s === "in_progress" || s === "pending" || s === "running") return "busy";
  return "idle";
}

/**
 * Edit tool card. Mirrors TUI's Edit block:
 * - Shows file path with diff hunks
 * - Syntax-highlighted diffs via DiffList
 */
export const ToolEditCard = memo(function ToolEditCard({
  item,
  m,
}: {
  item: ToolItem;
  m: Messages;
}) {
  const sc = statusClass(item.status);
  const isFail = sc === "fail";
  const isBusy = sc === "busy";

  const diffs = item.diffs ?? [];
  const hasDiffs = diffs.length > 0;
  const hasOutput = Boolean(item.outputText && item.outputText.length > 0);
  const hasDetails = hasDiffs || hasOutput;
  const [open, setOpen] = useState(false);

  // TUI Edit title format: "Edit path"
  const title = item.title || "Edit";
  const pathLabel = title.startsWith("Edit") ? title : `Edit ${title}`;

  const header = (
    <div className="activity-tool-line">
      <span className="activity-tool-title" title={title}>
        <span className="edit-path">{pathLabel}</span>
      </span>
      {hasDiffs ? (
        <span className="activity-tool-meta">
          {m.toolDiffCount.replace("{n}", String(diffs.length))}
        </span>
      ) : null}
      {isFail ? (
        <span className="activity-tool-flag is-fail">{m.toolStatusFailed}</span>
      ) : null}
      {isBusy ? <span className="activity-tool-spinner" aria-hidden /> : null}
    </div>
  );

  if (!hasDetails) {
    return (
      <div className={`activity-tool edit-card status-${sc}`}>{header}</div>
    );
  }

  return (
    <details
      className={`activity-tool expandable edit-card status-${sc}`}
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
    >
      <summary className="activity-tool-summary">{header}</summary>
      <div className="activity-tool-body">
        {hasDiffs ? <DiffList diffs={diffs} defaultOpen={false} /> : null}
        {hasOutput ? (
          <div className="tool-output">
            <div className="tool-output-label">{m.toolOutput}</div>
            <pre className="tool-output-pre">{item.outputText}</pre>
            {item.outputTruncated ? (
              <div className="tool-output-trunc">{m.toolOutputTruncated}</div>
            ) : null}
          </div>
        ) : null}
      </div>
    </details>
  );
});
