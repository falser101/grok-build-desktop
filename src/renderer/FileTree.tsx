import {
  memo,
  useCallback,
  useEffect,
  useState,
  type KeyboardEvent,
} from "react";
import type { FileEntry } from "@shared/types";
import type { Messages } from "./i18n";

type Props = {
  workspace: string | undefined;
  selectedPath: string | null;
  onSelectFile: (path: string) => void;
  m: Messages;
};

type NodeState = {
  loading?: boolean;
  children?: FileEntry[];
  error?: string;
};

function fileIcon(entry: FileEntry, open: boolean): string {
  if (entry.isDir) return open ? "📂" : "📁";
  const ext = entry.name.includes(".")
    ? entry.name.slice(entry.name.lastIndexOf(".")).toLowerCase()
    : "";
  switch (ext) {
    case ".go":
      return "🦫";
    case ".java":
    case ".kt":
      return "☕";
    case ".md":
    case ".mdx":
      return "📝";
    case ".css":
    case ".scss":
    case ".less":
      return "🎨";
    case ".vue":
    case ".html":
    case ".htm":
    case ".svelte":
      return "🌐";
    case ".ts":
    case ".tsx":
    case ".js":
    case ".jsx":
      return "📜";
    case ".json":
    case ".yaml":
    case ".yml":
    case ".toml":
      return "⚙️";
    case ".py":
      return "🐍";
    case ".rs":
      return "🦀";
    case ".png":
    case ".jpg":
    case ".jpeg":
    case ".gif":
    case ".svg":
    case ".webp":
      return "🖼";
    default:
      return "📄";
  }
}

function TreeNode({
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
  const isOpen = entry.isDir && expanded.has(entry.path);
  const state = nodeState[entry.path];
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
          {entry.isDir ? (isOpen ? "▾" : "▸") : " "}
        </span>
        <span className="file-tree-icon" aria-hidden>
          {fileIcon(entry, Boolean(isOpen))}
        </span>
        <span className="file-tree-name">{entry.name}</span>
      </button>
      {entry.isDir && isOpen ? (
        <div className="file-tree-children" role="group">
          {state?.loading ? (
            <div
              className="file-tree-status"
              style={{ paddingLeft: 20 + depth * 12 }}
            >
              …
            </div>
          ) : null}
          {state?.error ? (
            <div
              className="file-tree-status error"
              style={{ paddingLeft: 20 + depth * 12 }}
            >
              {state.error}
            </div>
          ) : null}
          {state?.children?.map((child) => (
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
}

function FileTreeInner({
  workspace,
  selectedPath,
  onSelectFile,
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

  const root = nodeState[""];
  const q = filter.trim().toLowerCase();

  const visibleChildren = (root?.children ?? []).filter((e) => {
    if (!q) return true;
    return e.name.toLowerCase().includes(q);
  });

  if (!workspace) {
    return (
      <div className="file-tree">
        <div className="file-tree-header">
          <span className="file-tree-title">{m.filesTitle}</span>
        </div>
        <div className="file-tree-empty">{m.filesNoWorkspace}</div>
      </div>
    );
  }

  const projectName =
    workspace.replace(/\\/g, "/").split("/").filter(Boolean).pop() ||
    workspace;

  return (
    <div className="file-tree">
      <div className="file-tree-header">
        <span className="file-tree-title" title={workspace}>
          {m.filesTitle}
        </span>
        <button
          type="button"
          className="file-tree-refresh"
          title={m.filesRefresh}
          aria-label={m.filesRefresh}
          onClick={() => {
            setNodeState({});
            void loadDir("");
            for (const p of expanded) {
              if (p) void loadDir(p);
            }
          }}
        >
          ↻
        </button>
      </div>
      <div className="file-tree-project" title={workspace}>
        {projectName}
      </div>
      <div className="file-tree-filter">
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
            onToggle={onToggle}
            onSelectFile={onSelectFile}
          />
        ))}
      </div>
    </div>
  );
}

export const FileTree = memo(FileTreeInner);
