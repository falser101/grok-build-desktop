import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  ApiBackend,
  FetchedModelInfo,
  ModelProviderConfig,
  ModelProviderModel,
  ModelProviderPreset,
  ModelProviderRegion,
  ProviderUsageResult,
  UpsertProviderInput,
} from "@shared/types";
import type { Messages } from "./i18n";
import { usePrefs } from "./PrefsContext";

/** Memoised so toggling one row doesn't re-render every other row. */
const ModelRow = memo(function ModelRow({
  mod,
  onToggle,
  onToggle1M,
  m,
}: {
  mod: ModelProviderModel;
  onToggle: () => void;
  onToggle1M: () => void;
  m: Messages;
}) {
  const has1M =
    typeof mod.contextWindow === "number" && mod.contextWindow >= 1_000_000;
  return (
    <label className={`models-model-row ${mod.enabled ? "on" : ""}`}>
      <span className="models-model-check" aria-hidden>
        <input
          type="checkbox"
          checked={mod.enabled}
          onChange={onToggle}
        />
        <span className="models-model-check-box" />
      </span>
      <span className="models-model-text">
        <span className="models-model-name">{mod.name}</span>
        <span className="models-model-id">{mod.id}</span>
      </span>
      <span
        className={`models-source-badge ${mod.source}`}
        title={mod.source}
      >
        {mod.source === "fetched" ? m.modelsSourceFetched : m.modelsSourceManual}
      </span>
      <label
        className="models-1m-check"
        title={m.models1MTooltip}
        onClick={(e) => e.stopPropagation()}
      >
        <input
          type="checkbox"
          checked={has1M}
          onChange={onToggle1M}
        />
        <span className="models-1m-label">1M</span>
      </label>
    </label>
  );
});

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function regionOf(preset: ModelProviderPreset | undefined): ModelProviderRegion {
  return preset?.region ?? "local";
}

/** First non-ASCII letter for the avatar bubble (works for EN/ZH). */
function avatarChar(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  const ch = trimmed[0]!;
  // Strip emoji-style or multi-codepoint fall-through: just use first char.
  return ch.toUpperCase();
}

/**
 * Stable color slot for the avatar when no brand accent is set. Hashes the
 * preset / provider id into one of a small palette so visually similar ids
 * don't collide too often. Used as a fallback only — real presets carry an
 * `accent` hex that overrides this.
 */
function avatarColor(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = (h * 31 + name.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % 6;
}

/**
 * Inline style: brand accent if defined, else undefined (so the CSS slot
 * gradients from `.models-preset-avatar[data-slot="N"]` keep painting).
 */
function avatarStyle(
  accent: string | undefined,
): React.CSSProperties | undefined {
  if (accent) {
    return { background: accent, color: "#fff" };
  }
  return undefined;
}

/** True when a provider supports usage / balance queries (MiniMax, DeepSeek). */
function providerSupportsUsage(p: ModelProviderConfig): boolean {
  const id = (p.presetId || "").toLowerCase();
  const url = (p.baseUrl || "").toLowerCase();
  return (
    id === "minimax" ||
    id === "deepseek" ||
    url.includes("api.minimaxi.com") ||
    url.includes("api.minimax.io") ||
    url.includes("api.deepseek.com")
  );
}

/** Compact "remaining time until reset" label, e.g. "3h53m" / "6d12h" / "—". */
function formatResetCountdown(resetMs: number | undefined): string {
  if (!resetMs || !Number.isFinite(resetMs)) return "—";
  const now = Date.now();
  let diff = resetMs - now;
  if (diff <= 0) return "—";
  const totalMinutes = Math.floor(diff / 60_000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}d${hours}h`;
  if (hours > 0) return `${hours}h${minutes}m`;
  return `${minutes}m`;
}

/** Render a money amount compactly (≤2 decimals, drop trailing zeros). */
function formatBalanceAmount(
  amount: number,
  unit: string,
  short = false,
): string {
  const fixed = Math.abs(amount) >= 100 ? amount.toFixed(2) : amount.toFixed(2);
  // Trim trailing zeros after the decimal point: "266.87" / "12.50" → "12.5".
  const trimmed = fixed.replace(/\.?0+$/, "");
  if (short && unit === "CNY") {
    return `¥${trimmed}`;
  }
  if (short && unit === "USD") {
    return `$${trimmed}`;
  }
  return trimmed;
}

/** Human-friendly relative timestamp for the strip footer. */
function formatFetchedAgo(
  fetchedAt: string | undefined,
  m: Messages,
): string {
  if (!fetchedAt) return m.modelsUsageUnavailable;
  const t = Date.parse(fetchedAt);
  if (!Number.isFinite(t)) return m.modelsUsageUnavailable;
  const diffMin = Math.max(0, Math.floor((Date.now() - t) / 60_000));
  if (diffMin < 1) return m.modelsUsageJustNow;
  if (diffMin < 60) return m.modelsUsageMinutesAgo.replace("{n}", String(diffMin));
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return m.modelsUsageHoursAgo.replace("{n}", String(diffH));
  const diffD = Math.floor(diffH / 24);
  return m.modelsUsageDaysAgo.replace("{n}", String(diffD));
}

const USAGE_POLL_MS = 60_000;

/**
 * Per-card usage strip. Fetches MiniMax coding-plan quota, refreshes every
 * `USAGE_POLL_MS`, exposes a manual refresh button. Renders nothing if the
 * provider doesn't support usage queries — keeps MiniMax-only for now.
 */
const ProviderUsageStrip = memo(function ProviderUsageStrip({
  providerId,
  m,
}: {
  providerId: string;
  m: Messages;
}) {
  const [result, setResult] = useState<ProviderUsageResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const fetchOnce = useCallback(async () => {
    setLoading(true);
    try {
      const r = await window.desktop.queryProviderUsage(providerId);
      if (aliveRef.current) setResult(r);
    } catch (err) {
      if (aliveRef.current) {
        setResult({
          success: false,
          fetchedAt: new Date().toISOString(),
          error: errMsg(err),
        });
      }
    } finally {
      if (aliveRef.current) setLoading(false);
    }
  }, [providerId]);

  // Initial + polling
  useEffect(() => {
    void fetchOnce();
    const timer = setInterval(() => void fetchOnce(), USAGE_POLL_MS);
    return () => clearInterval(timer);
  }, [fetchOnce]);

  // Re-render every 30s so the countdown labels stay fresh.
  useEffect(() => {
    const t = setInterval(() => setTick((v) => v + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  const fetchedAt = result?.fetchedAt;
  const ago = formatFetchedAgo(fetchedAt, m);

  // Inline render so the empty / error / loading states don't shift the card.
  let body: React.ReactNode;
  if (!result) {
    body = (
      <span className="models-usage-loading">{m.modelsUsageLoading}</span>
    );
  } else if (!result.success || (!result.quota && !result.balance)) {
    const errMsg = result.error || m.modelsUsageErrorShort;
    // Truncate long error noise (raw body snippets) but keep the first
    // 60 chars so the user sees the actual reason (HTTP code, key error, etc).
    const shown =
      errMsg.length > 60 ? `${errMsg.slice(0, 60)}…` : errMsg;
    body = (
      <span className="models-usage-error" title={errMsg}>
        {shown}
      </span>
    );
  } else if (result.balance) {
    const bal = result.balance;
    const tone = bal.available === false ? "usage-high" : "usage-low";
    body = (
      <span className="models-usage-balance">
        <span className="models-usage-balance-label">
          {m.modelsUsageBalanceLabel}
        </span>
        <span className={`models-usage-value ${tone}`}>
          {formatBalanceAmount(bal.remaining, bal.unit)}
        </span>
        <span className="models-usage-reset">
          {bal.unit}
          {bal.grantedBalance !== undefined && bal.toppedUpBalance !== undefined
            ? ` · ${m.modelsUsageBalanceBreakdown
                .replace("{g}", formatBalanceAmount(bal.grantedBalance, bal.unit, true))
                .replace("{t}", formatBalanceAmount(bal.toppedUpBalance, bal.unit, true))}`
            : ""}
        </span>
      </span>
    );
  } else {
    // Coding-plan quota branch (MiniMax 5h / 7d).
    const quota = result.quota;
    if (!quota) {
      body = (
        <span className="models-usage-error">
          {m.modelsUsageErrorShort}
        </span>
      );
    } else {
      body = (
        <>
          {typeof quota.fiveHourPct === "number" ? (
            <span
              className={`models-usage-cell ${usageClass(quota.fiveHourPct)}`}
            >
              <span className="models-usage-label">
                {m.modelsUsageFiveHour}
              </span>
              <span className="models-usage-value">
                {Math.round(quota.fiveHourPct)}%
              </span>
              <span className="models-usage-reset">
                ⏱ {formatResetCountdown(quota.fiveHourResetMs)}
              </span>
            </span>
          ) : null}
          {typeof quota.sevenDayPct === "number" ? (
            <span
              className={`models-usage-cell ${usageClass(quota.sevenDayPct)}`}
            >
              <span className="models-usage-label">
                {m.modelsUsageSevenDay}
              </span>
              <span className="models-usage-value">
                {Math.round(quota.sevenDayPct)}%
              </span>
              <span className="models-usage-reset">
                ⏱ {formatResetCountdown(quota.sevenDayResetMs)}
              </span>
            </span>
          ) : null}
        </>
      );
    }
  }

  return (
    <div
      className="models-usage-strip"
      // tick drives the relative-time + countdown re-renders without forcing
      // a refetch on every interval.
      data-tick={tick}
    >
      <div className="models-usage-body">{body}</div>
      <div className="models-usage-meta">
        <span className="models-usage-time" title={fetchedAt}>
          ⏱ {ago}
        </span>
        <button
          type="button"
          className="models-usage-refresh"
          onClick={() => void fetchOnce()}
          disabled={loading}
          title={m.modelsUsageRefresh}
          aria-label={m.modelsUsageRefresh}
        >
          {loading ? "…" : "↻"}
        </button>
      </div>
    </div>
  );
});

/** Color tier: green ≤60, amber ≤85, red >85. */
function usageClass(pct: number): string {
  if (pct > 85) return "usage-high";
  if (pct > 60) return "usage-mid";
  return "usage-low";
}

type EditorState = {
  id?: string;
  presetId?: string;
  name: string;
  baseUrl: string;
  apiBackend: ApiBackend;
  apiKey: string;
  envKey: string;
  enabled: boolean;
  authStyle: "bearer" | "x-api-key";
  models: ModelProviderModel[];
  /** Models from last fetch (not yet all enabled). */
  fetched: FetchedModelInfo[];
  fetchError?: string;
};

function emptyEditor(preset?: ModelProviderPreset): EditorState {
  return {
    presetId: preset?.id,
    name: preset?.name ?? "",
    baseUrl: preset?.baseUrl ?? "",
    apiBackend: preset?.apiBackend ?? "chat_completions",
    apiKey: "",
    envKey: preset?.envKey ?? "",
    enabled: true,
    authStyle: preset?.authStyle ?? "bearer",
    models: [],
    fetched: [],
  };
}

function fromProvider(
  p: ModelProviderConfig,
  preset?: ModelProviderPreset,
): EditorState {
  // Catalog providers always show the official full endpoint for the protocol.
  let baseUrl = p.baseUrl;
  if (preset && preset.id !== "custom") {
    const mapped = preset.protocolEndpoints?.[p.apiBackend];
    if (mapped) baseUrl = mapped;
    else if (p.apiBackend === preset.apiBackend && preset.baseUrl) {
      baseUrl = preset.baseUrl;
    }
  }
  return {
    id: p.id,
    presetId: p.presetId,
    name: p.name,
    baseUrl,
    apiBackend: p.apiBackend,
    apiKey: p.apiKey ?? "",
    envKey: p.envKey ?? "",
    enabled: p.enabled,
    authStyle: p.authStyle ?? "bearer",
    models: p.models.map((m) => ({ ...m })),
    fetched: [],
  };
}

/** Format an ISO-ish date string in compact form. */
function formatDate(ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function ModelsView({
  onBack,
  m,
  onProvidersChanged,
}: {
  onBack: () => void;
  m: Messages;
  /** Called after save/delete so chat can refresh grouping. */
  onProvidersChanged?: () => void;
}) {
  const { resolvedLocale } = usePrefs();
  const zh = resolvedLocale === "zh";

  const [presets, setPresets] = useState<ModelProviderPreset[]>([]);
  const [providers, setProviders] = useState<ModelProviderConfig[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const [presetPickerOpen, setPresetPickerOpen] = useState(false);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [manualId, setManualId] = useState("");
  const [manualName, setManualName] = useState("");
  const [filter, setFilter] = useState("");
  const [fetchFilter, setFetchFilter] = useState("");
  const [presetSearch, setPresetSearch] = useState("");

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const [p, pr] = await Promise.all([
        window.desktop.listModelPresets(),
        window.desktop.listModelProviders(),
      ]);
      setPresets(p);
      setProviders(pr);
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const presetById = useMemo(() => {
    const map = new Map<string, ModelProviderPreset>();
    for (const p of presets) map.set(p.id, p);
    return map;
  }, [presets]);

  const usedPresetIds = useMemo(() => {
    const s = new Set<string>();
    for (const p of providers) {
      if (p.presetId) s.add(p.presetId);
    }
    return s;
  }, [providers]);

  const q = filter.trim().toLowerCase();
  const filteredProviders = useMemo(
    () =>
      !q
        ? providers
        : providers.filter(
            (p) =>
              p.name.toLowerCase().includes(q) ||
              p.baseUrl.toLowerCase().includes(q) ||
              p.models.some(
                (m) =>
                  m.id.toLowerCase().includes(q) ||
                  m.name.toLowerCase().includes(q),
              ),
          ),
    [providers, q],
  );

  const stats = useMemo(() => {
    const enabled = providers.filter((p) => p.enabled);
    const totalModels = providers.reduce(
      (acc, p) => acc + p.models.filter((m) => m.enabled).length,
      0,
    );
    const enabledProviders = enabled.length;
    return {
      enabledProviders,
      totalProviders: providers.length,
      totalModels,
    };
  }, [providers]);

  const run = async (fn: () => Promise<void>, okMsg?: string) => {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await fn();
      if (okMsg) setInfo(okMsg);
      await load();
      onProvidersChanged?.();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  const openNewFromPreset = (preset: ModelProviderPreset) => {
    setEditor(emptyEditor(preset));
    setPresetPickerOpen(false);
    setManualId("");
    setManualName("");
    setFetchFilter("");
    setInfo(null);
    setError(null);
    // Scroll the editor into view.
    requestAnimationFrame(() => {
      const el = document.querySelector(".models-editor-card");
      el?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  const openNewCustom = () => {
    const custom = presets.find((p) => p.id === "custom");
    setEditor(emptyEditor(custom));
    setPresetPickerOpen(false);
    setManualId("");
    setManualName("");
    setFetchFilter("");
    requestAnimationFrame(() => {
      const el = document.querySelector(".models-editor-card");
      el?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  const openEdit = (p: ModelProviderConfig) => {
    const preset = p.presetId ? presetById.get(p.presetId) : undefined;
    setEditor(fromProvider(p, preset));
    setPresetPickerOpen(false);
    setManualId("");
    setManualName("");
    setFetchFilter("");
    setInfo(null);
    setError(null);
    requestAnimationFrame(() => {
      const el = document.querySelector(".models-editor-card");
      el?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  const closeEditor = () => {
    setEditor(null);
    setManualId("");
    setManualName("");
    setFetchFilter("");
  };

  const onSave = () => {
    if (!editor) return;
    void run(async () => {
      const input: UpsertProviderInput = {
        id: editor.id,
        presetId: editor.presetId,
        name: editor.name.trim(),
        baseUrl: editor.baseUrl.trim(),
        apiBackend: editor.apiBackend,
        apiKey: editor.apiKey.trim() || null,
        envKey: editor.envKey.trim() || null,
        enabled: editor.enabled,
        authStyle: editor.authStyle,
        models: editor.models.map((m) => ({
          id: m.id,
          name: m.name,
          configKey: m.configKey || undefined,
          source: m.source,
          enabled: m.enabled,
          contextWindow: m.contextWindow,
        })),
      };
      if (!input.name) throw new Error(m.modelsNameRequired);
      if (!input.baseUrl && editor.presetId !== "ollama") {
        // allow empty only for rare cases; still warn for custom without URL
        if (editor.presetId === "custom" || !editor.presetId) {
          throw new Error(m.modelsBaseUrlRequired);
        }
      }
      await window.desktop.upsertModelProvider(input);
      closeEditor();
    }, m.modelsSaved);
  };

  const onDelete = (id: string, name: string) => {
    if (!window.confirm(m.modelsDeleteConfirm.replace("{name}", name))) return;
    void run(async () => {
      await window.desktop.deleteModelProvider(id);
      if (editor?.id === id) closeEditor();
    }, m.modelsDeleted);
  };

  const onToggleProvider = (p: ModelProviderConfig) => {
    void run(async () => {
      await window.desktop.upsertModelProvider({
        id: p.id,
        enabled: !p.enabled,
      });
    });
  };

  const onFetch = () => {
    if (!editor) return;
    void (async () => {
      setBusy(true);
      setError(null);
      setEditor((e) => (e ? { ...e, fetchError: undefined } : e));
      try {
        const listBase =
          editorPreset?.modelsListBaseUrl ||
          editorPreset?.protocolEndpoints?.chat_completions ||
          editor.baseUrl;
        const list = await window.desktop.fetchProviderModels({
          baseUrl: listBase.trim(),
          apiKey: editor.apiKey.trim() || undefined,
          envKey: editor.envKey.trim() || undefined,
          authStyle: editor.authStyle,
        });
        setEditor((e) => {
          if (!e) return e;
          // Merge fetched into models list (keep existing enable flags)
          const byId = new Map(e.models.map((m) => [m.id, m]));
          for (const f of list) {
            if (!byId.has(f.id)) {
              byId.set(f.id, {
                id: f.id,
                name: f.name,
                configKey: "",
                source: "fetched",
                enabled: false,
              });
            } else {
              const cur = byId.get(f.id)!;
              byId.set(f.id, {
                ...cur,
                source: cur.source === "manual" ? "manual" : "fetched",
                name: cur.name || f.name,
              });
            }
          }
          return {
            ...e,
            fetched: list,
            models: Array.from(byId.values()).sort((a, b) =>
              a.id.localeCompare(b.id),
            ),
          };
        });
        setInfo(
          m.modelsFetchedCount.replace("{n}", String(list.length)),
        );
      } catch (err) {
        const msg = errMsg(err);
        setEditor((e) => (e ? { ...e, fetchError: msg } : e));
        setError(msg);
      } finally {
        setBusy(false);
      }
    })();
  };

  const onAddManual = () => {
    if (!editor) return;
    const id = manualId.trim();
    if (!id) return;
    const name = manualName.trim() || id;
    setEditor((e) => {
      if (!e) return e;
      if (e.models.some((m) => m.id === id)) {
        return {
          ...e,
          models: e.models.map((m) =>
            m.id === id ? { ...m, name, enabled: true } : m,
          ),
        };
      }
      return {
        ...e,
        models: [
          ...e.models,
          {
            id,
            name,
            configKey: "",
            source: "manual",
            enabled: true,
          },
        ],
      };
    });
    setManualId("");
    setManualName("");
  };

  const toggleModel = (modelId: string) => {
    setEditor((e) => {
      if (!e) return e;
      return {
        ...e,
        models: e.models.map((m) =>
          m.id === modelId ? { ...m, enabled: !m.enabled } : m,
        ),
      };
    });
  };

  const toggle1M = (modelId: string) => {
    setEditor((e) => {
      if (!e) return e;
      return {
        ...e,
        models: e.models.map((m) =>
          m.id === modelId
            ? {
                ...m,
                contextWindow:
                  typeof m.contextWindow === "number" &&
                  m.contextWindow >= 1_000_000
                    ? undefined
                    : 1_000_000,
              }
            : m,
        ),
      };
    });
  };

  const setAllFetched = (enabled: boolean) => {
    setEditor((e) => {
      if (!e) return e;
      const fetchedIds = new Set(e.fetched.map((f) => f.id));
      // If no fetch yet, operate on all models
      const target = fetchedIds.size > 0 ? fetchedIds : null;
      return {
        ...e,
        models: e.models.map((m) =>
          !target || target.has(m.id) ? { ...m, enabled } : m,
        ),
      };
    });
  };

  const onReconnect = () =>
    void run(async () => {
      await window.desktop.reconnectAgent();
    }, m.modelsReconnected);

  const presetsByRegion = useMemo(() => {
    const groups: {
      region: ModelProviderRegion;
      label: string;
      items: ModelProviderPreset[];
    }[] = [
      { region: "intl", label: m.modelsRegionIntl, items: [] },
      { region: "cn", label: m.modelsRegionCn, items: [] },
      { region: "local", label: m.modelsRegionLocal, items: [] },
    ];
    for (const p of presets) {
      const g = groups.find((x) => x.region === p.region);
      g?.items.push(p);
    }
    return groups.filter((g) => g.items.length > 0);
  }, [presets, m.modelsRegionIntl, m.modelsRegionCn, m.modelsRegionLocal]);

  const presetQuery = presetSearch.trim().toLowerCase();
  const filteredPresetsByRegion = useMemo(() => {
    if (!presetQuery) return presetsByRegion;
    return presetsByRegion
      .map((g) => ({
        ...g,
        items: g.items.filter(
          (p) =>
            p.name.toLowerCase().includes(presetQuery) ||
            p.nameZh.toLowerCase().includes(presetQuery) ||
            (p.baseUrl || "").toLowerCase().includes(presetQuery),
        ),
      }))
      .filter((g) => g.items.length > 0);
  }, [presetsByRegion, presetQuery]);

  const fq = fetchFilter.trim().toLowerCase();
  const editorModelsVisible = useMemo(() => {
    if (!editor) return [];
    if (!fq) return editor.models;
    return editor.models.filter(
      (m) =>
        m.id.toLowerCase().includes(fq) || m.name.toLowerCase().includes(fq),
    );
  }, [editor, fq]);

  const enabledCount = (p: ModelProviderConfig) =>
    p.models.filter((m) => m.enabled).length;

  const editorEnabledCount = editor
    ? editor.models.filter((m) => m.enabled).length
    : 0;

  const editorPreset =
    editor?.presetId ? presetById.get(editor.presetId) : undefined;
  const editorRegion = regionOf(editorPreset);
  /** Catalog providers lock the endpoint; only custom is free-form. */
  const baseUrlLocked = Boolean(
    editor?.presetId && editor.presetId !== "custom",
  );
  const protocolOptions: {
    value: ApiBackend;
    label: string;
  }[] = (() => {
    const endpoints = editorPreset?.protocolEndpoints;
    if (endpoints && Object.keys(endpoints).length > 0) {
      const labels: Record<ApiBackend, string> = {
        chat_completions: m.modelsBackendChatCompletions,
        responses: m.modelsBackendResponses,
        messages: m.modelsBackendMessages,
      };
      return (Object.keys(endpoints) as ApiBackend[]).map((value) => ({
        value,
        label: `${labels[value]} — ${endpoints[value]}`,
      }));
    }
    return [
      {
        value: "chat_completions",
        label: m.modelsBackendChatCompletionsDefault,
      },
      { value: "responses", label: m.modelsBackendResponses },
      { value: "messages", label: m.modelsBackendMessages },
    ];
  })();

  const applyBackend = (apiBackend: ApiBackend) => {
    setEditor((ed) => {
      if (!ed) return ed;
      const preset = ed.presetId ? presetById.get(ed.presetId) : undefined;
      let baseUrl = ed.baseUrl;
      if (preset && preset.id !== "custom") {
        const mapped = preset.protocolEndpoints?.[apiBackend];
        if (mapped) baseUrl = mapped;
        else if (apiBackend === preset.apiBackend) baseUrl = preset.baseUrl;
      }
      return { ...ed, apiBackend, baseUrl };
    });
  };

  return (
    <div className="settings-page ext-page models-page">
      <header className="settings-header models-hero">
        <div className="models-hero-row">
          <button type="button" className="settings-back" onClick={onBack}>
            ← {m.backToChat}
          </button>
        </div>
        <div className="models-hero-row">
          <div className="models-hero-text">
            <h1 className="settings-title">{m.modelsTitle}</h1>
            <p className="settings-subtitle">{m.modelsSubtitle}</p>
          </div>
          <div className="models-hero-actions">
            <button
              type="button"
              className="ext-btn"
              disabled={busy}
              onClick={() => void load()}
              title={m.extRefresh}
            >
              <span className="ext-btn-icon" aria-hidden>
                ↻
              </span>
              <span>{m.extRefresh}</span>
            </button>
            <button
              type="button"
              className="ext-btn"
              disabled={busy}
              onClick={() => onReconnect()}
              title={m.modelsReconnectHint}
            >
              <span className="ext-btn-icon" aria-hidden>
                ⤴
              </span>
              <span>{m.modelsReconnect}</span>
            </button>
            <button
              type="button"
              className={`ext-btn primary models-add-btn ${
                presetPickerOpen ? "active" : ""
              }`}
              onClick={() => {
                setPresetPickerOpen((v) => !v);
                setEditor(null);
              }}
            >
              <span className="ext-btn-icon" aria-hidden>
                +
              </span>
              <span>{m.modelsAddProvider}</span>
            </button>
          </div>
        </div>
        {providers.length > 0 ? (
          <div className="models-stats">
            <span className="models-stat">
              <strong>{stats.enabledProviders}</strong>
              <span>/ {stats.totalProviders}</span>
              <span className="models-stat-label">
                {m.extEnabled.toLowerCase()}
              </span>
            </span>
            <span className="models-stat-sep" aria-hidden />
            <span className="models-stat">
              <strong>{stats.totalModels}</strong>
              <span className="models-stat-label">
                {m.modelsEnabledModelsStat}
              </span>
            </span>
          </div>
        ) : null}
      </header>

      {error ? (
        <div className="settings-sections models-body">
          <div className="settings-banner error">{error}</div>
        </div>
      ) : null}
      {info ? (
        <div className="settings-sections models-body">
          <div className="settings-banner info">{info}</div>
        </div>
      ) : null}

      <div className="settings-sections models-body">
        {/* ── Preset picker ── */}
        {presetPickerOpen ? (
          <section className="settings-card models-presets">
            <div className="settings-card-head">
              <h2>{m.modelsChoosePreset}</h2>
              <p>{m.modelsChoosePresetHint}</p>
            </div>
            <div className="models-preset-search">
              <input
                className="ext-filter"
                value={presetSearch}
                onChange={(e) => setPresetSearch(e.target.value)}
                placeholder={m.modelsPresetSearchPlaceholder}
              />
            </div>
            {filteredPresetsByRegion.length === 0 ? (
              <div className="ext-empty">{m.modelsEmpty}</div>
            ) : (
              filteredPresetsByRegion.map((g) => (
                <div key={g.region} className="models-preset-group">
                  <div className="models-preset-region">{g.label}</div>
                  <div className="models-preset-grid">
                    {g.items.map((preset) => {
                      const used = usedPresetIds.has(preset.id);
                      return (
                        <button
                          key={preset.id}
                          type="button"
                          className={`models-preset-card region-${preset.region} ${
                            used ? "used" : ""
                          }`}
                          onClick={() => openNewFromPreset(preset)}
                        >
                          <span
                            className="models-preset-avatar"
                            data-slot={avatarColor(preset.id)}
                            style={avatarStyle(preset.accent)}
                          >
                            {preset.logo ? (
                              <img
                                src={preset.logo}
                                alt=""
                                className="models-preset-logo"
                                draggable={false}
                              />
                            ) : (
                              avatarChar(
                                zh
                                  ? preset.nameZh || preset.name
                                  : preset.name,
                              )
                            )}
                          </span>
                          <span className="models-preset-body">
                            <span className="models-preset-name">
                              {zh ? preset.nameZh : preset.name}
                            </span>
                            <span className="models-preset-url">
                              {preset.baseUrl || m.modelsCustomEndpoint}
                            </span>
                          </span>
                          <span
                            className="models-preset-arrow"
                            aria-hidden
                          >
                            →
                          </span>
                          {used ? (
                            <span className="models-preset-used">
                              ✓ {m.modelsPresetAdded}
                            </span>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))
            )}
            <div className="settings-actions">
              <button
                type="button"
                className="settings-btn"
                onClick={() => openNewCustom()}
              >
                {m.modelsCustomEndpoint}
              </button>
              <button
                type="button"
                className="settings-btn"
                onClick={() => setPresetPickerOpen(false)}
              >
                {m.extCancel}
              </button>
            </div>
          </section>
        ) : null}

        {/* ── Editor ── */}
        {editor ? (
          <section
            className={`settings-card models-editor-card region-${editorRegion}`}
          >
            <div className="settings-card-head models-editor-head">
              <div className="models-editor-head-main">
                <span
                  className="models-preset-avatar"
                  data-slot={avatarColor(
                    editorPreset?.id || editor.name || "x",
                  )}
                  style={avatarStyle(editorPreset?.accent)}
                >
                  {editorPreset?.logo ? (
                    <img
                      src={editorPreset.logo}
                      alt=""
                      className="models-preset-logo"
                      draggable={false}
                    />
                  ) : (
                    avatarChar(editor.name)
                  )}
                </span>
                <div>
                  <h2>
                    {editor.id ? m.modelsEditProvider : m.modelsAddProvider}
                    {editorPreset
                      ? ` · ${
                          zh
                            ? editorPreset.nameZh || editorPreset.name
                            : editorPreset.name
                        }`
                      : ""}
                  </h2>
                  <p>{m.modelsEditorHint}</p>
                </div>
              </div>
              <button
                type="button"
                className="models-editor-close"
                onClick={closeEditor}
                aria-label={m.extCancel}
                title={m.extCancel}
              >
                ×
              </button>
            </div>

            {/* Section: Connection */}
            <div className="models-section">
              <h3 className="models-section-title">
                <span className="models-section-num">1</span>
                {m.modelsSectionConnection}
              </h3>
              <div className="ext-form-grid models-form-grid">
                <label>
                  <span>{m.modelsProviderName}</span>
                  <input
                    className="ext-filter"
                    value={editor.name}
                    onChange={(e) =>
                      setEditor((ed) =>
                        ed ? { ...ed, name: e.target.value } : ed,
                      )
                    }
                    placeholder="OpenAI"
                  />
                </label>
                <label>
                  <span>{m.modelsBaseUrl}</span>
                  <input
                    className="ext-filter"
                    value={editor.baseUrl}
                    onChange={(e) =>
                      setEditor((ed) =>
                        ed ? { ...ed, baseUrl: e.target.value } : ed,
                      )
                    }
                    placeholder="https://api.example.com/v1"
                    readOnly={baseUrlLocked}
                    disabled={baseUrlLocked}
                    title={
                      baseUrlLocked
                        ? zh
                          ? "已选提供商的接口地址由协议决定，不可修改"
                          : "Endpoint is fixed for this provider (follows protocol)"
                        : undefined
                    }
                  />
                  {baseUrlLocked ? (
                    <span className="settings-help models-field-hint">
                      {m.modelsEndpointFixedHint}
                    </span>
                  ) : null}
                </label>
                <label>
                  <span>{m.modelsApiKey}</span>
                  <input
                    className="ext-filter"
                    type="password"
                    autoComplete="off"
                    value={editor.apiKey}
                    onChange={(e) =>
                      setEditor((ed) =>
                        ed ? { ...ed, apiKey: e.target.value } : ed,
                      )
                    }
                    placeholder={m.modelsApiKeyPlaceholder}
                  />
                </label>
                <label>
                  <span>{m.modelsEnvKey}</span>
                  <input
                    className="ext-filter"
                    value={editor.envKey}
                    onChange={(e) =>
                      setEditor((ed) =>
                        ed ? { ...ed, envKey: e.target.value } : ed,
                      )
                    }
                    placeholder="OPENAI_API_KEY"
                  />
                </label>
              </div>
            </div>

            {/* Section: Auth & Backend */}
            <div className="models-section">
              <h3 className="models-section-title">
                <span className="models-section-num">2</span>
                {m.modelsSectionAuth}
              </h3>
              <div className="ext-form-grid models-form-grid">
                <label>
                  <span>{m.modelsApiBackend}</span>
                  <select
                    className="ext-filter"
                    value={editor.apiBackend}
                    onChange={(e) =>
                      applyBackend(e.target.value as ApiBackend)
                    }
                  >
                    {protocolOptions.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                  <span className="settings-help models-field-hint">
                    {m.modelsProtocolHint}
                  </span>
                </label>
                <label>
                  <span>{m.modelsAuthStyle}</span>
                  <select
                    className="ext-filter"
                    value={editor.authStyle}
                    onChange={(e) =>
                      setEditor((ed) =>
                        ed
                          ? {
                              ...ed,
                              authStyle: e.target.value as
                                | "bearer"
                                | "x-api-key",
                            }
                          : ed,
                      )
                    }
                  >
                    <option value="bearer">Bearer</option>
                    <option value="x-api-key">x-api-key</option>
                  </select>
                </label>
              </div>
              <label className="models-switch-row">
                <span className="models-switch-text">
                  <span className="models-switch-title">
                    {m.modelsProviderEnabled}
                  </span>
                  <span className="models-switch-desc">
                    {zh
                      ? "关闭后此提供商不会出现在选择器中"
                      : "Disable to hide this provider from the picker"}
                  </span>
                </span>
                <span className="models-switch">
                  <input
                    type="checkbox"
                    checked={editor.enabled}
                    onChange={(e) =>
                      setEditor((ed) =>
                        ed ? { ...ed, enabled: e.target.checked } : ed,
                      )
                    }
                  />
                  <span className="models-switch-track" aria-hidden>
                    <span className="models-switch-thumb" />
                  </span>
                </span>
              </label>
            </div>

            {/* Section: Models */}
            <div className="models-section models-models-section">
              <div className="models-models-head">
                <h3 className="models-section-title">
                  <span className="models-section-num">3</span>
                  {m.modelsListTitle}
                  <span className="models-section-count">
                    {editorEnabledCount}/{editor.models.length}
                  </span>
                </h3>
                <div className="ext-toolbar models-models-toolbar">
                  <button
                    type="button"
                    className="ext-btn primary"
                    disabled={busy || !editor.baseUrl.trim()}
                    onClick={() => onFetch()}
                  >
                    {m.modelsFetch}
                  </button>
                  <button
                    type="button"
                    className="ext-btn"
                    disabled={busy || editor.models.length === 0}
                    onClick={() => setAllFetched(true)}
                  >
                    {m.modelsEnableAll}
                  </button>
                  <button
                    type="button"
                    className="ext-btn"
                    disabled={busy || editor.models.length === 0}
                    onClick={() => setAllFetched(false)}
                  >
                    {m.modelsDisableAll}
                  </button>
                </div>
              </div>
              <p className="settings-help">{m.modelsFetchHint}</p>
              {editor.fetchError ? (
                <div className="settings-banner error">
                  {editor.fetchError}
                </div>
              ) : null}

              <div className="models-manual-row">
                <input
                  className="ext-filter"
                  value={manualId}
                  onChange={(e) => setManualId(e.target.value)}
                  placeholder={m.modelsManualIdPlaceholder}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      onAddManual();
                    }
                  }}
                />
                <input
                  className="ext-filter"
                  value={manualName}
                  onChange={(e) => setManualName(e.target.value)}
                  placeholder={m.modelsManualNamePlaceholder}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      onAddManual();
                    }
                  }}
                />
                <button
                  type="button"
                  className="ext-btn"
                  disabled={!manualId.trim()}
                  onClick={() => onAddManual()}
                >
                  {m.modelsAddManual}
                </button>
              </div>

              <input
                className="ext-filter models-model-filter"
                value={fetchFilter}
                onChange={(e) => setFetchFilter(e.target.value)}
                placeholder={m.modelsFilterModels}
              />

              <div className="models-model-list">
                {editorModelsVisible.length === 0 ? (
                  <div className="ext-empty">{m.modelsNoModelsYet}</div>
                ) : (
                  editorModelsVisible.map((mod) => (
                    <ModelRow
                      key={mod.id}
                      mod={mod}
                      onToggle={() => toggleModel(mod.id)}
                      onToggle1M={() => toggle1M(mod.id)}
                      m={m}
                    />
                  ))
                )}
              </div>
              <p className="settings-help">
                {m.modelsEnabledCount.replace(
                  "{n}",
                  String(editorEnabledCount),
                )}
              </p>
            </div>

            <div className="settings-actions models-editor-actions">
              <button
                type="button"
                className="settings-btn primary"
                disabled={busy}
                onClick={() => onSave()}
              >
                {m.extSave}
              </button>
              <button
                type="button"
                className="settings-btn"
                disabled={busy}
                onClick={() => closeEditor()}
              >
                {m.extCancel}
              </button>
              {editor.id ? (
                <button
                  type="button"
                  className="settings-btn danger models-editor-delete"
                  disabled={busy}
                  onClick={() => onDelete(editor.id!, editor.name)}
                >
                  {m.extRemove}
                </button>
              ) : null}
            </div>
          </section>
        ) : null}

        {/* ── Provider list ── */}
        {!editor && !presetPickerOpen ? (
          <>
            <div className="models-searchbar">
              <span className="models-searchbar-icon" aria-hidden>
                ⌕
              </span>
              <input
                className="models-searchbar-input"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder={m.modelsGlobalSearchPlaceholder}
              />
              {filter ? (
                <button
                  type="button"
                  className="models-searchbar-clear"
                  onClick={() => setFilter("")}
                  aria-label={m.modelsClearSearchAria}
                >
                  ×
                </button>
              ) : null}
            </div>

            {filteredProviders.length === 0 ? (
              <div className="settings-card models-empty-card">
                <div className="models-empty-icon" aria-hidden>
                  ◇
                </div>
                <h3 className="models-empty-title">
                  {providers.length === 0
                    ? m.modelsEmpty.split(".")[0]
                    : m.modelsEmptyNoMatches}
                </h3>
                <p className="models-empty-text">
                  {providers.length === 0
                    ? m.modelsEmpty
                    : m.modelsEmptyNoMatchesHint}
                </p>
                {providers.length === 0 ? (
                  <button
                    type="button"
                    className="ext-btn primary"
                    onClick={() => setPresetPickerOpen(true)}
                  >
                    {m.modelsAddProvider}
                  </button>
                ) : null}
              </div>
            ) : (
              <div className="models-provider-grid">
                {filteredProviders.map((p) => {
                  const preset = p.presetId
                    ? presetById.get(p.presetId)
                    : undefined;
                  const region = regionOf(preset);
                  const regionLabel =
                    region === "cn"
                      ? m.modelsRegionCn
                      : region === "local"
                        ? m.modelsRegionLocal
                        : m.modelsRegionIntl;
                  const count = enabledCount(p);
                  const total = p.models.length;
                  return (
                    <article
                      key={p.id}
                      className={`models-provider-card region-${region} ${
                        p.enabled ? "" : "disabled"
                      }`}
                    >
                      <div className="models-provider-card-top">
                        <span
                          className="models-preset-avatar models-provider-avatar"
                          data-slot={avatarColor(p.presetId || p.id)}
                          style={avatarStyle(preset?.accent)}
                        >
                          {preset?.logo ? (
                            <img
                              src={preset.logo}
                              alt=""
                              className="models-preset-logo"
                              draggable={false}
                            />
                          ) : (
                            avatarChar(p.name)
                          )}
                        </span>
                        <div className="models-provider-title-wrap">
                          <h3 className="models-provider-title">{p.name}</h3>
                          <div className="models-provider-meta">
                            <span className={`ext-badge region-pill region-${region}`}>
                              {regionLabel}
                            </span>
                            <span className="models-provider-api">
                              {p.apiBackend}
                            </span>
                            {!p.enabled ? (
                              <span className="ext-badge danger-pill">
                                {m.extDisabled}
                              </span>
                            ) : null}
                          </div>
                        </div>
                        <span
                          className="models-provider-count"
                          title={m.modelsEnabledCount.replace(
                            "{n}",
                            String(count),
                          )}
                        >
                          <strong>{count}</strong>
                          <span>/{total}</span>
                        </span>
                      </div>
                      <div className="models-provider-url">{p.baseUrl || "—"}</div>
                      {providerSupportsUsage(p) ? (
                        <ProviderUsageStrip providerId={p.id} m={m} />
                      ) : null}
                      {count > 0 ? (
                        <div className="models-provider-models">
                          {p.models
                            .filter((x) => x.enabled)
                            .slice(0, 6)
                            .map((x) => (
                              <span key={x.configKey || x.id} className="chip">
                                {x.name}
                              </span>
                            ))}
                          {count > 6 ? (
                            <span className="chip">+{count - 6}</span>
                          ) : null}
                        </div>
                      ) : (
                        <div className="models-provider-models-empty">
                          {m.modelsNoModelsInProvider}
                        </div>
                      )}
                      <div className="models-provider-foot">
                        <span className="models-provider-updated">
                          {formatDate(p.updatedAt || p.createdAt || Date.now())}
                        </span>
                        <div className="models-provider-actions">
                          <span className="models-switch models-switch-sm">
                            <input
                              type="checkbox"
                              checked={p.enabled}
                              disabled={busy}
                              onChange={() => onToggleProvider(p)}
                              aria-label={m.modelsProviderEnabled}
                            />
                            <span className="models-switch-track" aria-hidden>
                              <span className="models-switch-thumb" />
                            </span>
                          </span>
                          <button
                            type="button"
                            className="models-provider-btn"
                            disabled={busy}
                            onClick={() => openEdit(p)}
                            title={m.modelsEdit}
                          >
                            {m.modelsEdit}
                          </button>
                          <button
                            type="button"
                            className="models-provider-btn danger"
                            disabled={busy}
                            onClick={() => onDelete(p.id, p.name)}
                            title={m.extRemove}
                            aria-label={m.extRemove}
                          >
                            ×
                          </button>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}

            <div className="models-footnote-card">
              <span className="models-footnote-icon" aria-hidden>
                ⓘ
              </span>
              <p>{m.modelsFootnote}</p>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}