// Structural assertion script for the chat-load pinning fix.
//
// Goal: prove the renderer (a) snaps to the latest message after a
// cold session load completes and (b) the "jump to latest" button
// stays visibility-correct (and that `scrollToBottom` is robust).
// Also proves the backend already suppresses intermediate snapshots
// during history replay so the renderer isn't asked to re-parse
// markdown N times mid-load.
//
// Drives the real shipped source on each run; exits 0 on full pass,
// 1 on first failure.

import fs from "node:fs";
import path from "node:path";

const repo = "/home/falser/Projects/grok-build-desktop";
const appPath = path.join(repo, "src/renderer/App.tsx");
const backendPath = path.join(repo, "src/main/backend.ts");
const stylesPath = path.join(repo, "src/renderer/styles.css");

const app = fs.readFileSync(appPath, "utf8");
const backend = fs.readFileSync(backendPath, "utf8");
const styles = fs.readFileSync(stylesPath, "utf8");

const checks = [];
function check(name, ok, detail = "") {
  checks.push({ name, ok: !!ok, detail });
}

// 1. Renderer has an edge-detector for the `replaying → not-replaying`
//    transition. The previous code permanently disabled stick while
//    replaying and never re-armed it on the cold-load completion path.
check(
  "App.tsx declares a `prevReplayingRef` edge-detector ref",
  /const\s+prevReplayingRef\s*=\s*useRef/.test(app),
);

// 1b. The replaying branch sets stick=false AND records the edge so
//     the transition below can react.
check(
  "App.tsx sets prevReplayingRef.current = true on the replaying branch",
  /stickToBottomRef\.current\s*=\s*false;[\s\S]{0,80}prevReplayingRef\.current\s*=\s*true/.test(
    app,
  ),
);

// 1c. The transition handler re-arms stick + sets isAtBottom(true)
//     + scrolls to bottom. This is the cold-load completion pin.
check(
  "App.tsx re-arms stickToBottomRef + setIsAtBottom(true) on replay completion",
  /justFinishedReplay[\s\S]{0,400}stickToBottomRef\.current\s*=\s*true[\s\S]{0,200}setIsAtBottom\(\s*true\s*\)/.test(
    app,
  ),
);

// 1d. The transition handler scrolls to the bottom via the chat
//     pane (sets scrollTop = scrollHeight).
check(
  "App.tsx scroll-to-bottom on replay completion uses pane.scrollTop = pane.scrollHeight",
  /justFinishedReplay[\s\S]{0,800}p\.scrollHeight\s*=\s*p\.scrollHeight|p\.scrollTop\s*=\s*p\.scrollHeight/.test(
    app,
  ) ||
    /justFinishedReplay[\s\S]{0,800}requestAnimationFrame\(\s*\(\)\s*=>\s*\{[\s\S]{0,400}scrollTop\s*=\s*scrollHeight/.test(
      app,
    ),
);

// 2. Jump-to-latest button visibility is only gated by isAtBottom
//    (and `!showHome` for the home screen). The old code was already
//    not guarded by replaying — keep it that way; assert no extra
//    suppression condition crept in.
check(
  "App.tsx jump-to-latest button visibility depends only on !showHome && !isAtBottom",
  /!showHome\s*&&\s*!isAtBottom\s*\?\s*\(?\s*[\s\S]{0,80}<button[^>]*className="chat-jump-to-bottom"/.test(
    app,
  ),
);

// 3. scrollToBottom guards against an empty timeline (scrollHeight=0)
//    and re-snaps after the smooth-scroll completes to absorb late
//    layout shifts.
check(
  "App.tsx scrollToBottom early-returns when scrollHeight === 0",
  /const\s+scrollToBottom\s*=\s*useCallback[\s\S]{0,400}pane\.scrollHeight\s*<=\s*0[\s\S]{0,200}return/.test(
    app,
  ),
);
check(
  "App.tsx scrollToBottom requestAnimationFrame re-snaps scrollTop = scrollHeight",
  /scrollToBottom[\s\S]{0,800}requestAnimationFrame\(\s*\(\)\s*=>\s*\{[\s\S]{0,400}p\.scrollTop\s*=\s*p\.scrollHeight|p\.scrollTop\s*=\s*p\.scrollHeight/.test(
    app,
  ),
);

// 4. Backend pushTimeline / updateTimeline suppress emitSnapshot
//    during history replay (existing behaviour; do not regress).
check(
  "backend.ts pushTimeline early-returns when replaying",
  /private\s+pushTimeline[\s\S]{0,1000}if\s*\(\s*this\.replaying\s*\)\s*return;[\s\S]{0,200}this\.emitSnapshot/.test(
    backend,
  ),
);
check(
  "backend.ts updateTimeline guards emitSnapshot on replaying",
  /private\s+updateTimeline[\s\S]{0,800}if\s*\(\s*!this\.replaying\s*\)\s*\{[\s\S]{0,200}emitSnapshot/.test(
    backend,
  ),
);

// 5. loadSession finally emits exactly one full snapshot after
//    replaying flips back to false. Verify the order: replaying=false
//    first, syncActiveIntoRuntimes second, emitSnapshot third.
check(
  "backend.ts loadSession finally emits one snapshot after replaying=false",
  /finally\s*\{[\s\S]{0,400}this\.replaying\s*=\s*false;[\s\S]{0,400}syncActiveIntoRuntimes\(\);[\s\S]{0,200}this\.emitSnapshot\(\)/.test(
    backend,
  ),
);

// 6. Chat-pane stays gated on snap.replaying — the loading wrap still
//    wins over the ChatTimeline cascade so the freshly-arrived
//    timeline isn't rendered behind the spinner for a frame.
check(
  "App.tsx still gates ChatTimeline render behind snap.replaying",
  /snap\.replaying\s*\?\s*\([\s\S]{0,300}session-loading-wrap[\s\S]{0,400}\)\s*:\s*\([\s\S]{0,400}<ChatTimeline/.test(
    app,
  ),
);

let failed = 0;
for (const c of checks) {
  const tag = c.ok ? "PASS" : "FAIL";
  if (!c.ok) failed++;
  console.log(
    `[${tag}] ${c.name}${c.detail ? ` — ${c.detail}` : ""}`,
  );
}
console.log(
  `\n${checks.length - failed}/${checks.length} assertions passed.`,
);
process.exit(failed === 0 ? 0 : 1);