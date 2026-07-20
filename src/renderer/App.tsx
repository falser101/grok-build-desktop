import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import type {
  AccountStatus,
  AppSnapshot,
  AskUserQuestionResponse,
  ModelConfigKeyIndex,
  ModelInfo,
  PathSuggestion,
  PermissionOptionKind,
  PermissionRequestUi,
  PlanApprovalOutcome,
  PromptAttachment,
  SessionModeId,
  SessionRunStatus,
  SessionSearchHit,
  SessionSummary,
  TimelineItem,
} from "@shared/types";
import type { Messages } from "./i18n";
import { localizeEffort } from "./i18n";
import { AskUserQuestionModal } from "./AskUserQuestionModal";

import { TrustPromptDialog } from "./TrustPromptDialog";
import { MarkdownBody } from "./MarkdownBody";
import { AccountMenu } from "./AccountMenu";
import { ExtensionsView, type ExtTab } from "./ExtensionsView";
import { FileTree } from "./FileTree";
import { FileViewer } from "./FileViewer";
import { FilesTabSection } from "./FilesTabSection";

import { PlanPanel } from "./PlanPanel";
import { PlanApprovalCard } from "./PlanApprovalCard";
import { PlanProgressBubble } from "./PlanProgressBubble";
import { WaitingSessionsBanner } from "./WaitingSessionsBanner";
import { usePrefs } from "./PrefsContext";
import { SettingsView, type SettingsSectionId } from "./SettingsView";
import { TerminalPanel } from "./TerminalPanel";
import { ToolCard } from "./ToolCard";
import {
  completeSlashName,
  filterSlashSuggestions,
  isSlashCompose,
  slashNameQuery,
  tryHandleLocalSlash,
  type SlashSuggestion,
} from "./slash";
import {
  copyText,
  downloadTextFile,
  itemToCopyText,
  safeExportFilename,
  timelineToMarkdown,
  type TimelineMdLabels,
} from "./timelineMarkdown";

const initial: AppSnapshot = {
  connection: "idle",
  timeline: [],
  sessions: [],
  availableModels: [],
  installerStatus: { kind: "absent" },
  installerChannel: "stable",
  availableCommands: [],
  sessionMode: "default",
  acceptsImages: true,
  busy: false,
  alwaysApprove: false,
  autoTrustNewSessions: false,
  todos: [],
};

/**
 * Panel widths as % of the shell width (responsive across screen sizes).
 * Drag below collapse threshold folds the panel.
 */
const SIDEBAR_DEFAULT = 18;
const SIDEBAR_MIN = 12;
const SIDEBAR_MAX = 32;
const SIDEBAR_COLLAPSE = 7;
/** Collapsed sidebar rail width (% of shell). */
const SIDEBAR_RAIL = 2.5;
const RIGHT_DEFAULT = 20;
const RIGHT_MIN = 14;
const RIGHT_MAX = 38;
const RIGHT_COLLAPSE = 7;
/** File-tree pane width inside the right panel's `files` tab, % of the
 *  right panel's inner width (not of the shell). */
const FILE_TREE_DEFAULT = 38;
const FILE_TREE_MIN = 18;
const FILE_TREE_MAX = 62;
const FILE_TREE_COLLAPSE = 12;
const LAYOUT_STORAGE_KEY = "grok-desktop-layout-v2";
/** Legacy px-based key — migrate once then drop. */
const LAYOUT_STORAGE_KEY_LEGACY = "grok-desktop-layout";

/**
 * Sidebar toggle icons matching the right-panel toggle style:
 * a simple window outline (rect) with a single vertical divider line.
 * No extra content lines — same clean look as chat-side-toggle.
 *
 *   collapse (pinned + expanded) → divider at x=6  (sidebar visible, 4u)
 *   expand  (pinned + collapsed) → divider at x=5  (rail, 3u — matches right toggle's closed proportion)
 *   pin     (unpinned / hover)   → divider at x=5  (same as collapsed)
 */

function SidebarIcon({
  name,
}: {
  name: "collapse" | "expand" | "pin";
}): React.ReactElement {
  const dividerX = name === "collapse" ? 6 : 5;
  return (
    <svg
      className="sidebar-toggle-icon"
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="2" y="3" width="12" height="10" rx="1.5" />
      <path d={`M${dividerX} 3v10`} />
    </svg>
  );
}

type PanelLayout = {
  /** Sidebar width as % of shell (0–100). */
  sidebarWidth: number;
  sidebarCollapsed: boolean;
  /**
   * Whether the sidebar is "pinned" open. When false, the sidebar is hidden
   * and only revealed by hovering the cursor near the left edge of the window.
   * Cmd/Ctrl+B toggles pin. Default = pinned (true).
   */
  sidebarPinned: boolean;
  /** Right panel width as % of shell. */
  rightPanelWidth: number;
  /**
   * Width of the inline file-tree pane inside the right panel's `files`
   * tab (between the editor area and the tree). % of the right panel's
   * inner width — pure visual, not a shell column.
   */
  fileTreeWidth: number;
};

type ResizeSide = "left" | "right" | "filesTree";

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function shellWidthPx(): number {
  if (typeof window === "undefined") return 1280;
  return Math.max(320, window.innerWidth);
}

/** Convert legacy px layout values to % of current window. */
function pxToPct(px: number, min: number, max: number): number {
  const pct = (px / shellWidthPx()) * 100;
  return clamp(pct, min, max);
}

/**
 * Accept stored number: if it looks like old px (> max%), convert; else treat as %.
 */
function normalizeWidthPct(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  // Legacy px storage was always well above 50 for these panels.
  if (value > max + 5) return pxToPct(value, min, max);
  return clamp(value, min, max);
}

/**
 * Right-panel `+` button dropdown — opens a Plan, Terminal, or file-
 * tree focus action. File picking is handled by focusing the existing
 * tree filter; new files creation is left for a future patch.
 */
function RightPanelPlusMenu({
  m,
  onPickFiles,
  onPickPlan,
  onPickTerminal,
}: {
  m: Messages;
  onPickFiles: () => void;
  onPickPlan: () => void;
  onPickTerminal: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div className="right-panel-plus-wrap" ref={ref}>
      <button
        type="button"
        className="right-panel-plus"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={m.termNewTab}
      >
        +
      </button>
      {open ? (
        <div className="dropdown" role="menu">
          <button
            type="button"
            className="dropdown-item"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onPickFiles();
            }}
          >
            {m.filesPickFromWorkspace}
          </button>
          <button
            type="button"
            className="dropdown-item"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onPickPlan();
            }}
          >
            {m.sidePanelPlan}
          </button>
          <button
            type="button"
            className="dropdown-item"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onPickTerminal();
            }}
          >
            {m.sidePanelTerminal}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function defaultPanelLayout(): PanelLayout {
  return {
    sidebarWidth: SIDEBAR_DEFAULT,
    sidebarCollapsed: false,
    sidebarPinned: true,
    rightPanelWidth: RIGHT_DEFAULT,
    fileTreeWidth: FILE_TREE_DEFAULT,
  };
}

function loadPanelLayout(): PanelLayout {
  try {
    const raw =
      localStorage.getItem(LAYOUT_STORAGE_KEY) ??
      localStorage.getItem(LAYOUT_STORAGE_KEY_LEGACY);
    if (!raw) return defaultPanelLayout();
    const p = JSON.parse(raw) as Partial<PanelLayout>;
    return {
      sidebarWidth: normalizeWidthPct(
        p.sidebarWidth,
        SIDEBAR_DEFAULT,
        SIDEBAR_MIN,
        SIDEBAR_MAX,
      ),
      sidebarCollapsed: Boolean(p.sidebarCollapsed),
      sidebarPinned: p.sidebarPinned === undefined ? true : Boolean(p.sidebarPinned),
      rightPanelWidth: normalizeWidthPct(
        p.rightPanelWidth,
        RIGHT_DEFAULT,
        RIGHT_MIN,
        RIGHT_MAX,
      ),
      fileTreeWidth: normalizeWidthPct(
        p.fileTreeWidth,
        FILE_TREE_DEFAULT,
        FILE_TREE_MIN,
        FILE_TREE_MAX,
      ),
    };
  } catch {
    return defaultPanelLayout();
  }
}

function savePanelLayout(layout: PanelLayout): void {
  try {
    localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(layout));
  } catch {
    /* ignore */
  }
}

function modeOptions(
  m: Messages,
): { id: SessionModeId; label: string; hint: string }[] {
  return [
    { id: "default", label: m.modeAgent, hint: m.modeAgentHint },
    { id: "plan", label: m.modePlan, hint: m.modePlanHint },
    { id: "ask", label: m.modeAsk, hint: m.modeAskHint },
  ];
}

function projectFromCwd(cwd: string): string {
  const parts = cwd.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts[parts.length - 1] || cwd || "workspace";
}

function groupSessions(
  sessions: SessionSummary[],
): { project: string; cwd: string; items: SessionSummary[] }[] {
  const map = new Map<
    string,
    { project: string; cwd: string; items: SessionSummary[] }
  >();
  for (const s of sessions) {
    const key = s.cwd;
    let g = map.get(key);
    if (!g) {
      g = { project: s.project, cwd: s.cwd, items: [] };
      map.set(key, g);
    }
    g.items.push(s);
  }
  return Array.from(map.values());
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(Math.round(n));
}

function permissionKindClass(kind: PermissionOptionKind): string {
  if (kind === "allow_once" || kind === "allow_always") return "allow";
  if (kind === "reject_once" || kind === "reject_always") return "reject";
  return "";
}

function PermissionPanel({
  request,
  activeIndex,
  onActiveIndex,
  onConfirm,
  onCancel,
  m,
}: {
  request: PermissionRequestUi;
  activeIndex: number;
  onActiveIndex: (i: number) => void;
  onConfirm: (optionId: string) => void;
  onCancel: () => void;
  m: Messages;
}) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    rootRef.current?.focus();
  }, [request.requestId]);

  useEffect(() => {
    const root = listRef.current;
    if (!root) return;
    root
      .querySelector<HTMLElement>(".perm-option.active")
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, request.requestId]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const n = request.options.length;
    if (n === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      e.stopPropagation();
      onActiveIndex((activeIndex + 1) % n);
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      e.stopPropagation();
      onActiveIndex((activeIndex - 1 + n) % n);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      const opt = request.options[activeIndex];
      if (opt) onConfirm(opt.optionId);
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onCancel();
    }
  };

  return (
    <div
      ref={rootRef}
      className="permission-panel"
      role="dialog"
      aria-modal="true"
      aria-label={m.permissionTitle}
      tabIndex={0}
      onKeyDown={onKeyDown}
    >
      <div className="permission-head">
        <div className="permission-head-text">
          <div className="permission-kicker">{m.permissionTitle}</div>
          <div className="permission-title" title={request.title}>
            {request.title}
          </div>
          {request.detail ? (
            <pre className="permission-detail" title={request.detail}>
              {request.detail}
            </pre>
          ) : null}
        </div>
        {request.toolKind ? (
          <span className="permission-kind-badge">{request.toolKind}</span>
        ) : null}
      </div>

      <div className="permission-options" ref={listRef} role="listbox">
        {request.options.map((opt, i) => (
          <button
            key={opt.optionId}
            type="button"
            role="option"
            aria-selected={i === activeIndex}
            className={`perm-option ${permissionKindClass(opt.kind)} ${
              i === activeIndex ? "active" : ""
            }`}
            onMouseEnter={() => onActiveIndex(i)}
            onClick={() => onActiveIndex(i)}
            onDoubleClick={() => onConfirm(opt.optionId)}
          >
            <span className="perm-option-marker" aria-hidden>
              {i === activeIndex ? "›" : ""}
            </span>
            <span className="perm-option-label">{opt.name}</span>
          </button>
        ))}
      </div>

      <div className="permission-foot">
        <span className="permission-hint">{m.permissionHint}</span>
        <div className="permission-actions">
          <button
            type="button"
            className="btn ghost"
            onClick={onCancel}
          >
            {m.permissionCancel}
          </button>
          <button
            type="button"
            className="btn primary"
            onClick={() => {
              const opt = request.options[activeIndex];
              if (opt) onConfirm(opt.optionId);
            }}
            disabled={!request.options[activeIndex]}
          >
            {m.permissionConfirm}
          </button>
        </div>
      </div>
    </div>
  );
}

function compactTitle(item: Extract<TimelineItem, { kind: "compact" }>, m: Messages): string {
  if (item.status === "running") {
    if (item.mode === "auto") {
      if (typeof item.percentage === "number") {
        return m.compactRunningAutoPct.replace(
          "{pct}",
          String(Math.round(item.percentage)),
        );
      }
      return m.compactRunningAuto;
    }
    return m.compactRunning;
  }
  if (item.status === "failed") {
    return item.message
      ? `${m.compactFailed}: ${item.message}`
      : m.compactFailed;
  }
  if (item.status === "cancelled") {
    return m.compactCancelled;
  }
  if (
    typeof item.tokensBefore === "number" &&
    typeof item.tokensAfter === "number"
  ) {
    return m.compactDoneTokens
      .replace("{before}", formatTokens(item.tokensBefore))
      .replace("{after}", formatTokens(item.tokensAfter));
  }
  return m.compactDone;
}

function msgDomId(id: string): string {
  return `msg-${id}`;
}

/**
 * History Timeline layout constants. Ticks are short horizontal dashes
 * stacked at `MIN_STEP` pixels apart along the rail. When the resulting
 * track height exceeds the rail's `max-height`, the rail scrolls.
 */
const HISTORY_TIMELINE_MIN_STEP = 14;
const HISTORY_TIMELINE_PAD = 8;

/** Compute the inner track height needed to hold N evenly-spaced ticks. */
function historyTrackHeight(count: number): number {
  if (count <= 0) return 0;
  return HISTORY_TIMELINE_PAD * 2 + (count - 1) * HISTORY_TIMELINE_MIN_STEP;
}

/** Single-line preview for the scroll-linked sticky user pin. */
function previewText(text: string, max = 140): string {
  const one = text.replace(/\s+/g, " ").trim();
  if (one.length <= max) return one;
  return `${one.slice(0, max - 1)}…`;
}

type UserTimelineItem = Extract<TimelineItem, { kind: "user" }>;

/**
 * Match `.msg { scroll-margin-top }` so jump-to-message doesn't land past
 * the section threshold and flip the pin to the previous user turn.
 */
const PIN_SECTION_SLACK_PX = 56;

/**
 * Which user message "owns" the current scroll position:
 * last user bubble whose top has reached the top of the chat pane.
 * Returns null when that bubble is still fully on-screen (no need to clone it).
 */
function resolveScrollPinnedUser(
  pane: HTMLElement,
  userItems: UserTimelineItem[],
): UserTimelineItem | null {
  if (userItems.length === 0) return null;
  const paneTop = pane.getBoundingClientRect().top;
  // Include scroll-margin slack so a message docked under the pin still owns the section.
  const threshold = paneTop + PIN_SECTION_SLACK_PX;

  let active: UserTimelineItem | null = null;
  for (const item of userItems) {
    const el = document.getElementById(msgDomId(item.id));
    if (!el) continue;
    if (el.getBoundingClientRect().top <= threshold) {
      active = item;
    } else {
      // Timeline is top-to-bottom; later user msgs are still below.
      break;
    }
  }
  if (!active) return null;

  const activeEl = document.getElementById(msgDomId(active.id));
  if (!activeEl) return null;
  // Original still starts at/near the top of the viewport → don't duplicate.
  // (After pin-click jump, hold keeps the bar even when this would clear it.)
  if (activeEl.getBoundingClientRect().top >= paneTop - 1) return null;
  return active;
}

function MsgCopyButton({
  item,
  m,
}: {
  item: TimelineItem;
  m: Messages;
}) {
  const [state, setState] = useState<"idle" | "ok" | "err">("idle");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const onCopy = async (e: ReactMouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const text = itemToCopyText(item);
    if (!text) return;
    try {
      await copyText(text);
      setState("ok");
    } catch {
      setState("err");
    }
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setState("idle"), 1600);
  };

  const label =
    state === "ok" ? m.copied : state === "err" ? m.copyFailed : m.copyMessage;

  return (
    <button
      type="button"
      className={`msg-copy-btn${state === "ok" ? " is-ok" : ""}${
        state === "err" ? " is-err" : ""
      }`}
      onClick={(e) => void onCopy(e)}
      title={label}
      aria-label={label}
    >
      {state === "ok" ? (
        <span className="msg-copy-label">{m.copied}</span>
      ) : (
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <rect x="9" y="9" width="13" height="13" rx="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      )}
    </button>
  );
}

const TimelineRow = memo(function TimelineRow({
  item,
  m,
  highlight,
}: {
  item: TimelineItem;
  m: Messages;
  highlight?: boolean;
}) {
  if (item.kind === "system") {
    return <div className="system-line">{item.text}</div>;
  }
  if (item.kind === "user") {
    return (
      <div
        className={`msg msg-user${highlight ? " msg-flash" : ""}`}
        id={msgDomId(item.id)}
      >
        <div className="msg-bubble">
          {/* User messages skip the role label — the right-aligned bubble
             shape + accent color already identifies the speaker. */}
          <div className="msg-body">{item.text}</div>
          <div className="msg-actions">
            <MsgCopyButton item={item} m={m} />
          </div>
        </div>
      </div>
    );
  }
  if (item.kind === "assistant") {
    return (
      <div className="msg msg-assistant">
        <div className="msg-bubble">
          <div className="msg-head">
            <div className="msg-role assistant">{m.grok}</div>
            <MsgCopyButton item={item} m={m} />
          </div>
          <MarkdownBody
            className="msg-body"
            text={item.text}
            streaming={item.streaming}
          />
        </div>
      </div>
    );
  }
  if (item.kind === "thought") {
    // Default-open when nested inside a turn-group so the user sees the
    // thought text immediately after expanding the per-turn toggle.
    return (
      <details className="thought msg-assistant" open>
        <summary className="thought-summary">
          <span className="thought-summary-label">
            {item.streaming ? m.thoughtStreaming : m.thought}
          </span>
          <MsgCopyButton item={item} m={m} />
        </summary>
        <MarkdownBody
          className="thought-body"
          text={item.text}
          streaming={item.streaming}
        />
      </details>
    );
  }
  if (item.kind === "compact") {
    const running = item.status === "running";
    const label = item.mode === "auto" ? m.compactAuto : m.compactManual;
    return (
      <div
        className={`compact-card status-${item.status}${running ? " is-running" : ""}`}
        role="status"
        aria-live="polite"
      >
        <div className="compact-card-row">
          <span className={`compact-badge mode-${item.mode}`}>{label}</span>
          <span className="compact-title">{compactTitle(item, m)}</span>
          {running ? <span className="compact-spinner" aria-hidden /> : null}
        </div>
        {running ? (
          <div className="compact-progress" aria-hidden>
            <div className="compact-progress-bar" />
          </div>
        ) : null}
        {item.status === "completed" &&
        typeof item.tokensBefore === "number" &&
        typeof item.tokensAfter === "number" ? (
          <div className="compact-meta">
            {formatTokens(item.tokensBefore)} → {formatTokens(item.tokensAfter)}{" "}
            tokens
          </div>
        ) : null}
      </div>
    );
  }
  if (item.kind === "tool") {
    return <ToolCard item={item} m={m} />;
  }
  return null;
});

/** A single assistant "turn" — one assistant text plus all of its
 *  intermediate thoughts / tool calls / compact events. */
type TurnGroup = {
  /** Stable id for React key + scroll-jump anchor. */
  id: string;
  /** Final assistant text for this turn (may be null if only tool calls). */
  assistant: Extract<TimelineItem, { kind: "assistant" }> | null;
  /** Everything between this assistant text and the next one. */
  extras: TimelineItem[];
};

/** Flatten timeline → user/system rows + per-turn groups.
 *  Rule: an assistant text starts a new turn; everything between it and the
 *  next assistant text belongs to this turn. user/system rows are emitted
 *  inline so they retain their original ordering. */
function groupTimelineForTurns(timeline: TimelineItem[]): Array<
  | { kind: "row"; item: TimelineItem }
  | { kind: "turn"; turn: TurnGroup }
> {
  const out: Array<
    | { kind: "row"; item: TimelineItem }
    | { kind: "turn"; turn: TurnGroup }
  > = [];
  let current: TurnGroup | null = null;

  const flush = () => {
    if (current && (current.assistant || current.extras.length > 0)) {
      out.push({ kind: "turn", turn: current });
    }
    current = null;
  };

  for (const item of timeline) {
    if (item.kind === "assistant") {
      // New turn — close the previous one and start a fresh group whose
      // anchor is this assistant text.
      flush();
      current = {
        id: item.id,
        assistant: item,
        extras: [],
      };
      continue;
    }
    if (item.kind === "user" || item.kind === "system") {
      // user/system always render standalone (turns collapse around them).
      flush();
      out.push({ kind: "row", item });
      continue;
    }
    // thought / tool / compact: attach to the current turn if any, otherwise
    // start an orphan turn so the items aren't lost.
    if (!current) {
      current = {
        id: `orphan-${item.id}`,
        assistant: null,
        extras: [],
      };
    }
    current.extras.push(item);
  }
  flush();
  return out;
}

/** One assistant turn — collapses the intermediate thought/tool chain by
 *  default. While the turn is still streaming it stays expanded so the user
 *  can watch it type. Once the turn ends, default is collapsed.
 *
 *  Layout: the toggle (when there are extras) sits *inside* the assistant
 *  message, right under the "Grok" role head. That way it visually belongs
 *  to the same turn instead of floating as a separate row above it. */
const TurnGroupView = memo(function TurnGroupView({
  turn,
  m,
  highlight,
}: {
  turn: TurnGroup;
  m: Messages;
  highlight: boolean;
}) {
  const isStreaming = Boolean(turn.assistant?.streaming);
  // Default: collapsed once the turn has settled. While streaming we keep
  // it open so the user can follow the live output (and so newly arriving
  // intermediate steps are visible).
  const [open, setOpen] = useState<boolean>(isStreaming);

  // Auto-expand on stream start, auto-collapse when stream ends AND the
  // user hasn't manually toggled yet. We track that with a ref so we don't
  // override an explicit click.
  const userToggledRef = useRef(false);
  useEffect(() => {
    if (isStreaming) {
      if (!userToggledRef.current) setOpen(true);
    } else {
      if (!userToggledRef.current) setOpen(false);
    }
  }, [isStreaming]);

  const onToggle = (e: ReactMouseEvent<HTMLElement>) => {
    e.preventDefault();
    e.stopPropagation();
    userToggledRef.current = true;
    setOpen((v) => !v);
  };

  const hasExtras = turn.extras.length > 0;
  const assistantText = turn.assistant?.text ?? "";
  const assistantStreaming = Boolean(turn.assistant?.streaming);

  // If there's no assistant text, fall back to the original layout:
  // extras first, then nothing. (Orphan turns with only tool calls.)
  if (!turn.assistant) {
    return (
      <div
        className={`turn-group${open ? " is-open" : ""}`}
        id={msgDomId(turn.id)}
      >
        {hasExtras ? (
          <div className="turn-group-extras">
            <button
              type="button"
              className="turn-group-toggle"
              aria-expanded={open}
              onClick={onToggle}
              title={m.turnGroupToggle}
            >
              <span className={`turn-chev ${open ? "open" : ""}`} aria-hidden>
                ▸
              </span>
              <span className="turn-group-label">
                {`${m.turnGroupToggle} · ${turn.extras.length}`}
              </span>
            </button>
            {open ? (
              <div className="turn-group-extras-list">
                {turn.extras.map((it) => (
                  <TimelineRow
                    key={it.id}
                    item={it}
                    m={m}
                    highlight={false}
                  />
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div
      className={`msg msg-assistant turn-group${open ? " is-open" : ""}${
        isStreaming ? " is-streaming" : ""
      }${highlight ? " msg-flash" : ""}`}
      id={msgDomId(turn.id)}
    >
      <div className="msg-bubble">
        <div className="msg-head">
          <div className="msg-role assistant">{m.grok}</div>
          <MsgCopyButton item={turn.assistant} m={m} />
        </div>

        {/* Extras toggle lives *inside* the bubble, right under the head,
            so it's visually part of the same turn. */}
        {hasExtras ? (
          <button
            type="button"
            className="turn-group-toggle"
            aria-expanded={open}
            onClick={onToggle}
            title={open ? m.turnGroupToggle : m.turnGroupInner}
          >
            <span className={`turn-chev ${open ? "open" : ""}`} aria-hidden>
              ▸
            </span>
            <span className="turn-group-label">
              {`${m.turnGroupToggle} · ${turn.extras.length}`}
            </span>
          </button>
        ) : null}

        {hasExtras && open ? (
          <div className="turn-group-extras-list">
            {turn.extras.map((it) => (
              <TimelineRow key={it.id} item={it} m={m} highlight={false} />
            ))}
          </div>
        ) : null}

        <MarkdownBody
          className="msg-body"
          text={assistantText}
          streaming={assistantStreaming}
        />
      </div>
    </div>
  );
});

/** Isolated so composer keystrokes don't re-render the whole timeline tree. */
const ChatTimeline = memo(function ChatTimeline({
  timeline,
  replaying,
  flashMsgId,
  busy,
  m,
  bottomRef,
}: {
  timeline: TimelineItem[];
  replaying: boolean;
  flashMsgId: string | null;
  busy: boolean;
  m: Messages;
  bottomRef: RefObject<HTMLDivElement | null>;
}) {
  // During cold session load, skip mounting partial history (avoids N× markdown
  // re-parses). Backend holds emits until replay finishes; this is a safety net.
  if (replaying) {
    return (
      <div className="timeline">
        <div className="system-line loading-conversation">
          {m.loadingConversation}
        </div>
        <div ref={bottomRef} />
      </div>
    );
  }
  const segments = useMemo(() => groupTimelineForTurns(timeline), [timeline]);
  // Show the "thinking" indicator right after the user message when the
  // agent is busy but no assistant text / thought has landed yet.
  const lastItem = timeline[timeline.length - 1];
  const lastIsUser = lastItem?.kind === "user";
  const showPending = busy && lastIsUser;
  return (
    <div className="timeline">
      {segments.map((seg) =>
        seg.kind === "row" ? (
          <TimelineRow
            key={seg.item.id}
            item={seg.item}
            m={m}
            highlight={flashMsgId === seg.item.id}
          />
        ) : (
          <TurnGroupView
            key={seg.turn.id}
            turn={seg.turn}
            m={m}
            highlight={flashMsgId === seg.turn.id}
          />
        ),
      )}
      {showPending ? (
        <div className="turn-pending" role="status" aria-live="polite">
          <span className="turn-pending-dots" aria-hidden>
            <span />
            <span />
            <span />
          </span>
          <span className="turn-pending-label">{m.turnPending}</span>
        </div>
      ) : null}
      <div ref={bottomRef} />
    </div>
  );
});

type MenuKind = "model" | "mode" | "effort" | null;

/** Follow-up prompt waiting for the current turn to finish. */
type QueuedPrompt = {
  id: string;
  text: string;
  attachments: PromptAttachment[];
};

function newQueueId(): string {
  return `q-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function previewQueueText(text: string, max = 72): string {
  const one = text.replace(/\s+/g, " ").trim();
  if (!one) return "";
  return one.length > max ? `${one.slice(0, max)}…` : one;
}

/** Newest-first; drop consecutive duplicates and empty strings. */
function pushHistoryEntry(list: string[], text: string, max = 500): string[] {
  const t = text.trim();
  if (!t) return list;
  if (list[0] === t) return list;
  return [t, ...list].slice(0, max);
}

function filterHistoryEntries(entries: string[], query: string): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return entries;
  const tokens = q.split(/\s+/).filter(Boolean);
  return entries.filter((e) => {
    const lower = e.toLowerCase();
    return tokens.every((tok) => lower.includes(tok));
  });
}

function userPromptsFromTimeline(timeline: TimelineItem[]): string[] {
  const chrono: string[] = [];
  for (const item of timeline) {
    if (item.kind !== "user") continue;
    const t = item.text.trim();
    if (!t) continue;
    // Skip pure image placeholders from the backend display text.
    if (/^\[\d+ images?\]$/i.test(t)) continue;
    if (chrono.length > 0 && chrono[chrono.length - 1] === t) continue;
    chrono.push(t);
  }
  return chrono.reverse();
}
type MainView = "chat" | "settings" | "extensions";

interface ModelGroup {
  id: string;
  name: string;
  models: ModelInfo[];
}

function groupModelsByProvider(
  models: ModelInfo[],
  index: ModelConfigKeyIndex,
  builtinLabel: string,
): ModelGroup[] {
  const order: string[] = [];
  const map = new Map<string, ModelGroup>();
  const ensure = (id: string, name: string) => {
    let g = map.get(id);
    if (!g) {
      g = { id, name, models: [] };
      map.set(id, g);
      order.push(id);
    }
    return g;
  };

  for (const mod of models) {
    const meta = index[mod.modelId];
    if (meta) {
      ensure(meta.providerId, meta.providerName).models.push(mod);
    } else {
      ensure("builtin", builtinLabel).models.push(mod);
    }
  }

  // Prefer builtin first, then others in discovery order
  const builtin = order.filter((id) => id === "builtin");
  const rest = order.filter((id) => id !== "builtin");
  return [...builtin, ...rest]
    .map((id) => map.get(id)!)
    .filter((g) => g.models.length > 0);
}

interface SessionCtxMenu {
  session: SessionSummary;
  x: number;
  y: number;
}

function newAttId(): string {
  return `att-${Math.random().toString(36).slice(2, 10)}`;
}

function sessionStatusLabel(
  status: SessionRunStatus | undefined,
  m: Messages,
): string | undefined {
  if (!status || status === "idle") return undefined;
  if (status === "running") return m.sessionStatusRunning;
  if (status === "loading") return m.sessionStatusLoading;
  if (status === "needs_question") return m.sessionStatusNeedsQuestion;
  if (status === "needs_permission") return m.sessionStatusNeedsPermission;
  if (status === "needs_trust") return m.sessionStatusNeedsTrust;
  return undefined;
}

function SessionStatusIcon({
  status,
  label,
}: {
  status: SessionRunStatus | undefined;
  label?: string;
}) {
  if (!status || status === "idle") return null;
  if (
    status === "needs_permission" ||
    status === "needs_question" ||
    status === "needs_trust"
  ) {
    const variant =
      status === "needs_question"
        ? "question"
        : status === "needs_trust"
          ? "trust"
          : "";
    return (
      <span
        className={`session-status-dot${variant ? ` ${variant}` : ""}`}
        title={label}
        aria-label={label}
        role="status"
      />
    );
  }
  return (
    <span
      className={`session-status-spin${status === "loading" ? " loading" : ""}`}
      title={label}
      aria-label={label}
      role="status"
    />
  );
}

export function App() {
  const { messages: m } = usePrefs();
  const [snap, setSnap] = useState<AppSnapshot>(initial);
  /**
   * Composer text is kept in the DOM + draftRef (uncontrolled textarea) so
   * each keystroke does not re-render the whole App / timeline. `hasDraft`
   * only tracks empty vs non-empty for the send button.
   */
  const draftRef = useRef("");
  const [hasDraft, setHasDraft] = useState(false);
  const suggestRafRef = useRef<number | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  /**
   * In auto (hover) mode the sidebar floats as an overlay. This state holds
   * whether the overlay is currently revealed (mouse is near the left edge
   * or hovering the overlay itself).
   */
  const [sidebarHoverOpen, setSidebarHoverOpen] = useState(false);
  /** Set to true once user moves the mouse into the sidebar in hover mode. */
  const sidebarHoverActiveRef = useRef(false);
  const [menu, setMenu] = useState<MenuKind>(null);
  const [view, setView] = useState<MainView>("chat");
  const [extTab, setExtTab] = useState<ExtTab>("mcp");
  /**
   * Section to land on inside Settings. Defaults to "general" — the
   * Settings view re-reads this every time it mounts, so external callers
   * (e.g. the model dropdown's "Manage models" item) just set this then
   * switch the main view to "settings".
   */
  const [settingsSection, setSettingsSection] =
    useState<SettingsSectionId>("general");
  /** Desktop provider configKey → provider (for composer grouping). */
  const [modelKeyIndex, setModelKeyIndex] = useState<ModelConfigKeyIndex>({});
  /** Filter model menu by provider id (`all` = every group). */
  const [modelProviderFilter, setModelProviderFilter] = useState<string>("all");
  const [dragOver, setDragOver] = useState(false);
  const [attachments, setAttachments] = useState<PromptAttachment[]>([]);
  /**
   * Per-session follow-up queue. While a turn is busy, Enter enqueues here;
   * items auto-send when the session becomes idle (FIFO).
   */
  const [queuesBySession, setQueuesBySession] = useState<
    Record<string, QueuedPrompt[]>
  >({});
  /** Prevents double-drain while a dequeued prompt is still starting. */
  const drainLockRef = useRef(false);
  /**
   * Cancel-and-send target: runs before the normal FIFO queue once busy clears.
   * Scoped to a sessionId so a switch mid-cancel does not mis-fire.
   */
  const pendingImmediateRef = useRef<{
    sessionId: string;
    text: string;
    attachments: PromptAttachment[];
  } | null>(null);
  /**
   * Prompt history (newest first). Loaded from agent `x.ai/prompt_history`
   * and updated locally on each send so ↑ recall works immediately.
   */
  const [promptHistory, setPromptHistory] = useState<string[]>([]);
  /** ↑/↓ browse mode over `promptHistory` (fills the composer). */
  const [historyBrowse, setHistoryBrowse] = useState<{
    index: number;
  } | null>(null);
  /** /history searchable overlay. */
  const [historySearchOpen, setHistorySearchOpen] = useState(false);
  const [historySearchQuery, setHistorySearchQuery] = useState("");
  const [historySearchIndex, setHistorySearchIndex] = useState(0);
  const historySearchInputRef = useRef<HTMLInputElement | null>(null);
  const historyListRef = useRef<HTMLDivElement | null>(null);
  const [atSuggest, setAtSuggest] = useState<PathSuggestion[] | null>(null);
  const [atQuery, setAtQuery] = useState("");
  const [atIndex, setAtIndex] = useState(0);
  const [slashSuggest, setSlashSuggest] = useState<SlashSuggestion[] | null>(
    null,
  );
  const [slashIndex, setSlashIndex] = useState(0);
  const [sessionQuery, setSessionQuery] = useState("");
  const [searchHits, setSearchHits] = useState<SessionSearchHit[] | null>(null);
  const [searchBusy, setSearchBusy] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<SessionCtxMenu | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  /** Highlighted option in the permission panel. */
  const [permIndex, setPermIndex] = useState(0);
  /**
   * Right side panel: a dynamic tab bar at the top.
   *
   * Each tab is one of:
   *   - `files`    — a single file preview, identified by its absolute path
   *   - `plan`     — the plan / TODO view (singleton: at most one)
   *   - `terminal` — a PTY shell session; multiple instances are allowed, each
   *                  is its own tab with its own backend PTY id
   *
   * The user navigates by activating a tab, opening new files via the
   * `+` menu / file-tree, and closing tabs via the `×` chip button.
   */
  type RightTab =
    | { id: string; kind: "files"; path: string }
    | { id: string; kind: "plan" }
    | { id: string; kind: "terminal" };
  const newRightTabId = () =>
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `r_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  /** Open tabs in the right panel (any mix of files / plan / terminal). */
  const [rightPanelTabs, setRightPanelTabs] = useState<RightTab[]>([]);
  /** Which tab is currently rendered in the body area. */
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [rightPanelOpen, setRightPanelOpen] = useState(false);
  /**
   * True after the user manually closes the right panel during the current
   * run. Resets when a new run starts; suppresses the auto-pop of PlanPanel
   * so we don't fight the user's choice.
   */
  const planAutoPopDismissed = useRef(false);
  /** Track the session id so the dismissed flag resets between sessions. */
  const lastSessionIdRef = useRef<string | undefined>(undefined);
  /** Inline file-tree pane collapse state (false = expanded). */
  const [fileTreeCollapsed, setFileTreeCollapsed] = useState(false);
  const [panelLayout, setPanelLayout] = useState<PanelLayout>(() =>
    loadPanelLayout(),
  );
  /** Workspace picker menu above the composer. */
  const [wsMenuOpen, setWsMenuOpen] = useState(false);
  const [accountStatus, setAccountStatus] = useState<AccountStatus | null>(
    null,
  );
  const [accountBusy, setAccountBusy] = useState(false);
  /**
   * Files, Plan and Terminal all live in `rightPanelTabs` as one unified
   * list. We don't keep a separate "open file" array anymore — opening a
   * file just appends a `{kind:'files', path}` tab. `openFile` is reused
   * by `<FileTree>` and the "+" picker; `closeTab` removes any tab by id
   * and re-elects a neighbour when it was the active one.
   */
  /** Timeline message id briefly highlighted after pin click. */
  const [flashMsgId, setFlashMsgId] = useState<string | null>(null);
  /** Brief status after export / download. */
  const [exportToast, setExportToast] = useState<string | null>(null);
  /**
   * User message that owns the current scroll position (drives the
   * highlighted tick on the left-edge History Timeline rail). Updates as
   * you scroll past each user turn — not always "latest turn".
   */
  const [pinnedUser, setPinnedUser] = useState<UserTimelineItem | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const chatPaneRef = useRef<HTMLDivElement | null>(null);
  // Top-of-chat overflow menu (rename / fork / export / delete on the
  // active conversation). Distinct from the sidebar's per-session ctx menu.
  const chatActionsRef = useRef<HTMLDivElement | null>(null);
  const [chatActionsOpen, setChatActionsOpen] = useState(false);
  const exportToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pinScrollRafRef = useRef<number | null>(null);
  /** Y-position of each user-message tick within the main-chat container. */
  const [historyTickY, setHistoryTickY] = useState<Record<string, number>>({});
  /** id of the tick currently hovered (drives the preview popover). */
  const [historyHoverId, setHistoryHoverId] = useState<string | null>(null);
  /** Anchor rect (relative to viewport) for the preview popover. */
  const [historyPopover, setHistoryPopover] = useState<{
    top: number;
    left: number;
  } | null>(null);
  const historyRailRef = useRef<HTMLDivElement | null>(null);
  const historyScrollRef = useRef<HTMLDivElement | null>(null);
  /**
   * After pin click: keep this user id sticky until the user scrolls manually.
   * Prevents jump/`scroll-margin` from flipping the pin to the previous turn.
   */
  const pinHoldIdRef = useRef<string | null>(null);
  /** Suppress pin updates while programmatic scrollIntoView is in flight. */
  const pinIgnoreScrollRef = useRef(false);
  const pinIgnoreScrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  /** When true, keep the chat pinned to the latest message. */
  const stickToBottomRef = useRef(true);
  /** Mirror of stickToBottomRef that triggers re-renders for the
      "jump to bottom" button visibility. */
  const [isAtBottom, setIsAtBottom] = useState(true);
  const prevSessionIdRef = useRef<string | undefined>(undefined);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const selectsRef = useRef<HTMLDivElement | null>(null);
  const wsMenuRef = useRef<HTMLDivElement | null>(null);
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const slashListRef = useRef<HTMLDivElement | null>(null);
  const atListRef = useRef<HTMLDivElement | null>(null);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipRenameBlurRef = useRef(false);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const resizeDragRef = useRef<{
    side: ResizeSide;
    startX: number;
    startW: number;
    /** Live width applied to DOM during drag (no React re-render). */
    liveW: number;
    rightOpen: boolean;
  } | null>(null);
  /** True while a panel edge is being dragged — skip React layout sync / persist. */
  const isResizingRef = useRef(false);
  const panelLayoutRef = useRef(panelLayout);
  panelLayoutRef.current = panelLayout;
  const rightPanelOpenRef = useRef(rightPanelOpen);
  rightPanelOpenRef.current = rightPanelOpen;
  const rightPanelTabsRef = useRef(rightPanelTabs);
  rightPanelTabsRef.current = rightPanelTabs;
  const activeTabIdRef = useRef(activeTabId);
  activeTabIdRef.current = activeTabId;
  const viewRef = useRef(view);
  viewRef.current = view;

  // ── Right-panel tab actions ────────────────────────────────────────
  // Unified helpers across files / plan / terminal kinds. Activating a
  // tab sets the active id; closing a tab re-elects a neighbour so the
  // panel never lands on "no active tab" while it still has any tabs
  // open.
  const activeTab = useMemo(
    () => rightPanelTabs.find((t) => t.id === activeTabId) ?? null,
    [rightPanelTabs, activeTabId],
  );
  /** Currently-rendered path (file tabs only) — used by legacy refs that
   *  previously gated on a single `openFilePath` value. */
  const openFilePath = useMemo(
    () =>
      activeTab?.kind === "files" ? activeTab.path : null,
    [activeTab],
  );
  const openFilePathRef = useRef(openFilePath);
  openFilePathRef.current = openFilePath;

  const openFile = useCallback((path: string) => {
    setRightPanelTabs((prev) => {
      const existing = prev.find(
        (t) => t.kind === "files" && t.path === path,
      );
      if (existing) {
        setActiveTabId(existing.id);
        return prev;
      }
      const id = newRightTabId();
      setActiveTabId(id);
      return [...prev, { id, kind: "files", path }];
    });
    setRightPanelOpen(true);
    setFileTreeCollapsed(false);
  }, []);

  /** Add or focus the Plan tab (singleton). */
  const openPlanTab = useCallback(() => {
    setRightPanelTabs((prev) => {
      const existing = prev.find((t) => t.kind === "plan");
      if (existing) {
        setActiveTabId(existing.id);
        return prev;
      }
      const id = newRightTabId();
      setActiveTabId(id);
      return [...prev, { id, kind: "plan" }];
    });
    setRightPanelOpen(true);
  }, []);

  /** Add a brand-new Terminal tab. The inner TerminalPanel spawns its
   *  own PTY via the standard `termStart` IPC, so we don't track
   *  backend ids here. */
  const openTerminalTab = useCallback(() => {
    setRightPanelTabs((prev) => {
      const id = newRightTabId();
      setActiveTabId(id);
      return [...prev, { id, kind: "terminal" }];
    });
    setRightPanelOpen(true);
  }, []);

  const closeRightTab = useCallback((id: string) => {
    setRightPanelTabs((prev) => {
      const idx = prev.findIndex((t) => t.id === id);
      if (idx < 0) return prev;
      const next = prev.filter((t) => t.id !== id);
      setActiveTabId((curr) => {
        if (curr !== id) return curr;
        if (next.length === 0) return null;
        const fallback = next[Math.min(idx, next.length - 1)];
        return fallback.id;
      });
      return next;
    });
  }, []);

  /** Plan/Terminal aren't multi-instance by themselves — keep one of each. */
  const ensurePlanTabOpen = useCallback(() => {
    setRightPanelTabs((prev) => {
      if (prev.some((t) => t.kind === "plan")) return prev;
      const id = newRightTabId();
      setActiveTabId(id);
      return [...prev, { id, kind: "plan" }];
    });
  }, []);

  // Persist panel widths / collapse (skip while actively dragging).
  useEffect(() => {
    if (isResizingRef.current) return;
    savePanelLayout(panelLayout);
  }, [panelLayout]);

  /**
   * Apply grid columns on the shell node — no React re-render.
   * Only mutates CSS variables; stylesheet rules drive grid-template-columns.
   * Layout: sidebar | chat(main) | [viewer?] | [right?]
   */
  const applyShellColumns = useCallback(
    (
      leftPct: number,
      rightPct: number | null,
    ) => {
      const el = shellRef.current;
      if (!el) return;
      const fmt = (pct: number) => `${pct.toFixed(2)}%`;
      el.style.setProperty("--sidebar-w", fmt(leftPct));
      if (rightPct != null && rightPct > 0) {
        el.style.setProperty("--right-panel-w", fmt(rightPct));
      } else {
        el.style.setProperty("--right-panel-w", "0%");
      }
      // Clear any legacy inline grid from older builds so CSS classes own the template.
      if (el.style.gridTemplateColumns) {
        el.style.gridTemplateColumns = "";
      }
    },
    [],
  );

  // Sync React layout state → DOM when not dragging.
  // (During drag, pointer handlers own the grid columns via applyShellColumns.)
  useLayoutEffect(() => {
    if (isResizingRef.current || resizeDragRef.current) return;
    // Auto (hover) mode: the grid reserves zero width and the sidebar floats
    // as a fixed-position overlay. Pinned-but-collapsed: keep the thin rail.
    const leftPct = panelLayout.sidebarPinned
      ? panelLayout.sidebarCollapsed
        ? SIDEBAR_RAIL
        : panelLayout.sidebarWidth
      : 0;
    const rightPct =
      rightPanelOpen && view === "chat" ? panelLayout.rightPanelWidth : null;
    applyShellColumns(leftPct, rightPct);
  }, [
    applyShellColumns,
    panelLayout.sidebarCollapsed,
    panelLayout.sidebarPinned,
    panelLayout.sidebarWidth,
    panelLayout.rightPanelWidth,
    rightPanelOpen,
    view,
  ]);

  // Keep % layout correct when the window is resized (no drag in progress).
  useEffect(() => {
    const onResize = () => {
      if (isResizingRef.current || resizeDragRef.current) return;
      const layout = panelLayoutRef.current;
      const leftPct = layout.sidebarPinned
        ? layout.sidebarCollapsed
          ? SIDEBAR_RAIL
          : layout.sidebarWidth
        : 0;
      const rightOpen = rightPanelOpenRef.current && viewRef.current === "chat";
      applyShellColumns(leftPct, rightOpen ? layout.rightPanelWidth : null);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [applyShellColumns]);

  const onResizePointerDown = useCallback(
    (side: ResizeSide) => (e: ReactPointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      const handle = e.currentTarget;
      const layout = panelLayoutRef.current;
      const rightOpenNow =
        rightPanelOpenRef.current && viewRef.current === "chat";
      const startW =
        side === "left"
          ? layout.sidebarWidth
          : side === "right"
            ? layout.rightPanelWidth
            : layout.fileTreeWidth;
      // Set drag ref BEFORE any state so layout effects skip overwriting.
      resizeDragRef.current = {
        side,
        startX: e.clientX,
        startW,
        liveW: startW,
        rightOpen: rightOpenNow,
      };
      isResizingRef.current = true;
      // DOM-only chrome — avoid a full React re-render at drag start.
      const shell = shellRef.current;
      shell?.classList.add("shell-resizing", `shell-resizing-${side}`);
      document.body.classList.add("is-resizing-panels");
      try {
        handle.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }

      const leftFixed = layout.sidebarPinned
        ? layout.sidebarCollapsed
          ? SIDEBAR_RAIL
          : layout.sidebarWidth
        : 0;
      const rightFixed = layout.rightPanelWidth;
      const shellW = Math.max(
        1,
        shellRef.current?.clientWidth ?? shellWidthPx(),
      );

      const paint = (clientX: number) => {
        const drag = resizeDragRef.current;
        if (!drag) return;
        const deltaPct = ((clientX - drag.startX) / shellW) * 100;
        if (drag.side === "left") {
          const raw = drag.startW + deltaPct;
          const next = clamp(raw, SIDEBAR_COLLAPSE * 0.45, SIDEBAR_MAX);
          drag.liveW = next;
          applyShellColumns(next, drag.rightOpen ? rightFixed : null);
        } else if (drag.side === "right") {
          // Drag left edge: move left = wider right panel.
          const raw = drag.startW - deltaPct;
          const next = clamp(raw, RIGHT_COLLAPSE * 0.45, RIGHT_MAX);
          drag.liveW = next;
          applyShellColumns(leftFixed, next);
        } else {
          // File-tree (inside right panel): drag left edge — move left = wider tree.
          const raw = drag.startW - deltaPct;
          const next = clamp(raw, FILE_TREE_COLLAPSE * 0.45, FILE_TREE_MAX);
          drag.liveW = next;
          // Right panel width is fixed; we only update a CSS var on the
          // right panel node, not the shell grid.
          const rightEl = document.querySelector(".right-panel");
          if (rightEl) {
            (rightEl as HTMLElement).style.setProperty(
              "--files-tree-w",
              `${next.toFixed(2)}%`,
            );
          }
        }
      };

      // Coalesce pointermoves to one layout per frame (smoother than layout thrash).
      let raf = 0;
      let latestX = e.clientX;
      const onMove = (ev: PointerEvent) => {
        latestX = ev.clientX;
        if (raf) return;
        raf = requestAnimationFrame(() => {
          raf = 0;
          paint(latestX);
        });
      };

      const finishChrome = () => {
        isResizingRef.current = false;
        shell?.classList.remove(
          "shell-resizing",
          "shell-resizing-left",
          "shell-resizing-right",
          "shell-resizing-filesTree",
        );
        document.body.classList.remove("is-resizing-panels");
        // Let terminal / file viewers fit once after the final column widths settle.
        requestAnimationFrame(() => {
          window.dispatchEvent(new Event("panel-resize-end"));
        });
      };

      const onUp = (ev: PointerEvent) => {
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
        document.removeEventListener("pointercancel", onUp);
        if (raf) {
          cancelAnimationFrame(raf);
          raf = 0;
        }
        latestX = ev.clientX;
        paint(latestX);

        const drag = resizeDragRef.current;
        try {
          if (handle.hasPointerCapture(ev.pointerId)) {
            handle.releasePointerCapture(ev.pointerId);
          }
        } catch {
          /* ignore */
        }
        if (!drag) {
          finishChrome();
          return;
        }

        const live = drag.liveW;
        // Clear drag BEFORE setState so useLayoutEffect can apply final columns.
        resizeDragRef.current = null;
        finishChrome();

        if (drag.side === "left") {
          if (live < SIDEBAR_COLLAPSE) {
            // Shrinking below the threshold hides the sidebar entirely
            // (hover mode) rather than collapsing it into the thin rail —
            // matches the right-panel behavior where dragging past its
            // collapse threshold closes the panel completely.
            setPanelLayout((prev) => ({
              ...prev,
              sidebarPinned: false,
              sidebarCollapsed: true,
              sidebarWidth: clamp(
                drag.startW >= SIDEBAR_MIN ? drag.startW : SIDEBAR_DEFAULT,
                SIDEBAR_MIN,
                SIDEBAR_MAX,
              ),
            }));
          } else {
            setPanelLayout((prev) => ({
              ...prev,
              sidebarCollapsed: false,
              sidebarWidth: clamp(live, SIDEBAR_MIN, SIDEBAR_MAX),
            }));
          }
        } else if (drag.side === "right") {
          if (live < RIGHT_COLLAPSE) {
            setRightPanelOpen(false);
            setPanelLayout((prev) => ({
              ...prev,
              rightPanelWidth: clamp(
                drag.startW >= RIGHT_MIN ? drag.startW : RIGHT_DEFAULT,
                RIGHT_MIN,
                RIGHT_MAX,
              ),
            }));
          } else {
            setPanelLayout((prev) => ({
              ...prev,
              rightPanelWidth: clamp(live, RIGHT_MIN, RIGHT_MAX),
            }));
          }
        } else if (live < FILE_TREE_COLLAPSE) {
          // Dragged past the collapse threshold — fold the tree to a rail.
          setFileTreeCollapsed(true);
          setPanelLayout((prev) => ({
            ...prev,
            fileTreeWidth: clamp(
              drag.startW >= FILE_TREE_MIN ? drag.startW : FILE_TREE_DEFAULT,
              FILE_TREE_MIN,
              FILE_TREE_MAX,
            ),
          }));
        } else {
          setPanelLayout((prev) => ({
            ...prev,
            fileTreeWidth: clamp(live, FILE_TREE_MIN, FILE_TREE_MAX),
          }));
        }
      };

      document.addEventListener("pointermove", onMove, { passive: true });
      document.addEventListener("pointerup", onUp);
      document.addEventListener("pointercancel", onUp);
    },
    [applyShellColumns],
  );

  // Close every file tab when the workspace changes (paths go stale).
  useEffect(() => {
    setRightPanelTabs((prev) => {
      const droppedIds = prev
        .filter((t) => t.kind === "files")
        .map((t) => t.id);
      const next = prev.filter((t) => t.kind !== "files");
      if (droppedIds.length > 0) {
        setActiveTabId((curr) => (curr && droppedIds.includes(curr) ? null : curr));
      }
      return next;
    });
  }, [snap.workspace]);

  // Reset permission cursor when a new prompt becomes front-of-queue.
  useEffect(() => {
    const p = snap.pendingPermission;
    if (!p) return;
    const idx = Math.min(
      Math.max(0, p.defaultOptionIndex),
      Math.max(0, p.options.length - 1),
    );
    setPermIndex(idx);
  }, [snap.pendingPermission?.requestId]);

  // Capture keys while a permission prompt is open (even if focus drifts).
  // Disabled while a questionnaire modal is open (higher priority).
  useEffect(() => {
    const p = snap.pendingPermission;
    if (!p || snap.pendingQuestion) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      const n = p.options.length;
      if (n === 0) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        e.stopPropagation();
        setPermIndex((i) => (i + 1) % n);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        e.stopPropagation();
        setPermIndex((i) => (i - 1 + n) % n);
        return;
      }
      if (e.key === "Enter" && !e.isComposing) {
        e.preventDefault();
        e.stopPropagation();
        const opt = p.options[
          Math.min(Math.max(0, permIndex), n - 1)
        ];
        if (opt) {
          void window.desktop.respondPermission(p.requestId, opt.optionId);
        }
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        void window.desktop.respondPermission(p.requestId, null);
      }
    };
    // Capture phase so we win over the composer textarea / menus.
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [snap.pendingPermission, snap.pendingQuestion, permIndex]);

  // Keep keyboard-highlighted suggest items in view when arrowing through a tall list.
  useEffect(() => {
    const root = slashListRef.current;
    if (!root || !slashSuggest?.length) return;
    root
      .querySelector<HTMLElement>(".at-item.active")
      ?.scrollIntoView({ block: "nearest" });
  }, [slashIndex, slashSuggest]);

  useEffect(() => {
    const root = atListRef.current;
    if (!root || !atSuggest?.length) return;
    root
      .querySelector<HTMLElement>(".at-item.active")
      ?.scrollIntoView({ block: "nearest" });
  }, [atIndex, atSuggest]);

  useEffect(() => {
    void window.desktop.getState().then(setSnap);
    void window.desktop.getAccountStatus().then(setAccountStatus).catch(() => {
      /* ignore */
    });
    const offAgent = window.desktop.onEvent((event) => {
      if (event.type === "snapshot") {
        // Apply immediately — busy / connection / permission must not lag
        // behind session switches (startTransition left the send button stuck).
        // During cold load the backend suppresses intermediate timeline frames.
        setSnap(event.snapshot);
      } else if (event.type === "log" && event.level === "error") {
        setLocalError(event.message);
      }
    });
    const offAccount = window.desktop.onAccountEvent((event) => {
      if (event.type === "status" || event.type === "loginDone") {
        setAccountStatus(event.status);
        if (event.type === "loginDone") {
          setAccountBusy(false);
          if (!event.ok) setLocalError(event.message);
        }
      } else if (event.type === "loginProgress") {
        setAccountBusy(true);
        setAccountStatus((prev) =>
          prev
            ? {
                ...prev,
                loginInProgress: true,
                loginMessage: event.message,
                deviceUrl: event.deviceUrl ?? prev.deviceUrl,
                deviceUserCode: event.deviceUserCode ?? prev.deviceUserCode,
              }
            : prev,
        );
      }
    });
    return () => {
      offAgent();
      offAccount();
    };
  }, []);

  // Pin chat to latest content without a top→bottom smooth-scroll animation
  // (that looked bad when replaying history or switching sessions).
  const lastTimelineSig = useMemo(() => {
    const last = snap.timeline[snap.timeline.length - 1];
    if (!last) return "";
    if (
      last.kind === "assistant" ||
      last.kind === "user" ||
      last.kind === "thought"
    ) {
      return `${last.id}:${last.text.length}:${last.kind === "assistant" || last.kind === "thought" ? !!last.streaming : ""}`;
    }
    if (last.kind === "tool") {
      return `${last.id}:${last.status}:${last.outputText?.length ?? 0}`;
    }
    return last.id;
  }, [snap.timeline]);

  /** All user turns in timeline order — sections for the scroll pin. */
  const userTimelineItems = useMemo(
    () =>
      snap.timeline.filter(
        (it): it is UserTimelineItem => it.kind === "user",
      ),
    [snap.timeline],
  );

  const updateScrollPin = useCallback(() => {
    const pane = chatPaneRef.current;
    // No session / empty / replaying → nothing to pin.
    if (
      !pane ||
      snap.replaying ||
      !snap.sessionId ||
      userTimelineItems.length === 0
    ) {
      pinHoldIdRef.current = null;
      setPinnedUser(null);
      return;
    }
    // Pin click hold: keep showing that turn until the user scrolls.
    const holdId = pinHoldIdRef.current;
    if (holdId) {
      const held =
        userTimelineItems.find((u) => u.id === holdId) ?? null;
      if (held) {
        setPinnedUser((prev) => {
          if (prev?.id === held.id && prev?.text === held.text) return prev;
          return held;
        });
        return;
      }
      pinHoldIdRef.current = null;
    }
    const next = resolveScrollPinnedUser(pane, userTimelineItems);
    setPinnedUser((prev) => {
      if (prev?.id === next?.id && prev?.text === next?.text) return prev;
      return next;
    });
    // Also refresh the History Timeline tick Y positions so they track each
    // user message's top edge inside the main-chat viewport.
    refreshHistoryTicks();
  }, [userTimelineItems, snap.replaying, snap.sessionId]);

  /**
   * Compute a Y position for every user message. The rail is a fixed-height
   * scrollable strip — ticks are evenly spaced at `HISTORY_TIMELINE_MIN_STEP`
   * pixels apart, anchored to the top of the inner track. When the
   * conversation has more ticks than fit, the rail scrolls vertically.
   */
  const refreshHistoryTicks = useCallback(() => {
    const rail = historyRailRef.current;
    if (!rail) return;
    const n = userTimelineItems.length;
    if (n === 0) {
      setHistoryTickY({});
      return;
    }
    const next: Record<string, number> = {};
    for (let i = 0; i < n; i++) {
      next[userTimelineItems[i].id] =
        HISTORY_TIMELINE_PAD + i * HISTORY_TIMELINE_MIN_STEP;
    }
    setHistoryTickY((prev) => {
      // Cheap shallow-equal: avoid state churn on no-op updates.
      const ids = Object.keys(next);
      if (ids.length === Object.keys(prev).length) {
        let same = true;
        for (const id of ids) {
          if (Math.abs((prev[id] ?? 0) - next[id]) > 0.5) {
            same = false;
            break;
          }
        }
        if (same) return prev;
      }
      return next;
    });
    // If a tick is currently hovered, keep the popover anchored to it as
    // the user scrolls the chat pane.
    if (historyHoverIdRef.current) {
      const id = historyHoverIdRef.current;
      const tickEl = rail.querySelector<HTMLButtonElement>(
        `.history-timeline-tick[data-id="${CSS.escape(id)}"]`,
      );
      if (tickEl) {
        const r = tickEl.getBoundingClientRect();
        setHistoryPopover({ top: r.top + r.height / 2, left: r.right + 8 });
      }
    }
    // Auto-scroll the rail so the active tick stays visible whenever
    // pinnedUser changes (e.g., scrolling the chat, jumping to a
    // message, or new stream updates landing).
    const scrollEl = historyScrollRef.current;
    if (pinnedUser && scrollEl && scrollEl.scrollHeight > scrollEl.clientHeight) {
      const y = next[pinnedUser.id];
      if (typeof y === "number") {
        const visibleTop = scrollEl.scrollTop;
        const visibleBottom = visibleTop + scrollEl.clientHeight;
        if (y < visibleTop || y > visibleBottom) {
          // Center the tick in the viewport if possible, otherwise clamp.
          const target = Math.max(
            0,
            Math.min(
              scrollEl.scrollHeight - scrollEl.clientHeight,
              y - scrollEl.clientHeight / 2,
            ),
          );
          scrollEl.scrollTop = target;
        }
      }
    }
  }, [userTimelineItems, pinnedUser]);

  /**
   * Mirror of `historyHoverId` so refreshHistoryTicks can read the current
   * hovered tick without taking it as a dependency (which would invalidate
   * the callback every hover).
   */
  const historyHoverIdRef = useRef<string | null>(null);
  useEffect(() => {
    historyHoverIdRef.current = historyHoverId;
  }, [historyHoverId]);

  const scheduleScrollPin = useCallback(() => {
    if (pinScrollRafRef.current != null) return;
    pinScrollRafRef.current = requestAnimationFrame(() => {
      pinScrollRafRef.current = null;
      updateScrollPin();
    });
  }, [updateScrollPin]);

  // Recompute pin after timeline / layout changes (new messages, stream, etc.).
  useLayoutEffect(() => {
    scheduleScrollPin();
  }, [scheduleScrollPin, snap.timeline, lastTimelineSig]);

  // Recompute History Timeline ticks when the rail/scroll pane resize
  // (window resize, sidebar/panel open/close) so the layout adapts to
  // the new rail height.
  useEffect(() => {
    if (typeof ResizeObserver === "undefined") return;
    const rail = historyRailRef.current;
    const scroll = historyScrollRef.current;
    const pane = chatPaneRef.current;
    if (!rail && !scroll && !pane) return;
    const ro = new ResizeObserver(() => {
      refreshHistoryTicks();
    });
    if (rail) ro.observe(rail);
    if (scroll) ro.observe(scroll);
    if (pane) ro.observe(pane);
    return () => ro.disconnect();
  }, [refreshHistoryTicks]);

  useEffect(() => {
    return () => {
      if (pinScrollRafRef.current != null) {
        cancelAnimationFrame(pinScrollRafRef.current);
        pinScrollRafRef.current = null;
      }
      if (pinIgnoreScrollTimerRef.current) {
        clearTimeout(pinIgnoreScrollTimerRef.current);
        pinIgnoreScrollTimerRef.current = null;
      }
    };
  }, []);

  /** Smooth-scroll the chat pane to a message and briefly flash it. */
  const jumpToMsg = useCallback((id: string) => {
    const el = document.getElementById(msgDomId(id));
    if (!el) return;
    // Don't fight auto-stick while the user is inspecting their prompt.
    stickToBottomRef.current = false;
    // Keep this turn on the pin; ignore scroll events from scrollIntoView.
    pinHoldIdRef.current = id;
    pinIgnoreScrollRef.current = true;
    if (pinIgnoreScrollTimerRef.current) {
      clearTimeout(pinIgnoreScrollTimerRef.current);
    }
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    const pane = chatPaneRef.current;
    const endIgnore = () => {
      pinIgnoreScrollRef.current = false;
      pinIgnoreScrollTimerRef.current = null;
    };
    // Prefer scrollend when available; always fall back after smooth scroll.
    if (pane && "onscrollend" in pane) {
      pane.addEventListener("scrollend", endIgnore, { once: true });
    }
    pinIgnoreScrollTimerRef.current = setTimeout(endIgnore, 700);
    setFlashMsgId(id);
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    flashTimerRef.current = setTimeout(() => {
      setFlashMsgId((cur) => (cur === id ? null : cur));
      flashTimerRef.current = null;
    }, 1600);
  }, []);

  /** Smooth-scroll the chat pane to the bottom and re-engage stick. */
  const scrollToBottom = useCallback(() => {
    const pane = chatPaneRef.current;
    if (!pane) return;
    // Suppress the auto-stick override while programmatic scroll runs.
    pinIgnoreScrollRef.current = true;
    if (pinIgnoreScrollTimerRef.current) {
      clearTimeout(pinIgnoreScrollTimerRef.current);
    }
    pane.scrollTo({ top: pane.scrollHeight, behavior: "smooth" });
    const endIgnore = () => {
      pinIgnoreScrollRef.current = false;
      pinIgnoreScrollTimerRef.current = null;
    };
    if ("onscrollend" in pane) {
      pane.addEventListener("scrollend", endIgnore, { once: true });
    }
    pinIgnoreScrollTimerRef.current = setTimeout(endIgnore, 700);
    stickToBottomRef.current = true;
    setIsAtBottom(true);
  }, []);

  useEffect(() => {
    if (view !== "chat") return;
    const sessionChanged = prevSessionIdRef.current !== snap.sessionId;
    if (sessionChanged) {
      prevSessionIdRef.current = snap.sessionId;
      stickToBottomRef.current = true;
      pinHoldIdRef.current = null;
      pinIgnoreScrollRef.current = false;
    }
    if (snap.replaying) {
      stickToBottomRef.current = true;
    }
    if (!stickToBottomRef.current) return;
    if (snap.timeline.length === 0 && !snap.replaying) return;

    const pane = chatPaneRef.current;
    if (pane) {
      // Instant jump — no smooth animation through the full transcript.
      pane.scrollTop = pane.scrollHeight;
    } else {
      bottomRef.current?.scrollIntoView({ behavior: "auto", block: "end" });
    }
    // Auto-scroll changes which user section is under the top edge.
    scheduleScrollPin();
  }, [
    snap.timeline.length,
    snap.busy,
    snap.replaying,
    snap.sessionId,
    view,
    lastTimelineSig,
    scheduleScrollPin,
  ]);

  // Auto-pop the right-side Plan panel only when the agent actually has
  // a plan awaiting user approval — we don't want to yank the panel open
  // just because todos showed up. Resets per session; respects a manual
  // close mid-run.
  useEffect(() => {
    if (lastSessionIdRef.current !== snap.sessionId) {
      lastSessionIdRef.current = snap.sessionId;
      planAutoPopDismissed.current = false;
    }
    if (!snap.pendingPlanApproval) {
      planAutoPopDismissed.current = false;
      return;
    }
    if (planAutoPopDismissed.current) return;
    if (rightPanelOpenRef.current) {
      const t = rightPanelTabsRef.current.find(
        (x) => x.id === activeTabIdRef.current,
      );
      if (t?.kind === "plan") return;
    }
    if (viewRef.current !== "chat") return;
    setRightPanelOpen(true);
    openPlanTab();
  }, [
    snap.sessionId,
    snap.pendingPlanApproval,
    setRightPanelOpen,
    openPlanTab,
  ]);

  // If the user closes the right panel mid-run while a plan is awaiting
  // approval, remember it so we don't re-pop it on every approval update.
  useEffect(() => {
    if (snap.pendingPlanApproval && !rightPanelOpen) {
      planAutoPopDismissed.current = true;
    }
  }, [snap.pendingPlanApproval, rightPanelOpen]);

  // Close model/mode/effort menus on outside click or Escape
  useEffect(() => {
    if (!menu) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      const inSelects = selectsRef.current?.contains(t);
      // Mode menu lives in the floating workspace bar.
      const inWsBar = wsMenuRef.current?.contains(t);
      if (!inSelects && !inWsBar) {
        setMenu(null);
      }
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setMenu(null);
      }
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  // Close workspace picker on outside click or Escape
  useEffect(() => {
    if (!wsMenuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (wsMenuRef.current && !wsMenuRef.current.contains(e.target as Node)) {
        setWsMenuOpen(false);
      }
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setWsMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [wsMenuOpen]);

  // Close the top-of-chat overflow menu on outside click or Escape.
  // Capture-phase pointerdown so nested stopPropagation (composer, timeline
  // rail, etc.) cannot swallow the event; defer attach so the opening click
  // does not immediately re-close the menu.
  useEffect(() => {
    if (!chatActionsOpen) return;
    const onDoc = (e: Event) => {
      const root = chatActionsRef.current;
      if (!root) return;
      const target = e.target as Node | null;
      if (target && root.contains(target)) return;
      // Shadow / retargeted events: also check the composed path.
      if (typeof (e as PointerEvent).composedPath === "function") {
        const path = (e as PointerEvent).composedPath();
        if (path.includes(root)) return;
      }
      setChatActionsOpen(false);
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setChatActionsOpen(false);
      }
    };
    const t = window.setTimeout(() => {
      document.addEventListener("pointerdown", onDoc, true);
      document.addEventListener("keydown", onKey);
    }, 0);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener("pointerdown", onDoc, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [chatActionsOpen]);

  // Close session context menu on outside click / Escape
  useEffect(() => {
    if (!ctxMenu) return;
    const onDoc = () => setCtxMenu(null);
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setCtxMenu(null);
      }
    };
    // Defer so the opening click does not immediately close the menu.
    const t = window.setTimeout(() => {
      document.addEventListener("mousedown", onDoc);
      document.addEventListener("keydown", onKey);
    }, 0);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [ctxMenu]);

  // Focus rename input when entering rename mode
  useEffect(() => {
    if (renamingId) {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }
  }, [renamingId]);

  // Debounced full-text search via agent
  useEffect(() => {
    const q = sessionQuery.trim();
    if (searchTimerRef.current) {
      clearTimeout(searchTimerRef.current);
      searchTimerRef.current = null;
    }
    if (!q) {
      setSearchHits(null);
      setSearchBusy(false);
      return;
    }
    setSearchBusy(true);
    searchTimerRef.current = setTimeout(() => {
      void window.desktop
        .searchSessions(q, { limit: 40, includeContent: true })
        .then((hits) => {
          setSearchHits(hits);
          setSearchBusy(false);
        })
        .catch((err) => {
          setSearchBusy(false);
          setLocalError(err instanceof Error ? err.message : String(err));
        });
    }, 280);
    return () => {
      if (searchTimerRef.current) {
        clearTimeout(searchTimerRef.current);
        searchTimerRef.current = null;
      }
    };
  }, [sessionQuery]);

  const filteredSessions = useMemo(() => {
    const q = sessionQuery.trim().toLowerCase();
    if (!q) return snap.sessions;
    return snap.sessions.filter((s) => {
      const title = (s.title || "").toLowerCase();
      const project = (s.project || "").toLowerCase();
      const cwd = (s.cwd || "").toLowerCase();
      return title.includes(q) || project.includes(q) || cwd.includes(q);
    });
  }, [snap.sessions, sessionQuery]);

  const groups = useMemo(
    () => groupSessions(filteredSessions),
    [filteredSessions],
  );
  /** Distinct recent workspaces for the composer picker. */
  const recentWorkspaces = useMemo(() => {
    const seen = new Set<string>();
    const list: { cwd: string; project: string }[] = [];
    for (const s of snap.sessions) {
      if (!s.cwd || seen.has(s.cwd)) continue;
      seen.add(s.cwd);
      list.push({ cwd: s.cwd, project: s.project || projectFromCwd(s.cwd) });
      if (list.length >= 12) break;
    }
    return list;
  }, [snap.sessions]);
  const modes = useMemo(() => modeOptions(m), [m]);
  const currentModel = useMemo(
    () => snap.availableModels.find((mod) => mod.modelId === snap.modelId),
    [snap.availableModels, snap.modelId],
  );
  const modeLabel = useMemo(() => {
    const hit = modes.find((mod) => mod.id === snap.sessionMode);
    const label = (hit?.label || m.modeAgent || "Agent").trim();
    return label || "Agent";
  }, [modes, snap.sessionMode, m.modeAgent]);

  const connectionReady = snap.connection === "ready";
  const hasWorkspace = Boolean(snap.workspace);
  const hasSession = Boolean(snap.sessionId);
  const showHome = !hasSession || snap.timeline.length === 0;
  const workspaceName = snap.workspace
    ? projectFromCwd(snap.workspace)
    : null;
  const canCompose =
    connectionReady &&
    hasWorkspace &&
    !snap.pendingTrustPrompt;
  const errorText = localError ?? snap.error;
  const loading =
    snap.connection === "starting" ||
    snap.connection === "connecting" ||
    snap.replaying ||
    snap.busy ||
    Boolean(snap.compacting);

  /** Top-left new chat: empty workspace until the user picks one. */
  const onNewSession = useCallback(async () => {
    setLocalError(null);
    setView("chat");
    setWsMenuOpen(false);
    setRightPanelTabs((prev) => prev.filter((t) => t.kind !== "files"));
    setActiveTabId((curr) => {
      const t = rightPanelTabsRef.current.find((x) => x.id === curr);
      if (t?.kind === "files") return null;
      return curr;
    });
    try {
      await window.desktop.prepareNewChat();
      textareaRef.current?.focus();
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const mdExportLabels = useMemo((): TimelineMdLabels => {
    return {
      you: m.you,
      grok: m.grok,
      thought: m.thought,
      tool: m.exportLabelTool,
      compact: m.exportLabelCompact,
      system: m.exportLabelSystem,
      output: m.toolOutput,
      truncated: m.toolOutputTruncated,
    };
  }, [m]);

  const showExportToast = useCallback((text: string) => {
    setExportToast(text);
    if (exportToastTimerRef.current) clearTimeout(exportToastTimerRef.current);
    exportToastTimerRef.current = setTimeout(() => setExportToast(null), 2200);
  }, []);

  const buildConversationMarkdown = useCallback(() => {
    return timelineToMarkdown(
      snap.timeline,
      {
        title: snap.sessionTitle || m.untitledSession,
        workspace: snap.workspace,
        sessionId: snap.sessionId,
        modelId: snap.modelId,
      },
      mdExportLabels,
    );
  }, [
    snap.timeline,
    snap.sessionTitle,
    snap.workspace,
    snap.sessionId,
    snap.modelId,
    m.untitledSession,
    mdExportLabels,
  ]);

  const onExportCopyMarkdown = useCallback(async () => {
    setChatActionsOpen(false);
    if (snap.timeline.length === 0) {
      showExportToast(m.exportEmpty);
      return;
    }
    try {
      await copyText(buildConversationMarkdown());
      showExportToast(m.exportCopied);
    } catch {
      showExportToast(m.copyFailed);
    }
  }, [
    snap.timeline.length,
    buildConversationMarkdown,
    showExportToast,
    m.exportEmpty,
    m.exportCopied,
    m.copyFailed,
  ]);

  const onExportDownloadMarkdown = useCallback(() => {
    setChatActionsOpen(false);
    if (snap.timeline.length === 0) {
      showExportToast(m.exportEmpty);
      return;
    }
    try {
      downloadTextFile(
        safeExportFilename(snap.sessionTitle || m.untitledSession),
        buildConversationMarkdown(),
      );
      showExportToast(m.exportDownloaded);
    } catch {
      showExportToast(m.copyFailed);
    }
  }, [
    snap.timeline.length,
    snap.sessionTitle,
    buildConversationMarkdown,
    showExportToast,
    m.exportEmpty,
    m.exportDownloaded,
    m.untitledSession,
    m.copyFailed,
  ]);

  /** New session bound to a project folder (sidebar project row). */
  const onNewSessionInProject = useCallback(async (cwd: string) => {
    setLocalError(null);
    setView("chat");
    setCtxMenu(null);
    setWsMenuOpen(false);
    try {
      await window.desktop.newSession(cwd);
      textareaRef.current?.focus();
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const onSelectWorkspace = useCallback(async (cwd: string) => {
    setLocalError(null);
    setView("chat");
    setWsMenuOpen(false);
    try {
      await window.desktop.newSession(cwd);
      textareaRef.current?.focus();
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const onBrowseWorkspace = useCallback(async () => {
    setWsMenuOpen(false);
    try {
      const folder = await window.desktop.pickFolder();
      if (!folder) return;
      await onSelectWorkspace(folder);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : String(err));
    }
  }, [onSelectWorkspace]);

  const onLoadSession = useCallback(
    async (session: SessionSummary) => {
      if (session.sessionId === snap.sessionId) {
        setView("chat");
        return;
      }
      setLocalError(null);
      setView("chat");
      setCtxMenu(null);
      try {
        await window.desktop.loadSession(session.sessionId, session.cwd);
      } catch (err) {
        setLocalError(err instanceof Error ? err.message : String(err));
      }
    },
    [snap.sessionId],
  );

  const beginRename = useCallback((session: SessionSummary) => {
    setCtxMenu(null);
    skipRenameBlurRef.current = false;
    setRenamingId(session.sessionId);
    setRenameDraft(session.title || "");
  }, []);

  const commitRename = useCallback(
    async (session: SessionSummary) => {
      if (skipRenameBlurRef.current) {
        skipRenameBlurRef.current = false;
        return;
      }
      const next = renameDraft.trim();
      setRenamingId(null);
      if (!next || next === (session.title || "").trim()) return;
      setLocalError(null);
      try {
        await window.desktop.renameSession(
          session.sessionId,
          next,
          session.cwd,
        );
      } catch (err) {
        setLocalError(err instanceof Error ? err.message : String(err));
      }
    },
    [renameDraft],
  );

  const onDeleteSession = useCallback(async (session: SessionSummary) => {
    setCtxMenu(null);
    if (!window.confirm(m.deleteConfirm)) return;
    setLocalError(null);
    try {
      await window.desktop.deleteSession(session.sessionId, session.cwd);
      if (renamingId === session.sessionId) setRenamingId(null);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : String(err));
    }
  }, [m.deleteConfirm, renamingId]);

  const onForkSession = useCallback(async (session: SessionSummary) => {
    setCtxMenu(null);
    setLocalError(null);
    setView("chat");
    try {
      await window.desktop.forkSession(session.sessionId, session.cwd);
      textareaRef.current?.focus();
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  // Project the active snap into a SessionSummary-shaped object so the
  // existing rename / fork / delete callbacks (which already take
  // SessionSummary for the sidebar ctx menu) can be reused from the
  // top-of-chat overflow menu without changing their signatures.
  const activeSessionForMenu = useMemo<SessionSummary | null>(() => {
    if (!snap.sessionId) return null;
    return {
      sessionId: snap.sessionId,
      cwd: snap.workspace || "",
      project: projectFromCwd(snap.workspace || ""),
      title: snap.sessionTitle || "",
      updatedAt: "",
      modelId: snap.modelId,
    };
  }, [snap.sessionId, snap.workspace, snap.sessionTitle, snap.modelId]);

  const onRenameActiveSession = useCallback(() => {
    setChatActionsOpen(false);
    if (!activeSessionForMenu) return;
    beginRename(activeSessionForMenu);
  }, [activeSessionForMenu, beginRename]);

  const onForkActiveSession = useCallback(() => {
    setChatActionsOpen(false);
    if (!activeSessionForMenu) return;
    void onForkSession(activeSessionForMenu);
  }, [activeSessionForMenu, onForkSession]);

  const onDeleteActiveSession = useCallback(() => {
    setChatActionsOpen(false);
    if (!activeSessionForMenu) return;
    void onDeleteSession(activeSessionForMenu);
  }, [activeSessionForMenu, onDeleteSession]);

  const onCopyMarkdownFromMenu = useCallback(() => {
    setChatActionsOpen(false);
    void onExportCopyMarkdown();
  }, [onExportCopyMarkdown]);

  const onDownloadMarkdownFromMenu = useCallback(() => {
    setChatActionsOpen(false);
    onExportDownloadMarkdown();
  }, [onExportDownloadMarkdown]);

  const onSessionContextMenu = useCallback(
    (e: ReactMouseEvent, session: SessionSummary) => {
      e.preventDefault();
      e.stopPropagation();
      const pad = 8;
      const menuW = 160;
      const menuH = 120;
      const x = Math.min(e.clientX, window.innerWidth - menuW - pad);
      const y = Math.min(e.clientY, window.innerHeight - menuH - pad);
      setCtxMenu({ session, x: Math.max(pad, x), y: Math.max(pad, y) });
    },
    [],
  );

  const loadSearchHit = useCallback(
    async (hit: SessionSearchHit) => {
      setLocalError(null);
      setView("chat");
      try {
        await window.desktop.loadSession(hit.sessionId, hit.cwd);
      } catch (err) {
        setLocalError(err instanceof Error ? err.message : String(err));
      }
    },
    [],
  );

  const ensureSession = useCallback(async () => {
    if (snap.sessionId) return true;
    if (!snap.workspace) {
      setLocalError(m.chooseWorkspaceFirst);
      setWsMenuOpen(true);
      return false;
    }
    await window.desktop.newSession(snap.workspace);
    return true;
  }, [snap.sessionId, snap.workspace, m.chooseWorkspaceFirst]);

  const clearComposerText = useCallback(() => {
    draftRef.current = "";
    setHasDraft(false);
    const el = textareaRef.current;
    if (el) {
      el.value = "";
      el.style.height = "auto";
    }
  }, []);

  const setComposerText = useCallback((next: string) => {
    draftRef.current = next;
    setHasDraft(next.trim().length > 0);
    const el = textareaRef.current;
    if (el) {
      el.value = next;
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
    }
  }, []);

  const rememberPrompt = useCallback((text: string) => {
    setPromptHistory((prev) => pushHistoryEntry(prev, text));
  }, []);

  const exitHistoryBrowse = useCallback(() => {
    setHistoryBrowse(null);
  }, []);

  const applyHistoryEntry = useCallback(
    (text: string) => {
      setComposerText(text);
      setSlashSuggest(null);
      setAtSuggest(null);
      requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (!el) return;
        el.focus();
        const pos = el.value.length;
        el.setSelectionRange(pos, pos);
        el.style.height = "auto";
        el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
      });
    },
    [setComposerText],
  );

  const openHistorySearch = useCallback(
    (filter?: string) => {
      setHistorySearchQuery(filter ?? "");
      setHistorySearchIndex(0);
      setHistorySearchOpen(true);
      setHistoryBrowse(null);
      setSlashSuggest(null);
      setAtSuggest(null);
      requestAnimationFrame(() => historySearchInputRef.current?.focus());
    },
    [],
  );

  const closeHistorySearch = useCallback(() => {
    setHistorySearchOpen(false);
    setHistorySearchQuery("");
    setHistorySearchIndex(0);
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, []);

  const pickHistoryEntry = useCallback(
    (text: string) => {
      applyHistoryEntry(text);
      setHistorySearchOpen(false);
      setHistorySearchQuery("");
      setHistorySearchIndex(0);
      setHistoryBrowse(null);
    },
    [applyHistoryEntry],
  );

  // Load prompt history when workspace / session changes (agent file + timeline fallback).
  useEffect(() => {
    let cancelled = false;
    const cwd = snap.workspace;
    if (!cwd || snap.connection !== "ready") {
      if (!cwd) setPromptHistory([]);
      return;
    }
    void (async () => {
      let fromAgent: string[] = [];
      try {
        fromAgent = await window.desktop.listPromptHistory(
          cwd,
          snap.sessionId,
        );
      } catch {
        fromAgent = [];
      }
      if (cancelled) return;
      const fromTimeline = userPromptsFromTimeline(snap.timeline);
      // Prefer agent history; seed with timeline when agent returns empty/unavailable.
      if (fromAgent.length > 0) {
        setPromptHistory(fromAgent);
      } else if (fromTimeline.length > 0) {
        setPromptHistory(fromTimeline);
      } else {
        setPromptHistory([]);
      }
      setHistoryBrowse(null);
    })();
    return () => {
      cancelled = true;
    };
    // Intentionally not depending on timeline every tick — only session/cwd/connection.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- timeline used as cold fallback seed
  }, [snap.workspace, snap.sessionId, snap.connection]);

  // After session load finishes replaying, merge timeline user prompts if history still empty.
  useEffect(() => {
    if (snap.replaying || !snap.sessionId) return;
    if (promptHistory.length > 0) return;
    const fromTimeline = userPromptsFromTimeline(snap.timeline);
    if (fromTimeline.length > 0) setPromptHistory(fromTimeline);
  }, [snap.replaying, snap.sessionId, snap.timeline, promptHistory.length]);

  const filteredHistory = useMemo(
    () => filterHistoryEntries(promptHistory, historySearchQuery),
    [promptHistory, historySearchQuery],
  );

  // Keep highlighted history-search row in view.
  useEffect(() => {
    if (!historySearchOpen) return;
    const root = historyListRef.current;
    if (!root) return;
    const el = root.querySelector<HTMLElement>(
      `[data-history-idx="${historySearchIndex}"]`,
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [historySearchOpen, historySearchIndex, filteredHistory.length]);

  const promptQueue = useMemo(() => {
    if (!snap.sessionId) return [] as QueuedPrompt[];
    return queuesBySession[snap.sessionId] ?? [];
  }, [queuesBySession, snap.sessionId]);

  const enqueuePrompt = useCallback(
    (sessionId: string, text: string, atts: PromptAttachment[]) => {
      const item: QueuedPrompt = {
        id: newQueueId(),
        text,
        attachments: atts.map((a) => ({ ...a })),
      };
      setQueuesBySession((prev) => ({
        ...prev,
        [sessionId]: [...(prev[sessionId] ?? []), item],
      }));
    },
    [],
  );

  const removeQueuedPrompt = useCallback(
    (sessionId: string, id: string) => {
      setQueuesBySession((prev) => {
        const list = prev[sessionId];
        if (!list?.length) return prev;
        return {
          ...prev,
          [sessionId]: list.filter((q) => q.id !== id),
        };
      });
    },
    [],
  );

  const clearSessionQueue = useCallback((sessionId: string) => {
    setQueuesBySession((prev) => {
      if (!prev[sessionId]?.length) return prev;
      const next = { ...prev };
      delete next[sessionId];
      return next;
    });
  }, []);

  /** Deliver a prompt to the agent (session must exist / be creatable). */
  const dispatchAgentPrompt = useCallback(
    async (text: string, atts: PromptAttachment[]) => {
      const ok = await ensureSession();
      if (!ok) return;
      await window.desktop.sendPrompt({ text, attachments: atts });
    },
    [ensureSession],
  );

  /**
   * Cancel the in-flight turn (if any) and send this prompt as soon as idle.
   * Used for Ctrl+Enter / "Send now" on a queued row.
   */
  const requestImmediateSend = useCallback(
    async (
      text: string,
      atts: PromptAttachment[],
      opts?: { sessionId?: string },
    ) => {
      const sid = opts?.sessionId ?? snap.sessionId;
      // Mid-turn on this session: park payload, cancel, drain on idle.
      if (snap.busy && sid && sid === snap.sessionId) {
        pendingImmediateRef.current = {
          sessionId: sid,
          text,
          attachments: atts.map((a) => ({ ...a })),
        };
        try {
          await window.desktop.cancel();
        } catch (err) {
          pendingImmediateRef.current = null;
          setLocalError(err instanceof Error ? err.message : String(err));
        }
        return;
      }

      try {
        await dispatchAgentPrompt(text, atts);
      } catch (err) {
        setLocalError(err instanceof Error ? err.message : String(err));
      }
    },
    [snap.sessionId, snap.busy, dispatchAgentPrompt],
  );

  const onSend = useCallback(async () => {
    const text = (textareaRef.current?.value ?? draftRef.current).trim();
    if (!text && attachments.length === 0) return;
    setLocalError(null);
    setSlashSuggest(null);
    setAtSuggest(null);
    exitHistoryBrowse();

    // Local slash commands (/new, /model, …) before going to the agent.
    if (text.startsWith("/") && attachments.length === 0) {
      try {
        const result = await tryHandleLocalSlash(text, {
          models: snap.availableModels,
          modelId: snap.modelId,
          workspace: snap.workspace,
          alwaysApprove: snap.alwaysApprove,
          m,
          newSession: (ws) => window.desktop.newSession(ws),
          prepareNewChat: () => window.desktop.prepareNewChat(),
          setModel: (id, effort) => window.desktop.setModel(id, effort),
          setMode: (mode) => window.desktop.setMode(mode),
          setAlwaysApprove: (on) => window.desktop.setAlwaysApprove(on),
          pickFolder: () => window.desktop.pickFolder(),
        });
        if (result.kind === "error") {
          setLocalError(result.message);
          return;
        }
        if (result.kind === "open_history") {
          clearComposerText();
          openHistorySearch(result.filter);
          return;
        }
        if (result.kind === "open_plan") {
          clearComposerText();
          openRightTool("plan");
          return;
        }
        if (result.kind === "handled") {
          clearComposerText();
          return;
        }
        if (result.kind === "send") {
          // e.g. /plan do something — mode switched, remaining text is the prompt
          const follow = result.text.trim();
          clearComposerText();
          setAttachments([]);
          if (!follow) return;
          rememberPrompt(follow);
          if (snap.busy && snap.sessionId) {
            enqueuePrompt(snap.sessionId, follow, []);
            return;
          }
          try {
            await dispatchAgentPrompt(follow, []);
          } catch (err) {
            setLocalError(err instanceof Error ? err.message : String(err));
          }
          return;
        }
        // passthrough → agent
      } catch (err) {
        setLocalError(err instanceof Error ? err.message : String(err));
        return;
      }
    }

    const atts = attachments.map((a) => ({ ...a }));
    clearComposerText();
    setAttachments([]);
    if (text) rememberPrompt(text);

    // Busy turn: queue follow-up (FIFO, auto-sends when idle).
    if (snap.busy) {
      if (!snap.sessionId) {
        setLocalError(m.chooseWorkspaceFirst);
        return;
      }
      enqueuePrompt(snap.sessionId, text, atts);
      return;
    }

    try {
      await dispatchAgentPrompt(text, atts);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : String(err));
    }
  }, [
    attachments,
    clearComposerText,
    dispatchAgentPrompt,
    enqueuePrompt,
    exitHistoryBrowse,
    openHistorySearch,
    rememberPrompt,
    snap.availableModels,
    snap.modelId,
    snap.workspace,
    snap.alwaysApprove,
    snap.busy,
    snap.sessionId,
    m.chooseWorkspaceFirst,
  ]);

  /**
   * Ctrl+Enter / empty-Enter mid-turn: cancel current turn and send
   * the draft (or the selected / top queued item) immediately after.
   */
  const onSendNow = useCallback(
    async (queuedId?: string) => {
      setLocalError(null);
      setSlashSuggest(null);
      setAtSuggest(null);
      exitHistoryBrowse();

      const sid = snap.sessionId;
      if (queuedId && sid) {
        const list = queuesBySession[sid] ?? [];
        const item = list.find((q) => q.id === queuedId);
        if (!item) return;
        removeQueuedPrompt(sid, queuedId);
        if (item.text) rememberPrompt(item.text);
        await requestImmediateSend(item.text, item.attachments, {
          sessionId: sid,
        });
        return;
      }

      const text = (textareaRef.current?.value ?? draftRef.current).trim();
      const atts = attachments.map((a) => ({ ...a }));
      if (text || atts.length > 0) {
        // Local slash that only mutates client state still runs immediately.
        if (text.startsWith("/") && atts.length === 0) {
          try {
            const result = await tryHandleLocalSlash(text, {
              models: snap.availableModels,
              modelId: snap.modelId,
              workspace: snap.workspace,
              alwaysApprove: snap.alwaysApprove,
              m,
              newSession: (ws) => window.desktop.newSession(ws),
              prepareNewChat: () => window.desktop.prepareNewChat(),
              setModel: (id, effort) => window.desktop.setModel(id, effort),
              setMode: (mode) => window.desktop.setMode(mode),
              setAlwaysApprove: (on) => window.desktop.setAlwaysApprove(on),
              pickFolder: () => window.desktop.pickFolder(),
            });
            if (result.kind === "error") {
              setLocalError(result.message);
              return;
            }
            if (result.kind === "open_history") {
              clearComposerText();
              openHistorySearch(result.filter);
              return;
            }
            if (result.kind === "open_plan") {
              clearComposerText();
              openRightTool("plan");
              return;
            }
            if (result.kind === "handled") {
              clearComposerText();
              return;
            }
            if (result.kind === "send") {
              const follow = result.text.trim();
              clearComposerText();
              setAttachments([]);
              if (!follow) return;
              rememberPrompt(follow);
              await requestImmediateSend(follow, []);
              return;
            }
          } catch (err) {
            setLocalError(err instanceof Error ? err.message : String(err));
            return;
          }
        }
        clearComposerText();
        setAttachments([]);
        if (text) rememberPrompt(text);
        await requestImmediateSend(text, atts);
        return;
      }

      // Empty composer: force-send the top queued follow-up.
      if (sid) {
        const top = (queuesBySession[sid] ?? [])[0];
        if (top) {
          removeQueuedPrompt(sid, top.id);
          if (top.text) rememberPrompt(top.text);
          await requestImmediateSend(top.text, top.attachments, {
            sessionId: sid,
          });
        }
      }
    },
    [
      snap.sessionId,
      snap.availableModels,
      snap.modelId,
      snap.workspace,
      snap.alwaysApprove,
      attachments,
      queuesBySession,
      removeQueuedPrompt,
      requestImmediateSend,
      clearComposerText,
      exitHistoryBrowse,
      openHistorySearch,
      rememberPrompt,
    ],
  );

  const onCancel = useCallback(async () => {
    try {
      await window.desktop.cancel();
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  // When the active session goes idle, deliver pendingImmediate then FIFO queue.
  useEffect(() => {
    if (drainLockRef.current) return;
    if (snap.busy || snap.replaying) return;
    if (snap.connection !== "ready") return;
    const sid = snap.sessionId;
    if (!sid) return;

    const immediate = pendingImmediateRef.current;
    const queue = queuesBySession[sid] ?? [];
    if (!immediate || immediate.sessionId !== sid) {
      if (queue.length === 0) return;
    }

    // Lock synchronously so a re-render before await cannot double-drain.
    drainLockRef.current = true;

    const run = async (
      text: string,
      atts: PromptAttachment[],
      requeue?: QueuedPrompt,
    ) => {
      try {
        await dispatchAgentPrompt(text, atts);
      } catch (err) {
        if (requeue) {
          setQueuesBySession((prev) => ({
            ...prev,
            [sid]: [requeue, ...(prev[sid] ?? [])],
          }));
        }
        setLocalError(err instanceof Error ? err.message : String(err));
      } finally {
        drainLockRef.current = false;
      }
    };

    if (immediate && immediate.sessionId === sid) {
      pendingImmediateRef.current = null;
      void run(immediate.text, immediate.attachments);
      return;
    }

    const next = queue[0]!;
    setQueuesBySession((prev) => {
      const list = prev[sid] ?? [];
      if (!list.length || list[0]?.id !== next.id) return prev;
      return { ...prev, [sid]: list.slice(1) };
    });
    void run(next.text, next.attachments, next);
  }, [
    snap.busy,
    snap.replaying,
    snap.connection,
    snap.sessionId,
    queuesBySession,
    dispatchAgentPrompt,
  ]);

  const onToggleAlwaysApprove = useCallback(async () => {
    try {
      await window.desktop.setAlwaysApprove(!snap.alwaysApprove);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : String(err));
    }
  }, [snap.alwaysApprove]);

  const onSetAlwaysApprove = useCallback(async (enabled: boolean) => {
    try {
      await window.desktop.setAlwaysApprove(enabled);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const onPermissionConfirm = useCallback(
    async (optionId: string) => {
      const req = snap.pendingPermission;
      if (!req) return;
      try {
        await window.desktop.respondPermission(req.requestId, optionId);
      } catch (err) {
        setLocalError(err instanceof Error ? err.message : String(err));
      }
    },
    [snap.pendingPermission],
  );

  const onPermissionCancel = useCallback(async () => {
    const req = snap.pendingPermission;
    if (!req) return;
    try {
      await window.desktop.respondPermission(req.requestId, null);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : String(err));
    }
  }, [snap.pendingPermission]);

  const onAskUserQuestion = useCallback(
    async (response: AskUserQuestionResponse) => {
      const req = snap.pendingQuestion;
      if (!req) return;
      try {
        await window.desktop.respondAskUserQuestion(req.requestId, response);
      } catch (err) {
        setLocalError(err instanceof Error ? err.message : String(err));
      }
    },
    [snap.pendingQuestion],
  );

  const onTrustPrompt = useCallback(
    async (outcome: "trust" | "reject") => {
      const req = snap.pendingTrustPrompt;
      if (!req) return;
      try {
        await window.desktop.respondTrustPrompt(req.requestId, outcome);
      } catch (err) {
        setLocalError(err instanceof Error ? err.message : String(err));
      }
    },
    [snap.pendingTrustPrompt],
  );

  const onRetryConnect = useCallback(async () => {
    setLocalError(null);
    try {
      await window.desktop.connect();
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  // Installer state for the "Install automatically" button in the
  // connection-error card. Survives only for the lifetime of the error
  // card; a retry/successful install clears it.
  const [installRunning, setInstallRunning] = useState(false);
  const [installResult, setInstallResult] =
    useState<Awaited<ReturnType<typeof window.desktop.installAgent>> | null>(
      null,
    );
  const runInstaller = useCallback(async () => {
    setInstallRunning(true);
    setInstallResult(null);
    try {
      const result = await window.desktop.installAgent();
      setInstallResult(result);
      // On success, immediately retry connecting so the user doesn't have
      // to click again — installer puts the binary in ~/.grok/bin which
      // the next resolveGrokBinaryDetailed() will pick up.
      if (result.ok) {
        setLocalError(null);
        try {
          await window.desktop.connect();
        } catch (err) {
          setLocalError(err instanceof Error ? err.message : String(err));
        }
      }
    } catch (err) {
      setInstallResult({
        ok: false,
        output: "",
        code: null,
        durationMs: 0,
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setInstallRunning(false);
    }
  }, []);

  /**
   * "Upgrade" button inside the connection-error card. Same shape as
   * runInstaller() but routes through `upgradeAgent()` so we get the
   * rollback safety net. Reused by Settings → Agent → Upgrade.
   */
  const runUpgradeFromCard = useCallback(async () => {
    setInstallRunning(true);
    setInstallResult(null);
    try {
      const result = await window.desktop.upgradeAgent();
      setInstallResult(result);
      if (result.ok) {
        setLocalError(null);
        try {
          await window.desktop.connect();
        } catch (err) {
          setLocalError(err instanceof Error ? err.message : String(err));
        }
      }
    } catch (err) {
      setInstallResult({
        ok: false,
        output: "",
        code: null,
        durationMs: 0,
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setInstallRunning(false);
    }
  }, []);

  const mergeAttachments = useCallback((files: PromptAttachment[]) => {
    if (files.length === 0) return;
    setAttachments((prev) => {
      const seen = new Set(prev.map((p) => p.path ?? p.name));
      const next = [...prev];
      for (const f of files) {
        const key = f.path ?? f.name;
        if (seen.has(key)) continue;
        seen.add(key);
        next.push(f);
      }
      return next;
    });
  }, []);

  const onPickFiles = useCallback(async () => {
    setLocalError(null);
    try {
      const files = await window.desktop.pickFiles();
      mergeAttachments(files);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : String(err));
    }
  }, [mergeAttachments]);

  const onDropFiles = useCallback(
    async (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragOver(false);
      if (!connectionReady || snap.replaying) return;
      const list = e.dataTransfer?.files;
      if (!list || list.length === 0) return;
      setLocalError(null);
      try {
        const paths: string[] = [];
        const inlineImages: PromptAttachment[] = [];
        for (let i = 0; i < list.length; i++) {
          const file = list.item(i);
          if (!file) continue;
          const path = window.desktop.getPathForFile(file);
          if (path) {
            paths.push(path);
            continue;
          }
          // Fallback: image blob without path (e.g. some drag sources)
          if (file.type.startsWith("image/") && snap.acceptsImages) {
            const buf = await file.arrayBuffer();
            const bytes = new Uint8Array(buf);
            let binary = "";
            for (let j = 0; j < bytes.length; j++) {
              binary += String.fromCharCode(bytes[j]!);
            }
            inlineImages.push({
              id: newAttId(),
              kind: "image",
              displayPath: file.name || `drop-${Date.now()}.png`,
              name: file.name || `drop-${Date.now()}.png`,
              mimeType: file.type || "image/png",
              dataBase64: btoa(binary),
              sizeBytes: file.size,
            });
          }
        }
        if (paths.length > 0) {
          const atts = await window.desktop.attachPaths(paths);
          mergeAttachments(atts);
        }
        if (inlineImages.length > 0) mergeAttachments(inlineImages);
      } catch (err) {
        setLocalError(err instanceof Error ? err.message : String(err));
      }
    },
    [connectionReady, snap.replaying, snap.acceptsImages, mergeAttachments],
  );

  const openExtensions = useCallback((tab: ExtTab) => {
    setExtTab(tab);
    setView("extensions");
  }, []);

  /**
   * Navigate into Settings and pre-select a specific section. Used by the
   * composer model's "Manage models…" item, which now lands inside
   * Settings → 模型 instead of opening the standalone Models view.
   */
  const openSettingsSection = useCallback((section: SettingsSectionId) => {
    setSettingsSection(section);
    setView("settings");
  }, []);

  const refreshModelIndex = useCallback(async () => {
    try {
      const idx = await window.desktop.getModelConfigKeyIndex();
      setModelKeyIndex(idx);
    } catch {
      // Non-fatal: composer falls back to flat list
    }
  }, []);

  /** After Models settings change: regroup + force agent to re-read config.toml. */
  const refreshModelsAfterProviderChange = useCallback(async () => {
    await refreshModelIndex();
    try {
      await window.desktop.reloadAgentModels();
    } catch {
      // Agent may be offline; next connect/session will pick up config.
    }
  }, [refreshModelIndex]);

  useEffect(() => {
    void refreshModelIndex();
  }, [refreshModelIndex, snap.availableModels]);

  // Prevent Chromium from navigating to file:// when dropping outside composer.
  useEffect(() => {
    const block = (e: Event) => {
      e.preventDefault();
    };
    window.addEventListener("dragover", block);
    window.addEventListener("drop", block);
    return () => {
      window.removeEventListener("dragover", block);
      window.removeEventListener("drop", block);
    };
  }, []);

  const onSetModel = useCallback(
    async (modelId: string, effort?: string) => {
      setMenu(null);
      setLocalError(null);
      try {
        if (!snap.sessionId) {
          const ok = await ensureSession();
          if (!ok) return;
        }
        await window.desktop.setModel(modelId, effort);
      } catch (err) {
        setLocalError(err instanceof Error ? err.message : String(err));
      }
    },
    [snap.sessionId, ensureSession],
  );

  const onSetMode = useCallback(
    async (modeId: SessionModeId) => {
      setMenu(null);
      setLocalError(null);
      try {
        if (!snap.sessionId) {
          const ok = await ensureSession();
          if (!ok) return;
        }
        await window.desktop.setMode(modeId);
      } catch (err) {
        setLocalError(err instanceof Error ? err.message : String(err));
      }
    },
    [snap.sessionId, ensureSession],
  );

  const slashQueryRef = useRef<string | null>(null);
  const atQueryRef = useRef<string | null>(null);

  const updateSlashSuggest = useCallback(
    (value: string, cursor: number) => {
      if (!isSlashCompose(value, cursor)) {
        slashQueryRef.current = null;
        setSlashSuggest((prev) => (prev == null ? prev : null));
        return;
      }
      const q = slashNameQuery(value, cursor);
      const list = filterSlashSuggestions(snap.availableCommands, q);
      setSlashSuggest(list);
      // Only reset highlight when the filter query changes — not on every
      // keyup (ArrowUp/Down would otherwise always snap back to index 0).
      if (q !== slashQueryRef.current) {
        slashQueryRef.current = q;
        setSlashIndex(0);
      } else {
        setSlashIndex((i) =>
          list.length === 0 ? 0 : Math.min(i, list.length - 1),
        );
      }
      // Prefer slash menu over @ when both could match (slash owns leading `/`).
      setAtSuggest((prev) => (prev == null ? prev : null));
    },
    [snap.availableCommands],
  );

  const updateAtSuggest = useCallback(async (value: string, cursor: number) => {
    if (isSlashCompose(value, cursor)) {
      atQueryRef.current = null;
      setAtSuggest((prev) => (prev == null ? prev : null));
      return;
    }
    const before = value.slice(0, cursor);
    const match = before.match(/(?:^|[\s\n])@([^\s@]*)$/);
    if (!match) {
      atQueryRef.current = null;
      setAtSuggest((prev) => (prev == null ? prev : null));
      return;
    }
    const q = match[1] ?? "";
    setAtQuery(q);
    const queryChanged = q !== atQueryRef.current;
    if (queryChanged) {
      atQueryRef.current = q;
      setAtIndex(0);
    }
    try {
      const list = await window.desktop.pathSuggest(q);
      setAtSuggest(list);
      if (!queryChanged) {
        setAtIndex((i) =>
          list.length === 0 ? 0 : Math.min(i, list.length - 1),
        );
      }
    } catch {
      setAtSuggest(null);
    }
  }, []);

  const updateSuggest = useCallback(
    (value: string, cursor: number) => {
      updateSlashSuggest(value, cursor);
      void updateAtSuggest(value, cursor);
    },
    [updateSlashSuggest, updateAtSuggest],
  );

  /** Coalesce @ / slash filtering to one rAF so typing stays smooth. */
  const scheduleSuggest = useCallback(
    (value: string, cursor: number) => {
      if (suggestRafRef.current != null) {
        cancelAnimationFrame(suggestRafRef.current);
      }
      suggestRafRef.current = requestAnimationFrame(() => {
        suggestRafRef.current = null;
        // Prefer live DOM value (IME may have advanced since schedule).
        const el = textareaRef.current;
        const v = el?.value ?? value;
        const c = el?.selectionStart ?? cursor;
        updateSuggest(v, c);
      });
    },
    [updateSuggest],
  );

  const applySlashSuggestion = useCallback(
    (s: SlashSuggestion) => {
      const cur = textareaRef.current?.value ?? draftRef.current;
      const next = completeSlashName(cur, s);
      setComposerText(next);
      setSlashSuggest(null);
      requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (!el) return;
        el.focus();
        const pos = next.length;
        el.setSelectionRange(pos, pos);
        // If the command takes args, keep composing; re-open filter only for name phase
        updateSlashSuggest(next, pos);
      });
    },
    [setComposerText, updateSlashSuggest],
  );

  const insertAtPath = useCallback(
    (path: string, isDir: boolean) => {
      const el = textareaRef.current;
      if (!el) return;
      const value = el.value;
      const cursor = el.selectionStart ?? value.length;
      const before = value.slice(0, cursor);
      const after = value.slice(cursor);
      const match = before.match(/(?:^|[\s\n])@([^\s@]*)$/);
      if (!match || match.index === undefined) return;
      const atStart = match.index + (match[0].startsWith("@") ? 0 : 1);
      const absAt = before.lastIndexOf("@");
      const start = absAt >= 0 ? absAt : atStart;
      const insert = isDir ? `@${path}/` : `@${path} `;
      const next = value.slice(0, start) + insert + after;
      setComposerText(next);
      setAtSuggest(isDir ? atSuggest : null);
      requestAnimationFrame(() => {
        const pos = start + insert.length;
        el.focus();
        el.setSelectionRange(pos, pos);
        if (isDir) void updateAtSuggest(next, pos);
      });
    },
    [atSuggest, setComposerText, updateAtSuggest],
  );

  const onPaste = useCallback(
    async (e: ClipboardEvent<HTMLTextAreaElement>) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of Array.from(items)) {
        if (!item.type.startsWith("image/")) continue;
        e.preventDefault();
        const file = item.getAsFile();
        if (!file) continue;
        const buf = await file.arrayBuffer();
        const bytes = new Uint8Array(buf);
        let binary = "";
        for (let i = 0; i < bytes.length; i++) {
          binary += String.fromCharCode(bytes[i]!);
        }
        const dataBase64 = btoa(binary);
        const name = file.name || `paste-${Date.now()}.png`;
        setAttachments((prev) => [
          ...prev,
          {
            id: newAttId(),
            kind: snap.acceptsImages ? "image" : "file",
            displayPath: name,
            name,
            mimeType: file.type || "image/png",
            dataBase64: snap.acceptsImages ? dataBase64 : undefined,
            sizeBytes: file.size,
          },
        ]);
        break;
      }
    },
    [snap.acceptsImages],
  );

  const resizeTextarea = (el: HTMLTextAreaElement) => {
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (slashSuggest && slashSuggest.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSlashIndex((i) => Math.min(i + 1, slashSuggest.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSlashIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        const s = slashSuggest[slashIndex];
        if (s) applySlashSuggestion(s);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setSlashSuggest(null);
        return;
      }
    }
    if (atSuggest && atSuggest.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setAtIndex((i) => Math.min(i + 1, atSuggest.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setAtIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        const s = atSuggest[atIndex];
        if (s) insertAtPath(s.path, s.isDir);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setAtSuggest(null);
        return;
      }
    }
    if (e.key === "Escape" && historySearchOpen) {
      e.preventDefault();
      closeHistorySearch();
      return;
    }
    if (e.key === "Escape" && historyBrowse) {
      e.preventDefault();
      clearComposerText();
      exitHistoryBrowse();
      return;
    }
    if (e.key === "Escape" && menu) {
      e.preventDefault();
      setMenu(null);
      return;
    }
    // Ctrl/Cmd+R: open prompt-history search (TUI parity).
    if (
      (e.key === "r" || e.key === "R") &&
      (e.ctrlKey || e.metaKey) &&
      !e.altKey &&
      !e.shiftKey
    ) {
      e.preventDefault();
      openHistorySearch();
      return;
    }
    // ↑/↓ prompt history browse (empty composer, or already browsing).
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      const cur = textareaRef.current?.value ?? draftRef.current;
      const empty = cur.length === 0;
      if (historyBrowse || (e.key === "ArrowUp" && empty && !e.shiftKey)) {
        if (promptHistory.length === 0) {
          if (historyBrowse) {
            e.preventDefault();
          }
          return;
        }
        e.preventDefault();
        if (e.key === "ArrowUp") {
          if (!historyBrowse) {
            setHistoryBrowse({ index: 0 });
            applyHistoryEntry(promptHistory[0]!);
            return;
          }
          const next = Math.min(
            historyBrowse.index + 1,
            promptHistory.length - 1,
          );
          setHistoryBrowse({ index: next });
          applyHistoryEntry(promptHistory[next]!);
          return;
        }
        // ArrowDown
        if (!historyBrowse) return;
        if (historyBrowse.index <= 0) {
          clearComposerText();
          exitHistoryBrowse();
          return;
        }
        const next = historyBrowse.index - 1;
        setHistoryBrowse({ index: next });
        applyHistoryEntry(promptHistory[next]!);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!canCompose || snap.replaying || Boolean(snap.pendingPermission)) {
        return;
      }
      // Ctrl/Cmd+Enter: cancel-and-send (draft or top of queue).
      if (e.ctrlKey || e.metaKey) {
        void onSendNow();
        return;
      }
      if (snap.busy) {
        const text = (textareaRef.current?.value ?? draftRef.current).trim();
        if (!text && attachments.length === 0) {
          // Empty composer mid-turn → force-send top queued follow-up.
          if (promptQueue.length > 0) void onSendNow(promptQueue[0]!.id);
          return;
        }
        void onSend(); // enqueue
        return;
      }
      void onSend();
    }
  };

  const modelGroups = useMemo(
    () =>
      groupModelsByProvider(
        snap.availableModels,
        modelKeyIndex,
        m.modelsGroupBuiltin,
      ),
    [snap.availableModels, modelKeyIndex, m.modelsGroupBuiltin],
  );

  const filteredModelGroups = useMemo(() => {
    if (modelProviderFilter === "all") return modelGroups;
    return modelGroups.filter((g) => g.id === modelProviderFilter);
  }, [modelGroups, modelProviderFilter]);

  const currentProviderName = useMemo(() => {
    if (!snap.modelId) return undefined;
    return modelKeyIndex[snap.modelId]?.providerName;
  }, [snap.modelId, modelKeyIndex]);

  const modelChipLabel = currentModel
    ? currentProviderName
      ? `${currentProviderName} · ${currentModel.name}`
      : currentModel.name
    : snap.modelId || "Model";
  const tokensUsed = snap.tokensUsed;
  const contextWindow =
    snap.contextWindow ?? currentModel?.contextWindow ?? undefined;
  const tokenUsageLabel =
    typeof tokensUsed === "number"
      ? contextWindow
        ? `${formatTokens(tokensUsed)} / ${formatTokens(contextWindow)}`
        : formatTokens(tokensUsed)
      : null;
  const tokenUsageTitle =
    typeof tokensUsed === "number"
      ? m.tokenUsage
          .replace(
            "{used}",
            typeof tokensUsed === "number"
              ? tokensUsed.toLocaleString()
              : "—",
          )
          .replace(
            "{total}",
            typeof contextWindow === "number"
              ? contextWindow.toLocaleString()
              : "—",
          )
      : undefined;
  const tokenUsagePct =
    typeof tokensUsed === "number" &&
    typeof contextWindow === "number" &&
    contextWindow > 0
      ? Math.min(100, (tokensUsed / contextWindow) * 100)
      : null;
  const effortLabel = useMemo(() => {
    const raw =
      snap.reasoningEffort ||
      currentModel?.reasoningEffort ||
      "";
    return localizeEffort(raw, m);
  }, [snap.reasoningEffort, currentModel?.reasoningEffort, m]);

  const accountEmailDisplay =
    accountStatus?.email?.trim() || snap.accountEmail?.trim() || undefined;
  const accountSignedIn =
    accountStatus?.signedIn ?? !!accountEmailDisplay;

  const onAccountLogin = useCallback(
    async (method: "oauth" | "device") => {
      setAccountBusy(true);
      setLocalError(null);
      // Device flow benefits from settings UI (code + URL); browser can stay in place.
      if (method === "device") setView("settings");
      try {
        const s = await window.desktop.login(method);
        setAccountStatus(s);
      } catch (err) {
        setLocalError(err instanceof Error ? err.message : String(err));
      } finally {
        setAccountBusy(false);
      }
    },
    [],
  );

  const onAccountLogout = useCallback(async () => {
    if (!window.confirm(m.accountLogoutConfirm)) return;
    setAccountBusy(true);
    setLocalError(null);
    try {
      const r = await window.desktop.logout();
      setAccountStatus(r.status);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : String(err));
    } finally {
      setAccountBusy(false);
    }
  }, [m.accountLogoutConfirm]);

  const connectionLabel =
    snap.connection === "ready"
      ? m.connected
      : snap.connection === "error" || snap.connection === "stopped"
        ? m.disconnected
        : snap.connection === "connecting"
          ? m.connecting
          : m.starting;

  const insertFileMention = useCallback(
    (path: string) => {
      const mention = `@${path}`;
      const d = textareaRef.current?.value ?? draftRef.current;
      const next = !d.trim()
        ? `${mention} `
        : d.endsWith(" ") || d.endsWith("\n")
          ? `${d}${mention} `
          : `${d} ${mention} `;
      setComposerText(next);
      textareaRef.current?.focus();
    },
    [setComposerText],
  );

  const rightOpen = rightPanelOpen && view === "chat";

  /**
   * Height of the History Timeline's inner track. Drives both the inline
   * `height` on the scroll container and the rail's overflow (it scrolls
   * when this exceeds the rail's max-height).
   */
  const historyTrackHeightValue = historyTrackHeight(
    userTimelineItems.length,
  );
  /**
   * Index of the currently hovered tick within `userTimelineItems`, or
   * -1 when no tick is hovered. Computed once per render so each tick
   * can O(1) compute its fishbone distance to the hover point.
   */
  const historyHoverIdx = historyHoverId
    ? userTimelineItems.findIndex((u) => u.id === historyHoverId)
    : -1;

  const toggleRightPanel = useCallback(() => {
    setRightPanelOpen((open) => {
      if (open) return false;
      // Opening: keep any existing tabs in place; if none are open yet,
      // land on the Plan tab (matches the old `rightPanelTab = menu`
      // behaviour by giving the user something concrete to interact
      // with).
      setActiveTabId((curr) => {
        if (curr) return curr;
        const existing = rightPanelTabsRef.current;
        if (existing.length === 0) {
          const id = newRightTabId();
          setRightPanelTabs([{ id, kind: "plan" }]);
          return id;
        }
        return existing[existing.length - 1].id;
      });
      return true;
    });
  }, []);

  const toggleSidebar = useCallback(() => {
    setPanelLayout((p) => ({
      ...p,
      // Cmd/Ctrl+B toggles between "pinned" and "auto (hover)" modes.
      sidebarPinned: !p.sidebarPinned,
      // Switching into pinned mode always reveals the sidebar so the user
      // immediately sees it; switching into hover mode collapses it.
      sidebarCollapsed: !p.sidebarPinned ? false : true,
    }));
  }, []);

  // Collapsing the sidebar from the top-left ◀ button means the user
  // wants it out of the way — switch straight into hover (auto) mode so
  // there is no visible rail, and the overlay only appears on left-edge hover.
  const collapseSidebar = useCallback(() => {
    setPanelLayout((p) => ({
      ...p,
      sidebarPinned: false,
      sidebarCollapsed: true,
    }));
  }, []);

  const expandSidebar = useCallback(() => {
    setPanelLayout((p) => ({
      ...p,
      sidebarCollapsed: false,
    }));
  }, []);

  // Shared body of the left sidebar. Used in two places:
  //   - "pinned"  → inside the grid column when sidebarPinned && !sidebarCollapsed.
  //   - "hover"   → inside the floating overlay revealed by left-edge hover.
  // The `mode` argument only changes which top button is shown (collapse vs.
  // pin-to-grid) and whether the resize handle is rendered.
  const sidebarBody = useMemo(() => {
    return (mode: "pinned" | "hover"): React.ReactNode => (
      <>
        <div className="sidebar-top">
          <button
            className="nav-btn primary"
            onClick={() => void onNewSession()}
            title={m.newSession}
            aria-label={m.newSession}
          >
            <span className="icon">＋</span>
            <span className="nav-label">{m.newSession}</span>
          </button>
          <button
            className={`nav-btn ${view === "extensions" && extTab === "mcp" ? "active" : ""}`}
            onClick={() => openExtensions("mcp")}
            title={m.navMcp}
            aria-label={m.navMcp}
          >
            <span className="icon">🔌</span>
            <span className="nav-label">{m.navMcp}</span>
          </button>
          <button
            className={`nav-btn ${view === "extensions" && extTab !== "mcp" ? "active" : ""}`}
            onClick={() => openExtensions("skills")}
            title={m.navExtensions}
            aria-label={m.navExtensions}
          >
            <span className="icon">🧩</span>
            <span className="nav-label">{m.navExtensions}</span>
          </button>
        </div>

        <div className="sidebar-search">
          <input
            className="session-search-input"
            type="search"
            value={sessionQuery}
            onChange={(e) => setSessionQuery(e.target.value)}
            placeholder={m.searchSessions}
            aria-label={m.searchSessions}
          />
          {searchBusy ? <span className="session-search-busy" /> : null}
        </div>

        <div className="sidebar-scroll">
          {sessionQuery.trim() && searchHits && searchHits.length > 0 ? (
            <div className="project-group">
              <div className="project-header static">
                <span className="name">{m.searchHits}</span>
              </div>
              {searchHits.map((hit) => {
                const hitStatus = snap.sessions.find(
                  (s) => s.sessionId === hit.sessionId,
                )?.status;
                const statusLabel = sessionStatusLabel(hitStatus, m);
                return (
                  <button
                    key={`hit-${hit.sessionId}`}
                    className={`session-item search-hit ${
                      hit.sessionId === snap.sessionId && view === "chat"
                        ? "active"
                        : ""
                    }${hitStatus && hitStatus !== "idle" ? ` is-${hitStatus.replace("_", "-")}` : ""}`}
                    title={
                      statusLabel
                        ? `${hit.summary || m.untitledSession} · ${statusLabel}`
                        : hit.snippet || hit.summary
                    }
                    onClick={() => void loadSearchHit(hit)}
                    onContextMenu={(e) =>
                      onSessionContextMenu(e, {
                        sessionId: hit.sessionId,
                        cwd: hit.cwd,
                        project: projectFromCwd(hit.cwd),
                        title: hit.summary || m.untitledSession,
                        updatedAt: hit.updatedAt,
                        status: hitStatus,
                      })
                    }
                  >
                    <span className="session-item-row">
                      <SessionStatusIcon status={hitStatus} label={statusLabel} />
                      <span className="session-title">
                        {hit.summary || m.untitledSession}
                      </span>
                    </span>
                    {hit.snippet ? (
                      <span className="session-snippet">{hit.snippet}</span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          ) : null}

          {groups.length === 0 ? (
            <div className="empty-history">
              {!connectionReady
                ? m.connecting
                : sessionQuery.trim()
                  ? m.searchNoResults
                  : m.noSessions}
            </div>
          ) : (
            groups.map((g) => {
              const isCollapsed =
                sessionQuery.trim().length > 0
                  ? false
                  : (collapsed[g.cwd] ?? false);
              return (
                <div className="project-group" key={g.cwd}>
                  <div className="project-header-row">
                    <button
                      className="project-header"
                      onClick={() =>
                        setCollapsed((c) => ({ ...c, [g.cwd]: !isCollapsed }))
                      }
                      title={g.cwd}
                    >
                      <span className="chev">{isCollapsed ? "▸" : "▾"}</span>
                      <span className="name">{g.project}</span>
                    </button>
                    <button
                      type="button"
                      className="project-new-btn"
                      title={`${m.newSessionInProject}: ${g.project}`}
                      aria-label={`${m.newSessionInProject}: ${g.project}`}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        void onNewSessionInProject(g.cwd);
                      }}
                    >
                      ＋
                    </button>
                  </div>
                  {!isCollapsed &&
                    g.items.map((s) =>
                      renamingId === s.sessionId ? (
                        <form
                          key={s.sessionId}
                          className="session-rename-form"
                          onSubmit={(e) => {
                            e.preventDefault();
                            void commitRename(s);
                          }}
                        >
                          <input
                            ref={renameInputRef}
                            className="session-rename-input"
                            value={renameDraft}
                            onChange={(e) => setRenameDraft(e.target.value)}
                            onBlur={() => void commitRename(s)}
                            onKeyDown={(e) => {
                              if (e.key === "Escape") {
                                e.preventDefault();
                                skipRenameBlurRef.current = true;
                                setRenamingId(null);
                              }
                            }}
                            placeholder={m.renamePlaceholder}
                            aria-label={m.renameSession}
                          />
                        </form>
                      ) : (
                        <button
                          key={s.sessionId}
                          className={`session-item ${
                            s.sessionId === snap.sessionId && view === "chat"
                              ? "active"
                              : ""
                          }${
                            s.status && s.status !== "idle"
                              ? ` is-${s.status.replace("_", "-")}`
                              : ""
                          }`}
                          title={
                            (() => {
                              const st = sessionStatusLabel(s.status, m);
                              const base = s.title || m.untitledSession;
                              return st ? `${base} · ${st}` : base;
                            })()
                          }
                          onClick={() => void onLoadSession(s)}
                          onDoubleClick={(e) => {
                            e.preventDefault();
                            beginRename(s);
                          }}
                          onContextMenu={(e) => onSessionContextMenu(e, s)}
                        >
                          <SessionStatusIcon
                            status={s.status}
                            label={sessionStatusLabel(s.status, m)}
                          />
                          <span className="session-title">
                            {s.title || m.untitledSession}
                          </span>
                          {s.status === "running" || s.status === "loading" ? (
                            <span
                              className="session-cancel-btn"
                              role="button"
                              tabIndex={0}
                              title={m.cancelSessionTooltip}
                              aria-label={m.cancelSessionTooltip}
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                void window.desktop.cancelSession(s.sessionId);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  void window.desktop.cancelSession(s.sessionId);
                                }
                              }}
                            >
                              ■
                            </span>
                          ) : null}
                        </button>
                      ),
                    )}
                </div>
              );
            })
          )}
        </div>

        {ctxMenu ? (
          <div
            className="session-ctx-menu"
            style={{ left: ctxMenu.x, top: ctxMenu.y }}
            role="menu"
            aria-label={m.sessionActions}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => beginRename(ctxMenu.session)}
            >
              {m.renameSession}
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => void onForkSession(ctxMenu.session)}
            >
              {m.forkSession}
            </button>
            <button
              type="button"
              role="menuitem"
              className="danger"
              onClick={() => void onDeleteSession(ctxMenu.session)}
            >
              {m.deleteSession}
            </button>
          </div>
        ) : null}

        <div className="sidebar-footer">
          <AccountMenu
            connection={snap.connection}
            connectionLabel={connectionLabel}
            accountEmail={accountEmailDisplay}
            agentVersion={snap.agentVersion}
            usage={snap.usage}
            signedIn={accountSignedIn}
            loginBusy={accountBusy || !!accountStatus?.loginInProgress}
            onOpenSettings={() => setView("settings")}
            onLoginBrowser={() => void onAccountLogin("oauth")}
            onLoginDevice={() => void onAccountLogin("device")}
            onLogout={() => void onAccountLogout()}
            onOpenUsage={() => setView("settings")}
            onManageBilling={() => {
              const url =
                snap.usage?.manageUrl || "https://grok.com/?_s=usage";
              void window.desktop.openExternal(url).catch((err) => {
                setLocalError(
                  err instanceof Error ? err.message : String(err),
                );
              });
            }}
          />
        </div>
        {mode === "pinned" ? (
          <div
            className="resize-handle resize-handle-left"
            role="separator"
            aria-orientation="vertical"
            aria-label={m.resizeSidebar}
            title={m.resizeSidebar}
            onPointerDown={onResizePointerDown("left")}
            onDoubleClick={() => collapseSidebar()}
          />
        ) : null}
      </>
    );
  }, [
    m,
    view,
    extTab,
    openExtensions,
    onNewSession,
    sessionQuery,
    setSessionQuery,
    searchBusy,
    searchHits,
    snap,
    connectionReady,
    groups,
    collapsed,
    setCollapsed,
    renamingId,
    renameDraft,
    renameInputRef,
    commitRename,
    onLoadSession,
    beginRename,
    onSessionContextMenu,
    onForkSession,
    onDeleteSession,
    onNewSessionInProject,
    ctxMenu,
    accountEmailDisplay,
    connectionLabel,
    accountSignedIn,
    accountBusy,
    accountStatus,
    setView,
    onAccountLogin,
    onAccountLogout,
    snap.usage,
    setLocalError,
    onResizePointerDown,
    setPanelLayout,
    collapseSidebar,
    loadSearchHit,
  ]);

  const openRightTool = useCallback(
    (tab: "files" | "terminal" | "plan") => {
      setRightPanelOpen(true);
      if (tab === "files") {
        // No path yet — just open the file tree so the user can pick.
        setFileTreeCollapsed(false);
        requestAnimationFrame(() => {
          const input =
            document.querySelector<HTMLInputElement>(
              ".files-section-tree .file-tree-filter input",
            );
          input?.focus();
        });
        return;
      }
      if (tab === "plan") {
        openPlanTab();
        return;
      }
      if (tab === "terminal") {
        openTerminalTab();
      }
    },
    [openPlanTab, openTerminalTab],
  );

  const respondPlanApproval = useCallback(
    (
      requestId: string,
      outcome: PlanApprovalOutcome,
      feedback?: string,
    ) => {
      void window.desktop.respondPlanApproval(requestId, outcome, feedback);
    },
    [],
  );

  const refreshPlanContent = useCallback(() => {
    void window.desktop.refreshPlanContent();
  }, []);

  // Ctrl/Cmd+B toggles between pinned and auto (hover) sidebar modes.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod || e.altKey || e.shiftKey) return;
      if (e.key === "b" || e.key === "B") {
        e.preventDefault();
        e.stopPropagation();
        toggleSidebar();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [toggleSidebar]);

  // Auto (hover) mode: reveal the sidebar when the cursor approaches the
  // left edge of the window. Hide it when the cursor leaves the overlay.
  useEffect(() => {
    if (panelLayout.sidebarPinned) {
      // Switching to pinned mode should always close any hover overlay.
      sidebarHoverActiveRef.current = false;
      setSidebarHoverOpen(false);
      return;
    }
    const EDGE_PX = 8;
    const onMove = (e: MouseEvent) => {
      if (e.clientX <= EDGE_PX) {
        sidebarHoverActiveRef.current = true;
        setSidebarHoverOpen(true);
      }
    };
    document.addEventListener("mousemove", onMove);
    return () => {
      document.removeEventListener("mousemove", onMove);
    };
  }, [panelLayout.sidebarPinned]);

  // Shortcuts open the right panel into a specific tool (panel stays open).
  useEffect(() => {
    if (view !== "chat") return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod || e.altKey) return;
      if (e.key === "p" || e.key === "P") {
        if (e.shiftKey) {
          e.preventDefault();
          e.stopPropagation();
          openRightTool("plan");
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        openRightTool("files");
        return;
      }
      if (e.key === "`") {
        e.preventDefault();
        e.stopPropagation();
        openRightTool("terminal");
        return;
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [view, openRightTool]);

  // Auto-open Plan panel when a plan approval arrives or todos first appear.
  const prevPlanApprovalRef = useRef<string | null>(null);
  const prevTodoCountRef = useRef(0);
  useEffect(() => {
    if (view !== "chat") return;
    const approvalId = snap.pendingPlanApproval?.requestId ?? null;
    if (approvalId && approvalId !== prevPlanApprovalRef.current) {
      openRightTool("plan");
    }
    prevPlanApprovalRef.current = approvalId;

    const n = snap.todos?.length ?? 0;
    if (n > 0 && prevTodoCountRef.current === 0 && !rightPanelOpen) {
      // Soft open: only when panel is closed and todos appear for the first time.
      openRightTool("plan");
    }
    prevTodoCountRef.current = n;
  }, [
    view,
    snap.pendingPlanApproval?.requestId,
    snap.todos?.length,
    rightPanelOpen,
    openRightTool,
  ]);

  return (
    <div
      ref={shellRef}
      className={`shell ${rightOpen ? "shell-right-open" : ""} ${
        panelLayout.sidebarCollapsed ? "shell-sidebar-collapsed" : ""
      } ${
        view === "settings" ? "shell-view-settings" : ""
      }`}
    >
      {loading && view === "chat" ? <div className="loading-bar" /> : null}

      {snap.pendingQuestion ? (
        <AskUserQuestionModal
          request={snap.pendingQuestion}
          m={m}
          onSubmit={(response) => void onAskUserQuestion(response)}
        />
      ) : null}

      <div className="shell-header" />

      {view === "chat" ? (
      <button
        type="button"
        className="chat-topbar-btn chat-side-toggle-left"
        onClick={
          panelLayout.sidebarPinned
            ? panelLayout.sidebarCollapsed
              ? expandSidebar
              : collapseSidebar
            : toggleSidebar
        }
        title={
          panelLayout.sidebarPinned
            ? panelLayout.sidebarCollapsed
              ? `${m.sidebarExpand} (Ctrl+B)`
              : `${m.sidebarCollapse} (Ctrl+B)`
            : `${m.sidebarPin} (Ctrl+B)`
        }
        aria-label={
          panelLayout.sidebarPinned
            ? panelLayout.sidebarCollapsed
              ? `${m.sidebarExpand} (Ctrl+B)`
              : `${m.sidebarCollapse} (Ctrl+B)`
            : `${m.sidebarPin} (Ctrl+B)`
        }
      >
        <span className="icon" aria-hidden>
          {panelLayout.sidebarPinned ? (
            panelLayout.sidebarCollapsed ? (
              <SidebarIcon name="expand" />
            ) : (
              <SidebarIcon name="collapse" />
            )
          ) : (
            <SidebarIcon name="pin" />
          )}
        </span>
      </button>
      ) : null}

      {panelLayout.sidebarPinned ? (
        panelLayout.sidebarCollapsed ? (
          <div className="sidebar-rail">
            <button
              type="button"
              className="sidebar-rail-btn"
              title={`${m.sidebarExpand} (Ctrl+B)`}
              aria-label={`${m.sidebarExpand} (Ctrl+B)`}
              onClick={expandSidebar}
            >
              <SidebarIcon name="expand" />
            </button>
          </div>
        ) : (
          <aside className="sidebar">{sidebarBody("pinned")}</aside>
        )
      ) : (
        // Auto (hover) mode: keep the rail as a visual anchor + an invisible
        // trigger strip; float the sidebar as an overlay when revealed.
        <>
          <div
            className="sidebar-rail sidebar-trigger-rail"
            aria-hidden
            onMouseEnter={() => {
              sidebarHoverActiveRef.current = true;
              setSidebarHoverOpen(true);
            }}
          />
          {sidebarHoverOpen ? (
            <div
              className="sidebar-hover-overlay"
              onMouseEnter={() => {
                sidebarHoverActiveRef.current = true;
              }}
              onMouseLeave={() => {
                sidebarHoverActiveRef.current = false;
                setSidebarHoverOpen(false);
              }}
            >
              <aside className="sidebar">{sidebarBody("hover")}</aside>
            </div>
          ) : null}
        </>
      )}

      <section className="main">
        {view === "settings" ? (
          <div className="main-scroll settings-scroll">
            <SettingsView
              onBack={() => setView("chat")}
              accountEmail={accountEmailDisplay}
              connectionLabel={connectionLabel}
              alwaysApprove={snap.alwaysApprove}
              onSetAlwaysApprove={(on) => void onSetAlwaysApprove(on)}
              autoTrustNewSessions={snap.autoTrustNewSessions}
              onSetAutoTrustNewSessions={(on) =>
                void window.desktop.setAutoTrustNewSessions(on)
              }
              usage={snap.usage}
              onRefreshUsage={async () => {
                await window.desktop.refreshUsage();
              }}
              installerStatus={snap.installerStatus}
              lastUpdateCheckAt={snap.lastUpdateCheckAt}
              onProvidersChanged={() => void refreshModelsAfterProviderChange()}
              initialSection={settingsSection}
            />
          </div>
        ) : view === "extensions" ? (
          <div className="main-scroll settings-scroll">
            <ExtensionsView
              key={extTab}
              onBack={() => setView("chat")}
              initialTab={extTab}
              m={m}
            />
          </div>
        ) : (
          <div className="main-chat">
            {/* Full-width conversation header: sits at the top of the whole
                chat page (not inside the max-width-constrained chat-rail) so
                the title is top-left and the divider meets both panel edges. */}
            <div className="chat-topbar">
              <div className="chat-pane-title-wrap">
                <svg
                  className="chat-pane-title-icon"
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
                </svg>
                <span
                  className={`chat-pane-title${
                    snap.sessionTitle ? "" : " is-empty"
                  }`}
                  title={snap.sessionTitle || m.untitledSession}
                >
                  {snap.sessionTitle || m.untitledSession}
                </span>
                {hasSession && !showHome ? (
                  <div
                    className="chat-actions-wrap"
                    ref={chatActionsRef}
                  >
                    <button
                      type="button"
                      className={`chat-actions-btn${
                        chatActionsOpen ? " active" : ""
                      }`}
                      onClick={() => setChatActionsOpen((v) => !v)}
                      aria-haspopup="menu"
                      aria-expanded={chatActionsOpen}
                      title={m.chatActionsTitle}
                    >
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.75"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden
                      >
                        <circle cx="5" cy="12" r="1.4" />
                        <circle cx="12" cy="12" r="1.4" />
                        <circle cx="19" cy="12" r="1.4" />
                      </svg>
                    </button>
                    {chatActionsOpen ? (
                      <div className="chat-actions-menu" role="menu">
                        <button
                          type="button"
                          role="menuitem"
                          className="chat-actions-menu-item"
                          onClick={onRenameActiveSession}
                        >
                          {m.renameSession}
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          className="chat-actions-menu-item"
                          onClick={onForkActiveSession}
                        >
                          {m.forkSession}
                        </button>
                        <div
                          className="chat-actions-menu-sep"
                          aria-hidden
                        />
                        <button
                          type="button"
                          role="menuitem"
                          className="chat-actions-menu-item"
                          onClick={onCopyMarkdownFromMenu}
                          disabled={snap.timeline.length === 0}
                        >
                          {m.exportCopyMarkdown}
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          className="chat-actions-menu-item"
                          onClick={onDownloadMarkdownFromMenu}
                          disabled={snap.timeline.length === 0}
                        >
                          {m.exportDownloadMarkdown}
                        </button>
                        <div
                          className="chat-actions-menu-sep"
                          aria-hidden
                        />
                        <button
                          type="button"
                          role="menuitem"
                          className="chat-actions-menu-item danger"
                          onClick={onDeleteActiveSession}
                        >
                          {m.deleteSession}
                        </button>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
              <div className="chat-topbar-spacer" />
            </div>
            {/* Left-edge History Timeline rail. Replaces the old "current turn"
                pin chip: a fixed-height vertical strip centered on the chat
                column. Each user message is a short horizontal tick. The rail
                scrolls internally if there are more messages than fit.
                Hover → floating preview popover; click → jump & flash. */}
            {!showHome && userTimelineItems.length > 0 ? (
              <div
                className="history-timeline-rail"
                ref={historyRailRef}
                aria-label={m.historyTimelineTooltip}
                title={m.historyTimelineTooltip}
              >
                <div
                  className="history-timeline-scroll"
                  ref={historyScrollRef}
                >
                <div
                  className="history-timeline-track"
                  style={{ height: `${historyTrackHeightValue}px` }}
                >
                  {userTimelineItems.map((item, idx) => {
                    const y = historyTickY[item.id];
                    if (typeof y !== "number") return null;
                    const active = pinnedUser?.id === item.id;
                    const hovered = historyHoverId === item.id;
                    // Fishbone: when a tick is hovered, adjacent ticks within
                    // 3 positions stretch progressively shorter (1→2→3).
                    // distance === 0 means the hovered tick itself.
                    const hoverIdx = hovered
                      ? idx
                      : historyHoverIdx;
                    const distance =
                      hoverIdx >= 0 ? Math.abs(idx - hoverIdx) : -1;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        data-id={item.id}
                        className={`history-timeline-tick${
                          active ? " is-active" : ""
                        }${hovered ? " is-hovered" : ""}${
                          distance === 1 ? " is-near-1" : ""
                        }${distance === 2 ? " is-near-2" : ""}${
                          distance === 3 ? " is-near-3" : ""
                        }`}
                        style={{ top: `${y}px` }}
                        onMouseEnter={(e) => {
                          setHistoryHoverId(item.id);
                          const rect = (
                            e.currentTarget as HTMLButtonElement
                          ).getBoundingClientRect();
                          setHistoryPopover({
                            top: rect.top + rect.height / 2,
                            left: rect.right + 8,
                          });
                        }}
                        onMouseLeave={() => {
                          setHistoryHoverId((cur) =>
                            cur === item.id ? null : cur,
                          );
                          setHistoryPopover(null);
                        }}
                        onFocus={(e) => {
                          setHistoryHoverId(item.id);
                          const rect = (
                            e.currentTarget as HTMLButtonElement
                          ).getBoundingClientRect();
                          setHistoryPopover({
                            top: rect.top + rect.height / 2,
                            left: rect.right + 8,
                          });
                        }}
                        onBlur={() => {
                          setHistoryHoverId((cur) =>
                            cur === item.id ? null : cur,
                          );
                          setHistoryPopover(null);
                        }}
                        onClick={() => jumpToMsg(item.id)}
                        title={`${m.historyTimelineJump} (${idx + 1})`}
                        aria-label={`${m.historyTimelineJump}: ${previewText(
                          item.text,
                          80,
                        )}`}
                      >
                        <span className="history-timeline-tick-mark" />
                      </button>
                    );
                  })}
                </div>
                </div>
              </div>
            ) : null}
            {historyHoverId != null && historyPopover != null
              ? (() => {
                  const item = userTimelineItems.find(
                    (u) => u.id === historyHoverId,
                  );
                  if (!item) return null;
                  return (
                    <div
                      className="history-timeline-popover"
                      role="tooltip"
                      style={{
                        top: historyPopover.top,
                        left: historyPopover.left,
                      }}
                    >
                      <div className="history-timeline-popover-text">
                        {previewText(item.text, 240)}
                      </div>
                      <span className="history-timeline-popover-arrow" />
                    </div>
                  );
                })()
              : null}

            {/* Chat column only: timeline + composer share identical width. */}
            <div className="chat-rail">
            {exportToast ? (
              <div className="export-toast" role="status" aria-live="polite">
                {exportToast}
              </div>
            ) : null}
            <div className="main-work">
              <div
                className="main-scroll chat-pane"
                ref={chatPaneRef}
                onScroll={() => {
                  const el = chatPaneRef.current;
                  if (!el) return;
                  const dist =
                    el.scrollHeight - el.scrollTop - el.clientHeight;
                  stickToBottomRef.current = dist < 96;
                  setIsAtBottom(dist < 96);
                  // Programmatic pin jump: keep current pin, don't re-resolve.
                  if (pinIgnoreScrollRef.current) return;
                  // Real user scroll: release hold, then follow viewport.
                  pinHoldIdRef.current = null;
                  scheduleScrollPin();
                }}
              >
                {showHome && !snap.replaying ? (
                  <div className="center-stage">
                    <div className="greeting">
                      <span className="spark">✦</span>
                      {m.greeting}
                    </div>
                    <p className="hint">{m.homeHint}</p>
                    {errorText ? (
                      <div className="error-card">
                        <strong>
                          {/grok CLI was not found|grok.*not.*found|no such file/i.test(
                            errorText,
                          )
                            ? m.agentMissingTitle
                            : m.cantReachAgent}
                        </strong>
                        <pre className="error-card-body">{errorText}</pre>
                        {installResult ? (
                          <pre
                            className={
                              "error-card-body error-card-output" +
                              (installResult.ok
                                ? " error-card-output-ok"
                                : " error-card-output-fail")
                            }
                          >
                            {installResult.ok
                              ? m.agentInstallDone +
                                (installResult.path
                                  ? ` (${installResult.path})`
                                  : "")
                              : `${m.agentInstallFailed}\n${installResult.error ?? ""}\n\n${installResult.output}`}
                          </pre>
                        ) : null}
                        <div className="actions">
                          <button
                            className="btn"
                            onClick={() => void onRetryConnect()}
                            disabled={installRunning}
                          >
                            {m.retryConnect}
                          </button>
                          <button
                            className="btn primary"
                            onClick={() => void onNewSession()}
                            disabled={installRunning}
                          >
                            {m.newSession}
                          </button>
                          {snap.agentInstallUrl &&
                          /grok CLI was not found|grok.*not.*found|no such file/i.test(
                            errorText,
                          ) &&
                          // Hide install buttons once the binary is
                          // already on disk in a working state — show
                          // only when the user genuinely needs to (re-)
                          // install. "update-available" is handled by
                          // the dedicated Upgrade button below; the
                          // transition states are self-explanatory.
                          (snap.installerStatus.kind === "absent" ||
                            snap.installerStatus.kind === "error") ? (
                            <>
                              <button
                                className="btn primary"
                                disabled={installRunning}
                                onClick={() => void runInstaller()}
                              >
                                {installRunning
                                  ? m.agentInstallRunning
                                  : m.agentInstallAutoButton}
                              </button>
                              <button
                                className="btn"
                                onClick={() =>
                                  void window.desktop
                                    .openExternal(snap.agentInstallUrl!)
                                    .catch(() => {
                                      /* best-effort */
                                    })
                                }
                              >
                                {m.agentInstallButton}
                              </button>
                            </>
                          ) : null}
                          {snap.installerStatus.kind === "update-available" &&
                          !installRunning ? (
                            <button
                              className="btn primary"
                              onClick={() => void runUpgradeFromCard()}
                            >
                              {`${m.agentUpgrade} → v${snap.installerStatus.latest}`}
                            </button>
                          ) : null}
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <ChatTimeline
                    timeline={snap.timeline}
                    replaying={Boolean(snap.replaying)}
                    flashMsgId={flashMsgId}
                    busy={Boolean(snap.busy)}
                    m={m}
                    bottomRef={bottomRef}
                  />
                )}
              </div>
            </div>

            <div className="composer-wrap">
              {/* "Jump to bottom" button — floats above the composer and
                  only appears when the chat has been scrolled away from
                  the latest message. Clicking returns to the bottom and
                  re-engages the auto-stick behaviour. */}
              {!showHome && !isAtBottom ? (
                <button
                  type="button"
                  className="chat-jump-to-bottom"
                  onClick={() => scrollToBottom()}
                  title={m.jumpToBottom}
                  aria-label={m.jumpToBottom}
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 16 16"
                    fill="none"
                    aria-hidden
                  >
                    <path
                      d="M3.5 6.5 8 11l4.5-4.5"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
              ) : null}
              {errorText && !showHome ? (
                <div className="composer-error">{errorText}</div>
              ) : null}
              {/* Questionnaires take priority over permission prompts. */}
              {!snap.pendingQuestion && snap.pendingPermission ? (
                <PermissionPanel
                  request={snap.pendingPermission}
                  activeIndex={Math.min(
                    permIndex,
                    Math.max(0, snap.pendingPermission.options.length - 1),
                  )}
                  onActiveIndex={setPermIndex}
                  onConfirm={(optionId) => void onPermissionConfirm(optionId)}
                  onCancel={() => void onPermissionCancel()}
                  m={m}
                />
              ) : null}
              {/* Folder-trust gate: surfaces above permission/question
                  because the agent blocks turn start until the user grants
                  trust — composer is also disabled below. */}
              {snap.pendingTrustPrompt ? (
                <TrustPromptDialog
                  request={snap.pendingTrustPrompt}
                  m={m}
                  onResolve={(outcome) => void onTrustPrompt(outcome)}
                />
              ) : null}
              {/* Other-session attention banner — only surface sessions
                  that are blocked on user input. A background session that
                  is merely running stays visible in the sidebar instead of
                  distracting from the conversation currently in focus. */}
              <WaitingSessionsBanner
                sessions={snap.sessions}
                focusedSessionId={snap.sessionId}
                m={m}
                onJumpToSession={(s) => void onLoadSession(s)}
              />
              {/* Plan approval card — surfaces right above the composer
                  so the user can approve / request changes / abandon in
                  the same place they'll be typing their next message. */}
              {snap.pendingPlanApproval ? (
                <PlanApprovalCard
                  approval={snap.pendingPlanApproval}
                  m={m}
                  onRespond={respondPlanApproval}
                />
              ) : null}
              {/* Running-plan step pill — appears once approval has been
                  granted (or in non-plan sessions) and there is an
                  in-progress / pending todo. */}
              {!snap.pendingPlanApproval && snap.todos?.length ? (
                <PlanProgressBubble
                  todos={snap.todos}
                  m={m}
                  onOpenPanel={() => {
                    openPlanTab();
                  }}
                />
              ) : null}

              <div className="composer-stack">
                <div className="workspace-bar" ref={wsMenuRef}>
                  <button
                    type="button"
                    className={`workspace-picker-btn ${
                      !hasWorkspace ? "empty" : ""
                    } ${wsMenuOpen ? "open" : ""}`}
                    onClick={() => setWsMenuOpen((v) => !v)}
                    title={snap.workspace || m.workspacePick}
                    disabled={!connectionReady}
                  >
                    <span className="ws-icon" aria-hidden="true">
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.75"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4.2a1.5 1.5 0 0 1 1.2.6l1.2 1.6a1.5 1.5 0 0 0 1.2.6H19.5A1.5 1.5 0 0 1 21 10.2v6.3A1.5 1.5 0 0 1 19.5 18h-15A1.5 1.5 0 0 1 3 16.5v-9Z" />
                      </svg>
                    </span>
                    <span className="ws-name">
                      {workspaceName || m.workspaceEmpty}
                    </span>
                  </button>
                  <span className="ws-meta-chip" title={m.local}>
                    <span className="ws-icon" aria-hidden="true">
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.75"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <rect x="3" y="4" width="18" height="13" rx="2" />
                        <path d="M8 21h8M12 17v4" />
                      </svg>
                    </span>
                    <span>{m.local}</span>
                  </span>
                  <div className="chip-menu-wrap ws-mode-wrap">
                    <button
                      type="button"
                      className={`ws-meta-chip ws-meta-btn ws-mode-btn ${
                        menu === "mode" ? "open" : ""
                      }`}
                      disabled={!connectionReady}
                      onClick={() =>
                        setMenu((cur) => (cur === "mode" ? null : "mode"))
                      }
                      title={`${m.sessionMode}: ${modeLabel}`}
                      aria-label={`${m.sessionMode}: ${modeLabel}`}
                    >
                      <span className="ws-icon" aria-hidden="true">
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.75"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <circle cx="6" cy="6" r="2.25" />
                          <circle cx="18" cy="18" r="2.25" />
                          <path d="M8 7.2c4.5 0 5.5 3.3 5.5 6.3V15" />
                          <path d="M13.5 13.5 18 18" />
                        </svg>
                      </span>
                      <span className="ws-mode-label">{modeLabel}</span>
                    </button>
                    {menu === "mode" ? (
                      <div className="dropdown">
                        {modes.map((mod) => (
                          <button
                            key={mod.id}
                            type="button"
                            className={`dropdown-item ${
                              mod.id === snap.sessionMode ? "active" : ""
                            }`}
                            onClick={() => {
                              void onSetMode(mod.id);
                              setMenu(null);
                            }}
                          >
                            <span className="di-title">{mod.label}</span>
                            <span className="di-desc">{mod.hint}</span>
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  {wsMenuOpen ? (
                    <div className="workspace-dropdown" role="menu">
                      <button
                        type="button"
                        className="dropdown-item"
                        role="menuitem"
                        onClick={() => void onBrowseWorkspace()}
                      >
                        <span className="di-title">{m.workspaceBrowse}</span>
                        <span className="di-desc">{m.workspacePick}</span>
                      </button>
                      {recentWorkspaces.length > 0 ? (
                        <>
                          <div className="workspace-dropdown-sep">
                            {m.workspaceRecent}
                          </div>
                          {recentWorkspaces.map((w) => (
                            <button
                              key={w.cwd}
                              type="button"
                              className={`dropdown-item ${
                                w.cwd === snap.workspace ? "active" : ""
                              }`}
                              role="menuitem"
                              title={w.cwd}
                              onClick={() => void onSelectWorkspace(w.cwd)}
                            >
                              <span className="di-title">{w.project}</span>
                              <span className="di-desc">{w.cwd}</span>
                            </button>
                          ))}
                        </>
                      ) : null}
                    </div>
                  ) : null}
                </div>

                {promptQueue.length > 0 ? (
                  <div
                    className="prompt-queue"
                    role="region"
                    aria-label={m.queueTitle}
                  >
                    <div className="prompt-queue-head">
                      <span className="prompt-queue-title">
                        {m.queueCount.replace(
                          "{n}",
                          String(promptQueue.length),
                        )}
                      </span>
                      {snap.busy ? (
                        <span className="prompt-queue-hint">
                          {m.queueHintBusy}
                        </span>
                      ) : null}
                      <button
                        type="button"
                        className="prompt-queue-clear"
                        onClick={() => {
                          if (snap.sessionId) clearSessionQueue(snap.sessionId);
                        }}
                      >
                        {m.queueClear}
                      </button>
                    </div>
                    <ul className="prompt-queue-list">
                      {promptQueue.map((item, idx) => {
                        const preview =
                          previewQueueText(item.text) ||
                          (item.attachments.length > 0
                            ? m.queueAttachmentsOnly.replace(
                                "{n}",
                                String(item.attachments.length),
                              )
                            : m.queueEmptyItem);
                        return (
                          <li key={item.id} className="prompt-queue-item">
                            <span className="prompt-queue-idx" aria-hidden>
                              {idx + 1}
                            </span>
                            <span
                              className="prompt-queue-text"
                              title={item.text || preview}
                            >
                              {preview}
                              {item.attachments.length > 0 && item.text ? (
                                <span className="prompt-queue-atts">
                                  {" "}
                                  ·{" "}
                                  {m.queueAttachmentsOnly.replace(
                                    "{n}",
                                    String(item.attachments.length),
                                  )}
                                </span>
                              ) : null}
                            </span>
                            <button
                              type="button"
                              className="prompt-queue-send-now"
                              title={m.queueSendNowHint}
                              onClick={() => void onSendNow(item.id)}
                            >
                              {m.queueSendNow}
                            </button>
                            <button
                              type="button"
                              className="prompt-queue-remove"
                              title={m.queueRemove}
                              aria-label={m.queueRemove}
                              onClick={() => {
                                if (snap.sessionId) {
                                  removeQueuedPrompt(snap.sessionId, item.id);
                                }
                              }}
                            >
                              ×
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ) : null}

                <div
                  className={`composer ${
                    snap.pendingPermission || snap.pendingTrustPrompt
                      ? "composer-dimmed"
                      : ""
                  } ${dragOver ? "composer-drag-over" : ""}`}
                  onDragEnter={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (e.dataTransfer?.types?.includes("Files")) {
                      setDragOver(true);
                    }
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
                  }}
                  onDragLeave={(e) => {
                    e.preventDefault();
                    // Only clear when leaving the composer itself
                    if (
                      e.currentTarget === e.target ||
                      !e.currentTarget.contains(e.relatedTarget as Node)
                    ) {
                      setDragOver(false);
                    }
                  }}
                  onDrop={(e) => void onDropFiles(e)}
                >
                  {dragOver ? (
                    <div className="composer-drop-hint">{m.dropFilesHint}</div>
                  ) : null}
                  {attachments.length > 0 ? (
                    <div className="attach-bar">
                      {attachments.map((a) => (
                        <span
                          className="attach-chip"
                          key={a.id}
                          title={a.displayPath}
                        >
                          <span className="attach-kind">
                            {a.kind === "image" ? "🖼" : "📄"}
                          </span>
                          {a.name}
                          <button
                            className="attach-x"
                            onClick={() =>
                              setAttachments((prev) =>
                                prev.filter((x) => x.id !== a.id),
                              )
                            }
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                  ) : null}

                  {historyBrowse ? (
                    <div className="prompt-history-browse" role="status">
                      {m.historyBrowseStatus
                        .replace("{i}", String(historyBrowse.index + 1))
                        .replace("{n}", String(promptHistory.length))}
                      <span className="prompt-history-browse-hint">
                        {m.historyBrowseHint}
                      </span>
                    </div>
                  ) : null}

                  {historySearchOpen ? (
                    <div
                      className="prompt-history-search"
                      role="dialog"
                      aria-label={m.historySearchTitle}
                    >
                      <div className="prompt-history-search-head">
                        <input
                          ref={historySearchInputRef}
                          className="prompt-history-search-input"
                          type="search"
                          value={historySearchQuery}
                          placeholder={m.historySearchPlaceholder}
                          aria-label={m.historySearchPlaceholder}
                          onChange={(e) => {
                            setHistorySearchQuery(e.target.value);
                            setHistorySearchIndex(0);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Escape") {
                              e.preventDefault();
                              closeHistorySearch();
                              return;
                            }
                            if (e.key === "ArrowDown") {
                              e.preventDefault();
                              setHistorySearchIndex((i) =>
                                Math.min(
                                  i + 1,
                                  Math.max(0, filteredHistory.length - 1),
                                ),
                              );
                              return;
                            }
                            if (e.key === "ArrowUp") {
                              e.preventDefault();
                              setHistorySearchIndex((i) => Math.max(i - 1, 0));
                              return;
                            }
                            if (e.key === "Enter") {
                              e.preventDefault();
                              const hit = filteredHistory[historySearchIndex];
                              if (hit) pickHistoryEntry(hit);
                            }
                          }}
                        />
                        <button
                          type="button"
                          className="prompt-history-search-close"
                          onClick={closeHistorySearch}
                          title={m.historySearchClose}
                        >
                          ×
                        </button>
                      </div>
                      <div
                        ref={historyListRef}
                        className="prompt-history-search-list"
                      >
                        {filteredHistory.length === 0 ? (
                          <div className="prompt-history-search-empty">
                            {promptHistory.length === 0
                              ? m.historyEmpty
                              : m.historyNoMatches}
                          </div>
                        ) : (
                          filteredHistory.map((entry, i) => (
                            <button
                              key={`${i}:${entry.slice(0, 48)}`}
                              type="button"
                              data-history-idx={i}
                              className={`prompt-history-search-item ${
                                i === historySearchIndex ? "active" : ""
                              }`}
                              onMouseEnter={() => setHistorySearchIndex(i)}
                              onMouseDown={(e) => {
                                e.preventDefault();
                                pickHistoryEntry(entry);
                              }}
                            >
                              <span className="prompt-history-search-text">
                                {previewQueueText(entry, 120)}
                              </span>
                            </button>
                          ))
                        )}
                      </div>
                      <div className="prompt-history-search-foot">
                        {m.historySearchHint}
                      </div>
                    </div>
                  ) : null}

                  <div className="composer-row">
                    <div className="textarea-wrap">
                      <textarea
                        ref={textareaRef}
                        defaultValue=""
                        placeholder={
                          !connectionReady
                            ? m.placeholderWaiting
                            : !hasWorkspace
                              ? m.placeholderNeedWorkspace
                              : snap.busy
                                ? m.placeholderBusy
                                : m.placeholderReady
                        }
                        disabled={
                          !canCompose ||
                          snap.replaying ||
                          Boolean(snap.pendingPermission)
                        }
                        rows={1}
                        onChange={(e) => {
                          const v = e.target.value;
                          draftRef.current = v;
                          const nonEmpty = v.trim().length > 0;
                          setHasDraft((prev) =>
                            prev === nonEmpty ? prev : nonEmpty,
                          );
                          // Typing while browsing history = edit in place, leave browse mode.
                          if (historyBrowse) exitHistoryBrowse();
                          resizeTextarea(e.target);
                          // Only schedule @ / slash work when relevant.
                          if (
                            v.startsWith("/") ||
                            v.includes("@") ||
                            slashSuggest != null ||
                            atSuggest != null
                          ) {
                            scheduleSuggest(
                              v,
                              e.target.selectionStart ?? v.length,
                            );
                          }
                        }}
                        onClick={(e) => {
                          const t = e.currentTarget;
                          if (
                            t.value.startsWith("/") ||
                            t.value.includes("@")
                          ) {
                            scheduleSuggest(
                              t.value,
                              t.selectionStart ?? t.value.length,
                            );
                          }
                        }}
                        onKeyUp={(e) => {
                          // Navigation / accept / dismiss are handled in
                          // onKeyDown. Re-filtering here would reset the
                          // highlight index even when the draft did not change.
                          if (
                            e.key === "ArrowDown" ||
                            e.key === "ArrowUp" ||
                            e.key === "Enter" ||
                            e.key === "Tab" ||
                            e.key === "Escape"
                          ) {
                            return;
                          }
                          const t = e.currentTarget;
                          if (
                            t.value.startsWith("/") ||
                            t.value.includes("@") ||
                            slashSuggest != null ||
                            atSuggest != null
                          ) {
                            scheduleSuggest(
                              t.value,
                              t.selectionStart ?? t.value.length,
                            );
                          }
                        }}
                        onKeyDown={onKeyDown}
                        onPaste={(e) => void onPaste(e)}
                      />
                      {slashSuggest && slashSuggest.length > 0 ? (
                        <div
                          ref={slashListRef}
                          className="at-suggest slash-suggest"
                        >
                          {slashSuggest.map((s, i) => (
                            <button
                              key={`${s.source}:${s.name}`}
                              className={`at-item slash-item ${
                                i === slashIndex ? "active" : ""
                              }`}
                              onMouseDown={(e) => {
                                e.preventDefault();
                                applySlashSuggestion(s);
                              }}
                            >
                              <span className="slash-cmd">{s.display}</span>
                              <span className="slash-desc">
                                {s.description}
                                {s.inputHint ? (
                                  <span className="slash-hint">
                                    {" "}
                                    {s.inputHint}
                                  </span>
                                ) : null}
                              </span>
                            </button>
                          ))}
                        </div>
                      ) : slashSuggest && slashSuggest.length === 0 ? (
                        <div className="at-suggest">
                          <div className="at-empty">
                            {m.noMatches}{" "}
                            {(
                              textareaRef.current?.value ?? draftRef.current
                            ).trim()}
                          </div>
                        </div>
                      ) : atSuggest && atSuggest.length > 0 ? (
                        <div ref={atListRef} className="at-suggest">
                          {atSuggest.map((s, i) => (
                            <button
                              key={s.path}
                              className={`at-item ${i === atIndex ? "active" : ""}`}
                              onMouseDown={(e) => {
                                e.preventDefault();
                                insertAtPath(s.path, s.isDir);
                              }}
                            >
                              <span className="at-icon">
                                {s.isDir ? "📁" : "📄"}
                              </span>
                              {s.path}
                              {s.isDir ? "/" : ""}
                            </button>
                          ))}
                        </div>
                      ) : atSuggest && atSuggest.length === 0 && atQuery ? (
                        <div className="at-suggest">
                          <div className="at-empty">
                            {m.noMatches} @{atQuery}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <div className="composer-toolbar" ref={selectsRef}>
                    <div className="composer-toolbar-left">
                      <button
                        type="button"
                        className="icon-btn attach-btn"
                        title={m.attachFiles}
                        disabled={
                          !canCompose ||
                          snap.replaying ||
                          Boolean(snap.pendingPermission)
                        }
                        onClick={() => void onPickFiles()}
                      >
                        <svg
                          width="16"
                          height="16"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          aria-hidden="true"
                        >
                          <path d="M12 5v14M5 12h14" />
                        </svg>
                      </button>
                      {snap.busy ||
                      snap.pendingPlanApproval ||
                      (snap.sessionMode === "plan" &&
                        Boolean(snap.planContent?.trim())) ? (
                        <button
                          type="button"
                          className={`chip chip-btn plan-todos-chip ${
                            snap.pendingPlanApproval ? "needs-approval" : ""
                          }`}
                          onClick={() => openRightTool("plan")}
                          title={m.sidePanelPlan}
                        >
                          <strong>
                            {snap.pendingPlanApproval
                              ? m.planApprovalNeeded
                              : m.planTodosChip}
                          </strong>
                          {(snap.todos?.length ?? 0) > 0 ? (
                            <span className="chip-meta">
                              {
                                snap.todos.filter(
                                  (t) => t.status === "completed",
                                ).length
                              }
                              /
                              {
                                snap.todos.filter(
                                  (t) => t.status !== "cancelled",
                                ).length
                              }
                            </span>
                          ) : null}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className={`chip chip-btn always-approve-chip ${
                          snap.alwaysApprove ? "on" : ""
                        }`}
                        disabled={!connectionReady}
                        onClick={() => void onToggleAlwaysApprove()}
                        title={m.alwaysApproveHint}
                        aria-pressed={snap.alwaysApprove}
                      >
                        <span className="chip-leading-icon" aria-hidden="true">
                          <svg
                            width="13"
                            height="13"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.75"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <path d="M12 3 5 6.5v5.2c0 4.3 2.9 8.2 7 9.3 4.1-1.1 7-5 7-9.3V6.5L12 3Z" />
                            <path d="m9.2 12 1.9 1.9 3.7-3.8" />
                          </svg>
                        </span>
                        <strong>
                          {snap.alwaysApprove
                            ? m.alwaysApproveOn
                            : m.alwaysApproveOff}
                        </strong>
                      </button>
                    </div>

                    <div className="composer-toolbar-right">
                      {tokenUsageLabel ? (
                        <span
                          className={`chip token-usage ${
                            tokenUsagePct != null && tokenUsagePct >= 85
                              ? "warn"
                              : tokenUsagePct != null && tokenUsagePct >= 70
                                ? "elevated"
                                : ""
                          }`}
                          title={tokenUsageTitle}
                        >
                          {tokenUsageLabel}
                        </span>
                      ) : null}

                      <div className="chip-menu-wrap">
                        <button
                          className={`chip chip-btn ${menu === "model" ? "open" : ""}`}
                          disabled={!connectionReady}
                          onClick={() => {
                            setMenu((cur) =>
                              cur === "model" ? null : "model",
                            );
                            // Regroup + re-pull agent catalog (covers config
                            // edits that the watcher may have missed).
                            void refreshModelsAfterProviderChange();
                          }}
                          title={m.switchModel}
                        >
                          <strong>{modelChipLabel}</strong>
                        </button>
                        {menu === "model" ? (
                          <div className="dropdown dropdown-end dropdown-models">
                            {snap.availableModels.length === 0 ? (
                              <div className="dropdown-empty">
                                {m.openSessionForModels}
                              </div>
                            ) : (
                              <>
                                {modelGroups.length > 1 ? (
                                  <div className="model-provider-tabs">
                                    <button
                                      type="button"
                                      className={`model-provider-tab ${
                                        modelProviderFilter === "all"
                                          ? "active"
                                          : ""
                                      }`}
                                      onClick={() =>
                                        setModelProviderFilter("all")
                                      }
                                    >
                                      {m.modelsAllProviders}
                                    </button>
                                    {modelGroups.map((g) => (
                                      <button
                                        key={g.id}
                                        type="button"
                                        className={`model-provider-tab ${
                                          modelProviderFilter === g.id
                                            ? "active"
                                            : ""
                                        }`}
                                        onClick={() =>
                                          setModelProviderFilter(g.id)
                                        }
                                        title={g.name}
                                      >
                                        {g.name}
                                      </button>
                                    ))}
                                  </div>
                                ) : null}
                                {snap.accountAvailable === false ? (
                                  <div
                                    className="dropdown-notice warn"
                                    role="note"
                                    title={m.accountRequiredForGrokHint}
                                  >
                                    {m.accountRequiredForGrokHint}
                                  </div>
                                ) : null}
                                {filteredModelGroups.length === 0 ? (
                                  <div className="dropdown-empty">
                                    {m.modelsNoModelsInProvider}
                                  </div>
                                ) : (
                                  filteredModelGroups.map((group) => (
                                    <div
                                      key={group.id}
                                      className="model-group"
                                    >
                                      {modelProviderFilter === "all" &&
                                      modelGroups.length > 1 ? (
                                        <div className="model-group-label">
                                          {group.name}
                                        </div>
                                      ) : null}
                                      {group.models.map((mod) => (
                                        <button
                                          key={mod.modelId}
                                          type="button"
                                          className={`dropdown-item ${
                                            mod.modelId === snap.modelId
                                              ? "active"
                                              : ""
                                          }`}
                                          onClick={() => {
                                            void onSetModel(mod.modelId);
                                            setMenu(null);
                                          }}
                                        >
                                          <span className="di-title">
                                            {mod.name}
                                          </span>
                                        </button>
                                      ))}
                                    </div>
                                  ))
                                )}
                                <button
                                  type="button"
                                  className="dropdown-item model-manage-item"
                                  onClick={() => {
                                    setMenu(null);
                                    openSettingsSection("models");
                                  }}
                                >
                                  <span className="di-title">
                                    {m.modelsManage}
                                  </span>
                                </button>
                              </>
                            )}
                          </div>
                        ) : null}
                      </div>

                      {currentModel?.supportsReasoningEffort &&
                      (currentModel.reasoningEfforts?.length ?? 0) > 0 ? (
                        <div className="chip-menu-wrap">
                          <button
                            className={`chip chip-btn ${
                              menu === "effort" ? "open" : ""
                            }`}
                            disabled={!connectionReady || !snap.modelId}
                            onClick={() =>
                              setMenu((cur) =>
                                cur === "effort" ? null : "effort",
                              )
                            }
                            title={m.reasoningEffort}
                          >
                            <strong>{effortLabel}</strong>
                          </button>
                          {menu === "effort" ? (
                            <div className="dropdown dropdown-end">
                              {currentModel.reasoningEfforts!.map((e) => (
                                <button
                                  key={e.id}
                                  className={`dropdown-item ${
                                    e.id === snap.reasoningEffort
                                      ? "active"
                                      : ""
                                  }`}
                                  onClick={() => {
                                    void onSetModel(snap.modelId!, e.id);
                                    setMenu(null);
                                  }}
                                >
                                  <span className="di-title">
                                    {localizeEffort(e.id, m) || e.label}
                                  </span>
                                  {e.description ? (
                                    <span className="di-desc">
                                      {e.description}
                                    </span>
                                  ) : null}
                                </button>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      ) : null}

                      {snap.busy ? (
                        <button
                          type="button"
                          className="icon-btn stop"
                          title={m.cancel}
                          onClick={() => void onCancel()}
                        >
                          ■
                        </button>
                      ) : null}
                      {snap.busy &&
                      (hasDraft || attachments.length > 0) ? (
                        <button
                          type="button"
                          className="icon-btn send send-queue"
                          title={`${m.queueAction} · ${m.queueSendNowHint} (${m.queueSendNowShortcut})`}
                          disabled={
                            !canCompose ||
                            snap.replaying ||
                            Boolean(snap.pendingPermission)
                          }
                          onClick={() => void onSend()}
                        >
                          <svg
                            width="15"
                            height="15"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.25"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden="true"
                          >
                            <path d="M5 12h14M12 5l7 7-7 7" />
                            <path d="M5 7v10" opacity="0.45" />
                          </svg>
                        </button>
                      ) : !snap.busy ? (
                        <button
                          type="button"
                          className="icon-btn send"
                          title={m.send}
                          disabled={
                            !canCompose ||
                            snap.replaying ||
                            (!hasDraft && attachments.length === 0)
                          }
                          onClick={() => void onSend()}
                        >
                          <svg
                            width="15"
                            height="15"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.25"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden="true"
                          >
                            <path d="M12 19V5M6.5 10.5 12 5l5.5 5.5" />
                          </svg>
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>
            </div>
            </div>
          </div>
        )}
      </section>

      {view === "chat" ? (
        <button
          type="button"
          className={`chat-topbar-btn chat-side-toggle ${
            rightPanelOpen ? "active" : ""
          }`}
          onClick={toggleRightPanel}
          title={rightPanelOpen ? m.sidePanelToggleHide : m.sidePanelToggle}
          aria-pressed={rightPanelOpen}
          aria-label={
            rightPanelOpen ? m.sidePanelToggleHide : m.sidePanelToggle
          }
        >
          <span className="icon" aria-hidden>
            {rightPanelOpen ? (
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <rect
                  x="2"
                  y="3"
                  width="12"
                  height="10"
                  rx="1.5"
                  stroke="currentColor"
                  strokeWidth="1.3"
                />
                <path d="M10 3v10" stroke="currentColor" strokeWidth="1.3" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <rect
                  x="2"
                  y="3"
                  width="12"
                  height="10"
                  rx="1.5"
                  stroke="currentColor"
                  strokeWidth="1.3"
                />
                <path d="M11 3v10" stroke="currentColor" strokeWidth="1.3" />
              </svg>
            )}
          </span>
        </button>
      ) : null}

      {rightOpen ? (
        <aside className="right-panel" aria-label={m.sidePanelToggle}>
          <div
            className="resize-handle resize-handle-right"
            role="separator"
            aria-orientation="vertical"
            aria-label={m.resizeRightPanel}
            title={m.resizeRightPanel}
            onPointerDown={onResizePointerDown("right")}
            onDoubleClick={() => setRightPanelOpen(false)}
          />
          <div className="right-panel-body">
            {/* Unified top tab bar — files, plan, terminal as one row. */}
            <div
              className="right-panel-tabs"
              role="tablist"
              aria-label={m.sidePanelToggle}
            >
              {rightPanelTabs.map((tab) => {
                const isActive = tab.id === activeTabId;
                let label = "";
                if (tab.kind === "files") {
                  label = tab.path.split(/[/\\]/).pop() || tab.path;
                } else if (tab.kind === "plan") {
                  label = m.sidePanelPlan;
                } else {
                  label = m.sidePanelTerminal;
                }
                return (
                  <div
                    key={tab.id}
                    className={
                      "right-panel-tab" +
                      (isActive ? " active" : "") +
                      (tab.kind === "plan"
                        ? " kind-plan"
                        : tab.kind === "terminal"
                          ? " kind-terminal"
                          : " kind-files")
                    }
                    onClick={() => setActiveTabId(tab.id)}
                    role="tab"
                    aria-selected={isActive}
                    title={
                      tab.kind === "files"
                        ? tab.path
                        : tab.kind === "plan"
                          ? m.sidePanelPlan
                          : m.sidePanelTerminal
                    }
                  >
                    <span className="right-panel-tab-icon" aria-hidden>
                      {tab.kind === "files" ? (
                        <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                          <path
                            d="M2.5 4.2A1.2 1.2 0 0 1 3.7 3h2.4l1.1 1.3h5.1A1.2 1.2 0 0 1 13.5 5.5v6.3a1.2 1.2 0 0 1-1.2 1.2H3.7a1.2 1.2 0 0 1-1.2-1.2V4.2Z"
                            stroke="currentColor"
                            strokeWidth="1.2"
                            strokeLinejoin="round"
                          />
                        </svg>
                      ) : tab.kind === "plan" ? (
                        <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                          <path
                            d="M3.5 2.5h9A.5.5 0 0 1 13 3v10a.5.5 0 0 1-.5.5h-9A.5.5 0 0 1 3 13V3a.5.5 0 0 1 .5-.5Z"
                            stroke="currentColor"
                            strokeWidth="1.2"
                          />
                          <path
                            d="M5.5 5.5h5M5.5 8h5M5.5 10.5h3"
                            stroke="currentColor"
                            strokeWidth="1.2"
                            strokeLinecap="round"
                          />
                        </svg>
                      ) : (
                        <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                          <rect
                            x="2.5"
                            y="3"
                            width="11"
                            height="10"
                            rx="1.5"
                            stroke="currentColor"
                            strokeWidth="1.2"
                          />
                          <path
                            d="M5 7.2 6.6 8.5 5 9.8M8.2 10.2h2.6"
                            stroke="currentColor"
                            strokeWidth="1.2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      )}
                    </span>
                    <span className="right-panel-tab-label">{label}</span>
                    <button
                      type="button"
                      className="right-panel-tab-close"
                      onClick={(e) => {
                        e.stopPropagation();
                        closeRightTab(tab.id);
                      }}
                      aria-label={m.filesCloseTabTooltip}
                      title={m.filesCloseTabTooltip}
                    >
                      ×
                    </button>
                  </div>
                );
              })}
              {/* `+` menu opens a fresh tab — file / plan / terminal. */}
              <RightPanelPlusMenu
                m={m}
                onPickFiles={() => {
                  // Open the file-tree filter as the picker UX. We don't
                  // create a tab here: the user still needs to choose a
                  // path; once they do, `openFile` creates the tab.
                  setFileTreeCollapsed(false);
                  // Make sure a tab is active so the editor area shows.
                  if (
                    !rightPanelTabs.some((t) => t.kind === "files")
                  ) {
                    // Seed a dummy placeholder file tab by reusing an
                    // existing file id? Simpler: open the most recent
                    // existing file tab if any, else let the empty state
                    // show. Focus the tree filter regardless.
                  }
                  requestAnimationFrame(() => {
                    const input =
                      document.querySelector<HTMLInputElement>(
                        ".files-section-tree .file-tree-filter input",
                      );
                    input?.focus();
                  });
                }}
                onPickPlan={openPlanTab}
                onPickTerminal={() => openTerminalTab()}
              />
            </div>

            {/* Body: render content based on the active tab. */}
            <div className="right-panel-content">
              {activeTab?.kind === "files" ? (
                <FilesTabSection
                  workspace={snap.workspace}
                  m={m}
                  activeFilePath={activeTab.path}
                  treeCollapsed={fileTreeCollapsed}
                  fileTreeWidth={panelLayout.fileTreeWidth}
                  onClose={() => closeRightTab(activeTab.id)}
                  onNewFile={openFile}
                  onSetFileTreeCollapsed={setFileTreeCollapsed}
                  onResizePointerDown={onResizePointerDown("filesTree")}
                  onInsertMention={insertFileMention}
                />
              ) : null}
              {activeTab?.kind === "plan" ? (
                <PlanPanel
                  todos={snap.todos ?? []}
                  planContent={snap.planContent}
                  pendingApproval={snap.pendingPlanApproval}
                  sessionMode={snap.sessionMode}
                  m={m}
                  onClose={() => closeRightTab(activeTab.id)}
                  onRespondApproval={respondPlanApproval}
                  onRefreshPlan={refreshPlanContent}
                />
              ) : null}
              {activeTab?.kind === "terminal" ? (
                <TerminalPanel
                  key={activeTab.id}
                  workspace={snap.workspace}
                  active={rightOpen}
                  m={m}
                  onLastTabClosed={() => closeRightTab(activeTab.id)}
                  onOpenFile={() => openFile("")}
                />
              ) : null}
              {/* No tab open — show the right-panel welcome. */}
              {!activeTab ? (
                <div className="right-panel-empty">
                  <button
                    type="button"
                    className="right-panel-empty-cta"
                    onClick={openPlanTab}
                  >
                    <span className="right-panel-empty-icon" aria-hidden>
                      <svg width="22" height="22" viewBox="0 0 16 16" fill="none">
                        <path
                          d="M3.5 2.5h9A.5.5 0 0 1 13 3v10a.5.5 0 0 1-.5.5h-9A.5.5 0 0 1 3 13V3a.5.5 0 0 1 .5-.5Z"
                          stroke="currentColor"
                          strokeWidth="1.2"
                        />
                      </svg>
                    </span>
                    <span>{m.sidePanelPlan}</span>
                  </button>
                  <button
                    type="button"
                    className="right-panel-empty-cta"
                    onClick={() => openTerminalTab()}
                  >
                    <span className="right-panel-empty-icon" aria-hidden>
                      <svg width="22" height="22" viewBox="0 0 16 16" fill="none">
                        <rect
                          x="2.5"
                          y="3"
                          width="11"
                          height="10"
                          rx="1.5"
                          stroke="currentColor"
                          strokeWidth="1.2"
                        />
                      </svg>
                    </span>
                    <span>{m.sidePanelTerminal}</span>
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </aside>
      ) : null}
    </div>
  );
}
