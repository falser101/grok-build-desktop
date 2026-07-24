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
 * Read tool card. Mirrors TUI's Read block:
 * - Shows file path with line range
 * - Content preview (outputText)
 */
export const ToolReadCard = memo(function ToolReadCard({
  item,
  m,
}: {
  item: ToolItem;
  m: Messages;
}) {
  const sc = statusClass(item.status);
  const isFail = sc === "fail";
  const isBusy = sc === "busy";

  const hasDiffs = (item.diffs ?? []).length > 0;
  const hasOutput = Boolean(item.outputText && item.outputText.length > 0);
  const hasDetails = hasDiffs || hasOutput;
  const [open, setOpen] = useState(false);

  // TUI Read title format: "Read path (1-150 of 2773)"
  const title = item.title || "Read";
  const pathLabel = title.startsWith("Read") ? title : `Read ${title}`;

  const header = (
    <div className="activity-tool-line">
      <span className="activity-tool-title" title={title}>
        <span className="read-path">{pathLabel}</span>
      </span>
      {hasDiffs ? (
        <span className="activity-tool-meta">
          {m.toolDiffCount.replace("{n}", String(item.diffs!.length))}
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
      <div className={`activity-tool read-card status-${sc}`}>{header}</div>
    );
  }

  return (
    <details
      className={`activity-tool expandable read-card status-${sc}`}
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
    >
      <summary className="activity-tool-summary">{header}</summary>
      <div className="activity-tool-body">
        {hasDiffs ? <DiffList diffs={item.diffs!} defaultOpen={false} /> : null}
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
