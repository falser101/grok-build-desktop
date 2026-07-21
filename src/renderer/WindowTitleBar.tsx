import { useCallback, useEffect, useState } from "react";

/**
 * Custom window title bar.
 *
 * Replaces the OS-painted client frame on Linux / Windows so the
 * compositor (KDE, GNOME…) doesn't double up a native title bar above
 * the app menu — that was the source of the two-tier chrome visible
 * in earlier screenshots.
 *
 * On macOS the native frame and traffic lights are kept, so this
 * component renders just an empty spacer there.
 *
 * The bar is one row: the in-app menu (File / Edit / View / Help /
 * Settings) on the left, a drag region for moving the window across
 * the rest, and Min / Max / Close controls on the right (Win / Linux).
 */
export function WindowTitleBar(): React.ReactElement {
  // Ask the main process which OS we're on. `navigator.userAgent`
  // reports the host CPU arch (so a Linux build running through
  // remote access on a Mac laptop shows `Macintosh` and breaks the
  // bool). The desktop API returns `process.platform`, which is
  // reliable.
  const [os, setOs] = useState<NodeJS.Platform | null>(null);
  const isMac = os === "darwin";
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void window.desktop.platform().then((p) => {
      if (!cancelled) setOs(p);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Keep the maximize glyph in sync with the OS-driven maximize state
  // (double-click on the empty drag region triggers `maximize`).
  useEffect(() => {
    if (isMac) return;
    let cancelled = false;
    void window.desktop.isMaximized().then((v) => {
      if (!cancelled) setMaximized(v);
    });
    const off = window.desktop.onMaximizeChanged((v) => setMaximized(v));
    return () => {
      cancelled = true;
      off();
    };
  }, [isMac]);

  const onMin = useCallback(() => {
    void window.desktop.minimizeWindow();
  }, []);
  const onMax = useCallback(() => {
    void window.desktop.toggleMaximizeWindow();
  }, []);
  const onClose = useCallback(() => {
    void window.desktop.closeWindow();
  }, []);

  return (
    <div className="window-titlebar" role="banner">
      {/* Drag region (CSS sets `-webkit-app-region: drag`). Buttons
          inside apply `-webkit-app-region: no-drag` to stay clickable. */}
      <div className="wtb-drag">{!isMac ? <TitleBarMenu /> : null}</div>
      {isMac ? <div className="wtb-mac-spacer" aria-hidden /> : null}
      {!isMac ? (
        <div className="wtb-controls">
          <button
            type="button"
            className="wtb-btn wtb-btn-min"
            onClick={onMin}
            aria-label="Minimize window"
            title="Minimize"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
              <rect x="0" y="4.25" width="10" height="1.5" fill="currentColor" />
            </svg>
          </button>
          <button
            type="button"
            className="wtb-btn wtb-btn-max"
            onClick={onMax}
            aria-label={maximized ? "Restore window" : "Maximize window"}
            title={maximized ? "Restore" : "Maximize"}
          >
            {maximized ? (
              <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
                {/* Restore glyph: two overlapping squares */}
                <rect
                  x="2.25"
                  y="0.75"
                  width="6.5"
                  height="6.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.25"
                />
                <rect
                  x="0.75"
                  y="2.75"
                  width="6.5"
                  height="6.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.25"
                />
              </svg>
            ) : (
              <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
                <rect
                  x="0.75"
                  y="0.75"
                  width="8.5"
                  height="8.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.25"
                />
              </svg>
            )}
          </button>
          <button
            type="button"
            className="wtb-btn wtb-btn-close"
            onClick={onClose}
            aria-label="Close window"
            title="Close"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
              <path
                d="M1.5 1.5 L8.5 8.5 M8.5 1.5 L1.5 8.5"
                stroke="currentColor"
                strokeWidth="1.25"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
      ) : null}
    </div>
  );
}

type MenuId = "file" | "edit" | "view" | "help" | "settings";

type MenuItem =
  | { kind?: "item"; label: string; kbd?: string; onClick: () => void }
  | { kind: "sep" };

/**
 * In-app menu row. Each item is a small renderer-side popover bound to
 * either an IPC call (`openSettings`, `newSession`) or a built-in
 * renderer behavior (fullscreen, devtools, execCommand). We render it
 * ourselves instead of relying on the OS menu bar so the chrome is
 * identical across Win / Linux and doesn't depend on KDE's optional
 * global-menu integration.
 */
function TitleBarMenu(): React.ReactElement {
  const [openMenu, setOpenMenu] = useState<MenuId | null>(null);

  // Outside-click + Escape dismissal.
  useEffect(() => {
    if (!openMenu) return;
    const onDown = (e: MouseEvent): void => {
      const t = e.target as HTMLElement | null;
      if (t?.closest?.(".wtb-menu-wrap")) return;
      setOpenMenu(null);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setOpenMenu(null);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [openMenu]);

  const toggle = (id: MenuId): void => {
    setOpenMenu((cur) => (cur === id ? null : id));
  };

  const close = (): void => setOpenMenu(null);

  const newSession = (): void => {
    close();
    void window.desktop.requestNewSession();
  };
  const openSettings = (): void => {
    close();
    void window.desktop.requestOpenSettings();
  };
  const reload = (): void => {
    close();
    void window.desktop.requestReload();
  };
  const toggleDevTools = (): void => {
    close();
    void window.desktop.requestToggleDevTools();
  };
  const about = (): void => {
    close();
    void window.desktop.requestAbout();
  };
  const fullscreen = (): void => {
    close();
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen();
  };

  const items: Record<MenuId, MenuItem[]> = {
    file: [
      { label: "新建会话", kbd: "Ctrl N", onClick: newSession },
    ],
    edit: [
      { label: "撤销", kbd: "Ctrl Z", onClick: () => docExec("undo") },
      { label: "重做", kbd: "Ctrl ⇧ Z", onClick: () => docExec("redo") },
      { kind: "sep" },
      { label: "剪切", kbd: "Ctrl X", onClick: () => docExec("cut") },
      { label: "复制", kbd: "Ctrl C", onClick: () => docExec("copy") },
      { label: "粘贴", kbd: "Ctrl V", onClick: () => docExec("paste") },
      { label: "删除", onClick: () => docExec("delete") },
      { kind: "sep" },
      { label: "全选", kbd: "Ctrl A", onClick: () => docExec("selectAll") },
    ],
    view: [
      { label: "切换开发者工具", kbd: "Ctrl ⇧ I", onClick: toggleDevTools },
      { label: "重新加载", kbd: "Ctrl R", onClick: reload },
      { kind: "sep" },
      { label: "全屏", kbd: "F11", onClick: fullscreen },
    ],
    help: [
      { label: "关于 Grok Build", onClick: about },
    ],
    settings: [
      { label: "打开设置", kbd: "Ctrl ,", onClick: openSettings },
    ],
  };

  const order: MenuId[] = ["file", "edit", "view", "help"];

  return (
    <nav className="wtb-menu" aria-label="Window menu">
      {order.map((id) => (
        <MenuTrigger
          key={id}
          id={id}
          label={LABEL[id]}
          items={items[id]}
          openId={openMenu}
          onToggle={toggle}
        />
      ))}
      <div className="wtb-menu-sep" aria-hidden />
      <MenuTrigger
        id="settings"
        label={LABEL.settings}
        items={items.settings}
        openId={openMenu}
        onToggle={toggle}
        accent
      />
    </nav>
  );
}

const LABEL: Record<MenuId, string> = {
  file: "文件",
  edit: "编辑",
  view: "视图",
  help: "帮助",
  settings: "设置",
};

function MenuTrigger({
  id,
  label,
  items,
  openId,
  onToggle,
  accent,
}: {
  id: MenuId;
  label: string;
  items: MenuItem[];
  openId: MenuId | null;
  onToggle: (id: MenuId) => void;
  accent?: boolean;
}): React.ReactElement {
  const open = openId === id;
  return (
    <div className="wtb-menu-wrap">
      <button
        type="button"
        className={`wtb-menu-btn${open ? " open" : ""}${
          accent ? " accent" : ""
        }`}
        onClick={() => onToggle(id)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {label}
      </button>
      {open ? (
        <div className="wtb-dropdown" role="menu">
          {items.map((it, i) =>
            it.kind === "sep" ? (
              <div key={`sep-${i}`} className="wtb-dropdown-sep" aria-hidden />
            ) : (
              <button
                key={it.label}
                type="button"
                role="menuitem"
                className="wtb-dropdown-item"
                onClick={it.onClick}
              >
                <span className="wtb-dropdown-label">{it.label}</span>
                {it.kbd ? (
                  <span className="wtb-dropdown-kbd">{it.kbd}</span>
                ) : null}
              </button>
            ),
          )}
        </div>
      ) : null}
    </div>
  );
}

function docExec(cmd: string): void {
  try {
    document.execCommand(cmd);
  } catch {
    /* ignore — execCommand can throw when no editable target */
  }
}
