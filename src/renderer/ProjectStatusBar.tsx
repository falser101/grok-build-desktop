import { memo, useEffect, useRef, useState } from "react";
import type { McpInitProgressUi } from "@shared/types";

export interface ProjectStatusBarProps {
  cwd?: string;
  gitBranch?: string;
  isWorktree?: boolean;
  /** Tilde-shortened main repo when in a linked worktree. */
  gitMainRepo?: string;
  /** MCP connecting / ready badge (TUI init chip + ready linger). */
  mcpInitProgress?: McpInitProgressUi;
  tokensUsed?: number;
  contextWindow?: number;
  modelId?: string;
  /** Localized labels for overflow menu */
  labels?: {
    more: string;
    path: string;
    branch: string;
    worktree: string;
    usage: string;
    model: string;
    mcp?: string;
  };
  /** Optional: click MCP badge (e.g. open Extensions → MCP). */
  onMcpClick?: () => void;
}

/** Always-available branch glyph (no Nerd Font / PUA dependency). */
function BranchIcon() {
  return (
    <svg
      className="status-git-icon"
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden
    >
      <path d="M11.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm-2.122.586a2.25 2.25 0 1 1 1.586 2.61c-.047.09-.094.18-.144.268L9.5 7.536V9.25a.75.75 0 0 1-1.5 0V7.536L6.43 5.964a2.25 2.25 0 1 1 .707-1.06L8 6.036l.863-1.132a2.267 2.267 0 0 1 .765-1.818ZM4.75 3.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Z" />
      <path d="M4.75 8.5a.75.75 0 0 0-.75.75v3.5a.75.75 0 0 0 1.5 0v-3.5a.75.75 0 0 0-.75-.75Z" />
    </svg>
  );
}

function pathBasename(cwd: string): string {
  const parts = cwd.split(/[/\\]/).filter(Boolean);
  return parts[parts.length - 1] || cwd;
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function useUsage(tokensUsed?: number, contextWindow?: number) {
  const hasContext =
    typeof tokensUsed === "number" &&
    typeof contextWindow === "number" &&
    contextWindow > 0;
  const usagePct = hasContext
    ? Math.min(100, Math.round((tokensUsed! / contextWindow!) * 100))
    : 0;
  let usageColor = "usage-ok";
  if (usagePct >= 80) usageColor = "usage-hot";
  else if (usagePct >= 50) usageColor = "usage-warm";
  return { hasContext, usagePct, usageColor };
}

/**
 * Left chrome — TUI status-bar order:
 *   branch · worktree · path · (worktree of main)
 */
export const ChromeStatusLeft = memo(function ChromeStatusLeft({
  cwd,
  gitBranch,
  isWorktree,
  gitMainRepo,
}: Pick<
  ProjectStatusBarProps,
  "cwd" | "gitBranch" | "isWorktree" | "gitMainRepo"
>) {
  const pathLabel = cwd || "";
  if (!pathLabel && !gitBranch && !isWorktree) return null;
  const base = pathLabel ? pathBasename(pathLabel) : "";
  const mainTitle =
    isWorktree && gitMainRepo ? `worktree of ${gitMainRepo}` : undefined;

  return (
    <div className="chat-chrome-left status-left" title={mainTitle}>
      {gitBranch ? (
        <span
          className="status-git-branch"
          title={mainTitle ? `Branch: ${gitBranch} · ${mainTitle}` : `Branch: ${gitBranch}`}
        >
          <BranchIcon />
          <span className="status-git-name">{gitBranch}</span>
        </span>
      ) : null}
      {isWorktree ? <span className="status-worktree">worktree</span> : null}
      {pathLabel ? (
        <>
          <span className="status-path status-path-full" title={pathLabel}>
            {pathLabel}
          </span>
          <span className="status-path status-path-base" title={pathLabel}>
            {base}
          </span>
        </>
      ) : null}
      {isWorktree && gitMainRepo ? (
        <span className="status-main-repo" title={gitMainRepo}>
          (worktree of {pathBasename(gitMainRepo)})
        </span>
      ) : null}
    </div>
  );
});

/** Right chrome: token usage + model (density-hideable) + overflow ⓘ menu. */
export const ChromeStatusRight = memo(function ChromeStatusRight({
  cwd,
  gitBranch,
  isWorktree,
  gitMainRepo,
  mcpInitProgress,
  tokensUsed,
  contextWindow,
  modelId,
  labels,
  onMcpClick,
}: ProjectStatusBarProps) {
  const { hasContext, usagePct, usageColor } = useUsage(
    tokensUsed,
    contextWindow,
  );
  const modelLabel = modelId || "";
  const mcp =
    mcpInitProgress &&
    (mcpInitProgress.phase === "connecting"
      ? mcpInitProgress.total > 0
      : mcpInitProgress.total > 0 ||
        (mcpInitProgress.toolCount != null && mcpInitProgress.toolCount > 0))
      ? mcpInitProgress
      : null;
  const mcpConnecting = mcp?.phase === "connecting";
  const [overflowOpen, setOverflowOpen] = useState(false);
  const overflowRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!overflowOpen) return;
    const onDoc = (e: Event) => {
      const root = overflowRef.current;
      if (!root) return;
      const target = e.target as Node | null;
      if (target && root.contains(target)) return;
      if (typeof (e as PointerEvent).composedPath === "function") {
        if ((e as PointerEvent).composedPath().includes(root)) return;
      }
      setOverflowOpen(false);
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setOverflowOpen(false);
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
  }, [overflowOpen]);

  const moreLabel = labels?.more ?? "Status details";
  const hasAnything =
    Boolean(cwd) ||
    Boolean(gitBranch) ||
    Boolean(isWorktree) ||
    Boolean(mcp) ||
    hasContext ||
    Boolean(modelLabel);

  if (!hasAnything) return null;

  let mcpTitle = labels?.mcp ?? "MCP";
  let mcpLabel = "MCP";
  if (mcp) {
    if (mcp.phase === "connecting") {
      mcpLabel = `MCP (${mcp.connected}/${mcp.total})`;
      mcpTitle = labels?.mcp
        ? `${labels.mcp} (${mcp.connected}/${mcp.total})`
        : `MCP connecting ${mcp.connected}/${mcp.total}`;
    } else if (mcp.total > 0) {
      mcpLabel = `MCP · ${mcp.total}`;
      mcpTitle =
        mcp.toolCount != null && mcp.toolCount > 0
          ? `MCP ready · ${mcp.total} server(s) · ${mcp.toolCount} tool(s)`
          : `MCP ready · ${mcp.total} server(s)`;
    } else if (mcp.toolCount != null && mcp.toolCount > 0) {
      mcpLabel = `MCP · ${mcp.toolCount} tools`;
      mcpTitle = `MCP ready · ${mcp.toolCount} tool(s)`;
    }
  }

  return (
    <div className="chat-chrome-status-right">
      {mcp ? (
        <button
          type="button"
          className={`status-mcp${mcpConnecting ? " is-connecting" : " is-ready"}`}
          title={mcpTitle}
          aria-label={mcpTitle}
          onClick={onMcpClick}
          disabled={!onMcpClick}
        >
          {mcpConnecting ? (
            <span className="status-mcp-spinner" aria-hidden />
          ) : (
            <span className="status-mcp-dot" aria-hidden />
          )}
          <span className="status-mcp-label">{mcpLabel}</span>
        </button>
      ) : null}
      {hasContext ? (
        <div
          className="status-usage"
          title={`${fmtTokens(tokensUsed!)} / ${fmtTokens(contextWindow!)} tokens`}
        >
          <span className="status-usage-label">
            {fmtTokens(tokensUsed!)} / {fmtTokens(contextWindow!)}
          </span>
          <div className="status-usage-bar">
            <div
              className={`status-usage-fill ${usageColor}`}
              style={{ width: `${usagePct}%` }}
            />
          </div>
          <span className="status-usage-pct">{usagePct}%</span>
        </div>
      ) : null}

      {modelLabel ? (
        <div className="status-model">
          <span className="status-model-dot" aria-hidden>
            ●
          </span>
          <span className="status-model-label" title={modelLabel}>
            {modelLabel}
          </span>
        </div>
      ) : null}

      <div className="chat-chrome-overflow" ref={overflowRef}>
        <button
          type="button"
          className={`chat-chrome-overflow-btn${overflowOpen ? " active" : ""}`}
          onClick={() => setOverflowOpen((v) => !v)}
          aria-haspopup="menu"
          aria-expanded={overflowOpen}
          title={moreLabel}
          aria-label={moreLabel}
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
            <circle cx="12" cy="12" r="9" />
            <path d="M12 16v-5" />
            <circle cx="12" cy="8" r="0.75" fill="currentColor" stroke="none" />
          </svg>
        </button>
        {overflowOpen ? (
          <div className="chat-chrome-overflow-menu" role="menu">
            {cwd ? (
              <div className="chat-chrome-overflow-row" role="menuitem">
                <span className="chat-chrome-overflow-k">
                  {labels?.path ?? "Path"}
                </span>
                <span className="chat-chrome-overflow-v" title={cwd}>
                  {cwd}
                </span>
              </div>
            ) : null}
            {gitBranch ? (
              <div className="chat-chrome-overflow-row" role="menuitem">
                <span className="chat-chrome-overflow-k">
                  {labels?.branch ?? "Branch"}
                </span>
                <span className="chat-chrome-overflow-v">{gitBranch}</span>
              </div>
            ) : null}
            {isWorktree ? (
              <div className="chat-chrome-overflow-row" role="menuitem">
                <span className="chat-chrome-overflow-k">
                  {labels?.worktree ?? "Worktree"}
                </span>
                <span className="chat-chrome-overflow-v">
                  {gitMainRepo ? `yes · ${gitMainRepo}` : "yes"}
                </span>
              </div>
            ) : null}
            {hasContext ? (
              <div className="chat-chrome-overflow-row" role="menuitem">
                <span className="chat-chrome-overflow-k">
                  {labels?.usage ?? "Usage"}
                </span>
                <span className="chat-chrome-overflow-v">
                  {fmtTokens(tokensUsed!)} / {fmtTokens(contextWindow!)} (
                  {usagePct}%)
                </span>
              </div>
            ) : null}
            {modelLabel ? (
              <div className="chat-chrome-overflow-row" role="menuitem">
                <span className="chat-chrome-overflow-k">
                  {labels?.model ?? "Model"}
                </span>
                <span className="chat-chrome-overflow-v">{modelLabel}</span>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
});

/**
 * Standalone full-width status bar (legacy). Prefer ChromeStatusLeft /
 * ChromeStatusRight inside the merged chat chrome.
 */
export const ProjectStatusBar = memo(function ProjectStatusBar(
  props: ProjectStatusBarProps,
) {
  return (
    <div
      className="project-status-bar"
      role="status"
      aria-label="Project status"
    >
      <ChromeStatusLeft
        cwd={props.cwd}
        gitBranch={props.gitBranch}
        isWorktree={props.isWorktree}
        gitMainRepo={props.gitMainRepo}
      />
      <ChromeStatusRight {...props} />
    </div>
  );
});
