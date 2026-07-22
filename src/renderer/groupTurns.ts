/**
 * Timeline → display order.
 *
 * Consecutive assistant deltas are merged; empty assistant artifacts are
 * dropped. No tool grouping — each thought / tool stays its own row and
 * the UI collapses each one individually by default.
 */
import type { TimelineItem } from "@shared/types";

type AssistantItem = Extract<TimelineItem, { kind: "assistant" }>;

function isAssistant(item: TimelineItem): item is AssistantItem {
  return item.kind === "assistant";
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
