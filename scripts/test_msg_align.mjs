#!/usr/bin/env node
// Structural test: asserts that the user message bubble's right edge
// is aligned with the composer's right edge by inspecting the relevant
// CSS rules in the shipped stylesheet.
//
// Right-edge alignment contract (chat-rail layout):
//   - .chat-rail .composer-wrap reserves --chat-scrollbar (10px) on the
//     right to leave room for the (hidden) scrollbar gutter.
//   - .msg.msg-user right-aligns its child bubble via
//     align-items: flex-end; the bubble would otherwise sit at the
//     rail's right edge.
//   - Inside the rail, .msg.msg-user has padding-right:
//     var(--chat-scrollbar) so the bubble's flex-end anchor sits at
//     the same offset as the composer's content right edge. Both
//     share the same 10px reservation.
//
// The test additionally asserts:
//   - The fix does NOT over-inset with --chat-pad-x (which is the
//     non-rail horizontal padding — wrong variable for chat-rail).
//   - The bubble itself is bounded by max-width so it cannot push past
//     its parent's content edge on narrow layouts.
//
// Run: node scripts/test_msg_align.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DESKTOP = path.resolve(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(DESKTOP, rel), "utf8");

let pass = 0;
let fail = 0;
function check(name, ok, detail) {
  if (ok) { console.log(`  \u2713 ${name}`); pass++; }
  else    { console.error(`  \u2717 ${name}  ${detail ?? ""}`); fail++; }
}

const css = read("src/renderer/styles.css");

// (1) Composer inside the chat-rail is inset by --chat-scrollbar (10px).
//     This is the live composer right inset the user bubble must match.
{
  const re = /\.chat-rail\s+\.composer-wrap\s*\{[^}]*padding:\s*0\s+var\(--chat-scrollbar\)/;
  check(
    ".chat-rail .composer-wrap insets by --chat-scrollbar (10px)",
    re.test(css),
    "expected `.chat-rail .composer-wrap { padding: 0 var(--chat-scrollbar) ... }`",
  );
}

// (2) --chat-scrollbar resolves to a 10px gutter.
{
  const re = /--chat-scrollbar:\s*10px/;
  check(
    "--chat-scrollbar CSS variable resolves to 10px",
    re.test(css),
    "expected `--chat-scrollbar: 10px;`",
  );
}

// (3) User message bubble is right-aligned.
{
  const re = /\.msg\.msg-user\s*\{[^}]*align-items:\s*flex-end/;
  check(
    ".msg.msg-user right-aligns children with align-items: flex-end",
    re.test(css),
    "expected `.msg.msg-user { ... align-items: flex-end ... }`",
  );
}

// (4) The fix: inside the chat-rail, .msg.msg-user carries a right
//     padding matching the composer's --chat-scrollbar so the
//     bubble's flex-end anchor sits at the same offset as the
//     composer's content edge.
{
  const re = /\.chat-rail\s+\.msg\.msg-user\s*\{[^}]*padding-right:\s*var\(--chat-scrollbar\)/;
  check(
    ".chat-rail .msg.msg-user has padding-right: var(--chat-scrollbar)",
    re.test(css),
    "expected `.chat-rail .msg.msg-user { padding-right: var(--chat-scrollbar); }`",
  );
}

// (5) The fix does NOT over-inset with --chat-pad-x inside the rail
//     (that would push the bubble further left than the composer).
{
  const block = /\.chat-rail\s+\.msg\.msg-user\s*\{[^}]*\}/;
  const m = block.exec(css);
  const leaks = m && /padding-right:\s*var\(--chat-pad-x\)/.test(m[0]);
  check(
    ".chat-rail .msg.msg-user does NOT over-inset with --chat-pad-x",
    !leaks,
    leaks ? "chat-pad-x leaked into the chat-rail .msg.msg-user block" : "",
  );
}

// (6) The bubble's max-width is bounded so it cannot physically push
//     past its parent's content edge.
{
  const re = /\.msg\.msg-user\s+\.msg-bubble\s*\{[^}]*max-width:\s*min\(100%,\s*\d+rem\)/;
  check(
    ".msg.msg-user .msg-bubble has bounded max-width",
    re.test(css),
    "expected `max-width: min(100%, ...rem)` on the user bubble",
  );
}

// (7) The .msg.msg-user block (un-scoped) does NOT carry padding-right
//     directly — the inset only applies inside .chat-rail. This
//     guards against the bug-fixed-in-the-last-iteration where
//     applying the inset globally (instead of chat-rail-scoped)
//     over-inset the bubble when the non-rail main-scroll is in use.
{
  const m = /\.msg\.msg-user\s*\{[^}]*\}/.exec(css);
  const scoped = m && /padding-right:\s*var\(--chat/.test(m[0]);
  check(
    ".msg.msg-user (un-scoped) does NOT carry right padding",
    !scoped,
    scoped ? "right padding leaked into un-scoped .msg.msg-user" : "",
  );
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);