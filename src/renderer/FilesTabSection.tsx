import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ExternalEditorDescriptor } from "@shared/types";
import type { Messages } from "./i18n";
import { FileTree } from "./FileTree";
import { FileViewer } from "./FileViewer";

/**
 * One tab in the file tab bar.
 */
export interface OpenFileTab {
  /** Stable React key + IPC identity. */
  id: string;
  /** Absolute path on disk. */
  path: string;
}

interface FilesTabSectionProps {
  workspace: string | undefined;
  m: Messages;
  openFiles: OpenFileTab[];
  activeFileId: string | null;
  /** Derived — absolute path of the active tab, or null when no tab is open. */
  activeFilePath: string | null;
  /** True when the inline file-tree pane is folded to its narrow rail. */
  treeCollapsed: boolean;
  /** Width of the tree pane in % of the right panel's inner width. */
  fileTreeWidth: number;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  /** Open (or activate) a path; called by `<FileTree>` and the "+" picker. */
  onNewFile: (path: string) => void;
  onSetFileTreeCollapsed: (collapsed: boolean) => void;
  /** Drag-handle callback wired to the host's `onResizePointerDown`. */
  onResizePointerDown: (
    e: React.PointerEvent<HTMLDivElement>,
  ) => void;
  onInsertMention?: (path: string) => void;
}

/**
 * Right-panel "files" tab body.
 *
 * Layout (matches the user's reference screenshot):
 *
 *  ┌─ toolbar row ───────────────────────────────────────────────┐
 *  │ [Open file]  · breadcrumb · tabs · [+ ▾]  [open-in-editor▾] │
 *  └─────────────────────────────────────────────────────────────┘
 *  ┌─ editor pane ────────────────┬─ tree pane (collapsible) ───┐
 *  │ <FileViewer> or empty state  │ <FileTree> or rail icon   │
 *  └─────────────────────────────┴─────────────────────────────┘
 *
 * Resize handle between the two inner panes; tree can fold to a thin
 * vertical rail (single toggle button) when the user wants the file
 * previews to take the full right-panel width.
 */
function FilesTabSectionInner({
  workspace,
  m,
  openFiles,
  activeFileId,
  activeFilePath,
  treeCollapsed,
  fileTreeWidth,
  onActivate,
  onClose,
  onNewFile,
  onSetFileTreeCollapsed,
  onResizePointerDown,
  onInsertMention,
}: FilesTabSectionProps) {
  /** True when the open-in-editor dropdown is open. */
  const [editorMenuOpen, setEditorMenuOpen] = useState(false);
  /** True when the "+" menu is open (Pick from workspace / New file / Close panel). */
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const editorMenuRef = useRef<HTMLDivElement | null>(null);
  const addMenuRef = useRef<HTMLDivElement | null>(null);

  /**
   * Available editors. Cached for the lifetime of this component —
   * Phase 1 has the main side report every editor as `available: true`
   * so we just sort by a fixed display order.
   */
  const [editors, setEditors] = useState<ExternalEditorDescriptor[]>([]);

  useEffect(() => {
    let cancelled = false;
    void window.desktop.listExternalEditors().then((list) => {
      if (!cancelled) {
        setEditors(list);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Map editor id → i18n label key. We do the translation in the renderer
  // because the i18n table already lives here, even though the editor
  // catalogue itself ships from the main process.
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

  // Outside-click + Escape close for both dropdowns.
  useEffect(() => {
    if (!editorMenuOpen && !addMenuOpen) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (
        editorMenuOpen &&
        editorMenuRef.current &&
        !editorMenuRef.current.contains(t)
      ) {
        setEditorMenuOpen(false);
      }
      if (
        addMenuOpen &&
        addMenuRef.current &&
        !addMenuRef.current.contains(t)
      ) {
        setAddMenuOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (editorMenuOpen) setEditorMenuOpen(false);
        if (addMenuOpen) setAddMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [editorMenuOpen, addMenuOpen]);

  const breadcrumb = useMemo(() => {
    if (!activeFilePath) return "";
    if (workspace && activeFilePath.startsWith(workspace)) {
      const tail = activeFilePath.slice(workspace.length).replace(/^[/\\]/, "");
      if (tail) return tail;
    }
    return activeFilePath;
  }, [activeFilePath, workspace]);

  const openInEditor = useCallback(
    (id: string) => {
      setEditorMenuOpen(false);
      if (!activeFilePath) return;
      void window.desktop.openInEditor(id, activeFilePath).catch((err) => {
        // eslint-disable-next-line no-console
        console.error("[files] openInEditor failed:", err);
      });
    },
    [activeFilePath],
  );

  return (
    <div className="files-section-root">
      {/* Top toolbar row: file-open button · breadcrumb · tabs · [+ ▾] · open-in-editor ▾ · tree-toggle */}
      <header className="files-section-toolbar">
        <button
          type="button"
          className="files-section-open-btn"
          title={m.filesOpenFileTooltip}
          aria-label={m.filesOpenFileTooltip}
          onClick={() => {
            // Clicking the "open file" affordance opens the "+" menu —
            // the underlying picker either opens the tree or the new-file
            // input, depending on which entry the user picks.
            setAddMenuOpen((v) => !v);
          }}
        >
          <span className="files-section-open-icon" aria-hidden>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path
                d="M2.5 4.2A1.2 1.2 0 0 1 3.7 3h2.4l1.1 1.3h5.1A1.2 1.2 0 0 1 13.5 5.5v6.3a1.2 1.2 0 0 1-1.2 1.2H3.7a1.2 1.2 0 0 1-1.2-1.2V4.2Z"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <span className="files-section-open-label">
            {m.openFileTitle}
          </span>
        </button>

        <span className="files-section-breadcrumb" title={activeFilePath ?? ""}>
          {breadcrumb}
        </span>

        <div className="files-section-tabs">
          {openFiles.map((f) => {
            const isActive = f.id === activeFileId;
            const name = f.path.split(/[/\\]/).pop() || f.path;
            return (
              <div
                key={f.id}
                className={"files-tab" + (isActive ? " active" : "")}
                onClick={() => onActivate(f.id)}
                role="tab"
                aria-selected={isActive}
                title={f.path}
              >
                <span className="files-tab-name">{name}</span>
                <button
                  type="button"
                  className="files-tab-close"
                  onClick={(e) => {
                    e.stopPropagation();
                    onClose(f.id);
                  }}
                  title={m.filesCloseTabTooltip}
                  aria-label={m.filesCloseTabTooltip}
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>

        <div className="files-section-add-wrap" ref={addMenuRef}>
          <button
            type="button"
            className="files-section-add"
            onClick={() => setAddMenuOpen((v) => !v)}
            title={m.termNewTab}
            aria-haspopup="menu"
            aria-expanded={addMenuOpen}
          >
            +
          </button>
          {addMenuOpen ? (
            <div className="dropdown" role="menu">
              <button
                type="button"
                className="dropdown-item"
                role="menuitem"
                onClick={() => {
                  setAddMenuOpen(false);
                  // The user already has the file tree visible on the
                  // right side of this section — focus the filter input
                  // so they can start typing a path right away.
                  const input = document.querySelector<HTMLInputElement>(
                    ".files-section-tree .file-tree-filter input",
                  );
                  input?.focus();
                }}
              >
                {m.filesPickFromWorkspace}
              </button>
              <button
                type="button"
                className="dropdown-item"
                role="menuitem"
                onClick={() => {
                  setAddMenuOpen(false);
                  // Phase 1: defer the "new file" flow to the next patch —
                  // for now the user can use the tree picker above. We
                  // still wire the menu entry so the affordance exists.
                  const input =
                    document.querySelector<HTMLInputElement>(
                      ".files-section-tree .file-tree-filter input",
                    );
                  input?.focus();
                }}
              >
                {m.filesNewFile}
              </button>
              <button
                type="button"
                className="dropdown-item"
                role="menuitem"
                onClick={() => {
                  setAddMenuOpen(false);
                  // Close the entire right panel.
                  const rightBtn = document.querySelector<HTMLButtonElement>(
                    ".shell > .chat-side-toggle",
                  );
                  rightBtn?.click();
                }}
              >
                {m.filesClosePanel}
              </button>
            </div>
          ) : null}
        </div>

        <div className="files-section-divider" aria-hidden />

        <div
          className="files-section-editor-wrap"
          ref={editorMenuRef}
        >
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
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
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
            <span>open</span>
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
                <div className="dropdown-empty">{m.filesOpenInEditorTooltip}</div>
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

      {/* Body: editor pane (flex) + tree pane (fixed-width; min 28px when collapsed) */}
      <div className="files-section-body">
        <div className="files-section-editor">
          {activeFilePath ? (
            <FileViewer
              key={activeFilePath}
              path={activeFilePath}
              m={m}
              onClose={() => {
                const active = openFiles.find((f) => f.id === activeFileId);
                if (active) onClose(active.id);
              }}
              onInsertMention={onInsertMention}
            />
          ) : (
            <div className="file-viewer-empty-state">
              <div className="file-viewer-empty-icon" aria-hidden>
                <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
                  <path
                    d="M8 12.5A3 3 0 0 1 11 9.5h6l2.5 3H29a3 3 0 0 1 3 3V28a3 3 0 0 1-3 3H11a3 3 0 0 1-3-3V12.5Z"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
              <div className="file-viewer-empty-title">{m.openFileEmpty}</div>
              <div className="file-viewer-empty-hint">{m.openFileEmptyHint}</div>
            </div>
          )}
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
              style={{ width: `${Math.max(fileTreeWidth, FILE_TREE_MIN_VIEW)}%` }}
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

/**
 * Minimum visual width of the tree pane when fully expanded. We don't
 * block the underlying drag below this — the layout effect still updates
 * `fileTreeWidth` even when it dips, but the CSS floor keeps the column
 * from collapsing so low that the user loses the filter input.
 */
const FILE_TREE_MIN_VIEW = 22;

export const FilesTabSection = memo(FilesTabSectionInner);
