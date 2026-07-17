import { memo } from "react";
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

export const ToolCard = memo(function ToolCard({
  item,
  m,
}: {
  item: ToolItem;
  m: Messages;
}) {
  const diffs = item.diffs ?? [];
  const hasDiffs = diffs.length > 0;
  const hasOutput = Boolean(item.outputText && item.outputText.length > 0);
  const hasDetails = hasDiffs || hasOutput;
  const sc = statusClass(item.status);

  // Prefer open when there are diffs (coding feedback); keep pure stdout closed.
  const defaultOpen = hasDiffs;

  const header = (
    <div className="tool-card-header">
      <span className="badge">{item.toolKind || "tool"}</span>
      <span className="title" title={item.title}>
        {item.title}
      </span>
      {hasDiffs ? (
        <span className="tool-meta">
          {m.toolDiffCount.replace(
            "{n}",
            String(diffs.length),
          )}
        </span>
      ) : null}
      <span className={`status status-${sc}`}>{item.status}</span>
    </div>
  );

  if (!hasDetails) {
    return <div className={`tool-card status-${sc}`}>{header}</div>;
  }

  return (
    <details
      className={`tool-card expandable status-${sc}`}
      open={defaultOpen}
    >
      <summary className="tool-card-summary">{header}</summary>
      <div className="tool-card-body">
        {hasDiffs ? <DiffList diffs={diffs} defaultOpen /> : null}
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
