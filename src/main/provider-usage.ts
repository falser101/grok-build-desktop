/**
 * Provider usage / quota / balance queries.
 *
 * Currently supported:
 *   - MiniMax Coding Plan (国内站 api.minimaxi.com / 国际站 api.minimax.io)
 *     GET /v1/api/openplatform/coding_plan/remains → coding-plan quota (5h / 7d).
 *   - DeepSeek (api.deepseek.com) pay-as-you-go balance
 *     GET /user/balance → remaining CNY/USD.
 *
 * Endpoint + response-shape references: cc-switch
 * `src-tauri/src/services/coding_plan.rs` (query_minimax) and
 * `src-tauri/src/services/balance.rs` (query_deepseek).
 */

export interface ProviderUsageQuota {
  fiveHourPct?: number;
  fiveHourResetMs?: number;
  sevenDayPct?: number;
  sevenDayResetMs?: number;
}

export interface ProviderUsageBalance {
  remaining: number;
  unit: string;
  grantedBalance?: number;
  toppedUpBalance?: number;
  available?: boolean;
}

export interface ProviderUsageResult {
  success: boolean;
  /** ISO time of last fetch attempt. */
  fetchedAt: string;
  /** Coding-plan quota (MiniMax). Mutually exclusive with `balance`. */
  quota?: ProviderUsageQuota;
  /** Pay-as-you-go balance (DeepSeek). Mutually exclusive with `quota`. */
  balance?: ProviderUsageBalance;
  /** User-facing error when success=false. */
  error?: string;
}

const REQUEST_TIMEOUT_MS = 12_000;

// ── Provider detection ─────────────────────────────────────────────

type UsageKind = "minimax-coding-plan" | "deepseek-balance";

function detectProvider(
  presetId: string | undefined,
  baseUrl: string,
): UsageKind | null {
  const id = (presetId || "").toLowerCase();
  const lower = baseUrl.toLowerCase();
  if (
    id === "minimax" ||
    lower.includes("api.minimaxi.com") ||
    lower.includes("api.minimax.io")
  ) {
    return "minimax-coding-plan";
  }
  if (id === "deepseek" || lower.includes("api.deepseek.com")) {
    return "deepseek-balance";
  }
  return null;
}

function resolveApiKey(
  apiKey: string | undefined,
  envKey: string | undefined,
): string {
  let key = (apiKey || "").trim();
  if (key) return key;
  if (!envKey) return "";
  const candidates = envKey
    .split(/[,|]/)
    .map((s) => s.trim())
    .filter(Boolean);
  for (const k of candidates) {
    const v = process.env[k]?.trim();
    if (v) return v;
  }
  return "";
}

async function httpGetJson(url: string, apiKey: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      signal: controller.signal,
    });
    if (res.status === 401 || res.status === 403) {
      throw new Error(`Invalid API key (HTTP ${res.status})`);
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `HTTP ${res.status}${body ? `: ${body.slice(0, 160)}` : ""}`,
      );
    }
    return (await res.json()) as unknown;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`Request timed out after ${REQUEST_TIMEOUT_MS / 1000}s`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// ── MiniMax coding plan ────────────────────────────────────────────

function minimaxHost(baseUrl: string): string | null {
  const lower = baseUrl.toLowerCase();
  if (lower.includes("api.minimaxi.com")) return "api.minimaxi.com";
  if (lower.includes("api.minimax.io")) return "api.minimax.io";
  return null;
}

/**
 * Extract `general` coding-plan tier from the MiniMax remains response.
 * Pure function — easy to unit-test.
 */
function parseMinimaxTiers(body: unknown): ProviderUsageQuota | undefined {
  const obj = body as Record<string, unknown> | null | undefined;
  if (!obj || typeof obj !== "object") return undefined;
  const arr = (obj as { model_remains?: unknown }).model_remains;
  if (!Array.isArray(arr)) return undefined;
  const item = arr.find((it) => {
    if (!it || typeof it !== "object") return false;
    const name = (it as Record<string, unknown>).model_name;
    return name === "general";
  }) as Record<string, unknown> | undefined;
  if (!item) return undefined;

  const quota: ProviderUsageQuota = {};

  if (typeof item.current_interval_remaining_percent === "number") {
    quota.fiveHourPct = clampPct(100 - item.current_interval_remaining_percent);
    if (typeof item.end_time === "number") {
      quota.fiveHourResetMs = item.end_time;
    }
  }
  if (item.current_weekly_status === 1) {
    if (typeof item.current_weekly_remaining_percent === "number") {
      quota.sevenDayPct = clampPct(
        100 - item.current_weekly_remaining_percent,
      );
      if (typeof item.weekly_end_time === "number") {
        quota.sevenDayResetMs = item.weekly_end_time;
      }
    }
  }
  if (quota.fiveHourPct === undefined && quota.sevenDayPct === undefined) {
    return undefined;
  }
  return quota;
}

function clampPct(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, v));
}

async function queryMinimaxQuota(
  baseUrl: string,
  apiKey: string,
): Promise<ProviderUsageQuota> {
  const host = minimaxHost(baseUrl);
  if (!host) throw new Error("Provider does not support usage queries");
  const url = `https://${host}/v1/api/openplatform/coding_plan/remains`;
  const json = await httpGetJson(url, apiKey);
  if (json && typeof json === "object") {
    const baseResp = (json as Record<string, unknown>).base_resp;
    if (baseResp && typeof baseResp === "object") {
      const code = (baseResp as Record<string, unknown>).status_code;
      if (typeof code === "number" && code !== 0) {
        const msg =
          (baseResp as Record<string, unknown>).status_msg || "API error";
        throw new Error(`${msg} (code ${code})`);
      }
    }
  }
  const quota = parseMinimaxTiers(json);
  if (!quota) throw new Error("No 'general' plan in response");
  return quota;
}

// ── DeepSeek balance ───────────────────────────────────────────────

/**
 * Extract the first available balance entry from DeepSeek's
 * GET /user/balance response.
 *
 *   { balance_infos: [{ currency, total_balance, granted_balance,
 *                       topped_up_balance }], is_available }
 *
 * `total_balance` is the displayed "remaining" amount; `granted_balance` and
 * `topped_up_balance` are kept as metadata (tooltip) for transparency.
 */
function parseDeepseekBalance(body: unknown): ProviderUsageBalance {
  const obj = body as Record<string, unknown> | null | undefined;
  if (!obj || typeof obj !== "object") {
    throw new Error("Empty DeepSeek balance response");
  }
  const infos = obj.balance_infos;
  if (!Array.isArray(infos) || infos.length === 0) {
    throw new Error("Missing balance_infos in DeepSeek response");
  }
  const isAvailable = obj.is_available !== false; // default true
  const entry = infos.find(
    (it) => it && typeof it === "object",
  ) as Record<string, unknown> | undefined;
  if (!entry) throw new Error("Empty balance_infos array");
  const total = numberOr(entry.total_balance, NaN);
  if (!Number.isFinite(total)) {
    throw new Error("total_balance missing or not a number");
  }
  return {
    remaining: total,
    unit: stringOr(entry.currency, "CNY"),
    grantedBalance: numberOr(entry.granted_balance, undefined),
    toppedUpBalance: numberOr(entry.topped_up_balance, undefined),
    available: isAvailable,
  };
}

function numberOr<T extends number | undefined>(
  v: unknown,
  fallback: T,
): number | T {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

function stringOr(v: unknown, fallback: string): string {
  return typeof v === "string" && v ? v : fallback;
}

async function queryDeepseekBalance(apiKey: string): Promise<ProviderUsageBalance> {
  const url = "https://api.deepseek.com/user/balance";
  const json = await httpGetJson(url, apiKey);
  return parseDeepseekBalance(json);
}

// ── Public entry ───────────────────────────────────────────────────

/**
 * Query usage for a configured provider.
 *
 * Returns coding-plan `quota` (MiniMax) or `balance` (DeepSeek) depending on
 * the provider's preset / baseUrl. Unknown providers get a deterministic
 * "Provider does not support usage queries" without any network call.
 */
export async function queryProviderUsage(input: {
  presetId?: string;
  baseUrl: string;
  apiKey?: string;
  envKey?: string;
}): Promise<ProviderUsageResult> {
  const baseUrl = (input.baseUrl || "").trim();
  const kind = detectProvider(input.presetId, baseUrl);
  const fetchedAt = new Date().toISOString();
  if (!kind) {
    return {
      success: false,
      fetchedAt,
      error: "Provider does not support usage queries",
    };
  }

  const apiKey = resolveApiKey(input.apiKey, input.envKey);
  if (!apiKey) {
    return { success: false, fetchedAt, error: "API key is required" };
  }

  try {
    if (kind === "minimax-coding-plan") {
      const quota = await queryMinimaxQuota(baseUrl, apiKey);
      return { success: true, fetchedAt, quota };
    }
    const balance = await queryDeepseekBalance(apiKey);
    return { success: true, fetchedAt, balance };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, fetchedAt, error: message };
  }
}