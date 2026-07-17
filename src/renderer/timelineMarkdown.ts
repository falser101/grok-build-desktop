import type { TimelineItem, ToolDiff } from "@shared/types";

/** Labels for role headings in export / copy. */
export interface TimelineMdLabels {
  you: string;
  grok: string;
  thought: string;
  tool: string;
  compact: string;
  system: string;
  output: string;
  truncated: string;
}

const MAX_DIFF_CHARS = 48_000;
const MAX_OUTPUT_CHARS = 80_000;

function truncate(text: string, max: number): { text: string; truncated: boolean } {
  if (text.length <= max) return { text, truncated: false };
  return {
    text: `${text.slice(0, max)}\n\n…`,
    truncated: true,
  };
}

function fence(lang: string, body: string): string {
  // Avoid breaking fences if body contains ``` sequences.
  let ticks = "```";
  while (body.includes(ticks)) ticks += "`";
  return `${ticks}${lang}\n${body}\n${ticks}`;
}

function unifiedDiff(d: ToolDiff): string {
  const oldLines = (d.oldText ?? "").split("\n");
  const newLines = d.newText.split("\n");
  // Lightweight export: show path header + new content when old empty (create),
  // otherwise both sides as separate fenced blocks (full LCS diff is heavy).
  if (!d.oldText) {
    const { text, truncated } = truncate(d.newText, MAX_DIFF_CHARS);
    const note = truncated ? "\n\n_Diff truncated for export._" : "";
    return `**${d.path}** _(new file)_\n\n${fence("", text)}${note}`;
  }
  const { text: oldT, truncated: t1 } = truncate(d.oldText, MAX_DIFF_CHARS / 2);
  const { text: newT, truncated: t2 } = truncate(d.newText, MAX_DIFF_CHARS / 2);
  const note = t1 || t2 ? "\n\n_Diff truncated for export._" : "";
  // Prefer a simple unified-ish dump without full LCS for export size.
  void oldLines;
  void newLines;
  return (
    `**${d.path}**\n\n` +
    `Before:\n\n${fence("", oldT)}\n\n` +
    `After:\n\n${fence("", newT)}${note}`
  );
}

/** Plain text suitable for clipboard of a single bubble. */
export function itemToCopyText(item: TimelineItem): string | null {
  switch (item.kind) {
    case "user":
    case "assistant":
    case "thought":
    case "system":
      return item.text.trim() ? item.text : null;
    case "tool": {
      const parts: string[] = [];
      if (item.title) parts.push(item.title);
      if (item.outputText) {
        const { text } = truncate(item.outputText, MAX_OUTPUT_CHARS);
        parts.push(text);
      }
      if (item.diffs?.length) {
        for (const d of item.diffs) {
          parts.push(unifiedDiff(d));
        }
      }
      return parts.length ? parts.join("\n\n") : null;
    }
    case "compact": {
      const bits: string[] = [item.status, item.mode];
      if (typeof item.tokensBefore === "number" && typeof item.tokensAfter === "number") {
        bits.push(`${item.tokensBefore} → ${item.tokensAfter} tokens`);
      }
      if (item.message) bits.push(item.message);
      return bits.filter(Boolean).join(" · ") || null;
    }
    default:
      return null;
  }
}

/** One timeline item as a Markdown section (for export). */
export function itemToMarkdown(
  item: TimelineItem,
  labels: TimelineMdLabels,
): string | null {
  switch (item.kind) {
    case "user":
      if (!item.text.trim()) return null;
      return `### ${labels.you}\n\n${item.text.trim()}`;
    case "assistant":
      if (!item.text.trim()) return null;
      return `### ${labels.grok}\n\n${item.text.trim()}`;
    case "thought":
      if (!item.text.trim()) return null;
      return `### ${labels.thought}\n\n${item.text.trim()}`;
    case "system":
      if (!item.text.trim()) return null;
      return `_${item.text.trim()}_`;
    case "compact": {
      const bits = [`**${labels.compact}** · ${item.mode} · ${item.status}`];
      if (
        typeof item.tokensBefore === "number" &&
        typeof item.tokensAfter === "number"
      ) {
        bits.push(`${item.tokensBefore} → ${item.tokensAfter} tokens`);
      }
      if (item.message) bits.push(item.message);
      return bits.join("  \n");
    }
    case "tool": {
      const kind = item.toolKind || labels.tool;
      const head = `### ${labels.tool} · \`${kind}\` · ${item.status}\n\n**${item.title}**`;
      const body: string[] = [head];
      if (item.outputText) {
        const { text, truncated } = truncate(item.outputText, MAX_OUTPUT_CHARS);
        body.push(`\n\n**${labels.output}**\n\n${fence("", text)}`);
        if (truncated || item.outputTruncated) {
          body.push(`\n\n_${labels.truncated}_`);
        }
      }
      if (item.diffs?.length) {
        for (const d of item.diffs) {
          body.push(`\n\n${unifiedDiff(d)}`);
        }
      }
      return body.join("");
    }
    default:
      return null;
  }
}

export interface ExportMeta {
  title?: string;
  workspace?: string;
  sessionId?: string;
  modelId?: string;
  exportedAt?: Date;
}

/** Full conversation as Markdown. */
export function timelineToMarkdown(
  timeline: TimelineItem[],
  meta: ExportMeta,
  labels: TimelineMdLabels,
): string {
  const title = (meta.title || "Conversation").trim() || "Conversation";
  const when = (meta.exportedAt ?? new Date()).toISOString();
  const header: string[] = [`# ${title}`, ""];
  const metaLines: string[] = [];
  if (meta.workspace) metaLines.push(`- **Workspace:** \`${meta.workspace}\``);
  if (meta.sessionId) metaLines.push(`- **Session:** \`${meta.sessionId}\``);
  if (meta.modelId) metaLines.push(`- **Model:** \`${meta.modelId}\``);
  metaLines.push(`- **Exported:** ${when}`);
  header.push(...metaLines, "", "---", "");

  const sections: string[] = [];
  for (const item of timeline) {
    const md = itemToMarkdown(item, labels);
    if (md) sections.push(md);
  }

  return `${header.join("\n")}${sections.join("\n\n")}\n`;
}

export function safeExportFilename(title: string | undefined): string {
  const base = (title || "conversation")
    .trim()
    .replace(/[^\w\u4e00-\u9fff\-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64);
  const stamp = new Date().toISOString().slice(0, 10);
  return `${base || "conversation"}-${stamp}.md`;
}

/** Trigger a browser/Electron download of a text file. */
export function downloadTextFile(filename: string, content: string): void {
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Delay revoke so the download can start.
  window.setTimeout(() => URL.revokeObjectURL(url), 2_000);
}

export async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  // Fallback for rare restricted contexts.
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.left = "-9999px";
  document.body.appendChild(ta);
  ta.select();
  document.execCommand("copy");
  ta.remove();
}
