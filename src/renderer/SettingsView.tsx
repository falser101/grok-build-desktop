import { memo, useCallback, useEffect, useMemo, useState } from "react";
import type {
  AccountStatus,
  InstallerStatus,
  UsageInfo,
} from "@shared/types";
import { usePrefs } from "./PrefsContext";
import type { LocalePref, ThemePref } from "./prefs";
import { AgentSettingsView } from "./AgentSettingsView";

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

  return (
    <div className="settings-page">
      <header className="settings-header">
        <button type="button" className="settings-back" onClick={onBack}>
          ← {m.backToChat}
        </button>
        <h1 className="settings-title">{m.settingsTitle}</h1>
        <p className="settings-subtitle">{m.settingsSubtitle}</p>
      </header>

      <div className="settings-sections">
        {error ? <div className="settings-banner error">{error}</div> : null}
        {info ? <div className="settings-banner info">{info}</div> : null}

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
        </section>

        <AgentSettingsView
          status={installerStatus}
          lastCheck={lastUpdateCheckAt}
          m={m}
        />

        <section className="settings-card">
          <div className="settings-card-head">
            <h2>{m.languageSection}</h2>
            <p>{m.languageDesc}</p>
          </div>
          <div
            className="settings-options"
            role="radiogroup"
            aria-label={m.language}
          >
            {localeOptions.map((opt) => (
              <OptionCard
                key={opt.id}
                value={opt.id}
                selected={prefs.locale === opt.id}
                title={opt.title}
                description={
                  opt.id === "system"
                    ? `${m.currentResolved}: ${systemLocaleLabel}`
                    : undefined
                }
                onSelect={setLocale}
              />
            ))}
          </div>
        </section>

        <section className="settings-card">
          <div className="settings-card-head">
            <h2>{m.appearanceSection}</h2>
            <p>{m.themeDesc}</p>
          </div>
          <div
            className="settings-options"
            role="radiogroup"
            aria-label={m.theme}
          >
            {themeOptions.map((opt) => (
              <OptionCard
                key={opt.id}
                value={opt.id}
                selected={prefs.theme === opt.id}
                title={opt.title}
                description={
                  opt.id === "system"
                    ? `${m.currentResolved}: ${systemThemeLabel}`
                    : undefined
                }
                onSelect={setTheme}
              />
            ))}
          </div>
        </section>

        <section className="settings-card">
          <div className="settings-card-head">
            <h2>{m.permissionsSection}</h2>
            <p>{m.permissionsSectionDesc}</p>
          </div>
          <div className="settings-card-head" style={{ marginBottom: 8 }}>
            <h3 className="settings-subhead">{m.alwaysApproveSetting}</h3>
            <p>{m.alwaysApproveSettingDesc}</p>
          </div>
          <div
            className="settings-options"
            role="radiogroup"
            aria-label={m.alwaysApproveSetting}
          >
            <OptionCard
              value="off"
              selected={!alwaysApprove}
              title={m.alwaysApproveDisabled}
              onSelect={() => onSetAlwaysApprove(false)}
            />
            <OptionCard
              value="on"
              selected={alwaysApprove}
              title={m.alwaysApproveEnabled}
              onSelect={() => onSetAlwaysApprove(true)}
            />
          </div>

          <div className="settings-card-head" style={{ marginBottom: 8, marginTop: 16 }}>
            <h3 className="settings-subhead">{m.autoTrustSetting}</h3>
            <p>{m.autoTrustSettingDesc}</p>
          </div>
          <div
            className="settings-options"
            role="radiogroup"
            aria-label={m.autoTrustSetting}
          >
            <OptionCard
              value="off"
              selected={!autoTrustNewSessions}
              title={m.autoTrustDisabled}
              onSelect={() => onSetAutoTrustNewSessions(false)}
            />
            <OptionCard
              value="on"
              selected={autoTrustNewSessions}
              title={m.autoTrustEnabled}
              onSelect={() => onSetAutoTrustNewSessions(true)}
            />
          </div>
        </section>

        <section className="settings-card">
          <div className="settings-card-head">
            <h2>{m.aboutSection}</h2>
            <p>{m.aboutSectionDesc}</p>
          </div>
          <div className="settings-info-list">
            <InfoRow label={m.appName} value="Grok Build Desktop" />
          </div>
        </section>
      </div>
    </div>
  );
}
