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

function kindLabel(m: Messages, kind: string | undefined): string {
  const k = (kind || "").toLowerCase();
  switch (k) {
    case "edit":
    case "apply_patch":
    case "search_replace":
      return m.toolKindEdit;
    case "write":
    case "create":
    case "patch":
      return m.toolKindWrite;
    case "search":
    case "grep":
    case "find":
    case "query":
      return m.toolKindSearch;
    case "think":
    case "reasoning":
      return m.toolKindThink;
    case "read":
    case "view":
    case "fetch":
    case "load":
      return m.toolKindRead;
    case "execute":
    case "run":
    case "bash":
    case "shell":
    case "command":
    case "cmd":
      return m.toolKindRun;
    case "web":
    case "browser":
    case "http":
    case "fetch_url":
    case "url":
      return m.toolKindWeb;
    default:
      return kind || m.toolKindTool;
  }
}

function statusLabel(m: Messages, status: string): string {
  const s = status.toLowerCase();
  if (s === "completed" || s === "complete" || s === "success")
    return m.toolStatusCompleted;
  if (s === "failed" || s === "error") return m.toolStatusFailed;
  if (s === "cancelled" || s === "canceled") return m.toolStatusCancelled;
  if (s === "in_progress" || s === "running") return m.toolStatusRunning;
  if (s === "awaiting_permission" || s === "awaiting" || s === "needs_permission")
    return m.toolStatusAwaiting;
  if (s === "pending") return m.toolStatusPending;
  return status;
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

  // Open state lives locally so that streaming updates to item.status /
  // item.outputText don't override the user's manual collapse. We start
  // with `hasDiffs` as the default (most useful for coding feedback) and
  // then respect user toggles forever after.
  const [open, setOpen] = useState<boolean>(hasDiffs);

  const header = (
    <div className="tool-card-header">
      <span className="badge">{kindLabel(m, item.toolKind)}</span>
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
      <span className={`status status-${sc}`}>{statusLabel(m, item.status)}</span>
    </div>
  );

  if (!hasDetails) {
    return <div className={`tool-card status-${sc}`}>{header}</div>;
  }

  return (
    <details
      className={`tool-card expandable status-${sc}`}
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
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
