import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AccountStatus,
  InstallerStatus,
  UsageInfo,
} from "@shared/types";
import { usePrefs } from "./PrefsContext";
import type { LocalePref, ThemePref, UserPrefs } from "./prefs";
import type { Messages } from "./i18n";
import { AgentSettingsView } from "./AgentSettingsView";
import { ModelsView } from "./ModelsView";
import { ExtensionsView } from "./ExtensionsView";

/**
 * Identifiers for the left-rail sections of the settings page. Imported by
 * App.tsx so external entry points (e.g. the chat model's "Manage models"
 * dropdown item) can request a specific section.
 */
export type SettingsSectionId =
  | "general"
  | "account"
  | "models"
  | "mcp"
  | "skills"
  | "agent"
  | "about";

interface OptionCardProps<T extends string> {
  value: T;
  selected: boolean;
  title: string;
  description?: string;
  onSelect: (value: T) => void;
}

export function OptionCard<T extends string>({
  value,
  selected,
  title,
  description,
  onSelect,
}: OptionCardProps<T>) {
  return (
    <button
      type="button"
      className={`settings-option ${selected ? "selected" : ""}`}
      onClick={() => onSelect(value)}
      aria-pressed={selected}
    >
      <span className="settings-radio" aria-hidden />
      <span className="settings-option-text">
        <span className="settings-option-title">{title}</span>
        {description ? (
          <span className="settings-option-desc">{description}</span>
        ) : null}
      </span>
    </button>
  );
}

interface SelectFieldProps<T extends string> {
  value: T;
  options: { value: T; label: string }[];
  onChange: (next: T) => void;
  ariaLabel?: string;
  id?: string;
}

/**
 * Compact labelled <select> used by the General Settings cards. Replaces
 * the multi-card option list to reclaim vertical space — a single native
 * dropdown per setting is far shorter than a stacked radio-card list while
 * remaining keyboard / screen-reader friendly. The arrow chrome is
 * decorated via the parent `.settings-select-wrap` (see styles.css).
 */
function SelectField<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  id,
}: SelectFieldProps<T>): React.ReactElement {
  return (
    <div className="settings-select-wrap">
      <select
        id={id}
        className="settings-select"
        value={value}
        aria-label={ariaLabel}
        onChange={(e) => onChange(e.target.value as T)}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      <svg
        className="settings-select-caret"
        width="10"
        height="10"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M3 6l5 5 5-5" />
      </svg>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="settings-info-row">
      <span className="settings-info-label">{label}</span>
      <span className="settings-info-value" title={value}>
        {value}
      </span>
    </div>
  );
}

/**
 * API key input row. Memoised so typing in the field only re-renders this
 * small subtree instead of the whole SettingsView (locale/theme pickers,
 * account info rows, usage panel, etc.).
 *
 * The "show / hide" toggle is owned locally because it's purely a UI concern
 * for this row and doesn't need to live in the parent.
 */
const ApiKeyField = memo(function ApiKeyField({
  placeholder,
  placeholderSet,
  apiKeySet,
  showLabel,
  hideLabel,
  onSave,
  onClear,
  busy,
  envSource,
  envHint,
  saveLabel,
  clearLabel,
  label,
  draft,
  setDraft,
  clearDisabled,
}: {
  placeholder: string;
  placeholderSet: string;
  apiKeySet: boolean;
  showLabel: string;
  hideLabel: string;
  onSave: () => void;
  onClear: () => void;
  busy: boolean;
  envSource: boolean;
  envHint: string;
  saveLabel: string;
  clearLabel: string;
  label: string;
  draft: string;
  setDraft: (v: string) => void;
  clearDisabled: boolean;
}) {
  const [showApiKey, setShowApiKey] = useState(false);

  return (
    <div className="settings-form">
      <label className="settings-field">
        <span>{label}</span>
        <div className="settings-input-row">
          <input
            type={showApiKey ? "text" : "password"}
            className="settings-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={apiKeySet ? placeholderSet : placeholder}
            autoComplete="off"
            spellCheck={false}
          />
          <button
            type="button"
            className="settings-btn"
            onClick={() => setShowApiKey((v) => !v)}
          >
            {showApiKey ? hideLabel : showLabel}
          </button>
        </div>
      </label>
      <div className="settings-actions">
        <button
          type="button"
          className="settings-btn primary"
          disabled={busy || !draft.trim()}
          onClick={onSave}
        >
          {saveLabel}
        </button>
        <button
          type="button"
          className="settings-btn"
          disabled={busy || clearDisabled}
          onClick={onClear}
          title={envSource ? envHint : undefined}
        >
          {clearLabel}
        </button>
      </div>
      {envSource ? <p className="settings-help">{envHint}</p> : null}
    </div>
  );
});

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function SettingsView({
  onBack,
  accountEmail,
  connectionLabel,
  alwaysApprove,
  onSetAlwaysApprove,
  autoTrustNewSessions,
  onSetAutoTrustNewSessions,
  usage,
  onRefreshUsage,
  installerStatus,
  lastUpdateCheckAt,
  onProvidersChanged,
  initialSection,
}: {
  onBack: () => void;
  accountEmail?: string | null;
  connectionLabel: string;
  alwaysApprove: boolean;
  onSetAlwaysApprove: (enabled: boolean) => void;
  autoTrustNewSessions: boolean;
  onSetAutoTrustNewSessions: (enabled: boolean) => void;
  usage?: UsageInfo | null;
  onRefreshUsage?: () => Promise<void>;
  installerStatus: InstallerStatus;
  lastUpdateCheckAt?: string;
  onProvidersChanged?: () => void;
  /**
   * Section to show on mount / when the parent re-enters Settings.
   * External callers (e.g. the composer model's "Manage models…" item)
   * set this and then switch the main view to "settings"; the view
   * also keeps a local activeSection so in-page nav clicks don't get
   * clobbered.
   */
  initialSection?: SettingsSectionId;
}) {
  const {
    prefs,
    systemLocale,
    systemTheme,
    messages,
    setLocale,
    setTheme,
  } = usePrefs();
  const m = messages;

  const [acct, setAcct] = useState<AccountStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const [apiKeyDraft, setApiKeyDraftRaw] = useState("");
  // Stable setter so it can be passed into the memoised <ApiKeyField /> without
  // busting memo on every parent render.
  const setApiKeyDraft = useCallback((v: string) => setApiKeyDraftRaw(v), []);

  const [loginMsg, setLoginMsg] = useState<string | null>(null);
  const [deviceUrl, setDeviceUrl] = useState<string | null>(null);
  const [deviceCode, setDeviceCode] = useState<string | null>(null);

  const applyStatus = useCallback((s: AccountStatus) => {
    setAcct(s);
    if (s.loginInProgress) {
      setLoginMsg(s.loginMessage ?? m.accountLoginInProgress);
      setDeviceUrl(s.deviceUrl ?? null);
      setDeviceCode(s.deviceUserCode ?? null);
    }
  }, [m.accountLoginInProgress]);

  const refresh = useCallback(async () => {
    try {
      const s = await window.desktop.getAccountStatus();
      applyStatus(s);
    } catch (err) {
      setError(errMsg(err));
    }
  }, [applyStatus]);

  useEffect(() => {
    void refresh();
    const off = window.desktop.onAccountEvent((ev) => {
      if (ev.type === "status") {
        applyStatus(ev.status);
      } else if (ev.type === "loginProgress") {
        setLoginMsg(ev.message);
        if (ev.deviceUrl) setDeviceUrl(ev.deviceUrl);
        if (ev.deviceUserCode) setDeviceCode(ev.deviceUserCode);
      } else if (ev.type === "loginDone") {
        applyStatus(ev.status);
        setLoginMsg(null);
        setDeviceUrl(null);
        setDeviceCode(null);
        if (ev.ok) setInfo(ev.message);
        else setError(ev.message);
      }
    });
    return off;
  }, [applyStatus, refresh]);

  const withBusy = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await fn();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  const onLogin = (method: "oauth" | "device") =>
    withBusy(async () => {
      setLoginMsg(
        method === "device"
          ? m.accountLoginDeviceStarting
          : m.accountLoginBrowserStarting,
      );
      setDeviceUrl(null);
      setDeviceCode(null);
      const s = await window.desktop.login(method);
      applyStatus(s);
      setInfo(
        s.email
          ? m.accountSignedInAs.replace("{email}", s.email)
          : m.accountSignedIn,
      );
      setLoginMsg(null);
      setDeviceUrl(null);
      setDeviceCode(null);
    });

  const onCancelLogin = () =>
    withBusy(async () => {
      await window.desktop.cancelLogin();
      setLoginMsg(null);
      setDeviceUrl(null);
      setDeviceCode(null);
      await refresh();
      setInfo(m.accountLoginCancelled);
    });

  const onLogout = () =>
    withBusy(async () => {
      if (!window.confirm(m.accountLogoutConfirm)) return;
      const r = await window.desktop.logout();
      applyStatus(r.status);
      setInfo(r.message || m.accountLoggedOut);
    });

  const onSaveApiKey = () =>
    withBusy(async () => {
      const s = await window.desktop.setApiKey(apiKeyDraft.trim() || null);
      applyStatus(s);
      setApiKeyDraft("");
      setInfo(
        s.apiKeySet ? m.accountApiKeySaved : m.accountApiKeyCleared,
      );
    });

  const onClearApiKey = () =>
    withBusy(async () => {
      const s = await window.desktop.setApiKey(null);
      applyStatus(s);
      setApiKeyDraft("");
      setInfo(m.accountApiKeyCleared);
    });

  const onReconnect = () =>
    withBusy(async () => {
      await window.desktop.reconnectAgent();
      setInfo(m.accountReconnected);
      await refresh();
    });

  const onRefreshUsageClick = () =>
    withBusy(async () => {
      if (onRefreshUsage) await onRefreshUsage();
      else await window.desktop.refreshUsage();
      setInfo(m.accountUsageRefreshed);
    });

  const onManageBilling = () =>
    withBusy(async () => {
      const url = usage?.manageUrl || "https://grok.com/?_s=usage";
      await window.desktop.openExternal(url);
    });

  // Static option lists — only depend on `m`, which is stable until the user
  // changes locale, so wrapping in useMemo avoids re-allocating two arrays on
  // every SettingsView render (e.g. on every keystroke in the API key field).
  const localeOptions = useMemo<{ id: LocalePref; title: string }[]>(
    () => [
      { id: "system", title: m.followSystem },
      { id: "en", title: m.english },
      { id: "zh", title: m.chinese },
    ],
    [m.followSystem, m.english, m.chinese],
  );

  const themeOptions = useMemo<{ id: ThemePref; title: string }[]>(
    () => [
      { id: "system", title: m.followSystem },
      { id: "dark", title: m.themeDark },
      { id: "light", title: m.themeLight },
    ],
    [m.followSystem, m.themeDark, m.themeLight],
  );

  const systemLocaleLabel =
    systemLocale === "zh" ? m.chinese : m.english;
  const systemThemeLabel =
    systemTheme === "dark" ? m.themeDark : m.themeLight;

  const email =
    acct?.email?.trim() || accountEmail?.trim() || "";
  const displayName = acct?.displayName?.trim();
  const signedIn = acct?.signedIn ?? !!email;
  const loginBusy = busy || !!acct?.loginInProgress;

  const apiKeyLabel = !acct?.apiKeySet
    ? m.accountApiKeyNone
    : acct.apiKeySource === "env"
      ? m.accountApiKeyFromEnv
      : m.accountApiKeyFromDesktop;

  const copyDevice = async () => {
    const text = [deviceCode, deviceUrl].filter(Boolean).join("\n");
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setInfo(m.accountCopied);
    } catch {
      setError(m.accountCopyFailed);
    }
  };

  // Nav sections shown in the left rail. Each maps to one or more cards in
  // the right pane. Defaults to the most common entry point (account).
  const SECTIONS: { id: SettingsSectionId; label: string }[] = useMemo(
    () => [
      { id: "general", label: m.settingsNavGeneral },
      { id: "account", label: m.settingsNavAccount },
      { id: "models", label: m.settingsNavModels },
      { id: "mcp", label: m.settingsNavMcp },
      { id: "skills", label: m.settingsNavSkills },
      { id: "agent", label: m.settingsNavAgent },
      { id: "about", label: m.settingsNavAbout },
    ],
    [
      m.settingsNavGeneral,
      m.settingsNavAccount,
      m.settingsNavModels,
      m.settingsNavMcp,
      m.settingsNavSkills,
      m.settingsNavAgent,
      m.settingsNavAbout,
    ],
  );
  const [activeSection, setActiveSection] = useState<SettingsSectionId>(
    initialSection ?? "general",
  );
  const [navQuery, setNavQuery] = useState("");
  // Sync the active section when an external caller (composer dropdown,
  // etc.) requests a specific section while Settings is already mounted.
  // Uses a ref to ignore the very first mount — that's already handled by
  // useState's initial value above.
  const initialSectionSeen = useRef(false);
  useEffect(() => {
    if (!initialSectionSeen.current) {
      initialSectionSeen.current = true;
      // Still apply initialSection on first mount when provided.
      if (initialSection) setActiveSection(initialSection);
      return;
    }
    setActiveSection(initialSection ?? "general");
  }, [initialSection]);
  const filteredSections = useMemo(() => {
    const q = navQuery.trim().toLowerCase();
    if (!q) return SECTIONS;
    return SECTIONS.filter((s) => s.label.toLowerCase().includes(q));
  }, [navQuery, SECTIONS]);

  return (
    <div className="settings-page settings-page-nav">
      <aside className="settings-nav">
        <button
          type="button"
          className="settings-nav-back"
          onClick={onBack}
          title={m.settingsBackToApp}
          aria-label={m.settingsBackToApp}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none"
            stroke="currentColor" strokeWidth="1.4"
            strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M10 3l-5 5 5 5" />
          </svg>
          <span>{m.settingsBackToApp}</span>
        </button>

        <div className="settings-nav-search">
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none"
            stroke="currentColor" strokeWidth="1.4"
            strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <circle cx="7" cy="7" r="4.5" />
            <path d="M14 14l-3.5-3.5" />
          </svg>
          <input
            type="text"
            value={navQuery}
            onChange={(e) => setNavQuery(e.target.value)}
            placeholder={m.settingsSearchPlaceholder}
            spellCheck={false}
            autoComplete="off"
          />
        </div>

        <nav className="settings-nav-list" aria-label={m.settingsTitle}>
          {filteredSections.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`settings-nav-item ${
                activeSection === s.id ? "active" : ""
              }`}
              onClick={() => setActiveSection(s.id)}
              aria-current={activeSection === s.id ? "page" : undefined}
            >
              <SettingsNavIcon section={s.id} />
              <span>{s.label}</span>
            </button>
          ))}
          {filteredSections.length === 0 ? (
            <div className="settings-nav-empty">{m.settingsSearchPlaceholder}</div>
          ) : null}
        </nav>
      </aside>

      <div className="settings-pane">
        <header className="settings-pane-head">
          <h1 className="settings-pane-title">
            {SECTIONS.find((s) => s.id === activeSection)?.label}
          </h1>
        </header>

        {error ? <div className="settings-banner error">{error}</div> : null}
        {info ? <div className="settings-banner info">{info}</div> : null}

        <div className="settings-pane-body">
          {activeSection === "general" ? (
            <GeneralCards
              m={m}
              prefs={prefs}
              systemLocaleLabel={systemLocaleLabel}
              systemThemeLabel={systemThemeLabel}
              localeOptions={localeOptions}
              themeOptions={themeOptions}
              setLocale={setLocale}
              setTheme={setTheme}
              alwaysApprove={alwaysApprove}
              onSetAlwaysApprove={onSetAlwaysApprove}
              autoTrustNewSessions={autoTrustNewSessions}
              onSetAutoTrustNewSessions={onSetAutoTrustNewSessions}
            />
          ) : null}

          {activeSection === "account" ? (
            <AccountCards
              m={m}
              signedIn={signedIn}
              displayName={displayName}
              email={email}
              acct={acct}
              connectionLabel={connectionLabel}
              apiKeyLabel={apiKeyLabel}
              loginMsg={loginMsg}
              deviceUrl={deviceUrl}
              deviceCode={deviceCode}
              copyDevice={copyDevice}
              onCancelLogin={onCancelLogin}
              loginBusy={loginBusy}
              onLogin={onLogin}
              busy={busy}
              onLogout={onLogout}
              onReconnect={onReconnect}
              usage={usage}
              onRefreshUsageClick={onRefreshUsageClick}
              onManageBilling={onManageBilling}
              apiKeyField={
                <ApiKeyField
                  label={m.accountApiKeyLabel}
                  placeholder={m.accountApiKeyPlaceholder}
                  placeholderSet={m.accountApiKeyPlaceholderSet}
                  apiKeySet={!!acct?.apiKeySet}
                  showLabel={m.accountShow}
                  hideLabel={m.accountHide}
                  onSave={() => void onSaveApiKey()}
                  onClear={() => void onClearApiKey()}
                  busy={busy}
                  envSource={acct?.apiKeySource === "env"}
                  envHint={m.accountApiKeyEnvHint}
                  saveLabel={m.accountSaveApiKey}
                  clearLabel={m.accountClearApiKey}
                  draft={apiKeyDraft}
                  setDraft={setApiKeyDraft}
                  clearDisabled={!acct?.apiKeySet || acct.apiKeySource === "env"}
                />
              }
            />
          ) : null}

          {activeSection === "models" ? (
            <div className="settings-models-embed">
              <ModelsView
                onBack={onBack}
                m={m}
                onProvidersChanged={onProvidersChanged}
              />
            </div>
          ) : null}

          {activeSection === "mcp" ? (
            <div className="settings-ext-embed">
              <ExtensionsView
                m={m}
                embedded
                onlyTabs={["mcp"]}
                initialTab="mcp"
              />
            </div>
          ) : null}

          {activeSection === "skills" ? (
            <div className="settings-ext-embed">
              <ExtensionsView
                m={m}
                embedded
                onlyTabs={["skills"]}
                initialTab="skills"
              />
            </div>
          ) : null}

          {activeSection === "agent" ? (
            <AgentSettingsView
              status={installerStatus}
              lastCheck={lastUpdateCheckAt}
              m={m}
            />
          ) : null}

          {activeSection === "about" ? (
            <section className="settings-card">
              <div className="settings-card-head">
                <h2>{m.aboutSection}</h2>
                <p>{m.aboutSectionDesc}</p>
              </div>
              <div className="settings-info-list">
                <InfoRow label={m.appName} value="Grok Build Desktop" />
              </div>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** Tiny inline icon for each settings nav item. */
function SettingsNavIcon({
  section,
}: {
  section: SettingsSectionId;
}): React.ReactElement {
  const common = {
    width: 14,
    height: 14,
    viewBox: "0 0 16 16",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.4,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  switch (section) {
    case "general":
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="2.5" />
          <path d="M8 1.5v1.5M8 13v1.5M1.5 8h1.5M13 8h1.5M3.5 3.5l1 1M11.5 11.5l1 1M3.5 12.5l1-1M11.5 4.5l1-1" />
        </svg>
      );
    case "account":
      return (
        <svg {...common}>
          <circle cx="8" cy="6" r="2.5" />
          <path d="M3 13.5c.6-2.3 2.6-3.5 5-3.5s4.4 1.2 5 3.5" />
        </svg>
      );
    case "models":
      return (
        <svg {...common}>
          <path d="M8 1.5l5.5 3v6L8 13.5 2.5 10.5v-6z" />
          <path d="M8 7.5l5.5-3M8 7.5L2.5 4.5M8 7.5v6" />
        </svg>
      );
    case "mcp":
      return (
        <svg {...common}>
          <rect x="2.5" y="2.5" width="4" height="4" rx="1" />
          <rect x="9.5" y="2.5" width="4" height="4" rx="1" />
          <rect x="2.5" y="9.5" width="4" height="4" rx="1" />
          <path d="M6.5 4.5h3M4.5 6.5v3M11.5 6.5v3" />
        </svg>
      );
    case "skills":
      return (
        <svg {...common}>
          <path d="M8 2.5l1.5 3.2 3.5.4-2.6 2.4.7 3.4L8 10.2 4.9 11.9l.7-3.4L3 6.1l3.5-.4z" />
        </svg>
      );
    case "agent":
      return (
        <svg {...common}>
          <rect x="3" y="5" width="10" height="7" rx="1.5" />
          <path d="M6 5V3.5a2 2 0 014 0V5" />
          <circle cx="6" cy="8.5" r="0.6" fill="currentColor" />
          <circle cx="10" cy="8.5" r="0.6" fill="currentColor" />
          <path d="M6.5 10.5h3" />
        </svg>
      );
    case "about":
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="6" />
          <path d="M8 7v4.5M8 4.5v0.1" />
        </svg>
      );
  }
}

        {/* Section bodies are rendered by <AccountCards /> and
            <GeneralCards /> below — keeps this return statement legible
            while preserving every existing card. */}

// ── Section bodies ────────────────────────────────────
// Splitting these out keeps the main SettingsView return short. Each card
// here is the same JSX that used to live inline — verbatim, just relocated.

interface AccountCardsProps {
  m: Messages;
  signedIn: boolean;
  displayName: string | undefined;
  email: string;
  acct: AccountStatus | null;
  connectionLabel: string;
  apiKeyLabel: string;
  loginMsg: string | null;
  deviceUrl: string | null;
  deviceCode: string | null;
  copyDevice: () => Promise<void>;
  onCancelLogin: () => Promise<void>;
  loginBusy: boolean;
  onLogin: (method: "oauth" | "device") => Promise<void>;
  busy: boolean;
  onLogout: () => Promise<void>;
  onReconnect: () => Promise<void>;
  usage: UsageInfo | null | undefined;
  onRefreshUsageClick: () => Promise<void>;
  onManageBilling: () => Promise<void>;
  apiKeyField: React.ReactElement;
}

function AccountCards(props: AccountCardsProps): React.ReactElement {
  const {
    m,
    signedIn,
    displayName,
    email,
    acct,
    connectionLabel,
    apiKeyLabel,
    loginMsg,
    deviceUrl,
    deviceCode,
    copyDevice,
    onCancelLogin,
    loginBusy,
    onLogin,
    busy,
    onLogout,
    onReconnect,
    usage,
    onRefreshUsageClick,
    onManageBilling,
    apiKeyField,
  } = props;

  return (
    <>
      {/* ── Account identity & session ── */}
      <section className="settings-card">
        <div className="settings-card-head">
          <h2>{m.accountSection}</h2>
          <p>{m.accountSectionDesc}</p>
        </div>
        <div className="settings-info-list">
          <InfoRow
            label={m.signedInAs}
            value={
              signedIn
                ? displayName
                  ? `${displayName} (${email || "—"})`
                  : email || m.accountSessionActive
                : m.notSignedIn
            }
          />
          <InfoRow label={m.connectionStatus} value={connectionLabel} />
          {acct?.authMode ? (
            <InfoRow label={m.accountAuthMode} value={acct.authMode} />
          ) : null}
          {acct?.expiresAt ? (
            <InfoRow
              label={m.accountExpires}
              value={new Date(acct.expiresAt).toLocaleString()}
            />
          ) : null}
          {acct?.issuer ? (
            <InfoRow label={m.accountIssuer} value={acct.issuer} />
          ) : null}
          {acct?.teamId ? (
            <InfoRow label={m.accountTeamId} value={acct.teamId} />
          ) : null}
          <InfoRow label={m.accountApiKeyStatus} value={apiKeyLabel} />
        </div>

        {loginMsg || deviceUrl || deviceCode ? (
          <div className="account-login-panel">
            {loginMsg ? (
              <p className="account-login-msg">{loginMsg}</p>
            ) : null}
            {deviceCode ? (
              <div className="account-device-code" title={m.accountDeviceCode}>
                {deviceCode}
              </div>
            ) : null}
            {deviceUrl ? (
              <a
                className="account-device-url"
                href={deviceUrl}
                target="_blank"
                rel="noreferrer"
              >
                {deviceUrl}
              </a>
            ) : null}
            <div className="settings-actions">
              {deviceUrl || deviceCode ? (
                <button
                  type="button"
                  className="settings-btn"
                  onClick={() => void copyDevice()}
                >
                  {m.accountCopyCode}
                </button>
              ) : null}
              <button
                type="button"
                className="settings-btn danger"
                disabled={busy}
                onClick={() => void onCancelLogin()}
              >
                {m.accountCancelLogin}
              </button>
            </div>
          </div>
        ) : null}

        <div className="settings-actions">
          <button
            type="button"
            className="settings-btn primary"
            disabled={loginBusy}
            onClick={() => void onLogin("oauth")}
          >
            {m.accountLoginBrowser}
          </button>
          <button
            type="button"
            className="settings-btn"
            disabled={loginBusy}
            onClick={() => void onLogin("device")}
          >
            {m.accountLoginDevice}
          </button>
          <button
            type="button"
            className="settings-btn"
            disabled={busy || !signedIn}
            onClick={() => void onLogout()}
          >
            {m.accountLogout}
          </button>
          <button
            type="button"
            className="settings-btn"
            disabled={busy}
            onClick={() => void onReconnect()}
          >
            {m.accountReconnect}
          </button>
        </div>
        <p className="settings-help">{m.accountLoginHelp}</p>
      </section>

      {/* ── Usage / subscription ── */}
      <section className="settings-card">
        <div className="settings-card-head">
          <h2>{m.accountUsageSection}</h2>
          <p>{m.accountUsageDesc}</p>
        </div>
        {usage && !usage.error ? (
          <>
            <div className="account-usage-block settings-usage">
              <div className="account-usage-row">
                <span className="account-usage-label">{usage.usageLabel}</span>
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
            </div>
            <div className="settings-info-list">
              {usage.subscriptionTier ? (
                <InfoRow
                  label={m.accountUsageTier}
                  value={usage.subscriptionTier}
                />
              ) : null}
              {usage.periodEndDisplay ? (
                <InfoRow
                  label={m.accountUsageReset}
                  value={usage.periodEndDisplay}
                />
              ) : null}
              {usage.prepaidUsd !== undefined && usage.prepaidUsd > 0 ? (
                <InfoRow
                  label={m.accountUsageCredits}
                  value={`$${usage.prepaidUsd.toFixed(
                    Number.isInteger(usage.prepaidUsd) ? 0 : 2,
                  )}`}
                />
              ) : null}
              {usage.autoTopupEnabled !== undefined &&
              usage.prepaidUsd !== undefined &&
              usage.prepaidUsd > 0 ? (
                <InfoRow
                  label={m.accountUsageAutoTopup}
                  value={
                    usage.autoTopupEnabled && usage.autoTopupAmountUsd != null
                      ? `$${usage.autoTopupAmountUsd.toFixed(2)}${
                          usage.autoTopupMaxUsd != null
                            ? ` (max $${usage.autoTopupMaxUsd.toFixed(2)}/mo)`
                            : ""
                        }`
                      : m.accountUsageAutoTopupOff
                  }
                />
              ) : null}
              {usage.payAsYouGo &&
              usage.onDemandCapUsd != null &&
              usage.onDemandUsedUsd != null ? (
                <InfoRow
                  label={m.accountUsagePayg}
                  value={`$${usage.onDemandUsedUsd.toFixed(2)} / $${usage.onDemandCapUsd.toFixed(2)}`}
                />
              ) : null}
              {usage.fetchedAt ? (
                <InfoRow
                  label={m.accountUsageUpdated}
                  value={new Date(usage.fetchedAt).toLocaleString()}
                />
              ) : null}
            </div>
          </>
        ) : (
          <p className="settings-help">
            {usage?.error || m.accountUsageUnavailable}
          </p>
        )}
        <div className="settings-actions">
          <button
            type="button"
            className="settings-btn primary"
            disabled={busy}
            onClick={() => void onRefreshUsageClick()}
          >
            {m.accountUsageRefresh}
          </button>
          <button
            type="button"
            className="settings-btn"
            disabled={busy}
            onClick={() => void onManageBilling()}
          >
            {m.accountUsageManage}
          </button>
        </div>
      </section>

      {/* ── API Key ── */}
      <section className="settings-card">
        <div className="settings-card-head">
          <h2>{m.accountApiKeySection}</h2>
          <p>{m.accountApiKeyDesc}</p>
        </div>
        {apiKeyField}
      </section>
    </>
  );
}

interface GeneralCardsProps {
  m: Messages;
  prefs: UserPrefs;
  systemLocaleLabel: string;
  systemThemeLabel: string;
  localeOptions: { id: LocalePref; title: string }[];
  themeOptions: { id: ThemePref; title: string }[];
  setLocale: (next: LocalePref) => void;
  setTheme: (next: ThemePref) => void;
  alwaysApprove: boolean;
  onSetAlwaysApprove: (enabled: boolean) => void;
  autoTrustNewSessions: boolean;
  onSetAutoTrustNewSessions: (enabled: boolean) => void;
}

function GeneralCards(props: GeneralCardsProps): React.ReactElement {
  const {
    m,
    prefs,
    systemLocaleLabel,
    systemThemeLabel,
    localeOptions,
    themeOptions,
    setLocale,
    setTheme,
    alwaysApprove,
    onSetAlwaysApprove,
    autoTrustNewSessions,
    onSetAutoTrustNewSessions,
  } = props;

  return (
    <>
      <section className="settings-card">
        <div className="settings-card-head">
          <h2>{m.languageSection}</h2>
          <p>{m.languageDesc}</p>
        </div>
        <SelectField
          value={prefs.locale}
          ariaLabel={m.language}
          options={localeOptions.map((opt) => ({
            value: opt.id,
            label: opt.title,
          }))}
          onChange={setLocale}
        />
        {prefs.locale === "system" ? (
          <p className="settings-help">
            {m.currentResolved}: {systemLocaleLabel}
          </p>
        ) : null}
      </section>

      <section className="settings-card">
        <div className="settings-card-head">
          <h2>{m.appearanceSection}</h2>
          <p>{m.themeDesc}</p>
        </div>
        <SelectField
          value={prefs.theme}
          ariaLabel={m.theme}
          options={themeOptions.map((opt) => ({
            value: opt.id,
            label: opt.title,
          }))}
          onChange={setTheme}
        />
        {prefs.theme === "system" ? (
          <p className="settings-help">
            {m.currentResolved}: {systemThemeLabel}
          </p>
        ) : null}
      </section>

      <section className="settings-card">
        <div className="settings-card-head">
          <h2>{m.permissionsSection}</h2>
          <p>{m.permissionsSectionDesc}</p>
        </div>
        <div className="settings-row">
          <div className="settings-row-text">
            <h3 className="settings-subhead">{m.alwaysApproveSetting}</h3>
            <p>{m.alwaysApproveSettingDesc}</p>
          </div>
          <SelectField
            value={alwaysApprove ? "on" : "off"}
            ariaLabel={m.alwaysApproveSetting}
            options={[
              { value: "off", label: m.alwaysApproveDisabled },
              { value: "on", label: m.alwaysApproveEnabled },
            ]}
            onChange={(v) => onSetAlwaysApprove(v === "on")}
          />
        </div>

        <div className="settings-row">
          <div className="settings-row-text">
            <h3 className="settings-subhead">{m.autoTrustSetting}</h3>
            <p>{m.autoTrustSettingDesc}</p>
          </div>
          <SelectField
            value={autoTrustNewSessions ? "on" : "off"}
            ariaLabel={m.autoTrustSetting}
            options={[
              { value: "off", label: m.autoTrustDisabled },
              { value: "on", label: m.autoTrustEnabled },
            ]}
            onChange={(v) => onSetAutoTrustNewSessions(v === "on")}
          />
        </div>
      </section>
    </>
  );
}
