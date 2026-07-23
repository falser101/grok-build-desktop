// MUST stay in sync with `PermissionMode::VALID_VALUES` in
//   grok-build crates/codegen/xai-grok-agent/src/config.rs
// `bypassPermissions` is intentionally NOT exposed here — it is
// controlled by the always-approve chip in the composer toolbar
// (which atomically flips sessionMode ↔ "bypassPermissions" together
// with the desktop's local auto-respond flag).
//
// Whenever a new PermissionMode variant lands upstream, add it here and
// bump `version` so the alignment contract test can flag drift.
import type { SessionModeId } from "@shared/types";
import type { Messages } from "./i18n";

export const MODE_OPTIONS_VERSION = "1.0.0";

export interface ModeOption {
  id: SessionModeId;
  label: string;
  hint: string;
  group: "approval" | "workflow";
}

export function modeOptions(m: Messages): ModeOption[] {
  return [
    {
      id: "default",
      label: m.modeDefault,
      hint: m.modeDefaultHint,
      group: "approval",
    },
    {
      id: "acceptEdits",
      label: m.modeAcceptEdits,
      hint: m.modeAcceptEditsHint,
      group: "approval",
    },
    {
      id: "auto",
      label: m.modeAuto,
      hint: m.modeAutoHint,
      group: "approval",
    },
    {
      id: "dontAsk",
      label: m.modeDontAsk,
      hint: m.modeDontAskHint,
      group: "approval",
    },
    {
      id: "plan",
      label: m.modePlan,
      hint: m.modePlanHint,
      group: "workflow",
    },
  ];
}

/** Group label keys (resolve to messages at the render site). */
export const MODE_GROUP_LABELS: Record<ModeOption["group"], keyof Messages> = {
  approval: "modeGroupApproval",
  workflow: "modeGroupWorkflow",
};