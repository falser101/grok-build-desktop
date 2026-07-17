import { useMemo } from "react";
import type { ToolDiff } from "@shared/types";

export type DiffLineKind = "eq" | "add" | "del";

export interface DiffLine {
  kind: DiffLineKind;
  text: string;
  /** 1-based line number in old file (for eq/del). */
  oldNo?: number;
  /** 1-based line number in new file (for eq/add). */
  newNo?: number;
}

/** Max lines rendered per file to keep the timeline responsive. */
const MAX_DIFF_LINES = 800;

/**
 * Line-level LCS diff (classic DP). Fine for typical search_replace /
 * apply_patch payloads; large files are truncated after computing.
 */
export function computeLineDiff(oldText: string, newText: string): DiffLine[] {
  const a = oldText === "" ? [] : oldText.replace(/\r\n/g, "\n").split("\n");
  const b = newText === "" ? [] : newText.replace(/\r\n/g, "\n").split("\n");
  // Drop trailing empty from final newline so "file\n" vs "file\n" is clean.
  if (a.length > 0 && a[a.length - 1] === "") a.pop();
  if (b.length > 0 && b[b.length - 1] === "") b.pop();

  const n = a.length;
  const m = b.length;
  // Cap LCS matrix for pathological sizes — fall back to replace-all.
  if (n * m > 2_000_000) {
    return fallbackReplaceAll(a, b);
  }

  const dp: Uint32Array[] = Array.from(
    { length: n + 1 },
    () => new Uint32Array(m + 1),
  );
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      if (a[i] === b[j]) dp[i][j] = dp[i + 1][j + 1] + 1;
      else dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  let oldNo = 1;
  let newNo = 1;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ kind: "eq", text: a[i], oldNo, newNo });
      i++;
      j++;
      oldNo++;
      newNo++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ kind: "del", text: a[i], oldNo });
      i++;
      oldNo++;
    } else {
      out.push({ kind: "add", text: b[j], newNo });
      j++;
      newNo++;
    }
  }
  while (i < n) {
    out.push({ kind: "del", text: a[i], oldNo });
    i++;
    oldNo++;
  }
  while (j < m) {
    out.push({ kind: "add", text: b[j], newNo });
    j++;
    newNo++;
  }
  return out;
}

function fallbackReplaceAll(a: string[], b: string[]): DiffLine[] {
  const out: DiffLine[] = [];
  for (let i = 0; i < a.length; i++) {
    out.push({ kind: "del", text: a[i], oldNo: i + 1 });
  }
  for (let j = 0; j < b.length; j++) {
    out.push({ kind: "add", text: b[j], newNo: j + 1 });
  }
  return out;
}

function shortPath(path: string): string {
  if (path.length <= 64) return path;
  const parts = path.split(/[/\\]/);
  if (parts.length <= 2) return path;
  return `…/${parts.slice(-2).join("/")}`;
}

function stats(lines: DiffLine[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const l of lines) {
    if (l.kind === "add") added++;
    else if (l.kind === "del") removed++;
  }
  return { added, removed };
}

export function DiffView({
  diff,
  defaultOpen = true,
}: {
  diff: ToolDiff;
  defaultOpen?: boolean;
}) {
  const { lines, truncated, added, removed } = useMemo(() => {
    const oldText = diff.oldText ?? "";
    const all = computeLineDiff(oldText, diff.newText);
    const truncated = all.length > MAX_DIFF_LINES;
    const lines = truncated ? all.slice(0, MAX_DIFF_LINES) : all;
    const { added, removed } = stats(all);
    return { lines, truncated, added, removed };
  }, [diff.oldText, diff.newText]);

  const isNewFile = diff.oldText === undefined || diff.oldText === "";

  return (
    <details className="diff-block" open={defaultOpen}>
      <summary className="diff-summary">
        <span className="diff-path" title={diff.path}>
          {shortPath(diff.path)}
        </span>
        {isNewFile ? (
          <span className="diff-stat new">new</span>
        ) : (
          <span className="diff-stat">
            {added > 0 ? (
              <span className="diff-stat-add">+{added}</span>
            ) : null}
            {removed > 0 ? (
              <span className="diff-stat-del">−{removed}</span>
            ) : null}
            {added === 0 && removed === 0 ? (
              <span className="diff-stat-eq">no changes</span>
            ) : null}
          </span>
        )}
      </summary>
      <div className="diff-body" role="table" aria-label={`Diff ${diff.path}`}>
        {lines.map((line, idx) => (
          <div
            key={idx}
            className={`diff-line kind-${line.kind}`}
            role="row"
          >
            <span className="diff-gutter old" role="cell">
              {line.kind !== "add" ? line.oldNo ?? "" : ""}
            </span>
            <span className="diff-gutter new" role="cell">
              {line.kind !== "del" ? line.newNo ?? "" : ""}
            </span>
            <span className="diff-sign" role="cell" aria-hidden>
              {line.kind === "add" ? "+" : line.kind === "del" ? "−" : " "}
            </span>
            <span className="diff-text" role="cell">
              {line.text || " "}
            </span>
          </div>
        ))}
        {truncated ? (
          <div className="diff-truncated">
            Showing first {MAX_DIFF_LINES} lines…
          </div>
        ) : null}
      </div>
    </details>
  );
}

export function DiffList({
  diffs,
  defaultOpen = true,
}: {
  diffs: ToolDiff[];
  defaultOpen?: boolean;
}) {
  if (!diffs.length) return null;
  return (
    <div className="diff-list">
      {diffs.map((d, i) => (
        <DiffView
          key={`${d.path}-${i}`}
          diff={d}
          defaultOpen={defaultOpen && i === 0}
        />
      ))}
    </div>
  );
}
