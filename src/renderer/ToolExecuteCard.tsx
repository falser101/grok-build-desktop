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
 * Execute tool card. Mirrors TUI's Execute block:
 * - Shows command title + stdout preview
 * - Collapsible details with full output
 */
export const ToolExecuteCard = memo(function ToolExecuteCard({
  item,
  m,
}: {
  item: ToolItem;
  m: Messages;
}) {
  const sc = statusClass(item.status);
  const isFail = sc === "fail";
  const isSuccess = sc === "ok";
  const isBusy = sc === "busy";

  const hasOutput = Boolean(item.outputText && item.outputText.length > 0);
  const hasDetails = hasOutput;
  const [open, setOpen] = useState(false);

  // Extract command from title (TUI format: "Execute: <command>")
  const title = item.title || "Execute";
  const cmdLabel =
    title.startsWith("Execute") || title.startsWith("execute")
      ? title
      : `Execute: ${title}`;

  const header = (
    <div className="activity-tool-line">
      <span className="activity-tool-title" title={title}>
        <code className="execute-cmd">{cmdLabel}</code>
      </span>
      {isFail ? (
        <span className="activity-tool-flag is-fail">{m.toolStatusFailed}</span>
      ) : null}
      {isSuccess ? (
        <span className="activity-tool-flag is-ok">
          {m.toolStatusCompleted || "Done"}
        </span>
      ) : null}
      {isBusy ? <span className="activity-tool-spinner" aria-hidden /> : null}
    </div>
  );

  if (!hasDetails) {
    return (
      <div className={`activity-tool execute-card status-${sc}`}>{header}</div>
    );
  }

  return (
    <details
      className={`activity-tool expandable execute-card status-${sc}`}
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
