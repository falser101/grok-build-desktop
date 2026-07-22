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
 * CLI-style tool row: one compact line (title from agent already looks like
 * `Read foo.vue (1-150 of 2773)` / `Search "…" (N matches)`).
 * Always starts collapsed when there is body content (output / diffs).
 */
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
  // File IO content starts collapsed — title line only until the user opens.
  const [open, setOpen] = useState(false);

  const title = item.title || kindFallback(item.toolKind);
  const isFail = sc === "fail";
  const isBusy = sc === "busy";

  const header = (
    <div className="activity-tool-line">
      <span className="activity-tool-title" title={title}>
        {title}
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

  // No body → plain one-liner (already the "collapsed" view).
  if (!hasDetails) {
    return (
      <div
        className={`activity-tool status-${sc}`}
        data-tool-kind={item.toolKind || ""}
      >
        {header}
      </div>
    );
  }

  return (
    <details
      className={`activity-tool expandable status-${sc}`}
      data-tool-kind={item.toolKind || ""}
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
    >
      <summary className="activity-tool-summary">{header}</summary>
      <div className="activity-tool-body">
        {/* Diffs stay collapsed until the outer details is opened; then
            show them open so the user sees the change immediately. */}
        {/* Keep nested diffs collapsed until the user opens each one. */}
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

function kindFallback(kind: string | undefined): string {
  return kind || "tool";
}
