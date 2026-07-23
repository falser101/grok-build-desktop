// E2E harness: drive AgentBackend.handleNotification with a synthetic
// x.ai/session_notification envelope carrying a goal_updated update, then
// assert the emitted snapshot.goalState carries the values we expect.
//
// Imports the real, shipped code from src/main/backend.ts via the
// workspace tsconfig — no mocking of the goal-branch logic. The
// handler is private in TS, but TS privacy is a compile-time hint:
// we cast through `unknown` so the e2e exercise stays honest.

import { AgentBackend } from "../src/main/backend";

function makeBackend(): AgentBackend {
  // No constructor args; AgentBackend builds its own clients lazily.
  return new AgentBackend();
}

function drain(backend: AgentBackend): Promise<void> {
  // Wait one tick so emitSnapshot's synchronous broadcast settles.
  return new Promise((resolve) => setImmediate(resolve));
}

function snapshotFrom(backend: AgentBackend): any | null {
  let last: any = null;
  const off = backend.onEvent((ev) => {
    if (ev.type === "snapshot") last = ev.snapshot;
  });
  // Drain immediately to register the listener.
  return new Promise<any>((resolve) => {
    setImmediate(() => {
      off();
      resolve(last);
    });
  });
}

async function takeSnapshot(backend: AgentBackend): Promise<any> {
  // Subscribe BEFORE the notification is dispatched so we don't race.
  let captured: any = null;
  const off = backend.onEvent((ev) => {
    if (ev.type === "snapshot") captured = ev.snapshot;
  });
  // Yield once so the listener is wired up before the notification runs.
  await drain(backend);
  // Tiny helper: capture current snapshot on demand by triggering a
  // harmless event. GoalState is populated synchronously inside
  // handleSessionUpdate before emitSnapshot fires, so we just listen.
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  await wait(0);
  off();
  return captured;
}

async function drive(
  backend: AgentBackend,
  method: string,
  params: any,
): Promise<any> {
  let captured: any = null;
  const off = backend.onEvent((ev) => {
    if (ev.type === "snapshot") captured = ev.snapshot;
  });
  await new Promise((r) => setImmediate(r));
  // Bypass TS privacy — TS-private is compile-time only, the runtime
  // method exists. Cast through unknown so we stay legal.
  (backend as unknown as { handleNotification: (m: string, p: any) => void })
    .handleNotification(method, params);
  await new Promise((r) => setImmediate(r));
  off();
  return captured;
}

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) {
    console.log(`  \u2713 ${name}`);
    pass++;
  } else {
    console.error(`  \u2717 ${name}`, detail ?? "");
    fail++;
  }
}

async function main(): Promise<void> {
  const backend = makeBackend();

  const samplePayload = {
    sessionId: "sess-TEST-1",
    update: {
      sessionUpdate: "goal_updated",
      goal_id: "g-TEST-1",
      objective: "Migrate the auth module",
      status: "active",
      phase: "executing",
      current_deliverable_title: "Token verifier",
      current_subagent_role: "worker",
      total_deliverables: 3,
      completed_deliverables: 1,
      tokens_used: 1234,
      token_budget: 100_000,
      elapsed_ms: 5000,
      pause_message: null,
      last_event: "worker_started",
    },
  };

  // (a) x.ai/session_notification envelope
  const snap1 = await drive(
    backend,
    "x.ai/session_notification",
    samplePayload,
  );
  check(
    "snapshot emitted after x.ai/session_notification",
    snap1 !== null,
    "no snapshot captured",
  );
  const gs1 = snap1?.goalState;
  check(
    "snapshot.goalState populated",
    gs1 && typeof gs1 === "object",
    gs1,
  );
  check(
    "goalState.objective = \"Migrate the auth module\"",
    gs1?.objective === "Migrate the auth module",
    gs1?.objective,
  );
  check(
    "goalState.status = \"active\"",
    gs1?.status === "active",
    gs1?.status,
  );
  check(
    "goalState.phase = \"executing\"",
    gs1?.phase === "executing",
    gs1?.phase,
  );
  check(
    "goalState.completedDeliverables = 1",
    gs1?.completedDeliverables === 1,
    gs1?.completedDeliverables,
  );
  check(
    "goalState.totalDeliverables = 3",
    gs1?.totalDeliverables === 3,
    gs1?.totalDeliverables,
  );

  // (b) x.ai/session/update envelope (legacy / replay path) — same shape
  const snap2 = await drive(
    backend,
    "x.ai/session/update",
    samplePayload,
  );
  check(
    "x.ai/session/update (replay) also populates goalState",
    snap2?.goalState?.objective === "Migrate the auth module",
    snap2?.goalState,
  );

  // (c) Defensive fallback: payload without sessionUpdate discriminator
  const snap3 = await drive(backend, "x.ai/session_notification", {
    sessionId: "sess-TEST-1",
    update: {
      // No sessionUpdate — simulate a future rename
      objective: "No-discriminator goal",
      status: "active",
      phase: "planning",
      total_deliverables: 0,
      completed_deliverables: 0,
    },
  });
  check(
    "defensive fallback accepts payload without sessionUpdate discriminator",
    snap3?.goalState?.objective === "No-discriminator goal",
    snap3?.goalState,
  );

  // (d) status=complete clears the bubble
  await drive(backend, "x.ai/session_notification", samplePayload);
  const snapComplete = await drive(backend, "x.ai/session_notification", {
    sessionId: "sess-TEST-1",
    update: {
      sessionUpdate: "goal_updated",
      goal_id: "g-TEST-1",
      objective: "Migrate the auth module",
      status: "complete",
      phase: "idle",
    },
  });
  check(
    "status=complete clears goalState (bubble disappears)",
    snapComplete?.goalState === undefined,
    snapComplete?.goalState,
  );

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("harness crashed:", err);
  process.exit(2);
});