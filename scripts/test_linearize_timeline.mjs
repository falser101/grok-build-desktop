#!/usr/bin/env node
// Behaviour test for linearizeTimeline — consecutive assistant merge +
// chronological interleaving with thoughts/tools/users.
//
// Run: node --experimental-strip-types scripts/test_linearize_timeline.mjs
import { linearizeTimeline } from "../src/renderer/linearizeTimeline.ts";

let pass = 0;
let fail = 0;

function check(name, ok, detail) {
  if (ok) {
    console.log(`  ✓ ${name}`);
    pass++;
  } else {
    console.error(`  ✗ ${name}  ${detail ?? ""}`);
    fail++;
  }
}

function user(id, text = "hi") {
  return { id, kind: "user", text };
}
function thought(id, text) {
  return { id, kind: "thought", text };
}
function tool(id, title = "tool", status = "completed") {
  return { id, kind: "tool", toolCallId: id, title, status };
}
function assistant(id, text, streaming) {
  return { id, kind: "assistant", text, streaming };
}
function compact(id) {
  return { id, kind: "compact", status: "completed", mode: "manual" };
}
function system(id, text) {
  return { id, kind: "system", text };
}

// A: OpenAI multi-id deltas with no interleaving → one assistant bubble
{
  const timeline = [
    user("u1"),
    assistant("a1", "Hel"),
    assistant("a2", "lo "),
    assistant("a3", "world"),
  ];
  const out = linearizeTimeline(timeline);
  check("A: 2 items (user + one assistant)", out.length === 2, `got ${out.length}`);
  check("A: first is user", out[0]?.kind === "user" && out[0]?.id === "u1");
  check(
    "A: assistant id is first chunk's id",
    out[1]?.kind === "assistant" && out[1]?.id === "a1",
  );
  check(
    "A: assistant text concatenated",
    out[1]?.kind === "assistant" && out[1]?.text === "Hello world",
    out[1]?.kind === "assistant" ? `got ${out[1].text}` : "",
  );
}

// B: thought / tool / assistant interleave — no nesting, order preserved
{
  const timeline = [
    user("u1"),
    thought("t1", "plan"),
    tool("k1"),
    assistant("a1", "done."),
    user("u2"),
    thought("t2", "round 2"),
    assistant("a2", "second."),
  ];
  const out = linearizeTimeline(timeline);
  check("B: 7 items, no collapse", out.length === 7, `got ${out.length}`);
  check(
    "B: order kinds",
    out.map((i) => i.kind).join(",") ===
      "user,thought,tool,assistant,user,thought,assistant",
    out.map((i) => i.kind).join(","),
  );
}

// C: assistant split by thought → two assistant bubbles
{
  const timeline = [
    user("u1"),
    assistant("a1", "part1"),
    thought("t1", "more thinking"),
    assistant("a2", "part2"),
  ];
  const out = linearizeTimeline(timeline);
  check("C: 4 items", out.length === 4, `got ${out.length}`);
  check(
    "C: two separate assistants",
    out[1]?.kind === "assistant" &&
      out[1]?.text === "part1" &&
      out[3]?.kind === "assistant" &&
      out[3]?.text === "part2",
  );
}

// D: streaming flag follows latest merged chunk
{
  const timeline = [
    assistant("a1", "x", false),
    assistant("a2", "y", true),
  ];
  const out = linearizeTimeline(timeline);
  check(
    "D: streaming from latest",
    out.length === 1 &&
      out[0]?.kind === "assistant" &&
      out[0]?.streaming === true &&
      out[0]?.text === "xy",
  );
}

// E: user attachments preserved (linearize must not drop fields)
{
  const timeline = [
    {
      id: "u1",
      kind: "user",
      text: "see",
      attachments: [
        {
          id: "att1",
          kind: "image",
          displayPath: "shot.png",
          name: "shot.png",
          mimeType: "image/png",
          dataBase64: "abc",
        },
      ],
    },
    assistant("a1", "ok"),
  ];
  const out = linearizeTimeline(timeline);
  check(
    "E: attachments intact",
    out[0]?.kind === "user" &&
      Array.isArray(out[0].attachments) &&
      out[0].attachments[0]?.dataBase64 === "abc",
  );
}

// F: compact + system pass through
{
  const timeline = [system("s1", "hi"), compact("c1"), user("u1"), assistant("a1", "x")];
  const out = linearizeTimeline(timeline);
  check(
    "F: kinds order",
    out.map((i) => i.kind).join(",") === "system,compact,user,assistant",
  );
}

// G: empty timeline
{
  check("G: empty", linearizeTimeline([]).length === 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
