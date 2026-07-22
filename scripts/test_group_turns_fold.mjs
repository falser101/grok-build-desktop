#!/usr/bin/env node
// Flat chronological timeline — no tool merging.
import { strict as assert } from "node:assert";
import { linearizeTimeline } from "../src/renderer/groupTurns.ts";

function row(kind, text) {
  return { id: kind + "-" + text, kind, text };
}
function thought(text) {
  return { id: "th-" + text, kind: "thought", text };
}
function tool(title, toolKind) {
  return {
    id: "tool-" + title,
    kind: "tool",
    toolCallId: title,
    title,
    status: "completed",
    toolKind,
  };
}
function assistant(text) {
  return { id: "a-" + text, kind: "assistant", text };
}

// 1. Order preserved; tools stay separate rows (not merged)
{
  const tl = [
    row("user", "u1"),
    thought("t1"),
    tool("Read a", "read"),
    tool("Read b", "read"),
    tool("Search x", "search"),
    assistant("done"),
  ];
  const out = linearizeTimeline(tl);
  assert.deepEqual(
    out.map((i) => i.kind),
    ["user", "thought", "tool", "tool", "tool", "assistant"],
  );
}

// 2. Adjacent assistant deltas merge
{
  const tl = [
    row("user", "u1"),
    { id: "a1", kind: "assistant", text: "Hel" },
    { id: "a2", kind: "assistant", text: "lo" },
  ];
  const out = linearizeTimeline(tl);
  assert.equal(out.length, 2);
  assert.equal(out[1].text, "Hello");
}

// 3. Empty assistants dropped
{
  const tl = [
    row("user", "u1"),
    { id: "g", kind: "assistant", text: "\n" },
    assistant("Done"),
  ];
  const out = linearizeTimeline(tl);
  assert.equal(out.length, 2);
  assert.equal(out[1].text, "Done");
}

console.log("linearizeTimeline: 3/3 pass");
