import {
  memo,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import type { FileEntry } from "@shared/types";
import type { Messages } from "./i18n";

type Props = {
  workspace: string | undefined;
  selectedPath: string | null;
  onSelectFile: (path: string) => void;
  /** Close the files panel (Codex-style). */
  onClose?: () => void;
  m: Messages;
};

type NodeState = {
  loading?: boolean;
  children?: FileEntry[];
  error?: string;
};

/** Keep a callback's identity stable across renders for memoised children. */
function useLatestCallback<T extends (...args: never[]) => unknown>(cb: T): T {
  const ref = useRef(cb);
  ref.current = cb;
  return useCallback(((...args: Parameters<T>) => ref.current(...args)) as T, []);
}
function fileIconKind(entry: FileEntry): string {
  if (entry.isDir) return "dir";
  const ext = entry.name.includes(".")
    ? entry.name.slice(entry.name.lastIndexOf(".")).toLowerCase()
    : "";
  switch (ext) {
    case ".go":
      return "go";
    case ".ts":
    case ".tsx":
      return "ts";
    case ".js":
    case ".jsx":
    case ".mjs":
    case ".cjs":
      return "js";
    case ".json":
      return "json";
    case ".md":
    case ".mdx":
    case ".markdown":
      return "md";
    case ".py":
      return "py";
    case ".rs":
      return "rs";
    case ".css":
    case ".scss":
    case ".less":
      return "css";
    case ".html":
    case ".htm":
      return "html";
    case ".yml":
    case ".yaml":
    case ".toml":
      return "cfg";
    case ".png":
    case ".jpg":
    case ".jpeg":
    case ".gif":
    case ".svg":
    case ".webp":
      return "img";
    case ".dockerignore":
    case ".gitignore":
      return "git";
    case ".dockerfile":
      return "docker";
    default:
      if (entry.name === "Dockerfile" || entry.name === "Makefile") return "cfg";
      if (entry.name === "GOAL.md" || entry.name === "README.md") return "md";
      return "file";
  }
}

const TreeNodeInner = memo(function TreeNodeInner({
  entry,
  depth,
  selectedPath,
  expanded,
  childLoading,
  childError,
  childList,
  onToggle,
  onSelectFile,
  nodeState,
}: {
  entry: FileEntry;
  depth: number;
  selectedPath: string | null;
  expanded: Set<string>;
  childLoading: boolean;
  childError?: string;
  childList?: FileEntry[];
  onToggle: (path: string) => void;
  onSelectFile: (path: string) => void;
  nodeState: Record<string, NodeState>;
}) {
  const isOpen = entry.isDir && expanded.has(entry.path);
  const active = !entry.isDir && selectedPath === entry.path;

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (entry.isDir) onToggle(entry.path);
      else onSelectFile(entry.path);
    }
    if (e.key === "ArrowRight" && entry.isDir && !isOpen) {
      e.preventDefault();
      onToggle(entry.path);
    }
    if (e.key === "ArrowLeft" && entry.isDir && isOpen) {
      e.preventDefault();
      onToggle(entry.path);
    }
  };

  return (
    <>
      <button
        type="button"
        className={`file-tree-item ${active ? "active" : ""} ${
          entry.isDir ? "dir" : "file"
        }`}
        style={{ paddingLeft: 8 + depth * 12 }}
        title={entry.path || entry.name}
        onClick={() => {
          if (entry.isDir) onToggle(entry.path);
          else onSelectFile(entry.path);
        }}
        onKeyDown={onKey}
      >
        <span className="file-tree-chev" aria-hidden>
          {entry.isDir ? (isOpen ? "▾" : "▸") : ""}
        </span>
        <span
          className={`file-tree-icon kind-${fileIconKind(entry)}${
            entry.isDir && isOpen ? " open" : ""
          }`}
          aria-hidden
        />
        <span className="file-tree-name">{entry.name}</span>
      </button>
      {entry.isDir && isOpen ? (
        <div className="file-tree-children" role="group">
          {childLoading ? (
            <div
              className="file-tree-status"
              style={{ paddingLeft: 20 + depth * 12 }}
            >
              …
            </div>
          ) : null}
          {childError ? (
            <div
              className="file-tree-status error"
              style={{ paddingLeft: 20 + depth * 12 }}
            >
              {childError}
            </div>
          ) : null}
          {childList?.map((child) => (
            <TreeNode
              key={child.path}
              entry={child}
              depth={depth + 1}
              selectedPath={selectedPath}
              expanded={expanded}
              nodeState={nodeState}
              onToggle={onToggle}
              onSelectFile={onSelectFile}
            />
          ))}
        </div>
      ) : null}
    </>
  );
});

/**
 * Wrapper that resolves this node's child slice once (so the memo body can
 * extract only primitive props instead of taking the whole `nodeState`).
 */
const TreeNode = memo(function TreeNodeOuter({
  entry,
  depth,
  selectedPath,
  expanded,
  nodeState,
  onToggle,
  onSelectFile,
}: {
  entry: FileEntry;
  depth: number;
  selectedPath: string | null;
  expanded: Set<string>;
  nodeState: Record<string, NodeState>;
  onToggle: (path: string) => void;
  onSelectFile: (path: string) => void;
}) {
  const state = entry.isDir ? nodeState[entry.path] : undefined;
  return (
    <TreeNodeInner
      entry={entry}
      depth={depth}
      selectedPath={selectedPath}
      expanded={expanded}
      nodeState={nodeState}
      childLoading={Boolean(state?.loading)}
      childError={state?.error}
      childList={state?.children}
      onToggle={onToggle}
      onSelectFile={onSelectFile}
    />
  );
});

function FileTreeInner({
  workspace,
  selectedPath,
  onSelectFile,
  onClose,
  m,
}: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([""]));
  const [nodeState, setNodeState] = useState<Record<string, NodeState>>({});
  const [rootError, setRootError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  const loadDir = useCallback(async (relDir: string) => {
    setNodeState((s) => ({
      ...s,
      [relDir]: { ...s[relDir], loading: true, error: undefined },
    }));
    try {
      const children = await window.desktop.listDir(relDir || undefined);
      setNodeState((s) => ({
        ...s,
        [relDir]: { loading: false, children },
      }));
      setRootError(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!relDir) setRootError(msg);
      setNodeState((s) => ({
        ...s,
        [relDir]: { loading: false, error: msg, children: [] },
      }));
    }
  }, []);

  // Reload root when workspace changes.
  useEffect(() => {
    setExpanded(new Set([""]));
    setNodeState({});
    setRootError(null);
    setFilter("");
    if (!workspace) return;
    void loadDir("");
  }, [workspace, loadDir]);

  const onToggle = useCallback(
    (path: string) => {
      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(path)) {
          next.delete(path);
        } else {
          next.add(path);
          if (!nodeState[path]?.children && !nodeState[path]?.loading) {
            void loadDir(path);
          }
        }
        return next;
      });
    },
    [loadDir, nodeState],
  );

  // Ref-stable callbacks for memoised TreeNode — children re-render only
  // when their own data props change, not every parent render.
  const onToggleStable = useLatestCallback(onToggle);
  const onSelectFileStable = useLatestCallback(onSelectFile);

  const root = nodeState[""];
  const deferredFilter = useDeferredValue(filter);
  const q = deferredFilter.trim().toLowerCase();

  const visibleChildren = useMemo(
    () =>
      (root?.children ?? []).filter((e) => {
        if (!q) return true;
        return e.name.toLowerCase().includes(q);
      }),
    [root?.children, q],
  );

  const projectName = workspace
    ? workspace.replace(/\\/g, "/").split("/").filter(Boolean).pop() ||
      workspace
    : "";

  const refresh = () => {
    setNodeState({});
    void loadDir("");
    for (const p of expanded) {
      if (p) void loadDir(p);
    }
  };

  return (
    <div className="file-tree">
      <div className="file-tree-toolbar">
        <button type="button" className="file-tree-open-btn" title={workspace}>
          <span className="file-tree-open-icon" aria-hidden>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path
                d="M2.5 4.2A1.2 1.2 0 0 1 3.7 3h2.4l1.1 1.3h5.1A1.2 1.2 0 0 1 13.5 5.5v6.3a1.2 1.2 0 0 1-1.2 1.2H3.7a1.2 1.2 0 0 1-1.2-1.2V4.2Z"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <span className="file-tree-open-label">{m.openFileTitle}</span>
        </button>
        <div className="file-tree-toolbar-actions">
          <button
            type="button"
            className="file-tree-refresh"
            title={m.filesRefresh}
            aria-label={m.filesRefresh}
            onClick={refresh}
          >
            ↻
          </button>
          {onClose ? (
            <button
              type="button"
              className="file-tree-close"
              title={m.sidePanelToggleHide}
              aria-label={m.sidePanelToggleHide}
              onClick={onClose}
            >
              ×
            </button>
          ) : null}
        </div>
      </div>
      {!workspace ? (
        <div className="file-tree-empty">{m.filesNoWorkspace}</div>
      ) : (
        <>
          <div className="file-tree-project" title={workspace}>
            {projectName}
          </div>
          <div className="file-tree-filter">
            <span className="file-tree-filter-icon" aria-hidden>
              ⌕
            </span>
            <input
              type="search"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder={m.filesFilter}
              aria-label={m.filesFilter}
            />
          </div>
          <div className="file-tree-scroll" role="tree">
            {rootError ? (
              <div className="file-tree-empty error">{rootError}</div>
            ) : null}
            {root?.loading && !root.children ? (
              <div className="file-tree-empty">{m.filesLoading}</div>
            ) : null}
            {!root?.loading && visibleChildren.length === 0 && !rootError ? (
              <div className="file-tree-empty">
                {q ? m.filesNoMatch : m.filesEmpty}
              </div>
            ) : null}
            {visibleChildren.map((entry) => (
              <TreeNode
                key={entry.path}
                entry={entry}
                depth={0}
                selectedPath={selectedPath}
                expanded={expanded}
                nodeState={nodeState}
                onToggle={onToggleStable}
                onSelectFile={onSelectFileStable}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export const FileTree = memo(FileTreeInner);
