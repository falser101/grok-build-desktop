import { memo, useState } from "react";
import type { TimelineItem } from "@shared/types";
import type { Messages } from "./i18n";

type ToolItem = Extract<TimelineItem, { kind: "tool" }>;

function statusClass(status: string): string {
  const s = status.toLowerCase();
  if (s === "completed" || s === "complete" || s === "success") return "ok";
  if (s === "failed" || s === "error") return "fail";
  if (s === "in_progress" || s === "pending" || s === "running") return "busy";
  return "idle";
}

/**
 * ListDir tool card. Mirrors TUI's ListDir block:
 * - Shows directory path
 * - Collapsible file listing output
 */
export const ToolListDirCard = memo(function ToolListDirCard({
  item,
  m,
}: {
  item: ToolItem;
  m: Messages;
}) {
  const sc = statusClass(item.status);
  const isFail = sc === "fail";
  const isBusy = sc === "busy";

  const hasOutput = Boolean(item.outputText && item.outputText.length > 0);
  const hasDetails = hasOutput;
  const [open, setOpen] = useState(false);

  const title = item.title || "ListDir";
  const pathLabel = title.startsWith("List") ? title : `ListDir ${title}`;

  // Count files from output if available
  const fileCount = hasOutput
    ? (item.outputText!.match(/^[^\n]+$/gm) || []).length
    : 0;

  const header = (
    <div className="activity-tool-line">
      <span className="activity-tool-title" title={title}>
        <span className="listdir-path">{pathLabel}</span>
      </span>
      {fileCount > 0 ? (
        <span className="activity-tool-meta">{`${fileCount} entries`}</span>
      ) : null}
      {isFail ? (
        <span className="activity-tool-flag is-fail">{m.toolStatusFailed}</span>
      ) : null}
      {isBusy ? <span className="activity-tool-spinner" aria-hidden /> : null}
    </div>
  );

  if (!hasDetails) {
    return (
      <div className={`activity-tool listdir-card status-${sc}`}>{header}</div>
    );
  }

  return (
    <details
      className={`activity-tool expandable listdir-card status-${sc}`}
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
    >
      <summary className="activity-tool-summary">{header}</summary>
      <div className="activity-tool-body">
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
