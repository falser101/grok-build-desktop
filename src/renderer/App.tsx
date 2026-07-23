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
  type ReactNode,
  type RefObject,
} from "react";
import type {
  AccountStatus,
  AgentActivity,
  AppSnapshot,
  AskUserQuestionResponse,
  ModelConfigKeyIndex,
  ModelInfo,
  NeedsInputReason,
  PathSuggestion,
  PermissionOptionKind,
  PermissionRequestUi,
  PlanApprovalOutcome,
  PromptAttachment,
  ProviderUsageResult,
  SessionModeId,
  SessionSearchHit,
  SessionSummary,
  TimelineItem,
} from "@shared/types";
import { isBusyLike, isTerminal } from "@shared/types";
import type { Messages } from "./i18n";
import { modeOptions as computeModeOptions } from "./modeOptions";
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
import { GoalProgressBubble } from "./GoalProgressBubble";
import { GoalDetailModal } from "./GoalDetailModal";
import { WaitingSessionsBanner } from "./WaitingSessionsBanner";
import { linearizeTimeline } from "./groupTurns";
import { WindowTitleBar } from "./WindowTitleBar";
import { usePrefs } from "./PrefsContext";
import { SettingsView, type SettingsSectionId } from "./SettingsView";
import { TerminalPanel } from "./TerminalPanel";
import { ToolCard } from "./ToolCard";
import {
  filterSlashMenu,
  isSkillCommand,
  isSlashCompose,
  slashNameQuery,
  tryHandleLocalSlash,
  type SlashMenuItem,
} from "./slash";
import { stripComposerIntentSlashPrefix } from "./stripComposerIntentSlashPrefix";
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
  activity: "idle",
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
/**
 * Absolute minimum width (in pixels) the sidebar is allowed to
 * occupy before the layout auto-collapses it into hover mode.
 * Below this, the column would squeeze the "+ 新建会话 / MCP / 插件"
 * nav rows into unreadable widths, so we hide the column entirely
 * and let the user summon it via the left-edge hover affordance.
 */
const SIDEBAR_HOVER_MIN_PX = 200;
/** Collapsed sidebar rail width (% of shell). */
const SIDEBAR_RAIL = 2.5;
const RIGHT_DEFAULT = 20;
const RIGHT_MIN = 14;
/** Allow the right panel to grow almost full-width (drag edge far left). */
const RIGHT_MAX = 82;
const RIGHT_COLLAPSE = 7;
/** File-tree pane width inside the right panel's `files` tab, % of the
 *  right panel's inner width (not of the shell). */
const FILE_TREE_DEFAULT = 38;
const FILE_TREE_MIN = 18;
const FILE_TREE_MAX = 62;
const FILE_TREE_COLLAPSE = 12;
const LAYOUT_STORAGE_KEY = "grok-desktop-layout-v3";
/** v2 was the px-percent unified layout; v3 flips the sidebar default
 *  to collapsed (rail-only) for fresh installs while honoring any
 *  user-pinned choice persisted in v2. v1 was px-based — drop it. */
const LAYOUT_STORAGE_KEY_LEGACY = "grok-desktop-layout-v2";

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
 * Optional extra entry — host can add e.g. a Plan shortcut beside the
 * built-in File / Terminal entries.
 */
interface PlusExtraItem {
  id: string;
  label: string;
  icon: "plan";
  onPick: () => void;
}

/**
 * Right-panel `+` button — built-in entries: File + Terminal. Hosts can
 * pass `extraItems` to inject additional shortcuts (e.g. Plan).
 *
 * Menu uses `position: fixed` so it is not clipped by the tab row's
 * `overflow-x: auto / overflow-y: hidden` (absolute dropdowns were
 * invisible even when `open === true`).
 */
function RightPanelPlusMenu({
  m,
  onPick,
  extraItems,
}: {
  m: Messages;
  onPick: (kind: "file" | "terminal") => void;
  extraItems?: PlusExtraItem[];
}) {
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(
    null,
  );
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const updateMenuPos = useCallback(() => {
    const btn = buttonRef.current;
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    setMenuPos({
      top: r.bottom + 6,
      right: Math.max(8, window.innerWidth - r.right),
    });
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    setMenuPos(null);
  }, []);

  useEffect(() => {
    if (!open) return;
    updateMenuPos();
    // Defer outside-click so the same click that opened us doesn't close us.
    let removeDoc: (() => void) | undefined;
    const t = window.setTimeout(() => {
      const onDoc = (e: MouseEvent) => {
        const target = e.target as Node;
        if (wrapRef.current?.contains(target)) return;
        if (menuRef.current?.contains(target)) return;
        close();
      };
      const onKey = (e: globalThis.KeyboardEvent) => {
        if (e.key === "Escape") {
          close();
          buttonRef.current?.focus();
        }
      };
      const onScrollOrResize = () => updateMenuPos();
      document.addEventListener("mousedown", onDoc, true);
      document.addEventListener("keydown", onKey);
      window.addEventListener("resize", onScrollOrResize);
      window.addEventListener("scroll", onScrollOrResize, true);
      removeDoc = () => {
        document.removeEventListener("mousedown", onDoc, true);
        document.removeEventListener("keydown", onKey);
        window.removeEventListener("resize", onScrollOrResize);
        window.removeEventListener("scroll", onScrollOrResize, true);
      };
    }, 0);
    return () => {
      window.clearTimeout(t);
      removeDoc?.();
    };
  }, [open, close, updateMenuPos]);

  return (
    <div className="right-panel-plus-wrap" ref={wrapRef}>
      <button
        ref={buttonRef}
        type="button"
        className="right-panel-plus"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((v) => {
            if (v) {
              setMenuPos(null);
              return false;
            }
            // Position will be set in the open effect; seed from rect now.
            const btn = buttonRef.current;
            if (btn) {
              const r = btn.getBoundingClientRect();
              setMenuPos({
                top: r.bottom + 6,
                right: Math.max(8, window.innerWidth - r.right),
              });
            }
            return true;
          });
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        title={m.termNewTab}
      >
        +
      </button>
      {open && menuPos ? (
        <div
          className="dropdown right-panel-plus-menu"
          ref={menuRef}
          role="menu"
          style={{
            position: "fixed",
            top: menuPos.top,
            right: menuPos.right,
            left: "auto",
            bottom: "auto",
            zIndex: 10000,
          }}
        >
          <button
            type="button"
            className="dropdown-item"
            role="menuitem"
            onClick={() => {
              close();
              onPick("file");
            }}
          >
            <span className="di-icon" aria-hidden>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <path
                  d="M2.5 4.2A1.2 1.2 0 0 1 3.7 3h2.4l1.1 1.3h5.1A1.2 1.2 0 0 1 13.5 5.5v6.3a1.2 1.2 0 0 1-1.2 1.2H3.7a1.2 1.2 0 0 1-1.2-1.2V4.2Z"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
            <span>{m.sidePanelFiles}</span>
          </button>
          <button
            type="button"
            className="dropdown-item"
            role="menuitem"
            onClick={() => {
              close();
              onPick("terminal");
            }}
          >
            <span className="di-icon" aria-hidden>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
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
            </span>
            <span>{m.sidePanelTerminal}</span>
          </button>
          {extraItems?.map((item) => (
            <button
              key={item.id}
              type="button"
              className="dropdown-item"
              role="menuitem"
              onClick={() => {
                close();
                item.onPick();
              }}
            >
              {item.icon === "plan" ? (
                <span className="di-icon" aria-hidden>
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 16 16"
                    fill="none"
                  >
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
                </span>
              ) : null}
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Composer `+` button popup menu — three options: Files & folders,
 * Goal mode, and Plan mode. Replaces the old single-action attach button.
 *
 * Menu uses `position: fixed` so it is not clipped by parent overflow.
 */
function ComposerPlusMenu({
  m,
  onPickFiles,
  onGoalMode,
  onPlanMode,
  disabled,
}: {
  m: Messages;
  onPickFiles: () => void;
  onGoalMode: () => void;
  onPlanMode: () => void;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(
    null,
  );
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const updateMenuPos = useCallback(() => {
    const btn = buttonRef.current;
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    setMenuPos({
      top: r.top - 8,
      left: Math.max(8, r.left),
    });
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    setMenuPos(null);
  }, []);

  useEffect(() => {
    if (!open) return;
    updateMenuPos();
    // Defer outside-click so the same click that opened us doesn't close us.
    let removeDoc: (() => void) | undefined;
    const t = window.setTimeout(() => {
      const onDoc = (e: MouseEvent) => {
        const target = e.target as Node;
        if (wrapRef.current?.contains(target)) return;
        if (menuRef.current?.contains(target)) return;
        close();
      };
      const onKey = (e: globalThis.KeyboardEvent) => {
        if (e.key === "Escape") {
          close();
          buttonRef.current?.focus();
        }
      };
      const onScrollOrResize = () => updateMenuPos();
      document.addEventListener("mousedown", onDoc, true);
      document.addEventListener("keydown", onKey);
      window.addEventListener("resize", onScrollOrResize);
      window.addEventListener("scroll", onScrollOrResize, true);
      removeDoc = () => {
        document.removeEventListener("mousedown", onDoc, true);
        document.removeEventListener("keydown", onKey);
        window.removeEventListener("resize", onScrollOrResize);
        window.removeEventListener("scroll", onScrollOrResize, true);
      };
    }, 0);
    return () => {
      window.clearTimeout(t);
      removeDoc?.();
    };
  }, [open, close, updateMenuPos]);

  return (
    <div className="composer-plus-wrap" ref={wrapRef}>
      <button
        ref={buttonRef}
        type="button"
        className={`icon-btn attach-btn ${open ? "open" : ""}`}
        title={m.attachFiles}
        disabled={disabled}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((v) => {
            if (v) {
              setMenuPos(null);
              return false;
            }
            // Position will be set in the open effect; seed from rect now.
            const btn = buttonRef.current;
            if (btn) {
              const r = btn.getBoundingClientRect();
              setMenuPos({
                top: r.top - 8,
                left: Math.max(8, r.left),
              });
            }
            return true;
          });
        }}
        aria-haspopup="menu"
        aria-expanded={open}
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
      {open && menuPos ? (
        <div
          className="dropdown composer-plus-menu"
          ref={menuRef}
          role="menu"
          style={{
            position: "fixed",
            top: menuPos.top,
            left: menuPos.left,
            right: "auto",
            bottom: "auto",
            zIndex: 10000,
            transform: "translateY(-100%)",
          }}
        >
          {/* Files & folders */}
          <button
            type="button"
            className="dropdown-item"
            role="menuitem"
            onClick={() => {
              close();
              onPickFiles();
            }}
          >
            <span className="di-icon" aria-hidden>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <path
                  d="M3.5 4a1 1 0 0 1 1-1h2l1.2 1.2h4.3a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1V4Z"
                  stroke="currentColor"
                  strokeWidth="1.3"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
            <span>{m.composerAddFilesFolders}</span>
          </button>
          {/* Goal mode */}
          <button
            type="button"
            className="dropdown-item"
            role="menuitem"
            onClick={() => {
              close();
              onGoalMode();
            }}
          >
            <span className="di-icon" aria-hidden>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <circle
                  cx="8"
                  cy="8"
                  r="5.5"
                  stroke="currentColor"
                  strokeWidth="1.3"
                />
                <circle cx="8" cy="8" r="2.5" fill="currentColor" />
                <path
                  d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2"
                  stroke="currentColor"
                  strokeWidth="1.3"
                  strokeLinecap="round"
                />
              </svg>
            </span>
            <span>{m.composerAddGoalMode}</span>
          </button>
          {/* Plan mode */}
          <button
            type="button"
            className="dropdown-item"
            role="menuitem"
            onClick={() => {
              close();
              onPlanMode();
            }}
          >
            <span className="di-icon" aria-hidden>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <path
                  d="M3.5 2.5h9a.5.5 0 0 1 .5.5v10a.5.5 0 0 1-.5.5h-9a.5.5 0 0 1-.5-.5V3a.5.5 0 0 1 .5-.5Z"
                  stroke="currentColor"
                  strokeWidth="1.3"
                />
                <path
                  d="M5.5 5.5h5M5.5 8h5M5.5 10.5h3"
                  stroke="currentColor"
                  strokeWidth="1.3"
                  strokeLinecap="round"
                />
              </svg>
            </span>
            <span>{m.composerAddPlanMode}</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Right panel tab discriminator — one union covers every kind of tab
 * the unified top bar can host.
 */
type RightTab =
  | { id: string; kind: "files"; path: string }
  | { id: string; kind: "plan" }
  | { id: string; kind: "terminal"; /** Absolute cwd for the chip label. */ cwd?: string };

/** Display path like `~/Projects` for terminal tab chips. */
function formatTildePath(abs: string): string {
  if (!abs) return "";
  const norm = abs.replace(/\\/g, "/");
  // /Users/x/... or /home/x/...
  const unix = norm.match(/^(\/Users\/[^/]+|\/home\/[^/]+)(\/.*)?$/);
  if (unix) return "~" + (unix[2] || "");
  // C:/Users/x/... or C:\Users\x\...
  const win = abs.match(/^[A-Za-z]:[\\/]Users[\\/][^\\/]+(.*)$/);
  if (win) {
    const rest = (win[1] || "").replace(/\\/g, "/");
    return "~" + rest;
  }
  return norm;
}

/** Per-render helper to mint a fresh tab id (crypto.randomUUID with a
 *  fallback for older runtimes / test envs). */
const newRightTabId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `r_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

function defaultPanelLayout(): PanelLayout {
  return {
    sidebarWidth: SIDEBAR_DEFAULT,
    // Workspace list defaults to collapsed (rail visible) — fewer
    // distractions when jumping back into a session. Click the rail
    // button to expand; the choice is persisted afterwards.
    sidebarCollapsed: true,
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

function modeOptions(m: Messages) {
  // Re-exported from './modeOptions' for backwards compat; new code
  // should import from the module directly so the sync-with-backend
  // contract test can read a single source of truth.
  return computeModeOptions(m);
}

/**
 * Inline-SVG icon for each session mode shown in the mode-selection
 * dropdown. Stroked (line-art) to match the rest of the app.
 *
 *   default          → Agent        — shield-question ("review each")
 *   acceptEdits      → Accept edits — pencil
 *   auto             → Auto class.  — sparkles
 *   dontAsk          → Deny unknown — circle with diagonal slash
 *   bypassPermissions→ Bypass       — shield with warning (destructive)
 *   plan             → Plan         — clipboard with list
 */
function ModeOptionIcon({ id }: { id: SessionModeId }) {
  const svgProps = {
    width: 16,
    height: 16,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.75,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true as const,
  };
  switch (id) {
    case "default":
      return (
        <svg {...svgProps}>
          <circle cx="12" cy="12" r="9" />
          <path d="M9.5 10a2.5 2.5 0 0 1 5 .3c-.2 1.4-2.5 1.8-2.5 3.2" />
          <circle cx="12" cy="17" r="0.6" fill="currentColor" stroke="none" />
        </svg>
      );
    case "acceptEdits":
      return (
        <svg {...svgProps}>
          <path d="M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4Z" />
          <path d="M14 6l4 4" />
        </svg>
      );
    case "auto":
      return (
        <svg {...svgProps}>
          <path d="M12 3l1.6 3.6L17 8.2l-3.4 1.6L12 13.4l-1.6-3.6L7 8.2l3.4-1.6Z" />
          <path d="M18.5 14l.7 1.5L20.7 16l-1.5.7L18.5 18.2l-.7-1.5L16.3 16l1.5-.7Z" />
        </svg>
      );
    case "dontAsk":
      return (
        <svg {...svgProps}>
          <circle cx="12" cy="12" r="9" />
          <path d="M6 6l12 12" />
        </svg>
      );
    case "bypassPermissions":
      return (
        <svg {...svgProps}>
          <path d="M12 3l-7 3.5v5.2c0 4.3 2.9 8.2 7 9.3 4.1-1.1 7-5 7-9.3V6.5Z" />
          <path d="M12 9v4" />
          <circle cx="12" cy="16" r="0.6" fill="currentColor" stroke="none" />
        </svg>
      );
    case "plan":
      return (
        <svg {...svgProps}>
          <rect x="6" y="4" width="12" height="17" rx="2" />
          <path d="M9 4V3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1" />
          <path d="M9 10h6M9 14h6M9 18h4" />
        </svg>
      );
    default:
      return null;
  }
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

/** Map a file path to a small inline emoji icon used in the @-mention
 *  suggestion row. Directories always get 📁; files look up the last
 *  segment's extension in a small table and fall back to 📄. */
const FILE_ICONS: Record<string, string> = {
  ".py": "🐍",
  ".pyi": "🐍",
  ".ts": "🔷",
  ".tsx": "🔷",
  ".js": "🟨",
  ".jsx": "🟨",
  ".mjs": "🟨",
  ".cjs": "🟨",
  ".rs": "🦀",
  ".go": "🐹",
  ".rb": "💎",
  ".java": "☕",
  ".kt": "🟪",
  ".swift": "🐦",
  ".c": "🔵",
  ".cc": "🔵",
  ".cpp": "🔵",
  ".h": "🔵",
  ".hpp": "🔵",
  ".cs": "🟢",
  ".php": "🟣",
  ".lua": "🌙",
  ".sh": "🐚",
  ".bash": "🐚",
  ".zsh": "🐚",
  ".md": "📝",
  ".mdx": "📝",
  ".txt": "📄",
  ".json": "🧾",
  ".yaml": "🧾",
  ".yml": "🧾",
  ".toml": "🧾",
  ".html": "🌐",
  ".htm": "🌐",
  ".css": "🎨",
  ".scss": "🎨",
  ".sass": "🎨",
  ".less": "🎨",
  ".svg": "🖼",
  ".png": "🖼",
  ".jpg": "🖼",
  ".jpeg": "🖼",
  ".gif": "🖼",
  ".webp": "🖼",
  ".ico": "🖼",
  ".pdf": "📕",
  ".zip": "🗜",
  ".tar": "🗜",
  ".gz": "🗜",
  ".tgz": "🗜",
};

function iconForPath(path: string, isDir: boolean): string {
  if (isDir) return "📁";
  const lower = path.toLowerCase();
  for (const ext of Object.keys(FILE_ICONS)) {
    if (lower.endsWith(ext)) return FILE_ICONS[ext]!;
  }
  // Common special filenames
  const base = lower.slice(lower.lastIndexOf("/") + 1);
  if (base === "dockerfile") return "🐳";
  if (base === "makefile") return "🔧";
  if (base === "license" || base === "license.md" || base === "license.txt") {
    return "📜";
  }
  if (base.startsWith(".gitignore") || base === ".gitignore") return "🚫";
  if (base.startsWith(".env")) return "🔐";
  return "📄";
}

/** Bare skill label for chips (drop optional `scope:` prefix). */
function skillChipLabel(name: string): string {
  const i = name.lastIndexOf(":");
  return i >= 0 ? name.slice(i + 1) : name;
}

/** Detect `/skill` tokens that match known skill names (longest-first). */
function findSkillSpans(
  text: string,
  skillByLower: Map<string, string>,
): { start: number; end: number; name: string }[] {
  if (skillByLower.size === 0 || !text.includes("/")) return [];
  const spans: { start: number; end: number; name: string }[] = [];
  const re = /(?:^|[\s\n])\/([A-Za-z0-9][A-Za-z0-9_.:-]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const token = m[1]!;
    const slashStart = m.index + (m[0].startsWith("/") ? 0 : 1);
    const lower = token.toLowerCase();
    const canonical = skillByLower.get(lower);
    if (!canonical) continue;
    // Require exact token match (not a longer unknown name sharing a prefix).
    if (lower !== canonical.toLowerCase()) continue;
    spans.push({
      start: slashStart,
      end: slashStart + 1 + token.length,
      name: canonical,
    });
  }
  return spans;
}

type UserBodySpan =
  | { kind: "text"; text: string }
  | { kind: "at"; path: string; leading: string }
  | { kind: "skill"; name: string; leading: string };

/** Split user/composer text into plain + @file + skill segments. */
function segmentUserBody(
  text: string,
  skillByLower?: Map<string, string>,
): UserBodySpan[] {
  const skills = skillByLower
    ? findSkillSpans(text, skillByLower)
    : [];
  const ats = findAtMentionSpans(text);
  type Mark = { start: number; end: number; kind: "at" | "skill"; value: string };
  const marks: Mark[] = [
    ...ats.map((s) => ({
      start: s.start,
      end: s.end,
      kind: "at" as const,
      value: s.path,
    })),
    ...skills.map((s) => ({
      start: s.start,
      end: s.end,
      kind: "skill" as const,
      value: s.name,
    })),
  ].sort((a, b) => a.start - b.start || b.end - a.end);
  // Drop overlapping marks (prefer earlier / longer).
  const kept: Mark[] = [];
  let cursor = 0;
  for (const mk of marks) {
    if (mk.start < cursor) continue;
    kept.push(mk);
    cursor = mk.end;
  }
  const out: UserBodySpan[] = [];
  let last = 0;
  for (const mk of kept) {
    if (mk.start > last) {
      out.push({ kind: "text", text: text.slice(last, mk.start) });
    }
    if (mk.kind === "at") {
      out.push({ kind: "at", path: mk.value, leading: "" });
    } else {
      out.push({ kind: "skill", name: mk.value, leading: "" });
    }
    last = mk.end;
  }
  if (last < text.length) out.push({ kind: "text", text: text.slice(last) });
  return out.length ? out : [{ kind: "text", text }];
}

/** Split text on `@path` and skill `/name` mentions for history bubbles. */
function renderUserMessageBody(
  text: string,
  onOpenAtFile?: (path: string) => void,
  skillByLower?: Map<string, string>,
): ReactNode {
  const segs = segmentUserBody(text, skillByLower);
  return segs.map((seg, i) => {
    if (seg.kind === "at") {
      return (
        <span
          key={i}
          className="at-file-link"
          onClick={() => onOpenAtFile?.(seg.path)}
          title={seg.path}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter") onOpenAtFile?.(seg.path);
          }}
        >
          @{seg.path}
        </span>
      );
    }
    if (seg.kind === "skill") {
      return (
        <span
          key={i}
          className="skill-chip"
          title={`/${seg.name}`}
          data-skill={seg.name}
        >
          {skillChipLabel(seg.name)}
        </span>
      );
    }
    return <span key={i}>{seg.text}</span>;
  });
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

/**
 * Thumbnail for a user-message image. Prefers inline base64; falls back to
 * loading an absolute path under ~/.grok/sessions via IPC (reload of large
 * images that were materialised to disk).
 */
const UserImageThumb = memo(function UserImageThumb({
  attachment: a,
  onOpenLightbox,
}: {
  attachment: PromptAttachment;
  onOpenLightbox?: (img: { src: string; mime: string; name: string }) => void;
}) {
  const mime = a.mimeType || "image/png";
  const inlineSrc = a.dataBase64
    ? `data:${mime};base64,${a.dataBase64}`
    : null;
  const [src, setSrc] = useState<string | null>(inlineSrc);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (inlineSrc) {
      setSrc(inlineSrc);
      setFailed(false);
      return;
    }
    if (!a.path) {
      setFailed(true);
      return;
    }
    let cancelled = false;
    void window.desktop
      .readSessionImageDataUrl(a.path)
      .then((dataUrl) => {
        if (cancelled) return;
        if (dataUrl) {
          setSrc(dataUrl);
          setFailed(false);
        } else {
          setFailed(true);
        }
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [inlineSrc, a.path]);

  if (failed || !src) {
    return (
      <span
        className="msg-attachment-file"
        title={a.displayPath || a.name || a.path}
      >
        <span className="attach-kind">🖼</span>
        {a.name}
      </span>
    );
  }

  return (
    <img
      className="msg-attachment-image"
      src={src}
      alt={a.name}
      title={a.displayPath || a.name}
      role="button"
      tabIndex={0}
      onClick={() => onOpenLightbox?.({ src, mime, name: a.name })}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpenLightbox?.({ src, mime, name: a.name });
        }
      }}
    />
  );
});

/**
 * Fullscreen image viewer used by the user bubble thumbnail click.
 * Backdrop click + Esc both dismiss; the inner image is the only
 * interactive surface so accidental outside clicks can't double-handle.
 * On dismiss, focus returns to the previously-focused element so the
 * composer / next keyboard interaction keeps working.
 */
function ImageLightbox({
  src,
  name,
  onClose,
}: {
  src: string;
  name: string;
  onClose: () => void;
}) {
  const returnFocusRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    returnFocusRef.current =
      (document.activeElement as HTMLElement | null) ?? null;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      // Restore focus on unmount so the composer (or wherever the user
      // was typing) regains focus after the modal closes.
      const prev = returnFocusRef.current;
      if (prev && typeof prev.focus === "function") {
        // rAF avoids a one-frame race with sibling updates.
        requestAnimationFrame(() => prev.focus());
      }
    };
  }, [onClose]);

  return (
    <div
      className="image-lightbox-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={name}
      onClick={onClose}
    >
      <button
        type="button"
        className="image-lightbox-close"
        aria-label="Close"
        onClick={onClose}
      >
        ×
      </button>
      <img
        className="image-lightbox-img"
        src={src}
        alt={name}
        // Stop propagation so clicking the image itself doesn't dismiss.
        onClick={(e) => e.stopPropagation()}
      />
      <div className="image-lightbox-caption">{name}</div>
    </div>
  );
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

/** CLI-style duration for thought headers (matches pager format_duration). */
function formatThoughtDuration(ms: number): string {
  const totalSecs = ms / 1000;
  if (totalSecs < 10) return `${totalSecs.toFixed(1)}s`;
  if (totalSecs < 60) return `${Math.round(totalSecs)}s`;
  const mins = Math.floor(totalSecs / 60);
  const secs = Math.round(totalSecs - mins * 60);
  if (mins < 60) return `${mins}m${secs}s`;
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  return `${hours}h${remMins}m`;
}

/**
 * CLI-aligned thought row: collapsed by default, header is
 * "Thinking…" while streaming / "Thought for 2.6s" when done.
 * Duration is measured locally (start → first non-streaming finalize).
 */
const ThoughtRow = memo(function ThoughtRow({
  item,
  m,
  onOpenAtFile,
  liveStreaming,
}: {
  item: Extract<TimelineItem, { kind: "thought" }>;
  m: Messages;
  onOpenAtFile?: (path: string) => void;
  /** True only while the session turn is still busy (hides stuck caret). */
  liveStreaming?: boolean;
}) {
  const startRef = useRef<number>(item.createdAt ?? Date.now());
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);
  const streaming = Boolean(liveStreaming);

  useEffect(() => {
    if (streaming) {
      // Reopen after MiniMax-style reconnect — keep original start.
      setElapsedMs(null);
      return;
    }
    // Finished: freeze wall-clock duration once.
    setElapsedMs((prev) => {
      if (prev != null) return prev;
      return Math.max(0, Date.now() - startRef.current);
    });
  }, [streaming]);

  let label: string;
  if (streaming) {
    label = m.thoughtStreaming;
  } else if (elapsedMs != null && elapsedMs > 50) {
    // Skip near-zero durations (instant replay finalize).
    label = m.thoughtFor.replace("{t}", formatThoughtDuration(elapsedMs));
  } else {
    label = m.thought;
  }

  // Controlled collapse — always start closed (including while streaming).
  const [open, setOpen] = useState(false);

  return (
    <details
      className="thought activity-thought"
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
    >
      <summary className="thought-summary">
        <span className="thought-summary-label">{label}</span>
        <MsgCopyButton item={item} m={m} />
      </summary>
      <MarkdownBody
        className="thought-body"
        text={item.text}
        streaming={streaming}
        onOpenAtFile={onOpenAtFile}
      />
    </details>
  );
});

const TimelineRow = memo(function TimelineRow({
  item,
  m,
  highlight,
  onOpenAtFile,
  onOpenLightbox,
  skillByLower,
  turnBusy,
}: {
  item: TimelineItem;
  m: Messages;
  highlight?: boolean;
  onOpenAtFile?: (path: string) => void;
  onOpenLightbox?: (img: { src: string; mime: string; name: string }) => void;
  /** Known skill slash names (lowercase → canonical) for chip rendering. */
  skillByLower?: Map<string, string>;
  /** Session turn busy — streaming caret only while true. */
  turnBusy?: boolean;
}) {
  if (item.kind === "system") {
    return <div className="system-line">{item.text}</div>;
  }
  if (item.kind === "user") {
    const atts = item.attachments ?? [];
    // Goal/loop badges: UI-intent only (backend attach*Badge). Hand-typed
    // `/goal` / `/loop` keep literal text and no badge.
    const isGoalCommand = item.attachGoalBadge === true;
    const isLoopCommand = item.attachLoopBadge === true;
    // Previewable: inline base64, or image with a session path (loaded
    // async). Everything else becomes a file chip.
    const previewableImages = atts.filter(
      (a) => a.kind === "image" && (a.dataBase64 || a.path),
    );
    const fileChips = atts.filter(
      (a) => !(a.kind === "image" && (a.dataBase64 || a.path)),
    );
    // Hide the "[N images]" placeholder when thumbnails already convey that.
    const bodyText =
      previewableImages.length > 0 && /^\[\d+ images?\]$/i.test(item.text.trim())
        ? ""
        : item.text;
    return (
      <div
        className={`msg msg-user${highlight ? " msg-flash" : ""}`}
        id={msgDomId(item.id)}
        data-atts-count={atts.length}
        data-prev-count={previewableImages.length}
        data-chips-count={fileChips.length}
      >
        {/* Images sit outside the bubble, above it — keeps the bubble
            compact and the thumbnails aligned to the right edge. */}
        {previewableImages.length > 0 ? (
          <div className="msg-attachments msg-attachments-outside">
            {previewableImages.map((a) => (
              <UserImageThumb
                key={a.id}
                attachment={a}
                onOpenLightbox={onOpenLightbox}
              />
            ))}
          </div>
        ) : null}
        <div className="msg-bubble">
          {fileChips.length > 0 ? (
            <div className="msg-attachments msg-attachments-files">
              {fileChips.map((a) => (
                <span
                  key={a.id}
                  className="msg-attachment-file"
                  title={a.displayPath || a.name}
                >
                  <span className="attach-kind">
                    {a.kind === "image" ? "🖼" : "📄"}
                  </span>
                  {a.name}
                </span>
              ))}
            </div>
          ) : null}
          {/* User messages skip the role label — the right-aligned bubble
             shape + accent color already identifies the speaker. */}
          {bodyText ? (
            <div className="msg-body">
              {renderUserMessageBody(bodyText, onOpenAtFile, skillByLower)}
            </div>
          ) : null}
          <div className="msg-actions">
            <MsgCopyButton item={item} m={m} />
          </div>
        </div>
        {/* Goal / loop badges sit outside the bubble, below it.
            i18n text already includes the icon glyph — no duplicate
            `<span className="...-icon">` needed. */}
        {isGoalCommand ? (
          <div className="user-msg-goal-badge" aria-label={m.goalMessageBadge}>
            <span>{m.goalMessageBadge}</span>
          </div>
        ) : null}
        {isLoopCommand ? (
          <div
            className="user-msg-loop-badge"
            aria-label={m.loopMessageBadge.replace(
              "{interval}",
              item.loopInterval || "5m",
            )}
          >
            <span className="user-msg-loop-badge-icon" aria-hidden="true">
              ⏱
            </span>
            <span>
              {m.loopMessageBadge.replace(
                "{interval}",
                item.loopInterval || "5m",
              )}
            </span>
          </div>
        ) : null}
      </div>
    );
  }
  if (item.kind === "assistant") {
    // No role label — conversation history is self-evident; copy sits in
    // the hover actions strip like user bubbles.
    // Caret only while the turn is busy — backend may leave streaming:true
    // on a bubble after the RPC settles; never blink after the turn ends.
    const liveStreaming = Boolean(turnBusy && item.streaming);
    return (
      <div className="msg msg-assistant">
        <div className="msg-bubble">
          <MarkdownBody
            className="msg-body"
            text={item.text}
            streaming={liveStreaming}
            onOpenAtFile={onOpenAtFile}
          />
          <div className="msg-actions">
            <MsgCopyButton item={item} m={m} />
          </div>
        </div>
      </div>
    );
  }
  if (item.kind === "thought") {
    return (
      <ThoughtRow
        item={item}
        m={m}
        onOpenAtFile={onOpenAtFile}
        liveStreaming={Boolean(turnBusy && item.streaming)}
      />
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
  if (item.kind === "goal_action") {
    const running = item.status === "running";
    // Badge label per verb — mirrors `.compact-badge.mode-{auto,manual}`
    // but scoped to the goal action namespace (`mode-pause/resume/clear`).
    const badgeText =
      item.verb === "pause"
        ? m.goalActionBadgePause
        : item.verb === "resume"
          ? m.goalActionBadgeResume
          : m.goalActionBadgeClear;
    // Title: three running labels, three completed labels, plus shared
    // failed / cancelled copy. `failed` surfaces the message so the user
    // can see *why* the prompt RPC didn't land.
    const titleText = (() => {
      if (running) {
        if (item.verb === "pause") return m.goalActionTitlePauseRunning;
        if (item.verb === "resume") return m.goalActionTitleResumeRunning;
        return m.goalActionTitleClearRunning;
      }
      if (item.status === "failed") {
        return item.message
          ? `${m.goalActionFailed}: ${item.message}`
          : m.goalActionFailed;
      }
      if (item.status === "cancelled") return m.goalActionCancelled;
      if (item.verb === "pause") return m.goalActionTitlePauseDone;
      if (item.verb === "resume") return m.goalActionTitleResumeDone;
      return m.goalActionTitleClearDone;
    })();
    // Reuse the compact-card chrome verbatim so this card visually
    // matches `/compact` receipts. The `.goal-action` modifier is
    // reserved for future per-verb tints (see styles.css).
    return (
      <div
        className={`compact-card goal-action status-${item.status}${running ? " is-running" : ""}`}
        role="status"
        aria-live="polite"
      >
        <div className="compact-card-row">
          <span className={`compact-badge mode-${item.verb}`}>{badgeText}</span>
          <span className="compact-title">{titleText}</span>
          {running ? <span className="compact-spinner" aria-hidden /> : null}
        </div>
        {running ? (
          <div className="compact-progress" aria-hidden>
            <div className="compact-progress-bar" />
          </div>
        ) : null}
      </div>
    );
  }
  return null;
});

/** Isolated so composer keystrokes don't re-render the whole timeline tree.
 *  Flat chronological order — each thought/tool is its own row and starts
 *  collapsed; nothing is merged into a group fold. */
const ChatTimeline = memo(function ChatTimeline({
  timeline,
  replaying,
  flashMsgId,
  busy,
  m,
  bottomRef,
  onOpenAtFile,
  onOpenLightbox,
  skillByLower,
}: {
  timeline: TimelineItem[];
  replaying: boolean;
  flashMsgId: string | null;
  busy: boolean;
  m: Messages;
  bottomRef: RefObject<HTMLDivElement | null>;
  onOpenAtFile?: (path: string) => void;
  onOpenLightbox?: (img: { src: string; mime: string; name: string }) => void;
  skillByLower?: Map<string, string>;
}) {
  const items = useMemo(() => linearizeTimeline(timeline), [timeline]);
  // Show the "thinking" indicator right after the user message when the
  // agent is busy but no assistant text / thought has landed yet.
  const lastItem = timeline[timeline.length - 1];
  const lastIsUser = lastItem?.kind === "user";
  const showPending = busy && lastIsUser;

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

  return (
    <div className="timeline">
      {items.map((item) => (
        <TimelineRow
          key={item.id}
          item={item}
          m={m}
          highlight={flashMsgId === item.id}
          onOpenAtFile={onOpenAtFile}
          onOpenLightbox={onOpenLightbox}
          skillByLower={skillByLower}
          turnBusy={busy}
        />
      ))}
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
  /** User-facing body (no auto `/goal` / `/loop` prefix). */
  text: string;
  attachments: PromptAttachment[];
  /** Snapshotted UI intent at enqueue time. */
  prependGoal?: boolean;
  prependLoop?: boolean;
  loopInterval?: string;
};

/** Resolved wire text + bubble flags for goal/loop composer intents. */
type ResolvedPromptIntent = {
  wireText: string;
  prependGoal?: boolean;
  prependLoop?: boolean;
  loopInterval?: string;
};

const LOOP_INTERVAL_PRESETS = ["1m", "5m", "15m", "1h"] as const;

function resolvePromptIntent(
  text: string,
  opts: {
    goalActive: boolean;
    loopActive: boolean;
    loopInterval: string;
    /** When set, ignore live UI state and use these flags (queued drain). */
    frozen?: {
      prependGoal?: boolean;
      prependLoop?: boolean;
      loopInterval?: string;
    };
  },
): ResolvedPromptIntent {
  if (opts.frozen?.prependLoop) {
    const interval = opts.frozen.loopInterval || "5m";
    if (/^\s*\/(goal|loop)\b/i.test(text)) {
      return { wireText: text, prependLoop: true, loopInterval: interval };
    }
    return {
      wireText: `/loop ${interval} ${text}`,
      prependLoop: true,
      loopInterval: interval,
    };
  }
  if (opts.frozen?.prependGoal) {
    if (/^\s*\/goal\b/i.test(text)) {
      return { wireText: text, prependGoal: true };
    }
    return { wireText: `/goal ${text}`, prependGoal: true };
  }
  if (opts.loopActive && !/^\s*\/(goal|loop)\b/i.test(text)) {
    const interval = opts.loopInterval || "5m";
    return {
      wireText: `/loop ${interval} ${text}`,
      prependLoop: true,
      loopInterval: interval,
    };
  }
  if (opts.goalActive && !/^\s*\/goal\b/i.test(text)) {
    return { wireText: `/goal ${text}`, prependGoal: true };
  }
  return { wireText: text };
}

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
  status: AgentActivity | undefined,
  reason: NeedsInputReason | undefined,
  m: Messages,
): string | undefined {
  if (!status || status === "idle") return undefined;
  if (status === "working") return m.sessionStatusWorking;
  if (status === "loading") return m.sessionStatusLoading;
  if (status === "needsInput") {
    if (reason === "permission") return m.needsInputReasonPermission;
    if (reason === "question") return m.needsInputReasonQuestion;
    if (reason === "trust") return m.needsInputReasonTrust;
    if (reason === "plan") return m.needsInputReasonPlan;
    return m.sessionStatusNeedsInput;
  }
  if (status === "completed") return m.sessionStatusCompleted;
  if (status === "failed") return m.sessionStatusFailed;
  if (status === "cancelled") return m.sessionStatusCancelled;
  if (status === "blocked") return m.sessionStatusBlocked;
  return undefined;
}

function SessionStatusIcon({
  status,
  reason,
  label,
  isFocused,
}: {
  status: AgentActivity | undefined;
  reason?: NeedsInputReason;
  label?: string;
  /** When true (session is the one the user is viewing), terminal stains
   *  are suppressed — the user clicked the session, so the notification
   *  has been "seen". */
  isFocused?: boolean;
}) {
  if (!status || status === "idle") return null;
  if (status === "needsInput") {
    // plan 单独配色(蓝灰),与 permission(橙)/question(紫)/trust(黄)区分
    const variant =
      reason === "question"
        ? "question"
        : reason === "trust"
          ? "trust"
          : reason === "plan"
            ? "plan"
            : reason === "permission"
              ? "permission"
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
  // Terminal stains (completed/failed/cancelled/blocked):
  // - Focused session → user clicked in, clear the notification
  // - Unfocused session → pulsing dot to alert user something finished
  if (isTerminal(status)) {
    if (isFocused) return null;
    return (
      <span
        className={`session-status-dot terminal ${status}`}
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

/**
 * Header status badge for the focused session.
 *
 * Aligned with TUI `RowState` — see `AgentActivity`. Renders a small
 * animated dot or ring next to the connection state so the user can
 * tell at a glance whether the agent is working, loading history,
 * waiting for input, or has just finished a turn.
 *
 * Terminal stains (completed/failed/cancelled/blocked) auto-fade after
 * the matching duration (2s for success/cancel, 5s for failure/blocked)
 * without mutating `snap.activity` — purely renderer-local.
 */
function AgentActivityBadge({
  activity,
  reason,
  m,
}: {
  activity: AgentActivity;
  reason?: NeedsInputReason;
  m: Messages;
}) {
  // Auto-fade duration per terminal state (ms).
  const FADE_MS: Partial<Record<AgentActivity, number>> = {
    completed: 2000,
    cancelled: 2000,
    failed: 5000,
    blocked: 5000,
  };

  const [faded, setFaded] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Prevent re-showing terminal stains on mount (session switch back).
  // When the component mounts with a terminal activity, it's a "stale"
  // stain from the previous time the user had this session open; the
  // real turn finished while the user was elsewhere. Skip it entirely.
  // When activity *transitions* to terminal while already mounted
  // (fresh turn finish while user is watching), show the badge normally.
  const wasMountedWithNonTerminal = useRef(false);
  useEffect(() => {
    if (!isTerminal(activity)) {
      wasMountedWithNonTerminal.current = true;
    }
  }, [activity]);

  // Stale terminal stain on mount → hide.
  if (!wasMountedWithNonTerminal.current && isTerminal(activity)) {
    return null;
  }

  useEffect(() => {
    // Any activity change resets the fade and clears any pending timer.
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const fadeMs = FADE_MS[activity];
    if (fadeMs === undefined) {
      // Live state — never fade (idle/working/loading/needsInput).
      setFaded(false);
      return;
    }
    // Terminal stain — show immediately, fade after `fadeMs`.
    setFaded(false);
    timerRef.current = setTimeout(() => {
      setFaded(true);
      timerRef.current = null;
    }, fadeMs);
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [activity]);

  if (faded) return null;

  // idle → no badge (only connection state is shown)
  if (activity === "idle") return null;

  const label = sessionStatusLabel(activity, reason, m);

  // Pick class + glyph per activity.
  let cls = "agent-activity-badge";
  let glyph: ReactNode = null;

  if (activity === "working") {
    cls += " working";
    glyph = <span className="badge-dot" aria-hidden />;
  } else if (activity === "loading") {
    cls += " loading";
    glyph = <span className="badge-ring" aria-hidden />;
  } else if (activity === "needsInput") {
    cls += ` needs-input ${reason ?? "permission"}`;
    glyph = <span className="badge-glyph" aria-hidden>{glyphForReason(reason)}</span>;
  } else {
    // Terminal stains — render as small static glyph + label.
    cls += ` terminal ${activity}`;
    glyph = <span className="badge-glyph" aria-hidden>{glyphForTerminal(activity)}</span>;
  }

  return (
    <span className={cls} title={label} role="status" aria-label={label}>
      {glyph}
      {label ? <span className="badge-label">{label}</span> : null}
    </span>
  );
}

function glyphForReason(reason: NeedsInputReason | undefined): string {
  if (reason === "permission") return "!";
  if (reason === "question") return "?";
  if (reason === "trust") return "🔒";
  if (reason === "plan") return "☑";
  return "!";
}

function glyphForTerminal(activity: AgentActivity): string {
  if (activity === "completed") return "✓";
  if (activity === "failed") return "✗";
  if (activity === "cancelled") return "—";
  if (activity === "blocked") return "⊘";
  return "•";
}

/**
 * Global keyboard accelerators that mirror the File / Edit / View / Help
 * menu items on Win/Linux, where we deliberately leave the platform
 * menu blank (see `setupApplicationMenu` in the main process). On macOS
 * these are registered by the system menu bar instead, so this hook is
 * effectively a no-op there — the menu accelerators win the race and
 * the dispatch hits the same renderer-side handlers.
 *
 * Implementation notes:
 *  - Capture phase (`addEventListener(..., true)`) so we run before
 *    xterm / textarea handlers and can `preventDefault` things like
 *    Ctrl+R.
 *  - We only block text-input fields from receiving our menu chords;
 *    edit / clipboard chords (Ctrl+Z/X/C/V/A) are intentionally left
 *    to the browser's default behavior to avoid stomping on normal
 *    typing.
 *  - Hotkeys are matched on a normalized key + modifier set, which is
 *    portable across Cmd vs Ctrl without parsing Electron accelerator
 *    strings ourselves.
 */
function isEditableTarget(t: EventTarget | null): boolean {
  if (!t || !(t instanceof HTMLElement)) return false;
  if (t.isContentEditable) return true;
  const tag = t.tagName;
  return tag === "INPUT" || tag === "TEXTAREA";
}

function useGlobalMenuAccelerators(opts: {
  onNewSession: () => void;
  onOpenSettings: () => void;
  onReload: () => void;
  onToggleDevTools: () => void;
  onAbout: () => void;
  onFullscreen: () => void;
}): void {
  const optsRef = useRef(opts);
  useEffect(() => {
    optsRef.current = opts;
  }, [opts]);

  useEffect(() => {
    // isMac is read once on mount; the platform doesn't change mid-life.
    const isMac = /Mac|Darwin/i.test(navigator.userAgent || "");

    const onKey = (e: globalThis.KeyboardEvent): void => {
      // Modifier set: prefer meta on macOS, ctrl elsewhere — both work
      // when the user swaps them, but matches what the menu accelerator
      // says ("CmdOrCtrl+...").
      const mod = isMac ? e.metaKey : e.ctrlKey;
      // Avoid capturing AltGr / Shift+Ctrl combos that browsers reserve.
      const plainMod = mod && !e.altKey;

      // Always-available chords (work even inside text inputs).
      if (plainMod && (e.key === "," || e.code === "Comma")) {
        e.preventDefault();
        optsRef.current.onOpenSettings();
        return;
      }
      if (plainMod && (e.key.toLowerCase() === "n")) {
        e.preventDefault();
        optsRef.current.onNewSession();
        return;
      }
      if (plainMod && e.shiftKey && (e.key === "I" || e.key === "i")) {
        e.preventDefault();
        optsRef.current.onToggleDevTools();
        return;
      }
      if (plainMod && !e.shiftKey && (e.key === "r" || e.key === "R")) {
        e.preventDefault();
        optsRef.current.onReload();
        return;
      }
      if (e.key === "F11") {
        e.preventDefault();
        optsRef.current.onFullscreen();
        return;
      }

      // Outside-of-text-input chords only — never hijack a key the
      // composer or filename input might want.
      if (!isEditableTarget(e.target)) {
        if (plainMod && e.shiftKey && (e.key === "r" || e.key === "R")) {
          e.preventDefault();
          optsRef.current.onReload();
          return;
        }
        if (plainMod && (e.key === "?" || e.key === "/")) {
          // Convention from many editors: Ctrl+/ opens the about page.
          e.preventDefault();
          optsRef.current.onAbout();
          return;
        }
      }
    };

    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, []);
}

/** A detected @-mention span in the composer text. */
interface AtMentionSpan {
  start: number;
  end: number;
  path: string;
}

function findAtMentionSpans(text: string): AtMentionSpan[] {
  const spans: AtMentionSpan[] = [];
  const re = /(?:^|[\s\n])@([^\s@]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    spans.push({
      start: m.index + (m[0].startsWith("@") ? 0 : 1),
      end: m.index + m[0].length,
      path: m[1],
    });
  }
  return spans;
}

/** Split text into segments, wrapping @-mentions in styled pills. */
function renderComposerOverlay(text: string): ReactNode {
  const spans = findAtMentionSpans(text);
  if (spans.length === 0) return text;
  const parts: ReactNode[] = [];
  let last = 0;
  for (const s of spans) {
    if (s.start > last) parts.push(text.slice(last, s.start));
    parts.push(
      <span key={s.start} className="composer-at-pill" data-path={s.path}>
        @{s.path}
      </span>,
    );
    last = s.end;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
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
  /**
   * Always-current slash/@ scheduler. ContentEditable onInput is a stable
   * useCallback([]) and must not close over first-render scheduleSuggest
   * (which saw availableCommands=[] → only plan/ask/compact/agent).
   */
  const scheduleSuggestRef = useRef<(value: string, cursor: number) => void>(
    () => {},
  );
  const slashSuggestRef = useRef<SlashMenuItem[] | null>(null);
  const atSuggestRef = useRef<PathSuggestion[] | null>(null);
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
  /** Provider balance/usage results keyed by providerId (for inline tab display). */
  const [providerUsageMap, setProviderUsageMap] = useState<
    Record<string, ProviderUsageResult | null>
  >({});
  const [dragOver, setDragOver] = useState(false);
  const [attachments, setAttachments] = useState<PromptAttachment[]>([]);
  /** One-shot composer intents (slash / + menu). Cleared after successful send. */
  const [goalActive, setGoalActive] = useState(false);
  const [loopActive, setLoopActive] = useState(false);
  const [loopInterval, setLoopInterval] = useState<string>("5m");
  const [loopIntervalMenuOpen, setLoopIntervalMenuOpen] = useState(false);
  /** TUI-style goal detail overlay (click progress chip). */
  const [goalDetailOpen, setGoalDetailOpen] = useState(false);

  // ── Workspace picker UI removed from composer (request). The agent still
  //    has a workspace (snap.workspace); `onBrowseWorkspace` /
  //    `onSelectWorkspace` / `recentWorkspaces` remain available for the
  //    sidebar or settings future work. State below was tied to the
  //    composer dropdown only and is now unused.
  useEffect(() => {
    if (!snap.goalState) setGoalDetailOpen(false);
  }, [snap.goalState]);
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
    prependGoal?: boolean;
    prependLoop?: boolean;
    loopInterval?: string;
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
  const [slashSuggest, setSlashSuggest] = useState<SlashMenuItem[] | null>(
    null,
  );
  slashSuggestRef.current = slashSuggest;
  const [slashIndex, setSlashIndex] = useState(0);
  atSuggestRef.current = atSuggest;
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
  /** Open tabs in the right panel (any mix of files / plan / terminal). */
  const [rightPanelTabs, setRightPanelTabs] = useState<RightTab[]>([]);
  /** Which tab is currently rendered in the body area. */
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [rightPanelOpen, setRightPanelOpen] = useState(false);
  /**
   * True after the user manually closes the right panel while a plan is
   * awaiting approval. Resets when the approval clears or the session
   * changes; suppresses auto-pop so we don't fight the user's choice.
   */
  const planAutoPopDismissed = useRef(false);
  /** Previous rightPanelOpen for edge-detecting a user close. */
  const prevRightPanelOpenRef = useRef(false);
  /** Track the session id so the dismissed flag resets between sessions. */
  const lastSessionIdRef = useRef<string | undefined>(undefined);
  /** Inline file-tree pane collapse state (false = expanded). */
  const [fileTreeCollapsed, setFileTreeCollapsed] = useState(false);
  const [panelLayout, setPanelLayout] = useState<PanelLayout>(() =>
    loadPanelLayout(),
  );
  /** Workspace picker menu above the composer. */
  // Workspace picker UI removed from composer (request). The agent still
  // has a workspace (snap.workspace); `onBrowseWorkspace` /
// `onSelectWorkspace` / `recentWorkspaces` remain defined below for the
  // sidebar or settings future work. The composer-local menu state is
  // retained so the handlers below keep compiling cleanly.
  const [wsMenuOpen, setWsMenuOpen] = useState(false);
  void wsMenuOpen;
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
   * Lightbox: when set, the user bubble image is shown full-size in an
   * overlay modal. Carries the data URL, mime, and original filename so
   * the modal can show a caption and close cleanly. Cleared on Esc /
   * backdrop click / close button.
   */
  const [lightbox, setLightbox] = useState<
    { src: string; mime: string; name: string } | null
  >(null);
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
  const contentEditableRef = useRef<HTMLDivElement | null>(null);
  const selectsRef = useRef<HTMLDivElement | null>(null);
  const wsMenuRef = useRef<HTMLDivElement | null>(null);
  void wsMenuRef;
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
    /** For filesTree: parent body width in px (tree % is relative to this). */
    bodyW?: number;
  } | null>(null);
  /** True while a panel edge is being dragged — skip React layout sync / persist. */
  const isResizingRef = useRef(false);
  const panelLayoutRef = useRef(panelLayout);
  panelLayoutRef.current = panelLayout;
  /**
   * Last sidebar width the user had pinned before the shell shrunk
   * past `SIDEBAR_HOVER_MIN_PX`. Lets us rehydrate the same pinned
   * width once the shell grows back, instead of snapping back to
   * `SIDEBAR_DEFAULT`.
   */
  const lastShrinkPinnedWidthRef = useRef<number | null>(null);
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

  const handleOpenAtFile = useCallback(
    (path: string) => {
      const existing =
        path
          ? rightPanelTabsRef.current.find(
              (t) => t.kind === "files" && t.path === path,
            )
          : undefined;
      if (existing) {
        setActiveTabId(existing.id);
      } else {
        const id = newRightTabId();
        setRightPanelTabs((prev) => [...prev, { id, kind: "files", path }]);
        setActiveTabId(id);
      }
      setRightPanelOpen(true);
      setFileTreeCollapsed(false);
    },
    [],
  );

  /**
   * Open a brand-new files tab (used by the `+` menu). Always selects
   * the resulting tab. Does NOT replace the active tab's path in place.
   */
  const openFile = useCallback((path: string) => {
    handleOpenAtFile(path);
  }, [handleOpenAtFile]);

  /**
   * Select a file inside the currently active files tab — updates that
   * tab's path in place so the left editor pane shows the file without
   * spawning a new tab chip.
   */
  const selectFileInActiveTab = useCallback((path: string) => {
    if (!path) return;
    const active = rightPanelTabsRef.current.find(
      (t) => t.id === activeTabIdRef.current,
    );
    if (active?.kind === "files") {
      setRightPanelTabs((prev) =>
        prev.map((t) =>
          t.id === active.id && t.kind === "files" ? { ...t, path } : t,
        ),
      );
      // Keep the same tab selected (already active).
      setActiveTabId(active.id);
    } else {
      openFile(path);
      return;
    }
    setRightPanelOpen(true);
    setFileTreeCollapsed(false);
  }, [openFile]);

  /** Add or focus the Plan tab (singleton). Always selects it. */
  const openPlanTab = useCallback(() => {
    const existing = rightPanelTabsRef.current.find((t) => t.kind === "plan");
    if (existing) {
      setActiveTabId(existing.id);
    } else {
      const id = newRightTabId();
      setRightPanelTabs((prev) => [...prev, { id, kind: "plan" }]);
      setActiveTabId(id);
    }
    setRightPanelOpen(true);
  }, []);

  /** Add a brand-new Terminal tab and select it immediately. */
  const openTerminalTab = useCallback(() => {
    const id = newRightTabId();
    setRightPanelTabs((prev) => [
      ...prev,
      { id, kind: "terminal", cwd: snap.workspace },
    ]);
    setActiveTabId(id);
    setRightPanelOpen(true);
  }, [snap.workspace]);

  const setTerminalTabCwd = useCallback((tabId: string, cwd: string) => {
    setRightPanelTabs((prev) =>
      prev.map((t) =>
        t.id === tabId && t.kind === "terminal" ? { ...t, cwd } : t,
      ),
    );
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
    // When the shell shrinks past the per-pixel minimum width the
    // sidebar can occupy without the nav rows collapsing into
    // unreadable squalor, automatically retire the column into hover
    // mode so the user can still summon it via the left-edge affordance.
    const maybeAutoHover = () => {
      if (isResizingRef.current || resizeDragRef.current) return;
      const layout = panelLayoutRef.current;
      if (!layout.sidebarPinned || layout.sidebarCollapsed) return;
      const shellEl = shellRef.current;
      if (!shellEl) return;
      const shellWidth = shellEl.getBoundingClientRect().width;
      if (shellWidth <= 0) return;
      const sidebarPx = (shellWidth * layout.sidebarWidth) / 100;
      if (sidebarPx < SIDEBAR_HOVER_MIN_PX) {
        // Capture the current widths so a future resize-back can
        // restore the user's pinned-mode preference. Until then we
        // surface hover mode.
        lastShrinkPinnedWidthRef.current = layout.sidebarWidth;
        setPanelLayout((prev) => ({
          ...prev,
          sidebarPinned: false,
          sidebarCollapsed: true,
        }));
      } else if (
        !layout.sidebarPinned &&
        layout.sidebarCollapsed &&
        lastShrinkPinnedWidthRef.current != null &&
        sidebarPx >= SIDEBAR_HOVER_MIN_PX + 24
      ) {
        // Shell regrew enough that the previously-stored pinned
        // width fits with a little breathing room — auto-rehydrate.
        const restoreWidth = clamp(
          lastShrinkPinnedWidthRef.current,
          SIDEBAR_MIN,
          SIDEBAR_MAX,
        );
        lastShrinkPinnedWidthRef.current = null;
        setPanelLayout((prev) => ({
          ...prev,
          sidebarPinned: true,
          sidebarCollapsed: false,
          sidebarWidth: restoreWidth,
        }));
      }
    };

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
      maybeAutoHover();
    };

    window.addEventListener("resize", onResize);
    // Run once on mount so a tiny initial shell (e.g. dev tools
    // split-pane) still gets the auto-hover treatment.
    maybeAutoHover();
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
      // filesTree % is of the files body, not the whole shell.
      const filesBody =
        side === "filesTree"
          ? (handle.closest(".files-section-body") as HTMLElement | null)
          : null;
      const filesBodyW = Math.max(1, filesBody?.clientWidth ?? 320);
      // Set drag ref BEFORE any state so layout effects skip overwriting.
      resizeDragRef.current = {
        side,
        startX: e.clientX,
        startW,
        liveW: startW,
        rightOpen: rightOpenNow,
        bodyW: side === "filesTree" ? filesBodyW : undefined,
      };
      isResizingRef.current = true;
      // DOM-only chrome — avoid a full React re-render at drag start.
      const shell = shellRef.current;
      shell?.classList.add("shell-resizing", `shell-resizing-${side}`);
      // Hide heavy content only for shell column resizes, not the inner
      // files-tree split (that would blank the editor + tree mid-drag).
      if (side !== "filesTree") {
        document.body.classList.add("is-resizing-panels");
      } else {
        document.body.classList.add("is-resizing-files-tree");
      }
      // Prefer window-level listeners over setPointerCapture: capture can
      // die when ancestors get `pointer-events: none` during shell-resizing.
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
        if (drag.side === "left") {
          const deltaPct = ((clientX - drag.startX) / shellW) * 100;
          // Drag handle right = wider sidebar; left = narrower.
          const raw = drag.startW + deltaPct;
          const next = clamp(raw, SIDEBAR_COLLAPSE * 0.45, SIDEBAR_MAX);
          drag.liveW = next;
          applyShellColumns(next, drag.rightOpen ? rightFixed : null);
        } else if (drag.side === "right") {
          const deltaPct = ((clientX - drag.startX) / shellW) * 100;
          // Drag left edge: move left = wider right panel.
          const raw = drag.startW - deltaPct;
          const next = clamp(raw, RIGHT_COLLAPSE * 0.45, RIGHT_MAX);
          drag.liveW = next;
          applyShellColumns(leftFixed, next);
        } else {
          // File-tree: handle is the left edge of the tree pane.
          // % is of the files-section-body width, set via --files-tree-w
          // on the parent root so .files-section-tree pulls it via var().
          const bodyW = drag.bodyW ?? filesBodyW;
          const deltaPct = ((clientX - drag.startX) / bodyW) * 100;
          const raw = drag.startW - deltaPct;
          const next = clamp(raw, FILE_TREE_COLLAPSE * 0.45, FILE_TREE_MAX);
          drag.liveW = next;
          const root = document.querySelector(
            ".files-section-root",
          ) as HTMLElement | null;
          if (root) {
            root.style.setProperty("--files-tree-w", `${next.toFixed(2)}%`);
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
        document.body.classList.remove(
          "is-resizing-panels",
          "is-resizing-files-tree",
        );
        // Let terminal / file viewers fit once after the final column widths settle.
        requestAnimationFrame(() => {
          window.dispatchEvent(new Event("panel-resize-end"));
        });
      };

      const onUp = (ev: PointerEvent) => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
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

      window.addEventListener("pointermove", onMove, { passive: true });
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
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
    // Manual scroll math (see the @-suggest effect above for rationale).
    const active = root.querySelector<HTMLElement>(".at-item.active");
    if (!active) return;
    const rootRect = root.getBoundingClientRect();
    const itemRect = active.getBoundingClientRect();
    const overflowTop = rootRect.top - itemRect.top;
    const overflowBottom = itemRect.bottom - rootRect.bottom;
    if (overflowTop > 0) {
      root.scrollTop -= overflowTop;
    } else if (overflowBottom > 0) {
      root.scrollTop += overflowBottom;
    }
  }, [slashIndex, slashSuggest]);

  useEffect(() => {
    const root = atListRef.current;
    if (!root || !atSuggest?.length) return;
    // Manual scroll math: scrollIntoView({block:"nearest"}) is unreliable
    // when the active item sits exactly on the boundary — the browser
    // considers it "visible" and skips the scroll, leaving the thumb
    // stuck on screen while the active item peeks. Compute the offset
    // explicitly and only scroll the minimum needed, in either direction.
    const active = root.querySelector<HTMLElement>(".at-item.active");
    if (!active) return;
    const rootRect = root.getBoundingClientRect();
    const itemRect = active.getBoundingClientRect();
    const overflowTop = rootRect.top - itemRect.top;
    const overflowBottom = itemRect.bottom - rootRect.bottom;
    if (overflowTop > 0) {
      // Item is above the visible area — scroll up so its top aligns.
      root.scrollTop -= overflowTop;
    } else if (overflowBottom > 0) {
      // Item is below the visible area — scroll down so its bottom aligns.
      root.scrollTop += overflowBottom;
    }
  }, [atIndex, atSuggest]);

  useEffect(() => {
    void window.desktop.getState().then(setSnap);
    void window.desktop.getAccountStatus().then(setAccountStatus).catch(() => {
      /* ignore */
    });
    let lastCatalogSig = "";
    const offAgent = window.desktop.onEvent((event) => {
      if (event.type === "snapshot") {
        // Apply immediately — busy / connection / permission must not lag
        // behind session switches (startTransition left the send button stuck).
        // During cold load the backend suppresses intermediate timeline frames.
        setSnap(event.snapshot);
        const cmds = event.snapshot.availableCommands ?? [];
        const lower = cmds.map((c) => c.name.toLowerCase());
        const skillsN = cmds.filter(
          (c) =>
            Boolean(c.skillPath || c.skillScope) ||
            /^(local|repo|user|server|bundled|plugin):/i.test(c.name),
        ).length;
        const sig = `${cmds.length}|${lower.includes("goal")}|${lower.includes("loop")}|${skillsN}`;
        if (sig !== lastCatalogSig) {
          lastCatalogSig = sig;
          // eslint-disable-next-line no-console
          console.log("[slash-catalog] ui snapshot", {
            n: cmds.length,
            goal: lower.includes("goal"),
            loop: lower.includes("loop"),
            skillsN,
            sessionId: event.snapshot.sessionId,
            replaying: event.snapshot.replaying,
          });
        }
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
    const offUiOpenSettings = window.desktop.onUiOpenSettings(() => {
      // Main-process menu accelerator (Ctrl/Cmd+,) requested settings.
      // Reset the section to default so we always land on the top-level
      // settings nav, mirroring clicking the account-menu Settings item.
      setSettingsSection("general");
      setView("settings");
    });
    const offUiNewSession = window.desktop.onUiNewSession(() => {
      // Main-process menu File → New session (Ctrl/Cmd+N). Mirror the
      // top-bar New chat handler so menu and button do the same thing.
      void onNewSession();
    });
    return () => {
      offAgent();
      offAccount();
      offUiOpenSettings();
      offUiNewSession();
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
      // Reset one-shot composer intents when switching sessions.
      setGoalActive(false);
      setLoopActive(false);
      setLoopIntervalMenuOpen(false);
    }
    if (snap.replaying) {
      // Prevent auto-scroll after history replay completes —
      // the user should see the loaded conversation at rest, not
      // a rapid scroll to the bottom.
      stickToBottomRef.current = false;
      return;
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
    snap.activity,
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
    // openPlanTab already sets rightPanelOpen=true.
    openPlanTab();
  }, [snap.sessionId, snap.pendingPlanApproval, openPlanTab]);

  // Mark dismissed only on a true user close: right panel goes open→closed
  // while a plan approval is still pending (not when approval first arrives
  // with the panel still closed).
  useEffect(() => {
    if (
      snap.pendingPlanApproval &&
      prevRightPanelOpenRef.current &&
      !rightPanelOpen
    ) {
      planAutoPopDismissed.current = true;
    }
    prevRightPanelOpenRef.current = rightPanelOpen;
  }, [snap.pendingPlanApproval, rightPanelOpen]);

  // Close model/mode/effort menus on outside click or Escape
  useEffect(() => {
    if (!menu) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      const inSelects = selectsRef.current?.contains(t);
      if (!inSelects) {
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

  // Close @-mention dropdown on outside click or Escape.
  useEffect(() => {
    if (!atSuggest || atSuggest.length === 0) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (atListRef.current && !atListRef.current.contains(t)) {
        setAtSuggest(null);
      }
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setAtSuggest(null);
      }
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [atSuggest]);

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
  /** lowercase skill name → canonical ACP name (for chips / composer pills). */
  const skillByLower = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of snap.availableCommands) {
      if (!isSkillCommand(c)) continue;
      map.set(c.name.toLowerCase(), c.name);
    }
    return map;
  }, [snap.availableCommands]);
  const skillByLowerRef = useRef(skillByLower);
  skillByLowerRef.current = skillByLower;
  const currentModel = useMemo(
    () => snap.availableModels.find((mod) => mod.modelId === snap.modelId),
    [snap.availableModels, snap.modelId],
  );
  // Normalize the legacy `"ask"` value to the new `"dontAsk"` so the UI
// always shows the rename target. The IPC layer does the same when
// forwarding back to the agent.
  const normalizedSessionMode = useMemo<SessionModeId>(() => {
    const m = snap.sessionMode;
    // Legacy "ask" → "dontAsk" rename. Treat any unknown value as
    // "default" so the chip never breaks on a value the desktop
    // does not yet know about.
    if (m === ("ask" as string)) return "dontAsk";
    return (m || "default") as SessionModeId;
  }, [snap.sessionMode]);
  const modeLabel = useMemo(() => {
    const hit = modes.find((mod) => mod.id === normalizedSessionMode);
    return hit?.label ?? "Agent";
  }, [modes, normalizedSessionMode]);

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
    isBusyLike(snap.activity) ||
    Boolean(snap.compacting);

  /** Top-left new chat: prepare empty chat, then pop folder picker so
   *  the user chooses a workspace. `prepareNewChat()` always clears
   *  `snap.workspace` — without the picker the user is stuck deadlocked. */
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
      // `prepareNewChat()` clears workspace → deadlock without a picker.
      const folder = await window.desktop.pickFolder();
      if (!folder) return;
      await window.desktop.newSession(folder);
      contentEditableRef.current?.focus();
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
      contentEditableRef.current?.focus();
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
      contentEditableRef.current?.focus();
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
      contentEditableRef.current?.focus();
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
    const ce = contentEditableRef.current;
    if (ce) ce.textContent = "";
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
    // Also update the visible contenteditable with pill rendering.
    const ce = contentEditableRef.current;
    if (ce) renderContentEditable(ce, next);
  }, []);

  function isComposerPillEl(node: Node): node is HTMLElement {
    return (
      node instanceof HTMLElement &&
      (node.classList.contains("composer-at-pill") ||
        node.classList.contains("composer-skill-pill"))
    );
  }

  function composerPillPlainText(el: HTMLElement): string {
    if (el.classList.contains("composer-skill-pill")) {
      return `/${el.getAttribute("data-skill") ?? ""}`;
    }
    return `@${el.getAttribute("data-path") ?? ""}`;
  }

  /** Render text into a contenteditable div, replacing @mentions and
   *  known skills with styled `contenteditable=false` pills. */
  function renderContentEditable(el: HTMLElement, text: string) {
    const atSpans = findAtMentionSpans(text);
    const skillSpans = findSkillSpans(text, skillByLowerRef.current);
    type Mark = {
      start: number;
      end: number;
      kind: "at" | "skill";
      value: string;
    };
    const marks: Mark[] = [
      ...atSpans.map((s) => ({
        start: s.start,
        end: s.end,
        kind: "at" as const,
        value: s.path,
      })),
      ...skillSpans.map((s) => ({
        start: s.start,
        end: s.end,
        kind: "skill" as const,
        value: s.name,
      })),
    ].sort((a, b) => a.start - b.start || b.end - a.end);
    const kept: Mark[] = [];
    let cur = 0;
    for (const mk of marks) {
      if (mk.start < cur) continue;
      kept.push(mk);
      cur = mk.end;
    }
    if (kept.length === 0) {
      el.textContent = text;
      return;
    }
    el.innerHTML = "";
    let last = 0;
    for (const s of kept) {
      if (s.start > last) {
        el.appendChild(document.createTextNode(text.slice(last, s.start)));
      }
      const pill = document.createElement("span");
      pill.contentEditable = "false";
      if (s.kind === "at") {
        pill.className = "composer-at-pill";
        pill.textContent = `@${s.value}`;
        pill.setAttribute("data-path", s.value);
      } else {
        pill.className = "composer-skill-pill";
        pill.textContent = skillChipLabel(s.value);
        pill.setAttribute("data-skill", s.value);
        pill.title = `/${s.value}`;
      }
      el.appendChild(pill);
      last = s.end;
    }
    if (last < text.length) {
      el.appendChild(document.createTextNode(text.slice(last)));
    }
  }

  /** Place caret at a plain-text offset inside the contenteditable. */
  function setTextOffset(root: HTMLElement, target: number) {
    let remaining = Math.max(0, target);
    const sel = window.getSelection();
    if (!sel) return;
    const walk = (node: Node): boolean => {
      if (node.nodeType === Node.TEXT_NODE) {
        const len = (node.textContent ?? "").length;
        if (remaining <= len) {
          const range = document.createRange();
          range.setStart(node, remaining);
          range.collapse(true);
          sel.removeAllRanges();
          sel.addRange(range);
          return true;
        }
        remaining -= len;
        return false;
      }
      if (isComposerPillEl(node)) {
        const plain = composerPillPlainText(node);
        if (remaining <= plain.length) {
          // Land after the whole pill (atomic).
          const range = document.createRange();
          range.setStartAfter(node);
          range.collapse(true);
          sel.removeAllRanges();
          sel.addRange(range);
          return true;
        }
        remaining -= plain.length;
        return false;
      }
      for (const child of Array.from(node.childNodes)) {
        if (walk(child)) return true;
      }
      return false;
    };
    if (!walk(root)) {
      const range = document.createRange();
      range.selectNodeContents(root);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
    }
  }

  /** Read the contenteditable's text (pills → @path / /skill) and sync to the
   *  hidden textarea, then trigger the normal onChange flow. */
  function syncContentEditable() {
    const ce = contentEditableRef.current;
    const ta = textareaRef.current;
    if (!ce || !ta) return;
    let text = "";
    const walk = (node: Node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        text += node.textContent ?? "";
      } else if (isComposerPillEl(node)) {
        text += composerPillPlainText(node);
      } else {
        for (const child of Array.from(node.childNodes)) walk(child);
      }
    };
    walk(ce);
    // If the plain text contains complete skill tokens but the DOM is
    // missing pills (e.g. user finished typing a skill name), re-pillify.
    const expectedSkills = findSkillSpans(text, skillByLowerRef.current).length;
    const expectedAts = findAtMentionSpans(text).length;
    const haveSkills = ce.querySelectorAll(".composer-skill-pill").length;
    const haveAts = ce.querySelectorAll(".composer-at-pill").length;
    if (expectedSkills > haveSkills || expectedAts > haveAts) {
      let caret = text.length;
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0 && sel.anchorNode && ce.contains(sel.anchorNode)) {
        caret = getTextOffset(ce, sel.anchorNode, sel.anchorOffset);
      }
      renderContentEditable(ce, text);
      setTextOffset(ce, caret);
    }
    ta.value = text;
    draftRef.current = text;
    // Trigger resize + suggestion re-evaluation
    resizeTextarea(ta);
    const nonEmpty = text.trim().length > 0;
    setHasDraft((prev) => (prev === nonEmpty ? prev : nonEmpty));
    // Always re-evaluate when draft looks like / or @ (or was suggesting).
    // Use scheduleSuggestRef so a stable onInput handler never closes over
    // first-render availableCommands=[] (that only showed plan/ask/compact/agent).
    if (
      text.startsWith("/") ||
      text.includes("@") ||
      slashSuggestRef.current != null ||
      atSuggestRef.current != null
    ) {
      scheduleSuggestRef.current(text, text.length);
    }
  }

  /** Stable ref so onInput never calls a stale syncContentEditable closure. */
  const syncContentEditableRef = useRef(syncContentEditable);
  syncContentEditableRef.current = syncContentEditable;

  const handleContentEditableInput = useCallback(() => {
    syncContentEditableRef.current();
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
    requestAnimationFrame(() => contentEditableRef.current?.focus());
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

  const clearComposerIntent = useCallback(() => {
    setGoalActive(false);
    setLoopActive(false);
    setLoopIntervalMenuOpen(false);
  }, []);

  const activateGoalIntent = useCallback(() => {
    setLoopActive(false);
    setLoopIntervalMenuOpen(false);
    setGoalActive(true);
  }, []);

  const activateLoopIntent = useCallback(() => {
    setGoalActive(false);
    setLoopInterval((prev) => prev || "5m");
    setLoopActive(true);
  }, []);

  const enqueuePrompt = useCallback(
    (
      sessionId: string,
      text: string,
      atts: PromptAttachment[],
      intent?: {
        prependGoal?: boolean;
        prependLoop?: boolean;
        loopInterval?: string;
      },
    ) => {
      const item: QueuedPrompt = {
        id: newQueueId(),
        text,
        attachments: atts.map((a) => ({ ...a })),
        prependGoal: intent?.prependGoal || undefined,
        prependLoop: intent?.prependLoop || undefined,
        loopInterval: intent?.loopInterval,
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
    async (
      text: string,
      atts: PromptAttachment[],
      frozenIntent?: {
        prependGoal?: boolean;
        prependLoop?: boolean;
        loopInterval?: string;
      },
    ) => {
      const ok = await ensureSession();
      if (!ok) return;
      // Goal/loop UI intents: prepend slash command for the agent; flags
      // tell the backend to strip prefixes from the user bubble.
      const resolved = resolvePromptIntent(text, {
        goalActive,
        loopActive,
        loopInterval,
        frozen: frozenIntent,
      });
      await window.desktop.sendPrompt({
        text: resolved.wireText,
        attachments: atts,
        prependGoal: resolved.prependGoal || undefined,
        prependLoop: resolved.prependLoop || undefined,
      });
      if (resolved.prependGoal || resolved.prependLoop) {
        clearComposerIntent();
      }
    },
    [ensureSession, goalActive, loopActive, loopInterval, clearComposerIntent],
  );

  /**
   * Cancel the in-flight turn (if any) and send this prompt as soon as idle.
   * Used for Ctrl+Enter / "Send now" on a queued row.
   */
  const requestImmediateSend = useCallback(
    async (
      text: string,
      atts: PromptAttachment[],
      opts?: {
        sessionId?: string;
        prependGoal?: boolean;
        prependLoop?: boolean;
        loopInterval?: string;
      },
    ) => {
      const sid = opts?.sessionId ?? snap.sessionId;
      const frozen =
        opts?.prependGoal || opts?.prependLoop
          ? {
              prependGoal: opts.prependGoal,
              prependLoop: opts.prependLoop,
              loopInterval: opts.loopInterval,
            }
          : undefined;
      // Mid-turn on this session: park payload, cancel, drain on idle.
      if (isBusyLike(snap.activity) && sid && sid === snap.sessionId) {
        pendingImmediateRef.current = {
          sessionId: sid,
          text,
          attachments: atts.map((a) => ({ ...a })),
          prependGoal: frozen?.prependGoal,
          prependLoop: frozen?.prependLoop,
          loopInterval: frozen?.loopInterval,
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
        await dispatchAgentPrompt(text, atts, frozen);
      } catch (err) {
        setLocalError(err instanceof Error ? err.message : String(err));
      }
    },
    [snap.sessionId, snap.activity, dispatchAgentPrompt],
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
          if (isBusyLike(snap.activity) && snap.sessionId) {
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

    // Snapshot one-shot goal/loop intent before queue/send so chip state
    // cannot change what was already committed.
    const intentSnap = resolvePromptIntent(text, {
      goalActive,
      loopActive,
      loopInterval,
    });
    const frozen =
      intentSnap.prependGoal || intentSnap.prependLoop
        ? {
            prependGoal: intentSnap.prependGoal,
            prependLoop: intentSnap.prependLoop,
            loopInterval: intentSnap.loopInterval,
          }
        : undefined;
    if (frozen) clearComposerIntent();

    // Busy turn: queue follow-up (FIFO, auto-sends when idle).
    if (isBusyLike(snap.activity)) {
      if (!snap.sessionId) {
        setLocalError(m.chooseWorkspaceFirst);
        return;
      }
      enqueuePrompt(snap.sessionId, text, atts, frozen);
      return;
    }

    try {
      await dispatchAgentPrompt(text, atts, frozen);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : String(err));
    }
  }, [
    attachments,
    clearComposerText,
    clearComposerIntent,
    dispatchAgentPrompt,
    enqueuePrompt,
    exitHistoryBrowse,
    openHistorySearch,
    rememberPrompt,
    goalActive,
    loopActive,
    loopInterval,
    snap.availableModels,
    snap.modelId,
    snap.workspace,
    snap.alwaysApprove,
    isBusyLike(snap.activity),
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
          prependGoal: item.prependGoal,
          prependLoop: item.prependLoop,
          loopInterval: item.loopInterval,
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
        const intentSnap = resolvePromptIntent(text, {
          goalActive,
          loopActive,
          loopInterval,
        });
        const frozen =
          intentSnap.prependGoal || intentSnap.prependLoop
            ? {
                prependGoal: intentSnap.prependGoal,
                prependLoop: intentSnap.prependLoop,
                loopInterval: intentSnap.loopInterval,
              }
            : undefined;
        if (frozen) clearComposerIntent();
        await requestImmediateSend(text, atts, frozen);
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
            prependGoal: top.prependGoal,
            prependLoop: top.prependLoop,
            loopInterval: top.loopInterval,
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
      clearComposerIntent,
      exitHistoryBrowse,
      openHistorySearch,
      rememberPrompt,
      goalActive,
      loopActive,
      loopInterval,
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
    if (isBusyLike(snap.activity) || snap.replaying) return;
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
      frozen?: {
        prependGoal?: boolean;
        prependLoop?: boolean;
        loopInterval?: string;
      },
    ) => {
      try {
        await dispatchAgentPrompt(text, atts, frozen);
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
      const frozen =
        immediate.prependGoal || immediate.prependLoop
          ? {
              prependGoal: immediate.prependGoal,
              prependLoop: immediate.prependLoop,
              loopInterval: immediate.loopInterval,
            }
          : undefined;
      void run(immediate.text, immediate.attachments, undefined, frozen);
      return;
    }

    const next = queue[0]!;
    setQueuesBySession((prev) => {
      const list = prev[sid] ?? [];
      if (!list.length || list[0]?.id !== next.id) return prev;
      return { ...prev, [sid]: list.slice(1) };
    });
    const frozen =
      next.prependGoal || next.prependLoop
        ? {
            prependGoal: next.prependGoal,
            prependLoop: next.prependLoop,
            loopInterval: next.loopInterval,
          }
        : undefined;
    void run(next.text, next.attachments, next, frozen);
  }, [
    snap.activity,
    snap.replaying,
    snap.connection,
    snap.sessionId,
    queuesBySession,
    dispatchAgentPrompt,
  ]);

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

  /** Enter goal intent — shows the 🎯 chip; send prepends `/goal ` once. */
  const onGoalMode = useCallback(() => {
    activateGoalIntent();
  }, [activateGoalIntent]);

  /** Send a `/goal <verb>` slash command to the agent. Used by the
   *  GoalProgressBubble's pause / resume / clear action buttons.
   *  Falls back to ensuring a session exists first (mirrors onGoalMode
   *  behavior) so the user can click these from a fresh workspace. */
  const onGoalAction = useCallback(
    async (verb: "pause" | "resume" | "clear") => {
      setLocalError(null);
      try {
        if (!snap.sessionId) {
          const ok = await ensureSession();
          if (!ok) return;
        }
        await window.desktop.sendPrompt(`/goal ${verb}`);
      } catch (err) {
        setLocalError(err instanceof Error ? err.message : String(err));
      }
    },
    [snap.sessionId, ensureSession],
  );

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

  // File / Edit / View / Help keyboard chords. On Win/Linux we don't
  // publish an Electron menu (see main `setupApplicationMenu`), so the
  // renderer is the only place these shortcuts come from. On macOS
  // the menu accelerators take precedence and trigger the same
  // handlers via `ui:openSettings` / `ui:newSession` IPC, so this hook
  // is a no-op there.
  useGlobalMenuAccelerators({
    onNewSession: () => {
      void onNewSession();
    },
    onOpenSettings: () => {
      setSettingsSection("general");
      setView("settings");
    },
    onReload: () => {
      void window.desktop.requestReload();
    },
    onToggleDevTools: () => {
      void window.desktop.requestToggleDevTools();
    },
    onAbout: () => {
      void window.desktop.requestAbout();
    },
    onFullscreen: () => {
      if (document.fullscreenElement) void document.exitFullscreen();
      else void document.documentElement.requestFullscreen();
    },
  });

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
        await window.desktop.setAlwaysApprove(modeId === "bypassPermissions");
      } catch (err) {
        setLocalError(err instanceof Error ? err.message : String(err));
      }
    },
    [snap.sessionId, ensureSession],
  );

  const slashQueryRef = useRef<string | null>(null);
  const atQueryRef = useRef<string | null>(null);
  // Monotonic counter incremented on every keystroke that mutates the
  // @-mention query. Each pathSuggest() call captures its generation
  // and drops its result if a newer call has been issued meanwhile.
  const atGenRef = useRef(0);

  const availableCommandsRef = useRef(snap.availableCommands);
  availableCommandsRef.current = snap.availableCommands;

  const updateSlashSuggest = useCallback(
    (value: string, cursor: number) => {
      if (!isSlashCompose(value, cursor)) {
        slashQueryRef.current = null;
        setSlashSuggest((prev) => (prev == null ? prev : null));
        return;
      }
      const q = slashNameQuery(value, cursor);
      // Prefer ref so a rAF scheduled before the last snapshot still sees
      // the latest catalog (and stable onInput never freezes empty acp).
      const acp = availableCommandsRef.current ?? [];
      const list = filterSlashMenu(acp, q, m);
      // Debug: DevTools console — greppable `[slash-catalog]`.
      if (q !== slashQueryRef.current) {
        const lower = acp.map((c) => c.name.toLowerCase());
        const skills = acp.filter(
          (c) =>
            Boolean(c.skillPath || c.skillScope) ||
            /^(local|repo|user|server|bundled|plugin):/i.test(c.name),
        );
        // eslint-disable-next-line no-console
        console.log("[slash-catalog] ui filter", {
          q,
          acpN: acp.length,
          goal: lower.includes("goal"),
          loop: lower.includes("loop"),
          skillsN: skills.length,
          menuN: list.length,
          menuNames: list.map((x) => x.name).slice(0, 20),
          menuSections: list.map((x) => x.section).slice(0, 20),
        });
      }
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
    [m],
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
    // Generation counter: bumped on every keystroke that mutates q.
    // When the async pathSuggest resolves we compare against the
    // current ref and drop the result if a newer query is in flight —
    // otherwise stale results from a previous query would overwrite
    // the menu state mid-typing (e.g. user types "@doc" then
    // backspaces to "@do" but the "doc" reply arrives later).
    const myGen = ++atGenRef.current;
    try {
      const raw = await window.desktop.pathSuggest(q);
      // Bail if a newer query has been requested since we started.
      if (myGen !== atGenRef.current) return;
      // Defensive client-side filter: a suggestion survives iff the
      // query is a substring of the path as a whole, or of any path
      // segment. The first branch handles path-shaped queries
      // ("@yak/docs" → "yak/docs"); the second handles bare names
      // ("@docs" → "yak/docs/readme.md"). This rules out fuzzy noise
      // ("@docs" should not surface "docker" / "docx.svg") without
      // rejecting legitimate nested matches.
      const qLower = q.toLowerCase().replace(/\/$/, "");
      const list = qLower
        ? raw.filter((s) => {
            const p = s.path.toLowerCase();
            if (p.includes(qLower)) return true;
            const segs = p.split("/").filter(Boolean);
            return segs.some((seg) => seg.includes(qLower));
          })
        : raw;
      setAtSuggest(list);
      if (!queryChanged) {
        setAtIndex((i) =>
          list.length === 0 ? 0 : Math.min(i, list.length - 1),
        );
      }
    } catch {
      if (myGen !== atGenRef.current) return;
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
        // Prefer contenteditable plain text + caret (hidden textarea is not
        // focused; selectionStart stays 0 and can break slash detection).
        const ce = contentEditableRef.current;
        const ta = textareaRef.current;
        let v = draftRef.current || ta?.value || value;
        let c = cursor;
        if (ce) {
          let text = "";
          const walk = (node: Node) => {
            if (node.nodeType === Node.TEXT_NODE) {
              text += node.textContent ?? "";
            } else if (isComposerPillEl(node)) {
              text += composerPillPlainText(node);
            } else {
              for (const child of Array.from(node.childNodes)) walk(child);
            }
          };
          walk(ce);
          if (text) v = text;
          const sel = window.getSelection();
          if (
            sel &&
            sel.rangeCount > 0 &&
            sel.anchorNode &&
            ce.contains(sel.anchorNode)
          ) {
            c = getTextOffset(ce, sel.anchorNode, sel.anchorOffset);
          } else {
            c = v.length;
          }
        } else if (ta && document.activeElement === ta) {
          v = ta.value;
          c = ta.selectionStart ?? v.length;
        }
        updateSuggest(v, c);
      });
    },
    [updateSuggest],
  );
  scheduleSuggestRef.current = scheduleSuggest;

  const applySlashMenuItem = useCallback(
    async (s: SlashMenuItem) => {
      setSlashSuggest(null);
      setLocalError(null);

      if (s.action === "fill") {
        const next = `/${s.name} `;
        setComposerText(next);
        requestAnimationFrame(() => {
          const ce = contentEditableRef.current;
          if (ce) {
            ce.focus();
            setTextOffset(ce, next.length);
            return;
          }
          const el = textareaRef.current;
          if (!el) return;
          el.focus();
          el.setSelectionRange(next.length, next.length);
        });
        return;
      }

      if (s.action === "set_intent" && s.intentId === "goal") {
        activateGoalIntent();
        // Drop in-progress `/…` or full `/goal` prefix; keep any body text.
        const cur = stripComposerIntentSlashPrefix(
          draftRef.current || "",
          "goal",
        );
        if (cur !== (draftRef.current || "")) setComposerText(cur);
        requestAnimationFrame(() => {
          contentEditableRef.current?.focus();
          textareaRef.current?.focus();
        });
        return;
      }

      if (s.action === "set_intent" && s.intentId === "loop") {
        activateLoopIntent();
        const cur = stripComposerIntentSlashPrefix(
          draftRef.current || "",
          "loop",
        );
        if (cur !== (draftRef.current || "")) setComposerText(cur);
        requestAnimationFrame(() => {
          contentEditableRef.current?.focus();
          textareaRef.current?.focus();
        });
        return;
      }

      // execute / set_mode: clear composer and run immediately
      clearComposerText();

      if (s.action === "set_mode" && s.modeId) {
        try {
          // `set_mode` action values come from the slash menu catalog and
          // are validated by the catalog itself; pass through any
          // SessionModeId-shaped string the catalog advertised.
          await window.desktop.setMode(s.modeId as SessionModeId);
        } catch (err) {
          setLocalError(err instanceof Error ? err.message : String(err));
        }
        return;
      }

      if (s.action === "execute") {
        const text = `/${s.name}`;
        try {
          const ok = await ensureSession();
          if (!ok) return;
          await window.desktop.sendPrompt({
            text,
            hideUserMessage: s.hideUserMessage === true,
          });
        } catch (err) {
          setLocalError(err instanceof Error ? err.message : String(err));
        }
      }
    },
    [
      setComposerText,
      clearComposerText,
      ensureSession,
      activateGoalIntent,
      activateLoopIntent,
    ],
  );

  const insertAtPath = useCallback(
    (path: string, isDir: boolean) => {
      const value = draftRef.current;
      if (!value) return;
      // Get cursor position from the visible contenteditable div
      let cursor = value.length;
      const ce = contentEditableRef.current;
      if (ce) {
        const sel = window.getSelection();
        if (sel && sel.rangeCount > 0 && ce.contains(sel.anchorNode)) {
          // Count text offset (treating pills as their @path text length)
          const range = sel.getRangeAt(0);
          cursor = getTextOffset(ce, range.startContainer, range.startOffset);
        }
      }
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
        const newCe = contentEditableRef.current;
        if (!newCe) return;
        newCe.focus();
        const sel = window.getSelection();
        if (!sel) return;
        const pills = newCe.querySelectorAll(".composer-at-pill");
        const lastPill = pills[pills.length - 1];
        if (lastPill) {
          const range = document.createRange();
          range.setStartAfter(lastPill);
          range.collapse(true);
          sel.removeAllRanges();
          sel.addRange(range);
        } else {
          const range = document.createRange();
          range.selectNodeContents(newCe);
          range.collapse(false);
          sel.removeAllRanges();
          sel.addRange(range);
        }
        if (isDir) void updateAtSuggest(next, start + insert.length);
      });
    },
    [atSuggest, setComposerText, updateAtSuggest],
  );

  /** Walk contenteditable DOM and count the text offset at a given
   *  node+offset, treating pills as their plain `@path` / `/skill` form. */
  function getTextOffset(root: Node, targetNode: Node, targetOffset: number): number {
    let offset = 0;
    const walk = (node: Node): boolean => {
      if (node === targetNode) {
        if (node.nodeType === Node.TEXT_NODE) {
          offset += targetOffset;
        } else if (isComposerPillEl(node)) {
          // Inside a non-editable pill: treat as start or end of the token.
          if (targetOffset > 0) offset += composerPillPlainText(node).length;
        }
        return true;
      }
      if (node.nodeType === Node.TEXT_NODE) {
        offset += (node.textContent ?? "").length;
      } else if (isComposerPillEl(node)) {
        offset += composerPillPlainText(node).length;
      } else {
        for (const child of Array.from(node.childNodes)) {
          if (walk(child)) return true;
        }
      }
      return false;
    };
    walk(root);
    return offset;
  }

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
        if (s) void applySlashMenuItem(s);
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
    // Backspace / Delete on an @-mention or skill pill in the contenteditable:
    // remove the whole pill atomically — but ONLY when the cursor is
    // touching the pill (no characters in between). Otherwise the
    // user is editing text and Backspace should delete a character.
    if (e.key === "Backspace" || e.key === "Delete") {
      const ce = contentEditableRef.current;
      if (!ce) return;
      const sel = window.getSelection();
      if (!sel || !sel.rangeCount) return;
      const range = sel.getRangeAt(0);
      // Bail if there's a non-collapsed selection — let the default
      // delete handle the selection (which may or may not include a pill).
      if (!range.collapsed) return;
      let pill: HTMLElement | null = null;
      if (e.key === "Backspace") {
        // Delete the pill only when the cursor sits at the very start
        // of the text node immediately following the pill (i.e. zero
        // characters between cursor and pill).
        const node = range.startContainer;
        if (
          node.nodeType === Node.TEXT_NODE &&
          range.startOffset === 0 &&
          isComposerPillEl(node.previousSibling as Node)
        ) {
          pill = node.previousSibling as HTMLElement;
        } else if (isComposerPillEl(node) && range.startOffset === 0) {
          pill = node;
        }
      } else {
        // Delete: cursor must be at the very end of the text node
        // immediately preceding the pill to swallow the pill whole.
        const node = range.startContainer;
        if (
          node.nodeType === Node.TEXT_NODE &&
          range.startOffset === node.textContent?.length &&
          isComposerPillEl(node.nextSibling as Node)
        ) {
          pill = node.nextSibling as HTMLElement;
        } else if (
          isComposerPillEl(node) &&
          range.startOffset === node.childNodes.length
        ) {
          pill = node;
        }
      }
      if (pill && isComposerPillEl(pill)) {
        e.preventDefault();
        pill.remove();
        syncContentEditable();
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
      if (isBusyLike(snap.activity)) {
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

  const currentProviderName = useMemo(() => {
    if (!snap.modelId) return undefined;
    return modelKeyIndex[snap.modelId]?.providerName;
  }, [snap.modelId, modelKeyIndex]);

  // Provider IDs that may support balance/usage queries (exclude "builtin").
  const providerIdsForBalance = useMemo(
    () => modelGroups.map((g) => g.id).filter((id) => id !== "builtin"),
    [modelGroups],
  );

  // Fetch provider balance/usage for inline tab display; poll every 60 s.
  useEffect(() => {
    if (providerIdsForBalance.length === 0) return;
    let alive = true;
    const fetchOne = async (id: string) => {
      try {
        const r = await window.desktop.queryProviderUsage(id);
        if (alive) setProviderUsageMap((prev) => ({ ...prev, [id]: r }));
      } catch {
        /* silent — balance is best-effort decoration */
      }
    };
    void Promise.allSettled(providerIdsForBalance.map((id) => fetchOne(id)));
    const timer = setInterval(() => {
      void Promise.allSettled(
        providerIdsForBalance.map((id) => fetchOne(id)),
      );
    }, 60_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [providerIdsForBalance]);

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
      contentEditableRef.current?.focus();
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
    setRightPanelOpen((open) => !open);
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

  /**
   * Promote the hover-mode sidebar overlay into a pinned column
   * (used by the 📌 button inside the overlay — mirrors the right
   * panel's `pinRightPanel` affordance). Records the current hover
   * width so the pinned column opens at a sensible size when the
   * user has dragged the floating sidebar earlier.
   */
  const pinSidebar = useCallback(() => {
    sidebarHoverActiveRef.current = false;
    setSidebarHoverOpen(false);
    setPanelLayout((p) => ({
      ...p,
      sidebarPinned: true,
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
          {/*
            First row pairs the "新建会话" pill with an icon-only
            toggle on its right edge:
              - pinned+expanded  → "折叠侧栏" (collapse icon).
              - hover            → "固定打开" (pin glyph).
            Both buttons are title-tipped — no visible label, just an
            icon — so the row reads as one primary action + one
            secondary glyph. The MCP / 插件 rows follow below.
          */}
          <div className="sidebar-top-new">
            <button
              className="nav-btn primary sidebar-new-btn"
              onClick={() => void onNewSession()}
              title={m.newSession}
              aria-label={m.newSession}
            >
              <span className="icon">＋</span>
              <span className="nav-label">{m.newSession}</span>
            </button>
            {/*
              Both modes render an icon-only toggle next to the new
              session pill, so the row always has the same shape and
              the user can either way reach the chrome control. CSS
              hides whichever toggle isn't currently meaningful.
            */}
            <button
              className={`sidebar-collapse-btn ${
                mode === "pinned" && !panelLayout.sidebarCollapsed ? "" : "is-hidden"
              }`}
              onClick={collapseSidebar}
              title={`${m.sidebarCollapse} (Ctrl+B)`}
              aria-label={`${m.sidebarCollapse} (Ctrl+B)`}
              aria-hidden={
                !(mode === "pinned" && !panelLayout.sidebarCollapsed) || undefined
              }
              tabIndex={
                mode === "pinned" && !panelLayout.sidebarCollapsed ? 0 : -1
              }
            >
              <SidebarIcon name="collapse" />
            </button>
            <button
              className={`sidebar-pin-btn ${
                mode === "hover" ? "" : "is-hidden"
              }`}
              onClick={pinSidebar}
              title={m.sidePanelPin}
              aria-label={m.sidePanelPin}
              aria-hidden={mode !== "hover" || undefined}
              tabIndex={mode === "hover" ? 0 : -1}
            >
              <SidebarIcon name="pin" />
            </button>
          </div>
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
                const hitSummary = snap.sessions.find(
                  (s) => s.sessionId === hit.sessionId,
                );
                const hitStatus = hitSummary?.status;
                const hitReason = hitSummary?.needsInputReason;
                const statusLabel = sessionStatusLabel(hitStatus, hitReason, m);
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
                      <SessionStatusIcon
                        status={hitStatus}
                        reason={hitReason}
                        label={statusLabel}
                        isFocused={hit.sessionId === snap.sessionId}
                      />
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
                              const st = sessionStatusLabel(
                                s.status,
                                s.needsInputReason,
                                m,
                              );
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
                            reason={s.needsInputReason}
                            label={sessionStatusLabel(
                              s.status,
                              s.needsInputReason,
                              m,
                            )}
                            isFocused={s.sessionId === snap.sessionId}
                          />
                          <span className="session-title">
                            {s.title || m.untitledSession}
                          </span>
                          {s.status === "working" || s.status === "loading" ? (
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

  // Right-panel hover reveal. Mirrors the left edge behaviour: when the
  // pinned right panel is closed, hovering the right edge opens it as
  // a floating overlay. The overlay's `📌 固定` button promotes the
  // overlay into a permanent pinned slot.
  const [rightHoverOpen, setRightHoverOpen] = useState(false);
  const rightHoverActiveRef = useRef(false);
  useEffect(() => {
    if (rightPanelOpen) {
      // The pinned panel owns the right edge; hover reveal becomes a no-op.
      rightHoverActiveRef.current = false;
      setRightHoverOpen(false);
      return;
    }
    if (view !== "chat") {
      // Hide the overlay whenever we leave the chat view (settings/etc
      // own the chrome).
      rightHoverActiveRef.current = false;
      setRightHoverOpen(false);
      return;
    }
    const EDGE_PX = 8;
    const onMove = (e: MouseEvent) => {
      if (e.clientX >= window.innerWidth - EDGE_PX) {
        rightHoverActiveRef.current = true;
        setRightHoverOpen(true);
      }
    };
    document.addEventListener("mousemove", onMove);
    return () => {
      document.removeEventListener("mousemove", onMove);
    };
  }, [rightPanelOpen, view]);

  const pinRightPanel = useCallback(() => {
    rightHoverActiveRef.current = false;
    setRightPanelOpen(true);
  }, []);

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

      <WindowTitleBar />

      {panelLayout.sidebarPinned ? (
        panelLayout.sidebarCollapsed ? (
          <div className="sidebar-rail">
            <button
              type="button"
              className="sidebar-collapse-btn"
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
                <span className="chat-pane-caret" aria-hidden>
                  ▾
                </span>
                {hasSession ? (
                  <AgentActivityBadge
                    activity={snap.activity}
                    reason={snap.needsInputReason}
                    m={m}
                  />
                ) : null}
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
                        {renderUserMessageBody(
                          previewText(item.text, 240),
                          undefined,
                          skillByLower,
                        )}
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
                    {!snap.workspace && connectionReady ? (
                      <button
                        className="btn primary workspace-pick-btn"
                        onClick={() => void onBrowseWorkspace()}
                      >
                        {m.workspaceBrowse}
                      </button>
                    ) : null}
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
                ) : snap.replaying ? (
                  <div className="session-loading-wrap">
                    <span className="session-loading-spinner" aria-hidden />
                    <span className="session-loading-text">
                      {m.loadingConversation}
                    </span>
                  </div>
                ) : (
                  <ChatTimeline
                    timeline={snap.timeline}
                    replaying={Boolean(snap.replaying)}
                    flashMsgId={flashMsgId}
                    busy={Boolean(isBusyLike(snap.activity))}
                    m={m}
                    bottomRef={bottomRef}
                    onOpenAtFile={handleOpenAtFile}
                    onOpenLightbox={setLightbox}
                    skillByLower={skillByLower}
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
                <div className="composer-error">
                  {errorText}
                  {!snap.workspace ? (
                    <button
                      className="composer-error-action"
                      onClick={() => void onBrowseWorkspace()}
                    >
                      {m.workspaceBrowse}
                    </button>
                  ) : null}
                </div>
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
              {/* ask_user_question — composer-anchored panel (not fullscreen). */}
              {snap.pendingQuestion ? (
                <AskUserQuestionModal
                  request={snap.pendingQuestion}
                  m={m}
                  onSubmit={(response) => void onAskUserQuestion(response)}
                />
              ) : null}
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
              {!snap.pendingPlanApproval && snap.todos?.length && !(snap.goalState && snap.goalTodos?.length) ? (
                <PlanProgressBubble
                  todos={snap.todos}
                  m={m}
                  onOpenPanel={() => {
                    openPlanTab();
                  }}
                />
              ) : null}
              {/* Goal subsystem progress — TUI-style chip; click opens detail. */}
              {snap.goalState ? (
                <GoalProgressBubble
                  goal={snap.goalState}
                  m={m}
                  onOpenDetail={() => setGoalDetailOpen(true)}
                  onPause={() => void onGoalAction("pause")}
                  onResume={() => void onGoalAction("resume")}
                  onClear={() => void onGoalAction("clear")}
                />
              ) : null}
              {snap.goalState && goalDetailOpen ? (
                <GoalDetailModal
                  goal={snap.goalState}
                  goalTodos={snap.goalTodos ?? []}
                  m={m}
                  open={goalDetailOpen}
                  onClose={() => setGoalDetailOpen(false)}
                  onPause={() => void onGoalAction("pause")}
                  onResume={() => void onGoalAction("resume")}
                  onClear={() => {
                    setGoalDetailOpen(false);
                    void onGoalAction("clear");
                  }}
                />
              ) : null}

              <div className="composer-stack">
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
                      {isBusyLike(snap.activity) ? (
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
                      {attachments.map((a) => {
                        const isImage = a.kind === "image" && a.dataBase64;
                        return (
                          <span
                            className={`attach-chip${isImage ? " attach-chip-image" : ""}`}
                            key={a.id}
                            title={a.displayPath}
                          >
                            {isImage ? (
                              <img
                                className="attach-chip-thumb"
                                src={`data:${a.mimeType || "image/png"};base64,${a.dataBase64}`}
                                alt={a.name}
                              />
                            ) : (
                              <span className="attach-kind">
                                {a.kind === "image" ? "🖼" : "📄"}
                              </span>
                            )}
                            <span className="attach-chip-name">{a.name}</span>
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
                        );
                      })}
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
                        style={{ display: "none" }}
                      />
                      <div
                        ref={contentEditableRef}
                        className="composer-contenteditable"
                        contentEditable={
                          canCompose &&
                          !snap.replaying &&
                          !Boolean(snap.pendingPermission)
                        }
                        suppressContentEditableWarning
                        onInput={handleContentEditableInput}
                        onCompositionEnd={handleContentEditableInput}
                        onKeyDown={(e) => onKeyDown(e as any)}
                        onPaste={(e) => void onPaste(e as any)}
                        data-placeholder={
                          !connectionReady
                            ? m.placeholderWaiting
                            : !hasWorkspace
                              ? m.placeholderNeedWorkspace
                              : isBusyLike(snap.activity)
                                ? m.placeholderBusy
                                : m.placeholderReady
                        }
                      />
                      {slashSuggest && slashSuggest.length > 0 ? (
                        <div
                          ref={slashListRef}
                          className="at-suggest slash-suggest"
                        >
                          {slashSuggest.map((s, i) => {
                            const prev = i > 0 ? slashSuggest[i - 1] : null;
                            const showSection =
                              !prev || prev.section !== s.section;
                            return (
                              <div key={`${s.section}:${s.name}`}>
                                {showSection ? (
                                  <div className="slash-section">
                                    {s.section === "command"
                                      ? m.slashSectionCommands
                                      : m.slashSectionSkills}
                                  </div>
                                ) : null}
                                <button
                                  type="button"
                                  className={`at-item slash-item slash-item--${s.section} ${
                                    i === slashIndex ? "active" : ""
                                  }`}
                                  onMouseDown={(e) => {
                                    e.preventDefault();
                                    void applySlashMenuItem(s);
                                  }}
                                >
                                  <span className="slash-title-row">
                                    <span className="slash-title">
                                      {s.title}
                                    </span>
                                    {s.skillScopeLabel ? (
                                      <span
                                        className="slash-scope"
                                        title={s.skillScope}
                                      >
                                        {s.skillScopeLabel}
                                      </span>
                                    ) : null}
                                    {s.inputHint ? (
                                      <span className="slash-hint">
                                        {s.inputHint}
                                      </span>
                                    ) : null}
                                  </span>
                                  {s.description ? (
                                    <span className="slash-desc">
                                      {s.description}
                                    </span>
                                  ) : null}
                                </button>
                              </div>
                            );
                          })}
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
                          {atSuggest.map((s, i) => {
                            const isDir = s.isDir;
                            const slashIdx = s.path.lastIndexOf("/");
                            const name =
                              slashIdx >= 0
                                ? s.path.slice(slashIdx + 1)
                                : s.path;
                            const parent =
                              slashIdx > 0 ? s.path.slice(0, slashIdx) : "";
                            return (
                              <button
                                key={s.path}
                                className={`at-item ${i === atIndex ? "active" : ""}`}
                                onMouseDown={(e) => {
                                  e.preventDefault();
                                  insertAtPath(s.path, s.isDir);
                                }}
                              >
                                <span className="at-icon">
                                  {iconForPath(s.path, isDir)}
                                </span>
                                <span className="at-name">
                                  {name}
                                  {isDir ? "/" : ""}
                                </span>
                                {parent ? (
                                  <span className="at-parent">
                                    {parent}
                                  </span>
                                ) : null}
                              </button>
                            );
                          })}
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
                      <ComposerPlusMenu
                        m={m}
                        onPickFiles={() => void onPickFiles()}
                        onGoalMode={onGoalMode}
                        onPlanMode={() => void onSetMode("plan")}
                        disabled={
                          !canCompose ||
                          snap.replaying ||
                          Boolean(snap.pendingPermission)
                        }
                      />
                      {/* Session-mode chip (Agent / Plan / Ask) — moved from
                          the workspace bar above the composer into the
                          composer toolbar so the workspace picker can go. */}
                      <div className="chip-menu-wrap mode-chip-wrap">
                        <button
                          type="button"
                          className={`chip chip-btn mode-chip mode-${normalizedSessionMode}${
                            menu === "mode" ? " open" : ""
                          }`}
                          disabled={!connectionReady}
                          onClick={() =>
                            setMenu((cur) =>
                              cur === "mode" ? null : "mode",
                            )
                          }
                          title={`${m.sessionMode}: ${modeLabel}`}
                          aria-label={`${m.sessionMode}: ${modeLabel}`}
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
                              <circle cx="6" cy="6" r="2.25" />
                              <circle cx="18" cy="18" r="2.25" />
                              <path d="M8 7.2c4.5 0 5.5 3.3 5.5 6.3V15" />
                              <path d="M13.5 13.5 18 18" />
                            </svg>
                          </span>
                          <strong>{modeLabel}</strong>
                        </button>
                        {menu === "mode" ? (
                          <div
                            className="dropdown mode-dropdown"
                            role="dialog"
                            aria-label={m.sessionMode}
                          >
                            {/* Flat list — no approval/workflow split.
                                Render every mode as a single compact row. */}
                            {modes.map((mod) => {
                              const isActive =
                                mod.id === normalizedSessionMode;
                              return (
                                <button
                                  key={mod.id}
                                  type="button"
                                  className={[
                                    "dropdown-item",
                                    isActive && "active",
                                    mod.destructive && "destructive",
                                  ].filter(Boolean).join(" ")}
                                  aria-pressed={isActive}
                                  onClick={() => {
                                    void onSetMode(mod.id);
                                    setMenu(null);
                                  }}
                                >
                                  <span
                                    className="di-icon"
                                    aria-hidden="true"
                                  >
                                    <ModeOptionIcon id={mod.id} />
                                  </span>
                                  <span className="di-text">
                                    <span className="di-title">
                                      {mod.label}
                                    </span>
                                    <span className="di-desc">
                                      {mod.hint}
                                    </span>
                                  </span>
                                  <span className="di-check" aria-hidden="true">
                                    {isActive ? "✓" : ""}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        ) : null}
                      </div>
                      {/* One-shot goal / loop intent chips. */}
                      {goalActive ? (
                        <span className="chip goal-chip" title={m.goalChipHint}>
                          <span className="chip-leading-icon" aria-hidden="true">
                            <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                              <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.3" />
                              <circle cx="8" cy="8" r="2.5" fill="currentColor" />
                              <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                            </svg>
                          </span>
                          <strong>{m.goalChipLabel}</strong>
                          <button
                            type="button"
                            className="goal-chip-close"
                            title={m.goalChipDismiss}
                            aria-label={m.goalChipDismiss}
                            onClick={(e) => {
                              e.stopPropagation();
                              setGoalActive(false);
                            }}
                          >
                            ×
                          </button>
                        </span>
                      ) : null}
                      {loopActive ? (
                        <span className="chip loop-chip" title={m.loopChipHint}>
                          <span className="chip-leading-icon" aria-hidden="true">
                            <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                              <path
                                d="M12.5 8a4.5 4.5 0 1 1-1.4-3.2"
                                stroke="currentColor"
                                strokeWidth="1.3"
                                strokeLinecap="round"
                              />
                              <path
                                d="M12.5 3.5v3h-3"
                                stroke="currentColor"
                                strokeWidth="1.3"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                          </span>
                          <strong>{m.loopChipLabel}</strong>
                          <span className="loop-chip-interval-wrap">
                            <button
                              type="button"
                              className="loop-chip-interval"
                              aria-haspopup="listbox"
                              aria-expanded={loopIntervalMenuOpen}
                              title={m.loopIntervalPick}
                              onClick={(e) => {
                                e.stopPropagation();
                                setLoopIntervalMenuOpen((v) => !v);
                              }}
                            >
                              {loopInterval}
                              <span aria-hidden>▾</span>
                            </button>
                            {loopIntervalMenuOpen ? (
                              <div
                                className="dropdown loop-interval-menu"
                                role="listbox"
                              >
                                {LOOP_INTERVAL_PRESETS.map((iv) => (
                                  <button
                                    key={iv}
                                    type="button"
                                    role="option"
                                    className={`dropdown-item${
                                      iv === loopInterval ? " active" : ""
                                    }`}
                                    aria-selected={iv === loopInterval}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setLoopInterval(iv);
                                      setLoopIntervalMenuOpen(false);
                                    }}
                                  >
                                    {iv}
                                  </button>
                                ))}
                              </div>
                            ) : null}
                          </span>
                          <button
                            type="button"
                            className="goal-chip-close loop-chip-close"
                            title={m.loopChipDismiss}
                            aria-label={m.loopChipDismiss}
                            onClick={(e) => {
                              e.stopPropagation();
                              setLoopActive(false);
                              setLoopIntervalMenuOpen(false);
                            }}
                          >
                            ×
                          </button>
                        </span>
                      ) : null}
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
                                {snap.accountAvailable === false ? (
                                  <div
                                    className="dropdown-notice warn"
                                    role="note"
                                    title={m.accountRequiredForGrokHint}
                                  >
                                    {m.accountRequiredForGrokHint}
                                  </div>
                                ) : null}
                                {modelGroups.length === 0 ? (
                                  <div className="dropdown-empty">
                                    {m.modelsNoModelsInProvider}
                                  </div>
                                ) : (
                                  modelGroups.map((group) => {
                                    // Usage / balance next to provider label.
                                    let usageText: string | null = null;
                                    let usageHigh = false;
                                    if (group.id === "builtin") {
                                      // Grok built-in account → weekly/monthly limit %.
                                      const u = snap.usage;
                                      if (u && !u.error) {
                                        // Compact period label: "Weekly"→"7d", "Monthly"→"30d".
                                        const label = u.usageLabel;
                                        let prefix = "";
                                        if (label.includes("Week")) prefix = "7d";
                                        else if (label.includes("Month")) prefix = "30d";
                                        usageText = prefix
                                          ? `${prefix} ${u.usageShort}`
                                          : u.usageShort;
                                        usageHigh = u.usagePct >= 85;
                                      }
                                    } else {
                                      const u = providerUsageMap[group.id];
                                      if (u?.success) {
                                        if (u.balance) {
                                          const unit = u.balance.unit;
                                          const sym =
                                            unit === "CNY" ? "¥" : unit === "USD" ? "$" : unit;
                                          usageText = `${sym}${u.balance.remaining.toFixed(2)}`;
                                        } else if (u.quota) {
                                          const parts: string[] = [];
                                          const fh = u.quota.fiveHourPct;
                                          const sd = u.quota.sevenDayPct;
                                          if (fh != null) {
                                            parts.push(`5h ${Math.round(fh)}%`);
                                            if (fh >= 85) usageHigh = true;
                                          }
                                          if (sd != null) {
                                            parts.push(`7d ${Math.round(sd)}%`);
                                            if (sd >= 85) usageHigh = true;
                                          }
                                          if (parts.length > 0) {
                                            usageText = parts.join(" · ");
                                          }
                                        }
                                      }
                                    }
                                    return (
                                      <div
                                        key={group.id}
                                        className="model-group"
                                      >
                                        <div className="model-group-label">
                                          <span>{group.name}</span>
                                          {usageText ? (
                                            <span
                                              className={`model-group-usage${
                                                usageHigh ? " usage-high" : ""
                                              }`}
                                            >
                                              {usageText}
                                            </span>
                                          ) : null}
                                        </div>
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
                                    );
                                  })
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

                      {isBusyLike(snap.activity) ? (
                        <button
                          type="button"
                          className="icon-btn stop"
                          title={m.cancel}
                          onClick={() => void onCancel()}
                        >
                          ■
                        </button>
                      ) : null}
                      {isBusyLike(snap.activity) &&
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
                      ) : !isBusyLike(snap.activity) ? (
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

      {(rightOpen || rightHoverOpen) && view === "chat" ? (
        <aside
          className={rightOpen ? "right-panel" : "right-panel right-panel-hover"}
          aria-label={m.sidePanelToggle}
          onMouseEnter={() => {
            if (!rightOpen) rightHoverActiveRef.current = true;
          }}
          onMouseLeave={() => {
            if (!rightOpen) {
              rightHoverActiveRef.current = false;
              setRightHoverOpen(false);
            }
          }}
        >
          <div
            className="resize-handle resize-handle-right"
            role="separator"
            aria-orientation="vertical"
            aria-label={m.resizeRightPanel}
            title={m.resizeRightPanel}
            onPointerDown={onResizePointerDown("right")}
            onDoubleClick={() => setRightPanelOpen(false)}
          />
          {/* Two affordances depending on whether the panel is pinned
              or floating (hover mode). Close hides the pinned panel;
              "pin" promotes the overlay into a permanent slot so the
              user can read and resize it without the cursor leaving. */}
          {rightOpen ? (
            <button
              type="button"
              className="right-panel-close"
              onClick={toggleRightPanel}
              title={m.sidePanelToggleHide}
              aria-label={m.sidePanelToggleHide}
            >
              {/* Same rectangle-with-divider icon the left sidebar uses
                  (the "panel-collapsed" variant) — keeping the visual
                  language identical across both panel chrome. */}
              <SidebarIcon name="collapse" />
            </button>
          ) : (
            <button
              type="button"
              className="right-panel-pin"
              onClick={pinRightPanel}
              title={m.sidePanelPin}
              aria-label={m.sidePanelPin}
            >
              {/* Same rectangle-with-divider icon the left sidebar uses
                  (the "panel-pinned" variant) so the affordance family
                  is shared between left and right panel chrome. */}
              <SidebarIcon name="pin" />
            </button>
          )}
          <div className="right-panel-body">
            {/* Landing: no tabs yet — clear File / Terminal entry points. */}
            {rightPanelTabs.length === 0 ? (
              <div
                className="right-panel-landing"
                aria-label={m.sidePanelToggle}
              >
                <div className="right-panel-landing-title">
                  {m.sidePanelToggle}
                </div>
                <button
                  type="button"
                  className="right-panel-landing-cta"
                  onClick={() => {
                    setFileTreeCollapsed(false);
                    openFile("");
                  }}
                >
                  <span className="right-panel-landing-icon" aria-hidden>
                    <svg width="20" height="20" viewBox="0 0 16 16" fill="none">
                      <path
                        d="M2.5 4.2A1.2 1.2 0 0 1 3.7 3h2.4l1.1 1.3h5.1A1.2 1.2 0 0 1 13.5 5.5v6.3a1.2 1.2 0 0 1-1.2 1.2H3.7a1.2 1.2 0 0 1-1.2-1.2V4.2Z"
                        stroke="currentColor"
                        strokeWidth="1.2"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </span>
                  <span className="right-panel-landing-label">
                    {m.sidePanelFiles}
                  </span>
                  <span className="right-panel-landing-hint">
                    {m.openFileEmptyHint}
                  </span>
                </button>
                <button
                  type="button"
                  className="right-panel-landing-cta"
                  onClick={() => openTerminalTab()}
                >
                  <span className="right-panel-landing-icon" aria-hidden>
                    <svg width="20" height="20" viewBox="0 0 16 16" fill="none">
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
                  </span>
                  <span className="right-panel-landing-label">
                    {m.sidePanelTerminal}
                  </span>
                </button>
                <button
                  type="button"
                  className="right-panel-landing-cta"
                  onClick={() => openPlanTab()}
                >
                  <span className="right-panel-landing-icon" aria-hidden>
                    <svg width="20" height="20" viewBox="0 0 16 16" fill="none">
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
                  </span>
                  <span className="right-panel-landing-label">
                    {m.sidePanelPlan}
                  </span>
                </button>
              </div>
            ) : (
              <>
                <div className="right-panel-tabs" role="tablist">
                  {rightPanelTabs.map((tab) => {
                    const isActive = tab.id === activeTabId;
                    let label = "";
                    if (tab.kind === "files") {
                      label = tab.path
                        ? tab.path.split(/[/\\]/).pop() || tab.path
                        : m.openFileTitle;
                    } else if (tab.kind === "plan") {
                      label = m.sidePanelPlan;
                    } else {
                      // Show shell cwd on the outer tab (e.g. ~/Projects).
                      label = tab.cwd
                        ? formatTildePath(tab.cwd)
                        : m.sidePanelTerminal;
                    }
                    return (
                      <div
                        key={tab.id}
                        className={
                          "right-panel-tab" +
                          (isActive ? " active" : "") +
                          " kind-" +
                          tab.kind
                        }
                        onClick={() => setActiveTabId(tab.id)}
                        role="tab"
                        aria-selected={isActive}
                        title={
                          tab.kind === "files"
                            ? tab.path
                            : tab.kind === "terminal"
                              ? tab.cwd || label
                              : label
                        }
                      >
                        <span className="right-panel-tab-icon" aria-hidden>
                          {tab.kind === "files" ? (
                            <svg
                              width="13"
                              height="13"
                              viewBox="0 0 16 16"
                              fill="none"
                            >
                              <path
                                d="M2.5 4.2A1.2 1.2 0 0 1 3.7 3h2.4l1.1 1.3h5.1A1.2 1.2 0 0 1 13.5 5.5v6.3a1.2 1.2 0 0 1-1.2 1.2H3.7a1.2 1.2 0 0 1-1.2-1.2V4.2Z"
                                stroke="currentColor"
                                strokeWidth="1.2"
                                strokeLinejoin="round"
                              />
                            </svg>
                          ) : tab.kind === "plan" ? (
                            <svg
                              width="13"
                              height="13"
                              viewBox="0 0 16 16"
                              fill="none"
                            >
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
                            <svg
                              width="13"
                              height="13"
                              viewBox="0 0 16 16"
                              fill="none"
                            >
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

                  <div className="right-panel-tabs-plus-slot">
                    <RightPanelPlusMenu
                      m={m}
                      onPick={(kind) => {
                        if (kind === "terminal") {
                          openTerminalTab();
                        } else {
                          setFileTreeCollapsed(false);
                          openFile("");
                        }
                      }}
                      extraItems={[
                        {
                          id: "plan",
                          label: m.sidePanelPlan,
                          icon: "plan",
                          onPick: () => openPlanTab(),
                        },
                      ]}
                    />
                  </div>
                </div>

                <div className="right-panel-content">
                  {activeTab?.kind === "files" ? (
                    <FilesTabSection
                      workspace={snap.workspace}
                      m={m}
                      activeFilePath={activeTab.path}
                      treeCollapsed={fileTreeCollapsed}
                      fileTreeWidth={panelLayout.fileTreeWidth}
                      onClose={() => closeRightTab(activeTab.id)}
                      onNewFile={selectFileInActiveTab}
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
                      active={rightOpen && activeTab.kind === "terminal"}
                      m={m}
                      onCwdChange={(cwd) =>
                        setTerminalTabCwd(activeTab.id, cwd)
                      }
                    />
                  ) : null}
                </div>
              </>
            )}
          </div>
        </aside>
      ) : null}

      {lightbox ? (
        <ImageLightbox
          src={lightbox.src}
          name={lightbox.name}
          onClose={() => setLightbox(null)}
        />
      ) : null}
    </div>
  );
}
