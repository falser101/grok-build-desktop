/**
 * Timeline → display order.
 *
 * Consecutive assistant deltas are merged; empty assistant artifacts are
 * dropped. Adjacent same-toolKind tools are folded into groups (TUI-style).
 */
import type { TimelineItem, ToolKind } from "@shared/types";

type AssistantItem = Extract<TimelineItem, { kind: "assistant" }>;
type ToolItem = Extract<TimelineItem, { kind: "tool" }>;

function isAssistant(item: TimelineItem): item is AssistantItem {
  return item.kind === "assistant";
}

function isTool(item: TimelineItem): item is ToolItem {
  return item.kind === "tool";
}

/** Group of adjacent same-toolKind tools (mirrors TUI fold groups). */
export interface FoldGroup {
  _fold: true;
  id: string;
  toolKind: ToolKind;
  items: ToolItem[];
  collapsed: boolean;
}

export type DisplayItem = TimelineItem | FoldGroup;

export function isFoldGroup(item: DisplayItem): item is FoldGroup {
  return "_fold" in item && (item as FoldGroup)._fold === true;
}

/** Flatten timeline for rendering in strict chronological order. */
export function linearizeTimeline(timeline: TimelineItem[]): TimelineItem[] {
  const out: TimelineItem[] = [];
  for (const item of timeline) {
    if (!isAssistant(item)) {
      out.push(item);
      continue;
    }
    if (!item.text || !item.text.trim()) continue;
    const prev = out[out.length - 1];
    if (prev && isAssistant(prev)) {
      out[out.length - 1] = {
        ...item,
        id: prev.id,
        text: prev.text + item.text,
        createdAt: prev.createdAt ?? item.createdAt,
        streaming: item.streaming,
      };
    } else {
      out.push(item);
    }
  }
  return out;
}

/**
 * Group adjacent same-toolKind tools into fold groups.
 * Returns a flat list of TimelineItem | FoldGroup.
 * Tools that are the only one of their kind remain ungrouped.
 */
export function groupTools(
  timeline: TimelineItem[],
  collapsed: boolean = true,
): DisplayItem[] {
  const out: DisplayItem[] = [];
  let group: ToolItem[] = [];
  let groupKind: ToolKind | undefined;

  function flushGroup(): void {
    if (group.length === 0) return;
    if (group.length === 1) {
      out.push(group[0]);
    } else {
      out.push({
        _fold: true,
        id: `group-${group[0].id}`,
        toolKind: groupKind ?? "other",
        items: group,
        collapsed,
      });
    }
    group = [];
    groupKind = undefined;
  }

  for (const item of timeline) {
    if (!isTool(item)) {
      flushGroup();
      out.push(item);
      continue;
    }
    const kind = item.toolKind ?? "other";
    if (group.length === 0) {
      group = [item];
      groupKind = kind;
    } else if (kind === groupKind) {
      group.push(item);
    } else {
      flushGroup();
      group = [item];
      groupKind = kind;
    }
  }
  flushGroup();
  return out;
}

/** Generate a descriptive summary for a fold group. */
export function groupSummary(group: FoldGroup): string {
  const kind = group.toolKind;
  const n = group.items.length;
  const files = group.items.filter(
    (t) => t.diffs && t.diffs.length > 0,
  ).length;
  const parts: string[] = [];
  if (kind === "read") parts.push(`Read`);
  else if (kind === "edit") parts.push(`Edit`);
  else if (kind === "execute") parts.push(`Exec`);
  else if (kind === "search") parts.push(`Search`);
  else if (kind === "listDir") parts.push(`List`);
  else parts.push(`Tool`);
  parts.push(`×${n}`);
  if (files > 0 && files !== n) parts.push(`(${files} files)`);
  return parts.join(" ");
}
