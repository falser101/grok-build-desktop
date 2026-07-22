#!/usr/bin/env node
/**
 * Structural contract: streaming caret must not stick after a turn ends.
 *
 * Run: node scripts/test_streaming_caret_contract.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DESKTOP = path.resolve(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(DESKTOP, rel), "utf8");

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

const backend = read("src/main/backend.ts");
const app = read("src/renderer/App.tsx");
const md = read("src/renderer/MarkdownBody.tsx");

// Backend: live caret only while busy
check(
  "streaming gated on busy (not just !replaying)",
  /const streaming = !this\.replaying && this\.busy/.test(backend),
  "expected streaming = !replaying && busy",
);

// Backend: orphan sweep exists and is used by finalizeStreaming
check(
  "clearOrphanStreamingFlags defined",
  /private clearOrphanStreamingFlags\(/.test(backend),
);
check(
  "finalizeStreaming calls clearOrphanStreamingFlags",
  /finalizeStreaming\([\s\S]*?clearOrphanStreamingFlags\(/.test(backend) ||
    /this\.clearOrphanStreamingFlags\(\)/.test(backend),
);

// Backend: cancel finalizes streaming (drops caret on stop)
{
  const idx = backend.indexOf("async cancel(): Promise<void>");
  const body = idx >= 0 ? backend.slice(idx, idx + 1800) : "";
  check(
    "cancel() calls finalizeStreaming",
    /this\.finalizeStreaming\(\)/.test(body),
    body ? "cancel body missing finalizeStreaming" : "cancel() not found",
  );
}

// Renderer: caret only when turn busy AND item.streaming
check(
  "assistant MarkdownBody uses liveStreaming (turnBusy && streaming)",
  /const liveStreaming = Boolean\(turnBusy && item\.streaming\)/.test(app) &&
    /streaming=\{liveStreaming\}/.test(app),
);
check(
  "thought row uses liveStreaming gated by turnBusy",
  /liveStreaming=\{Boolean\(turnBusy && item\.streaming\)\}/.test(app),
);
check(
  "ChatTimeline passes turnBusy={busy}",
  /turnBusy=\{busy\}/.test(app),
);

// MarkdownBody still renders caret from streaming prop (unchanged contract)
check(
  "MarkdownBody renders md-streaming-caret when streaming",
  /streaming \? <span className="md-streaming-caret"/.test(md),
);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
