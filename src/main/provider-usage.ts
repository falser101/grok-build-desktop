/**
 * Provider coding-plan quota queries.
 *
 * Currently only MiniMax Coding Plan (国内站 api.minimaxi.com / 国际站 api.minimax.io).
 * Endpoint: GET /v1/api/openplatform/coding_plan/remains
 * Auth:     Authorization: Bearer {api_key}
 * Response shape (新接口):
 *   base_resp: { status_code: 0, status_msg: "ok" }
 *   model_remains: [
 *     {
 *       model_name: "general" | "video" | …,
 *       current_interval_remaining_percent: number,  // 5h 桶 — 剩余百分比 0-100
 *       current_weekly_status: 1 | 3,                // 1=激活周限, 3=无周限(weekly = 100%)
 *       current_weekly_remaining_percent: number,    // 7d 桶
 *       end_time: number,                            // 5h 桶重置时间 (ms)
 *       weekly_end_time: number,                     // 7d 桶重置时间 (ms)
 *       …
 *     },
 *     …
 *   ]
 *
 * Reference: cc-switch `query_minimax` / `parse_minimax_tiers` in
 * `src-tauri/src/services/coding_plan.rs` (same MiniMax endpoint + shape).
 */

export interface ProviderUsageQuota {
  /** 5-hour window utilization percentage (0-100). */
  fiveHourPct?: number;
  /** 5-hour window reset time (ms since epoch). */
  fiveHourResetMs?: number;
  /** 7-day window utilization percentage (0-100). */
  sevenDayPct?: number;
  /** 7-day window reset time (ms since epoch). */
  sevenDayResetMs?: number;
}

export interface ProviderUsageResult {
  success: boolean;
  /** ISO time of last fetch attempt. */
  fetchedAt: string;
  /** Provider-specific quota payload (undefined for non-coding-plan providers). */
  quota?: ProviderUsageQuota;
  /** User-facing error when success=false. */
  error?: string;
}

const REQUEST_TIMEOUT_MS = 12_000;

/**
 * Resolve the MiniMax quota host from a provider's baseUrl.
 * Defaults to 国内站; falls back to 国际站 for `api.minimax.io`.
 * Returns null when the provider is not a recognised MiniMax host.
 */
function minimaxHost(baseUrl: string): string | null {
  const lower = baseUrl.toLowerCase();
  if (lower.includes("api.minimaxi.com")) return "api.minimaxi.com";
  if (lower.includes("api.minimax.io")) return "api.minimax.io";
  return null;
}

/**
 * Extract `general` coding-plan tier from the MiniMax remains response.
 * Pure function — easy to unit-test.
 *
 * 5h 桶: 当前接口给「剩余百分比」, 反转成已用百分比。
 * 周桶:   仅当 status=1 时激活 (status=3 表示无周限额套餐, 不应展示)。
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

  // 5h 桶 (current_interval_remaining_percent → 已用百分比)
  if (typeof item.current_interval_remaining_percent === "number") {
    const remain = item.current_interval_remaining_percent;
    quota.fiveHourPct = clampPct(100 - remain);
    if (typeof item.end_time === "number") {
      quota.fiveHourResetMs = item.end_time;
    }
  }

  // 周桶 (仅 status==1 时激活)
  if (item.current_weekly_status === 1) {
    if (typeof item.current_weekly_remaining_percent === "number") {
      const remain = item.current_weekly_remaining_percent;
      quota.sevenDayPct = clampPct(100 - remain);
      if (typeof item.weekly_end_time === "number") {
        quota.sevenDayResetMs = item.weekly_end_time;
      }
    }
  }

  // 至少解析出一个 tier 才有意义
  if (quota.fiveHourPct === undefined && quota.sevenDayPct === undefined) {
    return undefined;
  }
  return quota;
}

function clampPct(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, v));
}

/**
 * Query MiniMax coding-plan quota for a configured provider.
 *
 * - Only MiniMax (preset id "minimax" or any baseUrl under api.minimaxi.com /
 *   api.minimax.io) is supported; other providers return
 *   `{ success: false, error: "unsupported" }` without making a network call.
 * - `apiKey` falls back to `envKey` resolved against process.env, mirroring
 *   `fetchProviderModels` behaviour.
 */
export async function queryProviderUsage(input: {
  presetId?: string;
  baseUrl: string;
  apiKey?: string;
  envKey?: string;
}): Promise<ProviderUsageResult> {
  const baseUrl = (input.baseUrl || "").trim();
  const host = minimaxHost(baseUrl);
  if (!host) {
    return {
      success: false,
      fetchedAt: new Date().toISOString(),
      error: "Provider does not support usage queries",
    };
  }

  let apiKey = (input.apiKey || "").trim();
  if (!apiKey && input.envKey) {
    const candidates = input.envKey
      .split(/[,|]/)
      .map((s) => s.trim())
      .filter(Boolean);
    for (const k of candidates) {
      const v = process.env[k]?.trim();
      if (v) {
        apiKey = v;
        break;
      }
    }
  }
  if (!apiKey) {
    return {
      success: false,
      fetchedAt: new Date().toISOString(),
      error: "API key is required",
    };
  }

  const url = `https://${host}/v1/api/openplatform/coding_plan/remains`;
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
      return {
        success: false,
        fetchedAt: new Date().toISOString(),
        error: `Invalid API key (HTTP ${res.status})`,
      };
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return {
        success: false,
        fetchedAt: new Date().toISOString(),
        error: `HTTP ${res.status}${body ? `: ${body.slice(0, 160)}` : ""}`,
      };
    }
    const json: unknown = await res.json();
    if (json && typeof json === "object") {
      const baseResp = (json as Record<string, unknown>).base_resp;
      if (baseResp && typeof baseResp === "object") {
        const code = (baseResp as Record<string, unknown>).status_code;
        if (typeof code === "number" && code !== 0) {
          const msg =
            (baseResp as Record<string, unknown>).status_msg || "API error";
          return {
            success: false,
            fetchedAt: new Date().toISOString(),
            error: `${msg} (code ${code})`,
          };
        }
      }
    }
    const quota = parseMinimaxTiers(json);
    if (!quota) {
      return {
        success: false,
        fetchedAt: new Date().toISOString(),
        error: "No 'general' plan in response",
      };
    }
    return {
      success: true,
      fetchedAt: new Date().toISOString(),
      quota,
    };
  } catch (err) {
    const message =
      err instanceof Error
        ? err.name === "AbortError"
          ? `Request timed out after ${REQUEST_TIMEOUT_MS / 1000}s`
          : err.message
        : String(err);
    return {
      success: false,
      fetchedAt: new Date().toISOString(),
      error: message,
    };
  } finally {
    clearTimeout(timer);
  }
}