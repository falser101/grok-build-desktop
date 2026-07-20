import { memo } from "react";
import type { CSSProperties } from "react";
import type { Messages } from "./i18n";
import { FileTree } from "./FileTree";
import { FileViewer } from "./FileViewer";

interface FilesTabSectionProps {
  workspace: string | undefined;
  m: Messages;
  /** Absolute path of the file currently displayed in the editor pane.
   *  An empty string means "no file selected yet — show the empty
   *  state alongside the file tree so the user can pick one". */
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
 * Files tab body — just the editor + tree split. Action buttons
 * (`+`, `open in editor`, `toggle tree`) live in the unified tab bar
 * above, owned by App.tsx, so this component stays purely visual.
 *
 *   ┌─ editor pane ──────────────┬─ tree pane (collapsible) ─┐
 *   │ <FileViewer> or empty       │ <FileTree>             │
 *   └─────────────────────────────┴─────────────────────────┘
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
  return (
    <div
      className="files-section-root"
      style={
        treeCollapsed
          ? undefined
          : ({ "--files-tree-w": `${Math.max(fileTreeWidth, 18)}%` } as CSSProperties)
      }
    >
      <div className="files-section-body">
        <div className="files-section-editor">
          {activeFilePath ? (
            <FileViewer
              key={activeFilePath}
              path={activeFilePath}
              m={m}
              onClose={onClose}
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
              <div className="file-viewer-empty-hint">
                {m.openFileEmptyHint}
              </div>
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
              /* Width lives in --files-tree-w on the parent; this node
               * pulls it via var() in styles.css. Live drag mutates the
               * same var. */
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
