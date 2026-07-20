import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ExternalEditorDescriptor } from "@shared/types";
import type { Messages } from "./i18n";
import { FileTree } from "./FileTree";
import { FileViewer } from "./FileViewer";

interface FilesTabSectionProps {
  workspace: string | undefined;
  m: Messages;
  /** Absolute path of the file currently displayed in the editor pane. */
  activeFilePath: string;
  /** True when the inline file-tree pane is folded to its narrow rail. */
  treeCollapsed: boolean;
  /** Width of the tree pane in % of the right panel's inner width. */
  fileTreeWidth: number;
  /** Notify the host that the user wants to dismiss this file tab. */
  onClose: () => void;
  /** Called when the user picks a different path from the file tree. */
  onNewFile: (path: string) => void;
  onSetFileTreeCollapsed: (collapsed: boolean) => void;
  /** Drag-handle callback wired to the host's `onResizePointerDown`. */
  onResizePointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
  onInsertMention?: (path: string) => void;
}

/**
 * Right-panel files section body — file-row toolbar + editor + tree.
 *
 *   ┌─ file-row toolbar ────────────────────────────────────────┐
 *   │  ~/tests/compliance.test.mjs   [open ▾]  [tree ▸/◂]      │
 *   ├─ editor pane ────────────────┬─ tree pane (collapsible) ─┤
 *   │ <FileViewer>                 │ <FileTree>              │
 *   └──────────────────────────────┴─────────────────────────┘
 *
 * The top tab bar (file/plan/terminal chips + `+` menu) is rendered
 * separately by App.tsx; this component only owns the file-row toolbar
 * and the editor/tree split.
 */
function FilesTabSectionInner({
  workspace,
  m,
  activeFilePath,
  treeCollapsed,
  fileTreeWidth,
  onClose,
  onNewFile,
  onSetFileTreeCollapsed,
  onResizePointerDown,
  onInsertMention,
}: FilesTabSectionProps) {
  /** Available editors — fetched once on mount. */
  const [editors, setEditors] = useState<ExternalEditorDescriptor[]>([]);
  const [editorMenuOpen, setEditorMenuOpen] = useState(false);
  const editorMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    void window.desktop.listExternalEditors().then((list) => {
      if (!cancelled) setEditors(list);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!editorMenuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (
        editorMenuRef.current &&
        !editorMenuRef.current.contains(e.target as Node)
      ) {
        setEditorMenuOpen(false);
      }
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") setEditorMenuOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [editorMenuOpen]);

  const editorLabel = useCallback(
    (id: string): string => {
      switch (id) {
        case "vscode":
          return m.filesEditorVscode;
        case "vscode-insiders":
          return m.filesEditorVscodeInsiders;
        case "cursor":
          return m.filesEditorCursor;
        case "sublime":
          return m.filesEditorSublime;
        case "zed":
          return m.filesEditorZed;
        case "webstorm":
          return m.filesEditorWebstorm;
        case "system-default":
          return m.filesEditorSystemDefault;
        default:
          return id;
      }
    },
    [m],
  );

  const breadcrumb = useMemo(() => {
    if (!workspace) return activeFilePath;
    if (activeFilePath.startsWith(workspace)) {
      const tail = activeFilePath
        .slice(workspace.length)
        .replace(/^[/\\]/, "");
      if (tail) return tail;
    }
    return activeFilePath;
  }, [activeFilePath, workspace]);

  const openInEditor = useCallback(
    (id: string) => {
      setEditorMenuOpen(false);
      if (!activeFilePath) return;
      void window.desktop
        .openInEditor(id, activeFilePath)
        .catch((err: unknown) => {
          // eslint-disable-next-line no-console
          console.error("[files] openInEditor failed:", err);
        });
    },
    [activeFilePath],
  );

  return (
    <div className="files-section-root">
      {/* File-row toolbar: breadcrumb · open-in-editor · tree toggle */}
      <header className="files-section-toolbar">
        <span className="files-section-breadcrumb" title={activeFilePath}>
          {breadcrumb}
        </span>
        <div className="files-section-divider" aria-hidden />

        <div className="files-section-editor-wrap" ref={editorMenuRef}>
          <button
            type="button"
            className="files-section-editor-btn"
            onClick={() => setEditorMenuOpen((v) => !v)}
            title={m.filesOpenInEditorTooltip}
            aria-label={m.filesOpenInEditorTooltip}
            aria-haspopup="menu"
            aria-expanded={editorMenuOpen}
            disabled={!activeFilePath}
          >
            <span className="files-section-editor-icon" aria-hidden>
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                <path
                  d="M2.5 4.2A1.2 1.2 0 0 1 3.7 3h2.4l1.1 1.3h5.1A1.2 1.2 0 0 1 13.5 5.5v6.3a1.2 1.2 0 0 1-1.2 1.2H3.7a1.2 1.2 0 0 1-1.2-1.2V4.2Z"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  strokeLinejoin="round"
                />
                <path
                  d="m6 8.5 1.2 1.2L6 10.9"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
            <span>{m.filesOpenInEditorTooltip}</span>
          </button>
          {editorMenuOpen ? (
            <div className="dropdown" role="menu">
              {editors.map((e) => (
                <button
                  key={e.id}
                  type="button"
                  className="dropdown-item"
                  role="menuitem"
                  onClick={() => openInEditor(e.id)}
                >
                  {editorLabel(e.id)}
                </button>
              ))}
              {editors.length === 0 ? (
                <div className="dropdown-empty">
                  {m.filesOpenInEditorTooltip}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        <button
          type="button"
          className="files-section-toggle-tree"
          onClick={() => onSetFileTreeCollapsed(!treeCollapsed)}
          title={
            treeCollapsed
              ? m.filesExpandTreeTooltip
              : m.filesCollapseTreeTooltip
          }
          aria-label={
            treeCollapsed
              ? m.filesExpandTreeTooltip
              : m.filesCollapseTreeTooltip
          }
        >
          {treeCollapsed ? "◀" : "▶"}
        </button>
      </header>

      {/* Body: editor + (optional) collapsible tree. */}
      <div className="files-section-body">
        <div className="files-section-editor">
          <FileViewer
            key={activeFilePath}
            path={activeFilePath}
            m={m}
            onClose={onClose}
            onInsertMention={onInsertMention}
          />
        </div>

        {treeCollapsed ? (
          <div className="files-section-tree-rail" aria-hidden>
            <button
              type="button"
              className="files-section-tree-rail-btn"
              onClick={() => onSetFileTreeCollapsed(false)}
              title={m.filesExpandTreeTooltip}
              aria-label={m.filesExpandTreeTooltip}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <path
                  d="M2.5 4.2A1.2 1.2 0 0 1 3.7 3h2.4l1.1 1.3h5.1A1.2 1.2 0 0 1 13.5 5.5v6.3a1.2 1.2 0 0 1-1.2 1.2H3.7a1.2 1.2 0 0 1-1.2-1.2V4.2Z"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </div>
        ) : (
          <>
            <div
              className="resize-handle resize-handle-files-tree"
              role="separator"
              aria-orientation="vertical"
              title={m.resizeFilesTree}
              aria-label={m.resizeFilesTree}
              onPointerDown={onResizePointerDown}
            />
            <div
              className="files-section-tree"
              style={{ width: `calc(${fileTreeWidth}% - 6px)` }}
            >
              <FileTree
                workspace={workspace}
                selectedPath={activeFilePath}
                onSelectFile={onNewFile}
                onClose={() => onSetFileTreeCollapsed(true)}
                m={m}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export const FilesTabSection = memo(FilesTabSectionInner);
