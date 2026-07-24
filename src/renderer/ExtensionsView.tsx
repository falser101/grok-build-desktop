import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  HookEntry,
  McpServerEntry,
  PluginEntry,
  SkillCatalogEntry,
  SkillEntry,
  TrustedFolderEntry,
} from "@shared/types";
import type { Messages } from "./i18n";

function formatInstallCount(n: number | undefined): string | null {
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0) return null;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(Math.round(n));
}

export type ExtTab = "mcp" | "skills" | "plugins" | "hooks" | "trust";

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function ScopeBadge({ label }: { label: string }) {
  return <span className="ext-badge">{label}</span>;
}

function Toggle({
  on,
  disabled,
  onChange,
  labelOn,
  labelOff,
}: {
  on: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
  labelOn: string;
  labelOff: string;
}) {
  return (
    <button
      type="button"
      className={`ext-toggle ${on ? "on" : "off"}`}
      disabled={disabled}
      aria-pressed={on}
      onClick={() => onChange(!on)}
      title={on ? labelOn : labelOff}
    >
      {on ? labelOn : labelOff}
    </button>
  );
}

export function ExtensionsView({
  onBack,
  initialTab = "mcp",
  m,
  /** When true, hide page chrome (for Settings embed). */
  embedded = false,
  /** Limit visible tabs (e.g. only mcp inside Settings). */
  onlyTabs,
}: {
  onBack?: () => void;
  initialTab?: ExtTab;
  m: Messages;
  embedded?: boolean;
  onlyTabs?: ExtTab[];
}) {
  const [tab, setTab] = useState<ExtTab>(initialTab);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const [mcp, setMcp] = useState<McpServerEntry[]>([]);
  const [skills, setSkills] = useState<SkillEntry[]>([]);
  const [plugins, setPlugins] = useState<PluginEntry[]>([]);
  const [hooks, setHooks] = useState<HookEntry[]>([]);
  const [hookPreview, setHookPreview] = useState<{
    path: string;
    text: string;
  } | null>(null);
  // Trusted folders panel: list + per-row revoke (see trusted-folders-store.ts).
  const [trusted, setTrusted] = useState<TrustedFolderEntry[]>([]);
  const [revoking, setRevoking] = useState<string | null>(null);

  // MCP form
  const [showAddMcp, setShowAddMcp] = useState(false);
  const [mcpName, setMcpName] = useState("");
  const [mcpTransport, setMcpTransport] = useState<"stdio" | "http" | "sse">(
    "stdio",
  );
  const [mcpCmd, setMcpCmd] = useState("");
  const [mcpArgs, setMcpArgs] = useState("");
  const [mcpScope, setMcpScope] = useState<"user" | "project">("user");

  // Plugin install
  const [pluginSource, setPluginSource] = useState("");
  const [showMarketplace, setShowMarketplace] = useState(false);

  // Skills catalog (skills.sh)
  const [showAddSkill, setShowAddSkill] = useState(false);
  const [skillQuery, setSkillQuery] = useState("");
  const [skillPackage, setSkillPackage] = useState("");
  const [skillScope, setSkillScope] = useState<"user" | "project">("user");
  const [catalog, setCatalog] = useState<SkillCatalogEntry[]>([]);
  const [catalogSearched, setCatalogSearched] = useState(false);
  const [installingId, setInstallingId] = useState<string | null>(null);

  const [filter, setFilter] = useState("");

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    if (onlyTabs?.length && !onlyTabs.includes(tab)) {
      setTab(onlyTabs[0]!);
    }
  }, [onlyTabs, tab]);

  const load = useCallback(async (which: ExtTab, marketplace = false) => {
    setBusy(true);
    setError(null);
    try {
      if (which === "mcp") {
        setMcp(await window.desktop.listMcpServers());
      } else if (which === "skills") {
        setSkills(await window.desktop.listSkills());
      } else if (which === "plugins") {
        setPlugins(await window.desktop.listPlugins(marketplace));
      } else if (which === "trust") {
        setTrusted(await window.desktop.listTrustedFolders());
      } else {
        setHooks(await window.desktop.listHooks());
      }
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load(tab, showMarketplace && tab === "plugins");
  }, [tab, load, showMarketplace]);

  const revokeTrust = useCallback(
    async (path: string) => {
      if (typeof window === "undefined" || !window.confirm) return;
      if (!window.confirm(m.trustEntryRevokeConfirm)) return;
      setRevoking(path);
      setError(null);
      setInfo(null);
      try {
        const flipped = await window.desktop.revokeTrustedFolder(path);
        // Reload from disk so the panel reflects the canonical store
        // (also picks up any concurrent agent-side writes — e.g. a
        // `HooksAction::Untrust` fired from another session).
        const next = await window.desktop.listTrustedFolders();
        setTrusted(next);
        setInfo(
          flipped ? m.trustEntryRevoked : m.trustEntryRevokeFailed,
        );
      } catch (err) {
        setError(`${m.trustEntryRevokeFailed}: ${errMsg(err)}`);
      } finally {
        setRevoking(null);
      }
    },
    [m.trustEntryRevokeConfirm, m.trustEntryRevoked, m.trustEntryRevokeFailed],
  );

  const q = filter.trim().toLowerCase();

  const filteredMcp = useMemo(
    () =>
      !q
        ? mcp
        : mcp.filter(
            (s) =>
              s.name.toLowerCase().includes(q) ||
              s.detail.toLowerCase().includes(q),
          ),
    [mcp, q],
  );

  const filteredSkills = useMemo(
    () =>
      !q
        ? skills
        : skills.filter(
            (s) =>
              s.name.toLowerCase().includes(q) ||
              s.description.toLowerCase().includes(q),
          ),
    [skills, q],
  );

  const filteredPlugins = useMemo(
    () =>
      !q
        ? plugins
        : plugins.filter(
            (p) =>
              p.name.toLowerCase().includes(q) ||
              (p.description || "").toLowerCase().includes(q) ||
              (p.marketplace || "").toLowerCase().includes(q),
          ),
    [plugins, q],
  );

  const filteredHooks = useMemo(
    () =>
      !q
        ? hooks
        : hooks.filter(
            (h) =>
              h.name.toLowerCase().includes(q) ||
              h.events.some((e) => e.toLowerCase().includes(q)) ||
              h.path.toLowerCase().includes(q),
          ),
    [hooks, q],
  );

  const run = async (fn: () => Promise<void>, okMsg?: string) => {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await fn();
      if (okMsg) setInfo(okMsg);
      await load(tab, showMarketplace && tab === "plugins");
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  const onAddMcp = () =>
    void run(async () => {
      const args = mcpArgs
        .trim()
        .split(/\s+/)
        .filter(Boolean);
      await window.desktop.addMcpServer({
        name: mcpName.trim(),
        transport: mcpTransport,
        commandOrUrl: mcpCmd.trim(),
        args: mcpTransport === "stdio" ? args : undefined,
        scope: mcpScope,
      });
      setShowAddMcp(false);
      setMcpName("");
      setMcpCmd("");
      setMcpArgs("");
    }, m.extSaved);

  const onSearchSkills = () =>
    void (async () => {
      const q = skillQuery.trim();
      if (!q) return;
      setBusy(true);
      setError(null);
      setInfo(null);
      try {
        const hits = await window.desktop.searchSkillCatalog(q);
        setCatalog(hits);
        setCatalogSearched(true);
      } catch (err) {
        setError(errMsg(err));
      } finally {
        setBusy(false);
      }
    })();

  const onInstallCatalogSkill = (entry: SkillCatalogEntry) =>
    void run(async () => {
      setInstallingId(entry.id);
      try {
        const result = await window.desktop.installSkill({
          source: entry.source,
          skillId: entry.skillId,
          scope: skillScope,
        });
        setInfo(result.message || m.extSkillInstalled);
      } finally {
        setInstallingId(null);
      }
    });

  const onInstallPackage = () =>
    void run(async () => {
      const pkg = skillPackage.trim();
      if (!pkg) return;
      setInstallingId(pkg);
      try {
        const result = await window.desktop.installSkill({
          source: pkg,
          scope: skillScope,
        });
        setInfo(result.message || m.extSkillInstalled);
        setSkillPackage("");
      } finally {
        setInstallingId(null);
      }
    });

  const allTabs: { id: ExtTab; label: string }[] = [
    { id: "mcp", label: m.extTabMcp },
    { id: "skills", label: m.extTabSkills },
    { id: "plugins", label: m.extTabPlugins },
    { id: "hooks", label: m.extTabHooks },
    { id: "trust", label: m.extTabTrust },
  ];
  const tabs = onlyTabs?.length
    ? allTabs.filter((t) => onlyTabs.includes(t.id))
    : allTabs;
  const showTabBar = !embedded || tabs.length > 1;

  return (
    <div
      className={`ext-page${embedded ? " ext-page-embed" : " settings-page"}`}
    >
      {!embedded ? (
        <header className="settings-header">
          <button
            type="button"
            className="settings-back"
            onClick={() => onBack?.()}
          >
            ← {m.backToChat}
          </button>
          <h1 className="settings-title">{m.extTitle}</h1>
          <p className="settings-subtitle">{m.extSubtitle}</p>
        </header>
      ) : null}

      {showTabBar ? (
        <div className="ext-tabs" role="tablist">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              className={`ext-tab ${tab === t.id ? "active" : ""}`}
              onClick={() => {
                setFilter("");
                setHookPreview(null);
                setTab(t.id);
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      ) : null}

      <div className="ext-toolbar">
        {tab === "trust" ? null : (
          <input
            className="ext-filter"
            type="search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={m.extFilter}
            aria-label={m.extFilter}
          />
        )}
        <button
          type="button"
          className="ext-btn"
          disabled={busy}
          onClick={() => void load(tab, showMarketplace && tab === "plugins")}
        >
          {m.extRefresh}
        </button>
        {tab === "mcp" ? (
          <button
            type="button"
            className="ext-btn primary"
            disabled={busy}
            onClick={() => setShowAddMcp((v) => !v)}
          >
            {showAddMcp ? m.extCancel : m.extAddMcp}
          </button>
        ) : null}
        {tab === "skills" ? (
          <button
            type="button"
            className="ext-btn primary"
            disabled={busy}
            onClick={() => setShowAddSkill((v) => !v)}
          >
            {showAddSkill ? m.extCancel : m.extAddSkill}
          </button>
        ) : null}
        {tab === "plugins" ? (
          <button
            type="button"
            className={`ext-btn ${showMarketplace ? "active" : ""}`}
            disabled={busy}
            onClick={() => setShowMarketplace((v) => !v)}
          >
            {showMarketplace ? m.extInstalledOnly : m.extShowMarketplace}
          </button>
        ) : null}
      </div>

      {error ? <div className="ext-banner error">{error}</div> : null}
      {info ? <div className="ext-banner info">{info}</div> : null}
      {busy ? <div className="ext-busy">{m.filesLoading}</div> : null}

      {tab === "mcp" && showAddMcp ? (
        <section className="settings-card ext-form">
          <div className="settings-card-head">
            <h2>{m.extAddMcp}</h2>
            <p>{m.extAddMcpHint}</p>
          </div>
          <div className="ext-form-grid">
            <label>
              <span>{m.extMcpName}</span>
              <input
                value={mcpName}
                onChange={(e) => setMcpName(e.target.value)}
                placeholder="my-server"
              />
            </label>
            <label>
              <span>{m.extMcpTransport}</span>
              <select
                value={mcpTransport}
                onChange={(e) =>
                  setMcpTransport(e.target.value as "stdio" | "http" | "sse")
                }
              >
                <option value="stdio">stdio</option>
                <option value="http">http</option>
                <option value="sse">sse</option>
              </select>
            </label>
            <label className="span-2">
              <span>
                {mcpTransport === "stdio" ? m.extMcpCommand : m.extMcpUrl}
              </span>
              <input
                value={mcpCmd}
                onChange={(e) => setMcpCmd(e.target.value)}
                placeholder={
                  mcpTransport === "stdio"
                    ? "npx -y @modelcontextprotocol/server-filesystem"
                    : "https://mcp.example.com/mcp"
                }
              />
            </label>
            {mcpTransport === "stdio" ? (
              <label className="span-2">
                <span>{m.extMcpArgs}</span>
                <input
                  value={mcpArgs}
                  onChange={(e) => setMcpArgs(e.target.value)}
                  placeholder="/path/to/dir"
                />
              </label>
            ) : null}
            <label>
              <span>{m.extScope}</span>
              <select
                value={mcpScope}
                onChange={(e) =>
                  setMcpScope(e.target.value as "user" | "project")
                }
              >
                <option value="user">{m.extScopeUser}</option>
                <option value="project">{m.extScopeProject}</option>
              </select>
            </label>
            <div className="ext-form-actions span-2">
              <button
                type="button"
                className="ext-btn primary"
                disabled={busy || !mcpName.trim() || !mcpCmd.trim()}
                onClick={onAddMcp}
              >
                {m.extSave}
              </button>
            </div>
          </div>
        </section>
      ) : null}

      {tab === "skills" && showAddSkill ? (
        <section className="settings-card ext-form">
          <div className="settings-card-head">
            <h2>{m.extAddSkill}</h2>
            <p>{m.extAddSkillHint}</p>
          </div>
          <div className="ext-form-grid">
            <label className="span-2">
              <span>{m.extSkillSearch}</span>
              <div className="ext-inline-form">
                <input
                  value={skillQuery}
                  onChange={(e) => setSkillQuery(e.target.value)}
                  placeholder={m.extSkillSearchPlaceholder}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      onSearchSkills();
                    }
                  }}
                />
                <button
                  type="button"
                  className="ext-btn primary"
                  disabled={busy || !skillQuery.trim()}
                  onClick={onSearchSkills}
                >
                  {m.extSkillSearchBtn}
                </button>
              </div>
            </label>
            <label>
              <span>{m.extScope}</span>
              <select
                value={skillScope}
                onChange={(e) =>
                  setSkillScope(e.target.value as "user" | "project")
                }
              >
                <option value="user">{m.extScopeUser}</option>
                <option value="project">{m.extScopeProject}</option>
              </select>
            </label>
            <div className="ext-form-actions">
              <button
                type="button"
                className="ext-btn"
                onClick={() => void window.desktop.openExternal("https://skills.sh/")}
              >
                {m.extSkillOpenCatalog}
              </button>
            </div>
            <label className="span-2">
              <span>{m.extSkillPackage}</span>
              <div className="ext-inline-form">
                <input
                  value={skillPackage}
                  onChange={(e) => setSkillPackage(e.target.value)}
                  placeholder={m.extSkillPackagePlaceholder}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      onInstallPackage();
                    }
                  }}
                />
                <button
                  type="button"
                  className="ext-btn primary"
                  disabled={busy || !skillPackage.trim()}
                  onClick={onInstallPackage}
                >
                  {installingId === skillPackage.trim()
                    ? m.extSkillInstalling
                    : m.extInstall}
                </button>
              </div>
              <span className="ext-field-hint">{m.extSkillPackageHint}</span>
            </label>
          </div>
          {catalogSearched ? (
            <div className="ext-catalog-list">
              {catalog.length === 0 ? (
                <div className="ext-empty">{m.extSkillSearchEmpty}</div>
              ) : (
                catalog.map((entry) => {
                  const installs = formatInstallCount(entry.installs);
                  const busyThis = installingId === entry.id;
                  return (
                    <div className="ext-row" key={entry.id}>
                      <div className="ext-row-main">
                        <div className="ext-row-title">
                          <strong>{entry.name}</strong>
                          <ScopeBadge label={entry.source} />
                          {installs ? (
                            <ScopeBadge
                              label={m.extSkillInstalls.replace("{n}", installs)}
                            />
                          ) : null}
                        </div>
                        <div className="ext-row-detail" title={entry.url}>
                          <button
                            type="button"
                            className="ext-link-btn"
                            onClick={() =>
                              void window.desktop.openExternal(entry.url)
                            }
                          >
                            {entry.id}
                          </button>
                        </div>
                      </div>
                      <div className="ext-row-actions">
                        <button
                          type="button"
                          className="ext-btn primary"
                          disabled={busy || !!installingId}
                          onClick={() => onInstallCatalogSkill(entry)}
                        >
                          {busyThis ? m.extSkillInstalling : m.extInstall}
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          ) : null}
        </section>
      ) : null}

      {tab === "plugins" ? (
        <section className="settings-card ext-form">
          <div className="settings-card-head">
            <h2>{m.extInstallPlugin}</h2>
            <p>{m.extInstallPluginHint}</p>
          </div>
          <div className="ext-inline-form">
            <input
              value={pluginSource}
              onChange={(e) => setPluginSource(e.target.value)}
              placeholder="owner/repo  or  https://…  or  /path"
            />
            <button
              type="button"
              className="ext-btn primary"
              disabled={busy || !pluginSource.trim()}
              onClick={() =>
                void run(async () => {
                  await window.desktop.installPlugin(pluginSource.trim());
                  setPluginSource("");
                }, m.extSaved)
              }
            >
              {m.extInstall}
            </button>
          </div>
        </section>
      ) : null}

      <div className="ext-list">
        {tab === "mcp" &&
          (filteredMcp.length === 0 && !busy ? (
            <div className="ext-empty">{m.extMcpEmpty}</div>
          ) : (
            filteredMcp.map((s) => (
              <div className="ext-row" key={`${s.scope}:${s.name}`}>
                <div className="ext-row-main">
                  <div className="ext-row-title">
                    <strong>{s.displayName || s.name}</strong>
                    {s.status ? (
                      <span
                        className={`ext-status-badge status-${s.status}`}
                        title={s.status}
                      >
                        {s.status === "ready"
                          ? m.extMcpStatusReady
                          : s.status === "initializing"
                            ? m.extMcpStatusInit
                            : s.status === "needs_auth"
                              ? m.extMcpStatusAuth
                              : s.status === "setup_required"
                                ? m.extMcpStatusSetup
                                : m.extMcpStatusDown}
                      </span>
                    ) : null}
                    {s.source ? <ScopeBadge label={s.source} /> : null}
                    <ScopeBadge label={s.transport} />
                    {typeof s.toolCount === "number" ? (
                      <ScopeBadge
                        label={m.extMcpTools.replace(
                          "{n}",
                          String(s.toolCount),
                        )}
                      />
                    ) : null}
                    {!s.enabled ? (
                      <ScopeBadge label={m.extDisabled} />
                    ) : null}
                  </div>
                  <div className="ext-row-detail" title={s.detail}>
                    {s.detail || s.name || "—"}
                  </div>
                </div>
                <div className="ext-row-actions">
                  <Toggle
                    on={s.enabled}
                    disabled={busy}
                    labelOn={m.extEnabled}
                    labelOff={m.extDisabled}
                    onChange={(next) =>
                      void run(async () => {
                        await window.desktop.setMcpEnabled(
                          s.name,
                          next,
                          s.scope,
                        );
                      })
                    }
                  />
                  <button
                    type="button"
                    className="ext-btn danger"
                    disabled={busy}
                    onClick={() => {
                      if (!confirm(m.extRemoveConfirm.replace("{name}", s.name)))
                        return;
                      void run(async () => {
                        await window.desktop.removeMcpServer(s.name, s.scope);
                      }, m.extSaved);
                    }}
                  >
                    {m.extRemove}
                  </button>
                </div>
              </div>
            ))
          ))}

        {tab === "skills" &&
          (filteredSkills.length === 0 && !busy ? (
            <div className="ext-empty">{m.extSkillsEmpty}</div>
          ) : (
            filteredSkills.map((s) => (
              <div className="ext-row" key={`${s.scope}:${s.path}`}>
                <div className="ext-row-main">
                  <div className="ext-row-title">
                    <strong>{s.name}</strong>
                    <ScopeBadge label={s.scope} />
                    {s.disabled ? (
                      <ScopeBadge label={m.extDisabled} />
                    ) : null}
                  </div>
                  <div className="ext-row-detail" title={s.description}>
                    {s.description || s.path}
                  </div>
                </div>
                <div className="ext-row-actions">
                  <Toggle
                    on={!s.disabled}
                    disabled={busy}
                    labelOn={m.extEnabled}
                    labelOff={m.extDisabled}
                    onChange={(next) =>
                      void run(async () => {
                        await window.desktop.setSkillDisabled(s.name, !next);
                      })
                    }
                  />
                </div>
              </div>
            ))
          ))}

        {tab === "plugins" &&
          (filteredPlugins.length === 0 && !busy ? (
            <div className="ext-empty">{m.extPluginsEmpty}</div>
          ) : (
            filteredPlugins.map((p) => (
              <div
                className="ext-row"
                key={`${p.status}:${p.marketplace || ""}:${p.name}`}
              >
                <div className="ext-row-main">
                  <div className="ext-row-title">
                    <strong>{p.name}</strong>
                    <ScopeBadge
                      label={
                        p.status === "available"
                          ? m.extAvailable
                          : m.extInstalled
                      }
                    />
                    {p.marketplace ? (
                      <ScopeBadge label={p.marketplace} />
                    ) : null}
                    {p.version ? <ScopeBadge label={p.version} /> : null}
                  </div>
                  <div className="ext-row-detail" title={p.description || p.path}>
                    {p.description ||
                      p.source ||
                      p.path ||
                      (p.skillCount != null
                        ? `${p.skillCount} skills`
                        : "—")}
                  </div>
                </div>
                <div className="ext-row-actions">
                  {p.status === "installed" ? (
                    <>
                      <Toggle
                        on={p.enabled !== false}
                        disabled={busy}
                        labelOn={m.extEnabled}
                        labelOff={m.extDisabled}
                        onChange={(next) =>
                          void run(async () => {
                            await window.desktop.setPluginEnabled(p.name, next);
                          })
                        }
                      />
                      <button
                        type="button"
                        className="ext-btn danger"
                        disabled={busy}
                        onClick={() => {
                          if (
                            !confirm(
                              m.extUninstallConfirm.replace("{name}", p.name),
                            )
                          )
                            return;
                          void run(async () => {
                            await window.desktop.uninstallPlugin(p.name);
                          }, m.extSaved);
                        }}
                      >
                        {m.extUninstall}
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="ext-btn primary"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          const source = p.marketplace
                            ? p.name
                            : p.name;
                          await window.desktop.installPlugin(source);
                        }, m.extSaved)
                      }
                    >
                      {m.extInstall}
                    </button>
                  )}
                </div>
              </div>
            ))
          ))}

        {tab === "hooks" &&
          (filteredHooks.length === 0 && !busy ? (
            <div className="ext-empty">{m.extHooksEmpty}</div>
          ) : (
            filteredHooks.map((h) => (
              <div className="ext-row" key={h.path}>
                <div className="ext-row-main">
                  <div className="ext-row-title">
                    <strong>{h.name}</strong>
                    <ScopeBadge label={h.scope} />
                  </div>
                  <div className="ext-row-detail" title={h.path}>
                    {h.events.join(", ")}
                    {h.commandCount != null
                      ? ` · ${h.commandCount} hook(s)`
                      : ""}
                  </div>
                  <div className="ext-row-path">{h.path}</div>
                </div>
                <div className="ext-row-actions">
                  <button
                    type="button"
                    className="ext-btn"
                    disabled={busy}
                    onClick={() =>
                      void (async () => {
                        setBusy(true);
                        setError(null);
                        try {
                          const text = await window.desktop.readHookFile(
                            h.path,
                          );
                          setHookPreview({ path: h.path, text });
                        } catch (err) {
                          setError(errMsg(err));
                        } finally {
                          setBusy(false);
                        }
                      })()
                    }
                  >
                    {m.extView}
                  </button>
                </div>
              </div>
            ))
          ))}

        {tab === "trust" ? (
          <section className="settings-card trust-panel">
            <div className="settings-card-head">
              <h2>{m.trustPanelTitle}</h2>
              <p>{m.trustPanelSubtitle}</p>
            </div>
            {trusted.length === 0 && !busy ? (
              <div className="ext-empty">{m.trustPanelEmpty}</div>
            ) : (
              <ul className="trust-list" role="list">
                {trusted.map((entry) => (
                  <li
                    key={entry.path}
                    className={`trust-row trust-row-${entry.trusted ? "trusted" : "declined"}`}
                  >
                    <div className="trust-row-main">
                      <div className="trust-row-head">
                        <span
                          className={`ext-badge trust-status ${entry.trusted ? "ok" : "warn"}`}
                        >
                          {entry.trusted
                            ? m.trustEntryTrusted
                            : m.trustEntryDeclined}
                        </span>
                      </div>
                      <div
                        className="trust-row-path"
                        title={entry.path}
                      >
                        <span className="trust-row-label">
                          {m.trustEntryPathLabel}
                        </span>{" "}
                        <code>{entry.path}</code>
                      </div>
                      {entry.decidedAt ? (
                        <div className="trust-row-decided">
                          <span className="trust-row-label">
                            {m.trustEntryDecidedAtLabel}
                          </span>{" "}
                          <time dateTime={entry.decidedAt}>
                            {entry.decidedAt}
                          </time>
                        </div>
                      ) : null}
                    </div>
                    <div className="trust-row-actions">
                      {entry.trusted ? (
                        <button
                          type="button"
                          className="ext-btn"
                          disabled={busy || revoking === entry.path}
                          onClick={() => void revokeTrust(entry.path)}
                        >
                          {m.trustEntryRevoke}
                        </button>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : null}
      </div>

      {hookPreview ? (
        <section className="settings-card ext-preview">
          <div className="ext-preview-head">
            <h2>{hookPreview.path}</h2>
            <button
              type="button"
              className="ext-btn"
              onClick={() => setHookPreview(null)}
            >
              {m.filesClose}
            </button>
          </div>
          <pre className="ext-preview-body">{hookPreview.text}</pre>
        </section>
      ) : null}

      <p className="ext-footnote">{m.extFootnote}</p>
    </div>
  );
}
