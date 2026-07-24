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
 * Search tool card. Mirrors TUI's Search block:
 * - Shows pattern + match count
 * - Collapsible match listing output
 */
export const ToolSearchCard = memo(function ToolSearchCard({
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

  const title = item.title || "Search";
  const searchLabel = title.startsWith("Search") ? title : `Search: ${title}`;

  // Try to extract match count from title (TUI format: "Search "pattern" (N matches)")
  const matchMatch = title.match(/\((\d+)\s*match/i);
  const matchCount = matchMatch ? parseInt(matchMatch[1], 10) : null;

  const header = (
    <div className="activity-tool-line">
      <span className="activity-tool-title" title={title}>
        <span className="search-query">{searchLabel}</span>
      </span>
      {matchCount !== null ? (
        <span className="activity-tool-meta">
          {m.toolSearchMatches?.replace("{n}", String(matchCount)) ??
            `${matchCount} matches`}
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
      <div className={`activity-tool search-card status-${sc}`}>{header}</div>
    );
  }

  return (
    <details
      className={`activity-tool expandable search-card status-${sc}`}
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
