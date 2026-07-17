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
  PathSuggestion,
  PermissionOptionKind,
  PermissionRequestUi,
  PromptAttachment,
  SessionModeId,
  SessionRunStatus,
  SessionSearchHit,
  SessionSummary,
  TimelineItem,
} from "@shared/types";
import type { Messages } from "./i18n";
import { MarkdownBody } from "./MarkdownBody";
import { AccountMenu } from "./AccountMenu";
import { ExtensionsView, type ExtTab } from "./ExtensionsView";
import { FileTree } from "./FileTree";
import { FileViewer } from "./FileViewer";
import { usePrefs } from "./PrefsContext";
import { SettingsView } from "./SettingsView";
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

const initial: AppSnapshot = {
  connection: "idle",
  timeline: [],
  sessions: [],
  availableModels: [],
  availableCommands: [],
  sessionMode: "default",
  acceptsImages: true,
  busy: false,
  alwaysApprove: false,
};

/** Panel resize limits (px). Drag below collapse threshold folds the panel. */
const SIDEBAR_DEFAULT = 260;
const SIDEBAR_MIN = 180;
const SIDEBAR_MAX = 480;
const SIDEBAR_COLLAPSE = 96;
const SIDEBAR_RAIL = 28;
const RIGHT_DEFAULT = 300;
const RIGHT_MIN = 200;
const RIGHT_MAX = 560;
const RIGHT_COLLAPSE = 96;
const LAYOUT_STORAGE_KEY = "grok-desktop-layout";

type PanelLayout = {
  sidebarWidth: number;
  sidebarCollapsed: boolean;
  rightPanelWidth: number;
};

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function loadPanelLayout(): PanelLayout {
  try {
    const raw = localStorage.getItem(LAYOUT_STORAGE_KEY);
    if (!raw) {
      return {
        sidebarWidth: SIDEBAR_DEFAULT,
        sidebarCollapsed: false,
        rightPanelWidth: RIGHT_DEFAULT,
      };
    }
    const p = JSON.parse(raw) as Partial<PanelLayout>;
    return {
      sidebarWidth: clamp(
        typeof p.sidebarWidth === "number" ? p.sidebarWidth : SIDEBAR_DEFAULT,
        SIDEBAR_MIN,
        SIDEBAR_MAX,
      ),
      sidebarCollapsed: Boolean(p.sidebarCollapsed),
      rightPanelWidth: clamp(
        typeof p.rightPanelWidth === "number"
          ? p.rightPanelWidth
          : RIGHT_DEFAULT,
        RIGHT_MIN,
        RIGHT_MAX,
      ),
    };
  } catch {
    return {
      sidebarWidth: SIDEBAR_DEFAULT,
      sidebarCollapsed: false,
      rightPanelWidth: RIGHT_DEFAULT,
    };
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
        className={`msg${highlight ? " msg-flash" : ""}`}
        id={msgDomId(item.id)}
      >
        <div className="msg-role user">{m.you}</div>
        <div className="msg-body">{item.text}</div>
      </div>
    );
  }
  if (item.kind === "assistant") {
    return (
      <div className="msg">
        <div className="msg-role assistant">{m.grok}</div>
        <MarkdownBody
          className="msg-body"
          text={item.text}
          streaming={item.streaming}
        />
      </div>
    );
  }
  if (item.kind === "thought") {
    return (
      <details className="thought">
        <summary>
          {item.streaming ? m.thoughtStreaming : m.thought}
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

/** Isolated so composer keystrokes don't re-render the whole timeline tree. */
const ChatTimeline = memo(function ChatTimeline({
  timeline,
  replaying,
  flashMsgId,
  m,
  bottomRef,
}: {
  timeline: TimelineItem[];
  replaying: boolean;
  flashMsgId: string | null;
  m: Messages;
  bottomRef: RefObject<HTMLDivElement | null>;
}) {
  return (
    <div className="timeline">
      {replaying ? (
        <div className="system-line">{m.loadingConversation}</div>
      ) : null}
      {timeline.map((item) => (
        <TimelineRow
          key={item.id}
          item={item}
          m={m}
          highlight={flashMsgId === item.id}
        />
      ))}
      <div ref={bottomRef} />
    </div>
  );
});

type MenuKind = "model" | "mode" | "effort" | null;
type MainView = "chat" | "settings" | "extensions";

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
  if (status === "needs_permission") return m.sessionStatusNeedsPermission;
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
  if (status === "needs_permission") {
    return (
      <span
        className="session-status-dot"
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
  const [menu, setMenu] = useState<MenuKind>(null);
  const [view, setView] = useState<MainView>("chat");
  const [extTab, setExtTab] = useState<ExtTab>("mcp");
  const [dragOver, setDragOver] = useState(false);
  const [attachments, setAttachments] = useState<PromptAttachment[]>([]);
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
  /** Right side panel (files / terminal). */
  const [rightPanelOpen, setRightPanelOpen] = useState(false);
  const [rightPanelTab, setRightPanelTab] = useState<"files" | "terminal">(
    "files",
  );
  const [panelLayout, setPanelLayout] = useState<PanelLayout>(() =>
    loadPanelLayout(),
  );
  const [resizingSide, setResizingSide] = useState<"left" | "right" | null>(
    null,
  );
  /** Workspace picker menu above the composer. */
  const [wsMenuOpen, setWsMenuOpen] = useState(false);
  const [accountStatus, setAccountStatus] = useState<AccountStatus | null>(
    null,
  );
  const [accountBusy, setAccountBusy] = useState(false);
  /** Currently previewed workspace-relative file path. */
  const [openFilePath, setOpenFilePath] = useState<string | null>(null);
  /** Timeline message id briefly highlighted after pin click. */
  const [flashMsgId, setFlashMsgId] = useState<string | null>(null);
  /**
   * User message that owns the current scroll position (sticky header).
   * Updates as you scroll past each user turn — not always "latest turn".
   */
  const [pinnedUser, setPinnedUser] = useState<UserTimelineItem | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const chatPaneRef = useRef<HTMLDivElement | null>(null);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pinScrollRafRef = useRef<number | null>(null);
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
    side: "left" | "right";
    startX: number;
    startW: number;
    /** Live width applied to DOM during drag (no React re-render). */
    liveW: number;
    rightOpen: boolean;
  } | null>(null);
  const panelLayoutRef = useRef(panelLayout);
  panelLayoutRef.current = panelLayout;
  const rightPanelOpenRef = useRef(rightPanelOpen);
  rightPanelOpenRef.current = rightPanelOpen;
  const viewRef = useRef(view);
  viewRef.current = view;

  // Persist panel widths / collapse (skip while actively dragging).
  useEffect(() => {
    if (resizingSide) return;
    savePanelLayout(panelLayout);
  }, [panelLayout, resizingSide]);

  const maxSidebarW = useCallback(() => {
    if (typeof window === "undefined") return SIDEBAR_MAX;
    return Math.min(SIDEBAR_MAX, Math.floor(window.innerWidth * 0.42));
  }, []);
  const maxRightW = useCallback(() => {
    if (typeof window === "undefined") return RIGHT_MAX;
    return Math.min(RIGHT_MAX, Math.floor(window.innerWidth * 0.48));
  }, []);

  /** Apply grid columns directly on the shell node — no React re-render. */
  const applyShellColumns = useCallback(
    (leftPx: number, rightPx: number | null) => {
      const el = shellRef.current;
      if (!el) return;
      el.style.setProperty("--sidebar-w", `${leftPx}px`);
      if (rightPx != null) {
        el.style.setProperty("--right-panel-w", `${rightPx}px`);
        el.style.gridTemplateColumns = `${leftPx}px minmax(0, 1fr) ${rightPx}px`;
      } else {
        el.style.setProperty("--right-panel-w", "0px");
        el.style.gridTemplateColumns = `${leftPx}px minmax(0, 1fr)`;
      }
    },
    [],
  );

  // Sync React layout state → DOM when not dragging.
  // (During drag, pointer handlers own the grid columns via applyShellColumns.)
  useLayoutEffect(() => {
    if (resizeDragRef.current) return;
    const leftPx = panelLayout.sidebarCollapsed
      ? SIDEBAR_RAIL
      : panelLayout.sidebarWidth;
    const rightPx =
      rightPanelOpen && view === "chat" ? panelLayout.rightPanelWidth : null;
    applyShellColumns(leftPx, rightPx);
  }, [
    applyShellColumns,
    panelLayout.sidebarCollapsed,
    panelLayout.sidebarWidth,
    panelLayout.rightPanelWidth,
    rightPanelOpen,
    view,
  ]);

  const onResizePointerDown = useCallback(
    (side: "left" | "right") => (e: ReactPointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      const layout = panelLayoutRef.current;
      const rightOpenNow =
        rightPanelOpenRef.current && viewRef.current === "chat";
      const startW =
        side === "left" ? layout.sidebarWidth : layout.rightPanelWidth;
      // Set drag ref BEFORE any setState so layout effects skip overwriting.
      resizeDragRef.current = {
        side,
        startX: e.clientX,
        startW,
        liveW: startW,
        rightOpen: rightOpenNow,
      };
      setResizingSide(side);
      document.body.classList.add("is-resizing-panels");

      const leftFixed = layout.sidebarCollapsed
        ? SIDEBAR_RAIL
        : layout.sidebarWidth;
      const rightFixed = layout.rightPanelWidth;

      const paint = (clientX: number) => {
        const drag = resizeDragRef.current;
        if (!drag) return;
        if (drag.side === "left") {
          const raw = drag.startW + (clientX - drag.startX);
          const next = clamp(raw, SIDEBAR_COLLAPSE * 0.45, maxSidebarW());
          drag.liveW = next;
          applyShellColumns(next, drag.rightOpen ? rightFixed : null);
        } else {
          const raw = drag.startW - (clientX - drag.startX);
          const next = clamp(raw, RIGHT_COLLAPSE * 0.45, maxRightW());
          drag.liveW = next;
          applyShellColumns(leftFixed, next);
        }
      };

      const onMove = (ev: PointerEvent) => {
        // Direct DOM write — follows cursor without waiting for React/rAF.
        paint(ev.clientX);
      };

      const onUp = () => {
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
        document.removeEventListener("pointercancel", onUp);

        const drag = resizeDragRef.current;
        document.body.classList.remove("is-resizing-panels");
        if (!drag) {
          setResizingSide(null);
          return;
        }

        const live = drag.liveW;
        // Clear drag BEFORE setState so useLayoutEffect can apply final columns.
        resizeDragRef.current = null;
        setResizingSide(null);

        if (drag.side === "left") {
          if (live < SIDEBAR_COLLAPSE) {
            setPanelLayout((prev) => ({
              ...prev,
              sidebarCollapsed: true,
              sidebarWidth: clamp(
                drag.startW >= SIDEBAR_MIN ? drag.startW : SIDEBAR_DEFAULT,
                SIDEBAR_MIN,
                maxSidebarW(),
              ),
            }));
          } else {
            setPanelLayout((prev) => ({
              ...prev,
              sidebarCollapsed: false,
              sidebarWidth: clamp(live, SIDEBAR_MIN, maxSidebarW()),
            }));
          }
        } else if (live < RIGHT_COLLAPSE) {
          setRightPanelOpen(false);
          setPanelLayout((prev) => ({
            ...prev,
            rightPanelWidth: clamp(
              drag.startW >= RIGHT_MIN ? drag.startW : RIGHT_DEFAULT,
              RIGHT_MIN,
              maxRightW(),
            ),
          }));
        } else {
          setPanelLayout((prev) => ({
            ...prev,
            rightPanelWidth: clamp(live, RIGHT_MIN, maxRightW()),
          }));
        }
      };

      document.addEventListener("pointermove", onMove, { passive: true });
      document.addEventListener("pointerup", onUp);
      document.addEventListener("pointercancel", onUp);
    },
    [applyShellColumns, maxRightW, maxSidebarW],
  );

  // Close file preview when workspace changes.
  useEffect(() => {
    setOpenFilePath(null);
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
  useEffect(() => {
    const p = snap.pendingPermission;
    if (!p) return;
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
  }, [snap.pendingPermission, permIndex]);

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
  }, [userTimelineItems, snap.replaying, snap.sessionId]);

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

  const jumpToPinnedUser = useCallback(() => {
    if (!pinnedUser) return;
    const el = document.getElementById(msgDomId(pinnedUser.id));
    if (!el) return;
    // Don't fight auto-stick while the user is inspecting their prompt.
    stickToBottomRef.current = false;
    // Keep this turn on the pin; ignore scroll events from scrollIntoView.
    pinHoldIdRef.current = pinnedUser.id;
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
    setFlashMsgId(pinnedUser.id);
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    flashTimerRef.current = setTimeout(() => {
      setFlashMsgId((id) => (id === pinnedUser.id ? null : id));
      flashTimerRef.current = null;
    }, 1600);
  }, [pinnedUser]);

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
  const modeLabel =
    modes.find((mod) => mod.id === snap.sessionMode)?.label ?? m.modeAgent;

  const connectionReady = snap.connection === "ready";
  const hasWorkspace = Boolean(snap.workspace);
  const hasSession = Boolean(snap.sessionId);
  const showHome = !hasSession || snap.timeline.length === 0;
  const workspaceName = snap.workspace
    ? projectFromCwd(snap.workspace)
    : null;
  const canCompose = connectionReady && hasWorkspace;
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
    setOpenFilePath(null);
    try {
      await window.desktop.prepareNewChat();
      textareaRef.current?.focus();
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : String(err));
    }
  }, []);

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

  const onSend = useCallback(async () => {
    const text = (textareaRef.current?.value ?? draftRef.current).trim();
    if (!text && attachments.length === 0) return;
    setLocalError(null);
    setSlashSuggest(null);
    setAtSuggest(null);

    // Local slash commands (/new, /model, …) before going to the agent.
    if (text.startsWith("/") && attachments.length === 0) {
      try {
        const result = await tryHandleLocalSlash(text, {
          models: snap.availableModels,
          modelId: snap.modelId,
          workspace: snap.workspace,
          alwaysApprove: snap.alwaysApprove,
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
          const ok = await ensureSession();
          if (!ok) return;
          await window.desktop.sendPrompt({ text: follow });
          return;
        }
        // passthrough → agent
      } catch (err) {
        setLocalError(err instanceof Error ? err.message : String(err));
        return;
      }
    }

    try {
      const ok = await ensureSession();
      if (!ok) return;
      clearComposerText();
      setAttachments([]);
      await window.desktop.sendPrompt({ text, attachments });
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : String(err));
    }
  }, [
    attachments,
    ensureSession,
    clearComposerText,
    snap.availableModels,
    snap.modelId,
    snap.workspace,
    snap.alwaysApprove,
  ]);

  const onCancel = useCallback(async () => {
    try {
      await window.desktop.cancel();
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : String(err));
    }
  }, []);

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

  const onRetryConnect = useCallback(async () => {
    setLocalError(null);
    try {
      await window.desktop.connect();
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : String(err));
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
      if (!connectionReady || snap.busy || snap.replaying) return;
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
    [
      connectionReady,
      snap.busy,
      snap.replaying,
      snap.acceptsImages,
      mergeAttachments,
    ],
  );

  const openExtensions = useCallback((tab: ExtTab) => {
    setExtTab(tab);
    setView("extensions");
  }, []);

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
    if (e.key === "Escape" && menu) {
      e.preventDefault();
      setMenu(null);
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (canCompose && !snap.busy && !snap.replaying) {
        void onSend();
      }
    }
  };

  const modelChipLabel = currentModel?.name || snap.modelId || "Model";
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
  const effortLabel =
    snap.reasoningEffort || currentModel?.reasoningEffort || m.effort;

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

  return (
    <div
      ref={shellRef}
      className={`shell ${rightOpen ? "shell-right-open" : ""} ${
        panelLayout.sidebarCollapsed ? "shell-sidebar-collapsed" : ""
      } ${resizingSide ? `shell-resizing shell-resizing-${resizingSide}` : ""} ${
        openFilePath && view === "chat" ? "shell-viewer-open" : ""
      }`}
    >
      {loading && view === "chat" ? <div className="loading-bar" /> : null}

      {panelLayout.sidebarCollapsed ? (
        <div className="sidebar-rail">
          <button
            type="button"
            className="sidebar-rail-btn"
            title={m.sidebarExpand}
            aria-label={m.sidebarExpand}
            onClick={() =>
              setPanelLayout((p) => ({ ...p, sidebarCollapsed: false }))
            }
          >
            <span className="sidebar-rail-icon" aria-hidden>
              <span />
              <span />
              <span />
            </span>
          </button>
        </div>
      ) : (
      <aside className="sidebar">
        <div className="sidebar-top">
          <button
            className="nav-btn primary"
            onClick={() => void onNewSession()}
          >
            <span className="icon">＋</span>
            {m.newSession}
          </button>
          <button
            className={`nav-btn ${view === "extensions" && extTab === "mcp" ? "active" : ""}`}
            onClick={() => openExtensions("mcp")}
            title={m.navMcp}
          >
            <span className="icon">🔌</span>
            {m.navMcp}
          </button>
          <button
            className={`nav-btn ${view === "extensions" && extTab !== "mcp" ? "active" : ""}`}
            onClick={() => openExtensions("skills")}
            title={m.navExtensions}
          >
            <span className="icon">🧩</span>
            {m.navExtensions}
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
        <div
          className="resize-handle resize-handle-left"
          role="separator"
          aria-orientation="vertical"
          aria-label={m.resizeSidebar}
          title={m.resizeSidebar}
          onPointerDown={onResizePointerDown("left")}
          onDoubleClick={() =>
            setPanelLayout((p) => ({ ...p, sidebarCollapsed: true }))
          }
        />
      </aside>
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
              usage={snap.usage}
              onRefreshUsage={async () => {
                await window.desktop.refreshUsage();
              }}
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
            {/* Outside the rail so it sits on the true main top-right. */}
            <button
              type="button"
              className={`chat-topbar-btn chat-side-toggle ${
                rightPanelOpen ? "active" : ""
              }`}
              onClick={() => setRightPanelOpen((v) => !v)}
              title={
                rightPanelOpen ? m.sidePanelToggleHide : m.sidePanelToggle
              }
              aria-pressed={rightPanelOpen}
            >
              <span className="icon">☰</span>
              {m.sidePanelToggle}
            </button>
            {/* One column: pin + timeline + composer share identical width. */}
            <div
              className={`chat-rail${openFilePath ? " with-viewer" : ""}`}
            >
            <div className="chat-topbar">
              {pinnedUser && !showHome && !snap.replaying ? (
                <button
                  type="button"
                  className={`current-turn-pin${
                    snap.busy &&
                    userTimelineItems[userTimelineItems.length - 1]?.id ===
                      pinnedUser.id
                      ? " is-busy"
                      : ""
                  }`}
                  onClick={jumpToPinnedUser}
                  title={m.currentTurnPinHint}
                  aria-label={`${m.currentTurnPinHint}: ${previewText(pinnedUser.text, 200)}`}
                >
                  <span className="current-turn-pin-label">
                    {m.currentTurnPin}
                  </span>
                  <span className="current-turn-pin-text">
                    {previewText(pinnedUser.text)}
                  </span>
                  <span className="current-turn-pin-go" aria-hidden>
                    ↵
                  </span>
                </button>
              ) : null}
            </div>
            <div
              className={`main-work ${openFilePath ? "with-viewer" : ""}`}
            >
              <div
                className="main-scroll chat-pane"
                ref={chatPaneRef}
                onScroll={() => {
                  const el = chatPaneRef.current;
                  if (!el) return;
                  const dist =
                    el.scrollHeight - el.scrollTop - el.clientHeight;
                  stickToBottomRef.current = dist < 96;
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
                        <strong>{m.cantReachAgent}</strong>
                        {errorText}
                        <div className="actions">
                          <button
                            className="btn"
                            onClick={() => void onRetryConnect()}
                          >
                            {m.retryConnect}
                          </button>
                          <button
                            className="btn primary"
                            onClick={() => void onNewSession()}
                          >
                            {m.newSession}
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <ChatTimeline
                    timeline={snap.timeline}
                    replaying={Boolean(snap.replaying)}
                    flashMsgId={flashMsgId}
                    m={m}
                    bottomRef={bottomRef}
                  />
                )}
              </div>
              {openFilePath ? (
                <div className="viewer-pane">
                  <FileViewer
                    path={openFilePath}
                    m={m}
                    onClose={() => setOpenFilePath(null)}
                    onInsertMention={insertFileMention}
                  />
                </div>
              ) : null}
            </div>

            <div className="composer-wrap">
              {errorText && !showHome ? (
                <div className="composer-error">{errorText}</div>
              ) : null}
              {snap.pendingPermission ? (
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
                      className={`ws-meta-chip ws-meta-btn ${
                        menu === "mode" ? "open" : ""
                      }`}
                      disabled={!connectionReady}
                      onClick={() =>
                        setMenu((cur) => (cur === "mode" ? null : "mode"))
                      }
                      title={m.sessionMode}
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
                      <span>{modeLabel}</span>
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

                <div
                  className={`composer ${
                    snap.pendingPermission ? "composer-dimmed" : ""
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
                              : m.placeholderReady
                        }
                        disabled={
                          !canCompose ||
                          snap.busy ||
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
                        disabled={!canCompose || snap.busy}
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
                          onClick={() =>
                            setMenu((cur) =>
                              cur === "model" ? null : "model",
                            )
                          }
                          title={m.switchModel}
                        >
                          <strong>{modelChipLabel}</strong>
                        </button>
                        {menu === "model" ? (
                          <div className="dropdown dropdown-end">
                            {snap.availableModels.length === 0 ? (
                              <div className="dropdown-empty">
                                {m.openSessionForModels}
                              </div>
                            ) : (
                              snap.availableModels.map((mod) => (
                                <button
                                  key={mod.modelId}
                                  className={`dropdown-item ${
                                    mod.modelId === snap.modelId ? "active" : ""
                                  }`}
                                  onClick={() => {
                                    void onSetModel(mod.modelId);
                                    setMenu(null);
                                  }}
                                >
                                  <span className="di-title">{mod.name}</span>
                                  {mod.description ? (
                                    <span className="di-desc">
                                      {mod.description}
                                    </span>
                                  ) : null}
                                </button>
                              ))
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
                                  <span className="di-title">{e.label}</span>
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
                      ) : (
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
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
            </div>
          </div>
        )}
      </section>

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
          <div className="right-panel-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              className={`right-panel-tab ${
                rightPanelTab === "files" ? "active" : ""
              }`}
              aria-selected={rightPanelTab === "files"}
              onClick={() => setRightPanelTab("files")}
            >
              {m.sidePanelFiles}
            </button>
            <button
              type="button"
              role="tab"
              className={`right-panel-tab ${
                rightPanelTab === "terminal" ? "active" : ""
              }`}
              aria-selected={rightPanelTab === "terminal"}
              onClick={() => setRightPanelTab("terminal")}
            >
              {m.sidePanelTerminal}
            </button>
            <button
              type="button"
              className="right-panel-close"
              title={m.sidePanelToggleHide}
              onClick={() => setRightPanelOpen(false)}
            >
              ×
            </button>
          </div>
          <div className="right-panel-body">
            {rightPanelTab === "files" ? (
              <FileTree
                workspace={snap.workspace}
                selectedPath={openFilePath}
                onSelectFile={(p) => {
                  setOpenFilePath(p);
                }}
                m={m}
              />
            ) : (
              <TerminalPanel
                workspace={snap.workspace}
                active={rightOpen && rightPanelTab === "terminal"}
                m={m}
              />
            )}
          </div>
        </aside>
      ) : null}
    </div>
  );
}
