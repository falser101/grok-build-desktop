import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ConnectionState, UsageInfo } from "@shared/types";
import { usePrefs } from "./PrefsContext";
import type { LocalePref, ThemePref } from "./prefs";

type SubMenu = "language" | "theme" | null;

interface AccountMenuProps {
  connection: ConnectionState;
  connectionLabel: string;
  accountEmail?: string | null;
  agentVersion?: string | null;
  usage?: UsageInfo | null;
  signedIn?: boolean;
  loginBusy?: boolean;
  onOpenSettings: () => void;
  onLoginBrowser?: () => void;
  onLoginDevice?: () => void;
  onLogout?: () => void;
  onOpenUsage?: () => void;
  onManageBilling?: () => void;
}

interface PopoverPos {
  left: number;
  bottom: number;
  width: number;
}

export function AccountMenu({
  connection,
  connectionLabel,
  accountEmail,
  agentVersion,
  usage,
  signedIn,
  loginBusy,
  onOpenSettings,
  onLoginBrowser,
  onLoginDevice,
  onLogout,
  onOpenUsage,
  onManageBilling,
}: AccountMenuProps) {
  const {
    prefs,
    systemLocale,
    systemTheme,
    messages,
    setLocale,
    setTheme,
  } = usePrefs();
  const m = messages;
  const [open, setOpen] = useState(false);
  const [sub, setSub] = useState<SubMenu>(null);
  const [pos, setPos] = useState<PopoverPos | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const close = useCallback(() => {
    setOpen(false);
    setSub(null);
  }, []);

  const updatePos = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    setPos({
      left: rect.left,
      bottom: window.innerHeight - rect.top + 6,
      width: Math.max(rect.width, 220),
    });
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    updatePos();
    window.addEventListener("resize", updatePos);
    return () => window.removeEventListener("resize", updatePos);
  }, [open, updatePos]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (rootRef.current?.contains(t)) return;
      if (popoverRef.current?.contains(t)) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  const localeLabel = (id: LocalePref): string => {
    if (id === "system") return m.followSystem;
    if (id === "zh") return m.chinese;
    return m.english;
  };

  const themeLabel = (id: ThemePref): string => {
    if (id === "system") return m.followSystem;
    if (id === "dark") return m.themeDark;
    return m.themeLight;
  };

  const systemLocaleLabel =
    systemLocale === "zh" ? m.chinese : m.english;
  const systemThemeLabel =
    systemTheme === "dark" ? m.themeDark : m.themeLight;

  const currentLocaleShort =
    prefs.locale === "system"
      ? `${m.followSystem} · ${systemLocaleLabel}`
      : localeLabel(prefs.locale);

  const currentThemeShort =
    prefs.theme === "system"
      ? `${m.followSystem} · ${systemThemeLabel}`
      : themeLabel(prefs.theme);

  const displayName = accountEmail?.trim() || m.notSignedIn;
  // Brand label: when the agent is connected we show "grok-build · vX.Y.Z"
  // instead of a generic "Connected" — the version is only knowable once
  // the connection succeeds, so this naturally replaces the connected label.
  const brandVersionLabel =
    connection === "ready" && agentVersion?.trim()
      ? `${m.appBrandName} ${agentVersion.trim().replace(/^v/i, "")}`
      : null;
  const usageLine =
    usage && !usage.error
      ? `${usage.usageLabel}: ${usage.usageShort}${
          usage.subscriptionTier ? ` · ${usage.subscriptionTier}` : ""
        }`
      : usage?.error
        ? m.accountUsageUnavailable
        : null;
  // When connected, prefer the brand+version line over the raw connection
  // label. Otherwise (still starting/connecting/error) keep the connection
  // status so the user sees what's happening.
  const subParts: string[] = [];
  if (brandVersionLabel) subParts.push(brandVersionLabel);
  else subParts.push(connectionLabel);
  if (usageLine) subParts.push(usageLine);
  const displaySub = subParts.join(" · ");

  const localeOptions: LocalePref[] = ["system", "en", "zh"];
  const themeOptions: ThemePref[] = ["system", "dark", "light"];

  const popover =
    open && pos
      ? createPortal(
          <div
            ref={popoverRef}
            className="account-popover"
            role="menu"
            style={{
              left: pos.left,
              bottom: pos.bottom,
              width: pos.width,
            }}
          >
            <div className="account-popover-head">
              <div className="account-avatar" aria-hidden>
                {(accountEmail?.trim()?.[0] || "G").toUpperCase()}
              </div>
              <div className="account-popover-meta">
                <div className="account-popover-name" title={displayName}>
                  {displayName}
                </div>
                <div className="account-popover-sub" title={displaySub}>
                  {displaySub}
                </div>
              </div>
            </div>

            {usage && !usage.error ? (
              <>
                <div className="account-popover-divider" />
                <div className="account-usage-block">
                  <div className="account-usage-row">
                    <span className="account-usage-label">
                      {usage.usageLabel}
                    </span>
                    <span className="account-usage-pct">{usage.usageShort}</span>
                  </div>
                  <div
                    className="account-usage-bar"
                    role="progressbar"
                    aria-valuenow={Math.round(usage.usagePct)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                  >
                    <span
                      className={`account-usage-fill ${
                        usage.usagePct >= 90
                          ? "critical"
                          : usage.usagePct >= 75
                            ? "warn"
                            : ""
                      }`}
                      style={{ width: `${Math.min(100, usage.usagePct)}%` }}
                    />
                  </div>
                  {usage.periodEndDisplay ? (
                    <div className="account-usage-meta">
                      {m.accountUsageReset}: {usage.periodEndDisplay}
                    </div>
                  ) : null}
                  {usage.subscriptionTier ? (
                    <div className="account-usage-meta">
                      {usage.subscriptionTier}
                    </div>
                  ) : null}
                  <div className="account-usage-actions">
                    <button
                      type="button"
                      className="account-usage-link"
                      onClick={() => {
                        close();
                        onOpenUsage?.();
                      }}
                    >
                      {m.accountUsageDetails}
                    </button>
                    <button
                      type="button"
                      className="account-usage-link"
                      onClick={() => {
                        close();
                        onManageBilling?.();
                      }}
                    >
                      {m.accountUsageManage}
                    </button>
                  </div>
                </div>
              </>
            ) : null}

            <div className="account-popover-divider" />

            <div className="account-menu-item-wrap">
              <button
                type="button"
                className={`account-menu-item ${
                  sub === "language" ? "open" : ""
                }`}
                role="menuitem"
                aria-haspopup="menu"
                aria-expanded={sub === "language"}
                onClick={() =>
                  setSub((s) => (s === "language" ? null : "language"))
                }
              >
                <span className="account-menu-label">{m.language}</span>
                <span className="account-menu-value">{currentLocaleShort}</span>
                <span className="account-menu-chev" aria-hidden>
                  ›
                </span>
              </button>
              {sub === "language" ? (
                <div className="account-submenu" role="menu">
                  {localeOptions.map((id) => (
                    <button
                      key={id}
                      type="button"
                      className={`account-submenu-item ${
                        prefs.locale === id ? "selected" : ""
                      }`}
                      role="menuitemradio"
                      aria-checked={prefs.locale === id}
                      onClick={() => {
                        setLocale(id);
                        setSub(null);
                      }}
                    >
                      <span className="account-check" aria-hidden>
                        {prefs.locale === id ? "✓" : ""}
                      </span>
                      {localeLabel(id)}
                      {id === "system" ? (
                        <span className="account-submenu-hint">
                          {systemLocaleLabel}
                        </span>
                      ) : null}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="account-menu-item-wrap">
              <button
                type="button"
                className={`account-menu-item ${sub === "theme" ? "open" : ""}`}
                role="menuitem"
                aria-haspopup="menu"
                aria-expanded={sub === "theme"}
                onClick={() =>
                  setSub((s) => (s === "theme" ? null : "theme"))
                }
              >
                <span className="account-menu-label">{m.theme}</span>
                <span className="account-menu-value">{currentThemeShort}</span>
                <span className="account-menu-chev" aria-hidden>
                  ›
                </span>
              </button>
              {sub === "theme" ? (
                <div className="account-submenu" role="menu">
                  {themeOptions.map((id) => (
                    <button
                      key={id}
                      type="button"
                      className={`account-submenu-item ${
                        prefs.theme === id ? "selected" : ""
                      }`}
                      role="menuitemradio"
                      aria-checked={prefs.theme === id}
                      onClick={() => {
                        setTheme(id);
                        setSub(null);
                      }}
                    >
                      <span className="account-check" aria-hidden>
                        {prefs.theme === id ? "✓" : ""}
                      </span>
                      {themeLabel(id)}
                      {id === "system" ? (
                        <span className="account-submenu-hint">
                          {systemThemeLabel}
                        </span>
                      ) : null}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="account-popover-divider" />

            {!signedIn ? (
              <>
                <button
                  type="button"
                  className="account-menu-item"
                  role="menuitem"
                  disabled={loginBusy}
                  onClick={() => {
                    close();
                    onLoginBrowser?.();
                  }}
                >
                  <span className="account-menu-label">
                    {m.accountLoginBrowser}
                  </span>
                </button>
                <button
                  type="button"
                  className="account-menu-item"
                  role="menuitem"
                  disabled={loginBusy}
                  onClick={() => {
                    close();
                    onLoginDevice?.();
                  }}
                >
                  <span className="account-menu-label">
                    {m.accountLoginDevice}
                  </span>
                </button>
              </>
            ) : (
              <button
                type="button"
                className="account-menu-item"
                role="menuitem"
                disabled={loginBusy}
                onClick={() => {
                  close();
                  onLogout?.();
                }}
              >
                <span className="account-menu-label">{m.accountLogout}</span>
              </button>
            )}

            <div className="account-popover-divider" />

            <button
              type="button"
              className="account-menu-item"
              role="menuitem"
              onClick={() => {
                close();
                onOpenSettings();
              }}
            >
              <span className="account-menu-label">{m.settings}</span>
              <span
                className="account-menu-kbd"
                aria-hidden
                title={`Ctrl+,`}
              >
                Ctrl + ,
              </span>
            </button>
          </div>,
          document.body,
        )
      : null;

  return (
    <div className="account-menu-root" ref={rootRef}>
      {popover}
      <button
        ref={triggerRef}
        type="button"
        className={`account-trigger ${open ? "open" : ""}`}
        onClick={() => {
          if (open) close();
          else {
            setOpen(true);
            setSub(null);
          }
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={m.accountMenu}
        title={[
          accountEmail?.trim(),
          brandVersionLabel ?? connectionLabel,
          usageLine,
        ]
          .filter(Boolean)
          .join(" · ")}
      >
        <span
          className={`dot ${
            connection === "ready"
              ? "ready"
              : connection === "error" || connection === "stopped"
                ? "error"
                : ""
          }`}
        />
        <span className="account-trigger-text">
          <span className="account-trigger-name">{displayName}</span>
          <span className="account-trigger-status">
            {usage && !usage.error
              ? `${brandVersionLabel ?? connectionLabel} · ${usage.usageShort}`
              : displaySub}
          </span>
        </span>
        <span className="account-trigger-chev" aria-hidden>
          {open ? "▾" : "▴"}
        </span>
      </button>
    </div>
  );
}
