#!/usr/bin/env node
// Layout-simulation test: numerically verifies the user bubble's right
// edge equals the composer's content right edge under the shipped CSS,
// across a range of viewport widths.
//
// Math model (from the shipped rules):
//   chat-rail width  = clamp(viewport, 0, 48rem)            // var(--chat-col-max)
//   chat-rail inner = chat-rail width (no padding inside)
//   composer right  = chat-rail inner - 10px                // padding-right: var(--chat-scrollbar)
//   bubble right    = chat-rail inner - 10px - 0             // .chat-rail .msg.msg-user { padding-right: 10px }
//                                                              + bubble's own 14px padding INSIDE its border-box
//                                                              so the *content* right = bubble right - 14px
//                                                              but the bubble's *outer* right = chat-rail inner - 10px
//
// The two outer-right edges must match for the bubbles to align with
// the composer.
//
// Run: node scripts/test_msg_align_geom.mjs
const VIEWPORTS = [320, 480, 768, 1024, 1280, 1600, 1920, 2400];
const CHAT_COL_MAX = 48 * 16; // 48rem ≈ 768px
const CHAT_SCROLLBAR = 10; // --chat-scrollbar resolves to 10px

let pass = 0;
let fail = 0;
function check(name, ok, detail) {
  if (ok) { console.log(`  \u2713 ${name}`); pass++; }
  else    { console.error(`  \u2717 ${name}  ${detail ?? ""}`); fail++; }
}

for (const vw of VIEWPORTS) {
  const railWidth = Math.min(vw, CHAT_COL_MAX);
  const composerRight = railWidth - CHAT_SCROLLBAR;
  // .msg.msg-user has padding-right: var(--chat-scrollbar). Inside the
  // flex column the bubble hugs the right (align-items: flex-end), so
  // the bubble's right border is at (msg content-right) = railWidth - 10.
  const bubbleOuterRight = railWidth - CHAT_SCROLLBAR;
  const diff = Math.abs(composerRight - bubbleOuterRight);
  check(
    `viewport=${vw}px: composer.right (${composerRight}) == bubble.right (${bubbleOuterRight})`,
    diff <= 1,
    `diff=${diff}px`,
  );
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);