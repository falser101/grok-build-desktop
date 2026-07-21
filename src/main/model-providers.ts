/**
 * Custom model providers for Grok Build Desktop.
 *
 * - Provider list + credentials: ~/.grok/desktop-providers.json (mode 0600)
 * - Enabled models synced into ~/.grok/config.toml as [model.dp_*] sections
 *   so the CLI/agent picks them up (same format as docs/11-custom-models.md).
 */

import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import type {
  ApiBackend,
  FetchedModelInfo,
  ModelProviderConfig,
  ModelProviderModel,
  ModelProviderPreset,
  ModelProviderRegion,
  ReasoningEffortOption,
  UpsertProviderInput,
} from "../shared/types";

const MARKER_START = "# >>> grok-desktop-models";
const MARKER_END = "# <<< grok-desktop-models";
const STORE_VERSION = 1;

function grokHome(): string {
  return join(homedir(), ".grok");
}

function storePath(): string {
  return join(grokHome(), "desktop-providers.json");
}

function configPath(): string {
  return join(grokHome(), "config.toml");
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

// ── Presets (intl + CN + local) ─────────────────────────────────────

export const PROVIDER_PRESETS: ModelProviderPreset[] = [
  {
    id: "openai",
    name: "OpenAI",
    nameZh: "OpenAI",
    region: "intl",
    baseUrl: "https://api.openai.com/v1",
    apiBackend: "chat_completions",
    envKey: "OPENAI_API_KEY",
    accent: "#10a37f",
    logo: "./assets/provider-icons/openai.svg",
    popularModels: [
      { id: "gpt-4.1", name: "GPT-4.1" },
      { id: "gpt-4.1-mini", name: "GPT-4.1 Mini" },
      { id: "gpt-4o", name: "GPT-4o" },
      { id: "o3", name: "o3" },
      { id: "o4-mini", name: "o4-mini" },
    ],
  },
  {
    id: "anthropic",
    name: "Anthropic",
    nameZh: "Anthropic",
    region: "intl",
    baseUrl: "https://api.anthropic.com/v1",
    apiBackend: "messages",
    envKey: "ANTHROPIC_API_KEY",
    authStyle: "x-api-key",
    extraHeaders: { "anthropic-version": "2023-06-01" },
    accent: "#d97757",
    logo: "./assets/provider-icons/anthropic.svg",
    popularModels: [
      { id: "claude-opus-4-6", name: "Claude Opus 4.6" },
      { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6" },
      { id: "claude-haiku-4-5-20251001", name: "Claude Haiku 4.5" },
    ],
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    nameZh: "OpenRouter",
    region: "intl",
    baseUrl: "https://openrouter.ai/api/v1",
    apiBackend: "chat_completions",
    envKey: "OPENROUTER_API_KEY",
    accent: "#7c5cff",
    logo: "./assets/provider-icons/openrouter.svg",
    popularModels: [
      { id: "anthropic/claude-sonnet-4", name: "Claude Sonnet 4" },
      { id: "openai/gpt-4o", name: "GPT-4o" },
      { id: "google/gemini-2.5-pro", name: "Gemini 2.5 Pro" },
    ],
  },
  {
    id: "groq",
    name: "Groq",
    nameZh: "Groq",
    region: "intl",
    baseUrl: "https://api.groq.com/openai/v1",
    apiBackend: "chat_completions",
    envKey: "GROQ_API_KEY",
    accent: "#f55036",
    logo: "./assets/provider-icons/groq.svg",
    popularModels: [
      { id: "llama-3.3-70b-versatile", name: "Llama 3.3 70B" },
      { id: "qwen/qwen3-32b", name: "Qwen3 32B" },
    ],
  },
  {
    id: "together",
    name: "Together AI",
    nameZh: "Together AI",
    region: "intl",
    baseUrl: "https://api.together.xyz/v1",
    apiBackend: "chat_completions",
    envKey: "TOGETHER_API_KEY",
    accent: "#0fb5ba",
    logo: "./assets/provider-icons/together.svg",
  },
  {
    id: "gemini",
    name: "Google Gemini",
    nameZh: "Google Gemini",
    region: "intl",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    apiBackend: "chat_completions",
    envKey: "GEMINI_API_KEY",
    accent: "#4285f4",
    logo: "./assets/provider-icons/gemini.svg",
    popularModels: [
      { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro" },
      { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash" },
    ],
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    nameZh: "DeepSeek 深度求索",
    region: "cn",
    // Official docs (https://api-docs.deepseek.com/guides/anthropic_api/):
    //   OpenAI-compatible: POST https://api.deepseek.com/chat/completions
    //   Anthropic-compatible: POST https://api.deepseek.com/anthropic/v1/messages
    // Anthropic path uses `x-api-key` header (same convention as Anthropic).
    baseUrl: "https://api.deepseek.com/anthropic/v1",
    apiBackend: "messages",
    protocolEndpoints: {
      messages: "https://api.deepseek.com/anthropic/v1",
      chat_completions: "https://api.deepseek.com",
    },
    authStyle: "x-api-key",
    // List models via OpenAI-compatible host (Anthropic path has no /models).
    modelsListBaseUrl: "https://api.deepseek.com",
    envKey: "DEEPSEEK_API_KEY",
    accent: "#4d8aff",
    logo: "./assets/provider-icons/deepseek.png",
    popularModels: [
      { id: "deepseek-chat", name: "DeepSeek Chat (V3)" },
      { id: "deepseek-reasoner", name: "DeepSeek Reasoner (R1)" },
    ],
  },
  {
    id: "moonshot",
    name: "Moonshot (Kimi)",
    nameZh: "月之暗面 Kimi",
    region: "cn",
    baseUrl: "https://api.moonshot.cn/v1",
    apiBackend: "chat_completions",
    envKey: "MOONSHOT_API_KEY",
    accent: "#1a1a2e",
    logo: "./assets/provider-icons/moonshot.svg",
    popularModels: [
      { id: "kimi-k2-turbo-preview", name: "Kimi K2 Turbo" },
      { id: "moonshot-v1-128k", name: "Moonshot v1 128K" },
      { id: "moonshot-v1-32k", name: "Moonshot v1 32K" },
    ],
  },
  {
    id: "dashscope",
    name: "Alibaba DashScope (Qwen)",
    nameZh: "阿里云百炼 Qwen",
    region: "cn",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    apiBackend: "chat_completions",
    envKey: "DASHSCOPE_API_KEY",
    accent: "#ff6a00",
    logo: "./assets/provider-icons/qwen.svg",
    popularModels: [
      { id: "qwen-max", name: "Qwen Max" },
      { id: "qwen-plus", name: "Qwen Plus" },
      { id: "qwen-turbo", name: "Qwen Turbo" },
      { id: "qwen3-coder-plus", name: "Qwen3 Coder Plus" },
    ],
  },
  {
    id: "zhipu",
    name: "Zhipu GLM",
    nameZh: "智谱 GLM",
    region: "cn",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    apiBackend: "chat_completions",
    envKey: "ZHIPU_API_KEY",
    accent: "#3859ff",
    logo: "./assets/provider-icons/zhipu.svg",
    popularModels: [
      { id: "glm-4.5", name: "GLM-4.5" },
      { id: "glm-4.5-air", name: "GLM-4.5 Air" },
      { id: "glm-4-flash", name: "GLM-4 Flash" },
    ],
  },
  {
    id: "siliconflow",
    name: "SiliconFlow",
    nameZh: "硅基流动",
    region: "cn",
    baseUrl: "https://api.siliconflow.cn/v1",
    apiBackend: "chat_completions",
    envKey: "SILICONFLOW_API_KEY",
    accent: "#7c3aed",
    logo: "./assets/provider-icons/siliconflow.png",
    popularModels: [
      { id: "deepseek-ai/DeepSeek-V3", name: "DeepSeek V3" },
      { id: "Qwen/Qwen3-235B-A22B", name: "Qwen3 235B" },
      { id: "moonshotai/Kimi-K2-Instruct", name: "Kimi K2" },
    ],
  },
  {
    id: "volcengine",
    name: "Volcengine (Doubao)",
    nameZh: "火山引擎 豆包",
    region: "cn",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    apiBackend: "chat_completions",
    envKey: "ARK_API_KEY",
    accent: "#3b82f6",
    logo: "./assets/provider-icons/volcengine.svg",
    popularModels: [
      { id: "doubao-seed-1-6-250615", name: "Doubao Seed 1.6" },
      { id: "doubao-1-5-pro-32k-250115", name: "Doubao 1.5 Pro" },
    ],
  },
  {
    id: "minimax",
    name: "MiniMax",
    nameZh: "MiniMax",
    region: "cn",
    // Official Anthropic-compatible Messages API (docs: platform.minimaxi.com):
    // POST https://api.minimaxi.com/anthropic/v1/messages
    // OpenAI-compatible is separate: …/v1 + chat_completions.
    baseUrl: "https://api.minimaxi.com/anthropic/v1",
    apiBackend: "messages",
    protocolEndpoints: {
      messages: "https://api.minimaxi.com/anthropic/v1",
      chat_completions: "https://api.minimaxi.com/v1",
    },
    // List models via OpenAI-compatible host (Anthropic path has no /models).
    modelsListBaseUrl: "https://api.minimaxi.com/v1",
    envKey: "MINIMAX_API_KEY",
    accent: "#ff4d4f",
    logo: "./assets/provider-icons/minimax.svg",
    popularModels: [
      { id: "MiniMax-M3", name: "MiniMax M3" },
      { id: "MiniMax-M2.7", name: "MiniMax M2.7" },
      { id: "MiniMax-M2.5", name: "MiniMax M2.5" },
    ],
  },
  {
    id: "stepfun",
    name: "StepFun",
    nameZh: "阶跃星辰",
    region: "cn",
    baseUrl: "https://api.stepfun.com/v1",
    apiBackend: "chat_completions",
    envKey: "STEPFUN_API_KEY",
    accent: "#5b21b6",
    logo: "./assets/provider-icons/stepfun.svg",
    popularModels: [
      { id: "step-2-16k", name: "Step 2 16K" },
      { id: "step-1-flash", name: "Step 1 Flash" },
    ],
  },
  {
    id: "ollama",
    name: "Ollama (local)",
    nameZh: "Ollama（本地）",
    region: "local",
    baseUrl: "http://localhost:11434/v1",
    apiBackend: "chat_completions",
    accent: "#1a1a1a",
    logo: "./assets/provider-icons/ollama.svg",
    popularModels: [
      { id: "llama3.2", name: "Llama 3.2" },
      { id: "qwen2.5-coder", name: "Qwen2.5 Coder" },
      { id: "codellama", name: "Code Llama" },
    ],
  },
  {
    id: "lmstudio",
    name: "LM Studio (local)",
    nameZh: "LM Studio（本地）",
    region: "local",
    baseUrl: "http://localhost:1234/v1",
    apiBackend: "chat_completions",
    accent: "#0f172a",
    logo: "./assets/provider-icons/lmstudio.svg",
  },
  {
    id: "custom",
    name: "Custom (OpenAI-compatible)",
    nameZh: "自定义（OpenAI 兼容）",
    region: "local",
    baseUrl: "",
    apiBackend: "chat_completions",
    accent: "#64748b",
  },
];

export function listPresets(): ModelProviderPreset[] {
  return PROVIDER_PRESETS.map((p) => ({ ...p }));
}

/** Resolve the full base URL for a preset + protocol pair. */
export function resolvePresetBaseUrl(
  preset: ModelProviderPreset,
  apiBackend: ApiBackend,
): string {
  const mapped = preset.protocolEndpoints?.[apiBackend];
  if (mapped) return mapped;
  if (apiBackend === preset.apiBackend) return preset.baseUrl;
  return preset.baseUrl;
}

/**
 * Fix known mismatched base_url/protocol pairs (e.g. MiniMax messages
 * pointed at OpenAI `/v1` instead of `/anthropic/v1`).
 * Catalog presets always pin baseUrl to the official full endpoint for the
 * selected protocol so users cannot end up with a half-matched path.
 */
function migrateProvider(raw: ModelProviderConfig): ModelProviderConfig {
  const preset = raw.presetId
    ? PROVIDER_PRESETS.find((p) => p.id === raw.presetId)
    : undefined;
  if (!preset || preset.id === "custom") return raw;

  const expected = resolvePresetBaseUrl(preset, raw.apiBackend);
  if (!expected) return raw;
  const current = (raw.baseUrl || "").replace(/\/+$/, "");
  const want = expected.replace(/\/+$/, "");
  if (current === want) return raw;
  return { ...raw, baseUrl: expected };
}

// ── Store ───────────────────────────────────────────────────────────

interface StoreFile {
  version: number;
  providers: ModelProviderConfig[];
}

function sanitizeSegment(s: string, max: number): string {
  return s
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, max) || "x";
}

/** Build a stable config.toml section key for a provider model. */
export function makeConfigKey(providerId: string, modelId: string): string {
  const p = sanitizeSegment(providerId, 28);
  const m = sanitizeSegment(modelId.replace(/\//g, "-"), 56);
  return `dp_${p}_${m}`;
}

function normalizeModel(
  providerId: string,
  raw: Partial<ModelProviderModel> & { id: string },
): ModelProviderModel {
  const id = raw.id.trim();
  return {
    id,
    name: (raw.name || id).trim(),
    configKey: raw.configKey || makeConfigKey(providerId, id),
    source: raw.source === "fetched" ? "fetched" : "manual",
    enabled: raw.enabled !== false,
    contextWindow:
      typeof raw.contextWindow === "number" && raw.contextWindow > 0
        ? raw.contextWindow
        : undefined,
    // Default every custom model to the 4 standard reasoning-effort
    // levels (xhigh / high / medium / low). Users can opt out by
    // setting this to an empty array from the editor.
    reasoningEfforts:
      raw.reasoningEfforts && Array.isArray(raw.reasoningEfforts)
        ? raw.reasoningEfforts
        : DEFAULT_REASONING_EFFORTS,
  };
}

/**
 * Default reasoning-effort levels applied to every custom model when
 * the user hasn't overridden them. Mirrors the DeepSeek V4 Pro
 * (and most Chinese model APIs') standard menu.
 */
const DEFAULT_REASONING_EFFORTS: ReasoningEffortOption[] = [
  { id: "xhigh", label: "Extra high", description: "Maximum reasoning" },
  { id: "high", label: "High", description: "Heavy reasoning" },
  { id: "medium", label: "Medium", description: "Balanced reasoning" },
  { id: "low", label: "Low", description: "Faster, lighter reasoning" },
];

function normalizeProvider(raw: Partial<ModelProviderConfig>): ModelProviderConfig {
  const id = (raw.id || randomUUID()).trim();
  const models = Array.isArray(raw.models)
    ? raw.models
        .filter((m) => m && typeof m.id === "string" && m.id.trim())
        .map((m) => normalizeModel(id, m))
    : [];
  const backend = raw.apiBackend;
  const apiBackend: ApiBackend =
    backend === "responses" || backend === "messages"
      ? backend
      : "chat_completions";
  return {
    id,
    presetId: raw.presetId,
    name: (raw.name || "Provider").trim(),
    baseUrl: (raw.baseUrl || "").trim().replace(/\/+$/, ""),
    apiBackend,
    apiKey: raw.apiKey?.trim() || undefined,
    envKey: raw.envKey?.trim() || undefined,
    enabled: raw.enabled !== false,
    extraHeaders: raw.extraHeaders,
    authStyle: raw.authStyle === "x-api-key" ? "x-api-key" : "bearer",
    models,
    createdAt: raw.createdAt || Date.now(),
    updatedAt: raw.updatedAt || Date.now(),
  };
}

async function readStore(): Promise<StoreFile> {
  try {
    const text = await readFile(storePath(), "utf8");
    const parsed = JSON.parse(text) as StoreFile;
    const providers = Array.isArray(parsed.providers)
      ? parsed.providers.map((p) => migrateProvider(normalizeProvider(p)))
      : [];
    // Persist migration (e.g. MiniMax wrong /v1 + messages) so config.toml
    // and the JSON store stay aligned without requiring a UI save.
    let dirty = false;
    if (Array.isArray(parsed.providers)) {
      for (let i = 0; i < providers.length; i++) {
        const before = parsed.providers[i];
        const after = providers[i];
        if (
          before &&
          after &&
          ((before.baseUrl || "").replace(/\/+$/, "") !== after.baseUrl ||
            before.apiBackend !== after.apiBackend)
        ) {
          dirty = true;
          break;
        }
      }
    }
    const store: StoreFile = { version: STORE_VERSION, providers };
    if (dirty) {
      await writeStore(store);
      await syncConfigToml(providers);
    }
    return store;
  } catch {
    return { version: STORE_VERSION, providers: [] };
  }
}

async function writeStore(store: StoreFile): Promise<void> {
  await mkdir(grokHome(), { recursive: true });
  const payload: StoreFile = {
    version: STORE_VERSION,
    providers: store.providers.map((p) => normalizeProvider(p)),
  };
  await writeFile(storePath(), `${JSON.stringify(payload, null, 2)}\n`, {
    mode: 0o600,
  });
}

// ── TOML helpers ────────────────────────────────────────────────────

function tomlEscape(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
}

function tomlString(s: string): string {
  return `"${tomlEscape(s)}"`;
}

function tomlInlineTable(obj: Record<string, string>): string {
  const parts = Object.entries(obj).map(
    ([k, v]) => `${tomlString(k)} = ${tomlString(v)}`,
  );
  return `{ ${parts.join(", ")} }`;
}

/**
 * Format one reasoning-effort entry as a TOML inline table for the
 * `reasoning_efforts = [...]` array. Matches the CLI parser in
 * `xai-grok-shell/src/agent/config.rs`:
 *   - `value` is required (low / medium / high / xhigh / auto / off)
 *   - `id`, `label`, `description`, `default` are optional
 */
function tomlReasoningEffort(opt: ReasoningEffortOption): string {
  const parts: string[] = [`value = ${tomlString(opt.id)}`];
  if (opt.id) parts.push(`id = ${tomlString(opt.id)}`);
  parts.push(`label = ${tomlString(opt.label)}`);
  if (opt.description) {
    parts.push(`description = ${tomlString(opt.description)}`);
  }
  if ((opt as { default?: boolean }).default) {
    parts.push(`default = true`);
  }
  return `{ ${parts.join(", ")} }`;
}

function buildModelSection(provider: ModelProviderConfig, model: ModelProviderModel): string {
  const lines: string[] = [];
  lines.push(`[model.${model.configKey}]`);
  lines.push(`model = ${tomlString(model.id)}`);
  if (provider.baseUrl) {
    lines.push(`base_url = ${tomlString(provider.baseUrl)}`);
  }
  lines.push(`name = ${tomlString(model.name)}`);
  lines.push(`description = ${tomlString(provider.name)}`);
  lines.push(`api_backend = ${tomlString(provider.apiBackend)}`);
  if (
    typeof model.contextWindow === "number" &&
    model.contextWindow > 0
  ) {
    lines.push(`context_window = ${model.contextWindow}`);
  }

  const headers: Record<string, string> = {
    ...(provider.extraHeaders || {}),
  };
  if (provider.authStyle === "x-api-key" && provider.apiKey) {
    headers["x-api-key"] = provider.apiKey;
  } else if (provider.apiKey) {
    lines.push(`api_key = ${tomlString(provider.apiKey)}`);
  }
  if (provider.envKey) {
    lines.push(`env_key = ${tomlString(provider.envKey)}`);
  }
  if (Object.keys(headers).length > 0) {
    lines.push(`extra_headers = ${tomlInlineTable(headers)}`);
  }
  // Reasoning-effort menu. Only emit when the model has an explicit
  // list (the default fills all 4 standard levels for every custom
  // model; users can override per-model or set to [] to hide the
  // chip entirely).
  if (Array.isArray(model.reasoningEfforts) && model.reasoningEfforts.length > 0) {
    const items = model.reasoningEfforts
      .map((e) => tomlReasoningEffort(e))
      .join(", ");
    lines.push(`reasoning_efforts = [${items}]`);
  }
  return lines.join("\n");
}

/**
 * Rewrite the desktop-managed block in config.toml from current providers.
 * Removes any prior desktop block and orphaned [model.dp_*] sections.
 */
export async function syncConfigToml(providers: ModelProviderConfig[]): Promise<void> {
  await mkdir(grokHome(), { recursive: true });
  let text = "";
  try {
    text = await readFile(configPath(), "utf8");
  } catch {
    text = "";
  }

  // Strip previous managed block
  const startIdx = text.indexOf(MARKER_START);
  const endIdx = text.indexOf(MARKER_END);
  if (startIdx >= 0 && endIdx > startIdx) {
    const afterEnd = endIdx + MARKER_END.length;
    const before = text.slice(0, startIdx);
    const after = text.slice(afterEnd).replace(/^\r?\n/, "");
    text = before + after;
  }

  // Also strip any leftover [model.dp_*] sections (orphans)
  const lines = text.split(/\r?\n/);
  const kept: string[] = [];
  let skip = false;
  for (const line of lines) {
    const t = line.trim();
    if (t.startsWith("[")) {
      skip = /^\[model\.dp_/.test(t);
    }
    if (!skip) kept.push(line);
  }
  text = kept.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd();

  const sections: string[] = [];
  for (const p of providers) {
    if (!p.enabled) continue;
    for (const m of p.models) {
      if (!m.enabled) continue;
      // Apply reasoning-effort defaults at write time so every
      // custom-model section in config.toml picks up the 4-level
      // menu even when the store file predates this feature.
      const model = m.reasoningEfforts !== undefined
        ? m
        : { ...m, reasoningEfforts: DEFAULT_REASONING_EFFORTS };
      sections.push(buildModelSection(p, model));
    }
  }

  let out = text;
  if (sections.length > 0) {
    const block = [
      "",
      MARKER_START,
      "# Managed by Grok Build Desktop — edit via Models settings UI",
      "",
      ...sections.flatMap((s, i) => (i === 0 ? [s] : ["", s])),
      "",
      MARKER_END,
      "",
    ].join("\n");
    out = (out ? `${out}\n` : "") + block;
  } else if (out) {
    out = `${out}\n`;
  }

  await writeFile(configPath(), out.endsWith("\n") ? out : `${out}\n`, "utf8");
}

// ── Public API ──────────────────────────────────────────────────────

export async function listProviders(): Promise<ModelProviderConfig[]> {
  const store = await readStore();
  // Backfill reasoningEfforts on models loaded from older store files
  // so the UI composer always shows the reasoning-effort chip menu
  // for every custom model (4 standard levels by default).
  return store.providers.map(applyProviderReasoningDefaults);
}

/**
 * Ensure every model in a provider carries the 4 standard reasoning-
 * effort levels when no explicit list was persisted. Models that
 * already have a list (even empty) are left unchanged so users can
 * opt out by setting `reasoningEfforts: []`.
 */
function applyProviderReasoningDefaults(
  p: ModelProviderConfig,
): ModelProviderConfig {
  return {
    ...p,
    models: p.models.map((m) =>
      m.reasoningEfforts !== undefined
        ? m
        : { ...m, reasoningEfforts: DEFAULT_REASONING_EFFORTS },
    ),
  };
}

export async function getProvider(id: string): Promise<ModelProviderConfig | null> {
  const store = await readStore();
  return store.providers.find((p) => p.id === id) ?? null;
}

export async function upsertProvider(
  input: UpsertProviderInput,
): Promise<ModelProviderConfig> {
  const store = await readStore();
  const now = Date.now();
  const existingIdx = input.id
    ? store.providers.findIndex((p) => p.id === input.id)
    : -1;
  const existing = existingIdx >= 0 ? store.providers[existingIdx]! : null;

  const preset = input.presetId
    ? PROVIDER_PRESETS.find((p) => p.id === input.presetId)
    : existing?.presetId
      ? PROVIDER_PRESETS.find((p) => p.id === existing.presetId)
      : undefined;

  const id = existing?.id || input.id || randomUUID();
  type ModelDraft = {
    id: string;
    name: string;
    configKey?: string;
    source?: "fetched" | "manual";
    enabled?: boolean;
    contextWindow?: number;
  };

  let modelsIn: ModelDraft[];
  if (input.models !== undefined) {
    modelsIn = input.models;
  } else if (existing?.models) {
    modelsIn = existing.models;
  } else {
    // Start empty — user can fetch from API or add models manually.
    modelsIn = [];
  }

  const apiBackend: ApiBackend =
    input.apiBackend ??
    existing?.apiBackend ??
    preset?.apiBackend ??
    "chat_completions";

  // Catalog presets pin the full base URL to the selected protocol.
  // Custom endpoints remain free-form.
  let baseUrl =
    input.baseUrl !== undefined
      ? input.baseUrl
      : existing?.baseUrl || preset?.baseUrl || "";
  if (preset && preset.id !== "custom") {
    baseUrl = resolvePresetBaseUrl(preset, apiBackend);
  }

  const provider = normalizeProvider({
    id,
    presetId: input.presetId ?? existing?.presetId ?? preset?.id,
    name:
      input.name?.trim() ||
      existing?.name ||
      preset?.name ||
      "Provider",
    baseUrl,
    apiBackend,
    apiKey:
      input.apiKey !== undefined ? input.apiKey || undefined : existing?.apiKey,
    envKey:
      input.envKey !== undefined
        ? input.envKey || undefined
        : existing?.envKey || preset?.envKey,
    enabled: input.enabled ?? existing?.enabled ?? true,
    extraHeaders:
      input.extraHeaders !== undefined
        ? input.extraHeaders
        : existing?.extraHeaders || preset?.extraHeaders,
    authStyle:
      input.authStyle ??
      existing?.authStyle ??
      preset?.authStyle ??
      "bearer",
    models: modelsIn.map((m) =>
      normalizeModel(id, {
        id: m.id,
        name: m.name,
        source: m.source,
        enabled: m.enabled,
        configKey: m.configKey || makeConfigKey(id, m.id),
        contextWindow: m.contextWindow,
      }),
    ),
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  });

  if (existingIdx >= 0) {
    store.providers[existingIdx] = provider;
  } else {
    store.providers.push(provider);
  }

  await writeStore(store);
  await syncConfigToml(store.providers);
  return provider;
}

export async function deleteProvider(id: string): Promise<void> {
  const store = await readStore();
  store.providers = store.providers.filter((p) => p.id !== id);
  await writeStore(store);
  await syncConfigToml(store.providers);
}

export async function setProviderEnabled(
  id: string,
  enabled: boolean,
): Promise<ModelProviderConfig> {
  return upsertProvider({ id, enabled });
}

/**
 * Create a provider from a preset (disabled models until user enables them).
 * Popular models are pre-seeded as manual/disabled for quick enable.
 */
export async function addFromPreset(
  presetId: string,
  overrides?: Partial<UpsertProviderInput>,
): Promise<ModelProviderConfig> {
  const preset = PROVIDER_PRESETS.find((p) => p.id === presetId);
  if (!preset) throw new Error(`Unknown preset: ${presetId}`);

  return upsertProvider({
    presetId: preset.id,
    name: overrides?.name || preset.name,
    baseUrl: overrides?.baseUrl ?? preset.baseUrl,
    apiBackend: overrides?.apiBackend ?? preset.apiBackend,
    apiKey: overrides?.apiKey,
    envKey: overrides?.envKey ?? preset.envKey,
    extraHeaders: overrides?.extraHeaders ?? preset.extraHeaders,
    authStyle: overrides?.authStyle ?? preset.authStyle ?? "bearer",
    enabled: overrides?.enabled ?? true,
    // Start with no models — user fetches or adds them manually.
    models: overrides?.models ?? [],
  });
}

/** Map configKey → { providerId, providerName } for UI grouping. */
export async function getConfigKeyIndex(): Promise<
  Record<string, { providerId: string; providerName: string }>
> {
  const providers = await listProviders();
  const index: Record<string, { providerId: string; providerName: string }> = {};
  for (const p of providers) {
    if (!p.enabled) continue;
    for (const m of p.models) {
      if (!m.enabled) continue;
      index[m.configKey] = { providerId: p.id, providerName: p.name };
    }
  }
  return index;
}

// ── Fetch remote /v1/models ─────────────────────────────────────────

function joinModelsUrl(baseUrl: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  if (base.endsWith("/models")) return base;
  return `${base}/models`;
}

export async function fetchProviderModels(input: {
  baseUrl: string;
  apiKey?: string;
  envKey?: string;
  authStyle?: "bearer" | "x-api-key";
  extraHeaders?: Record<string, string>;
}): Promise<FetchedModelInfo[]> {
  const baseUrl = (input.baseUrl || "").trim();
  if (!baseUrl) {
    throw new Error("Base URL is required to fetch models");
  }

  let apiKey = input.apiKey?.trim() || "";
  if (!apiKey && input.envKey) {
    const keys = input.envKey.split(/[,|]/).map((s) => s.trim()).filter(Boolean);
    for (const k of keys) {
      const v = process.env[k]?.trim();
      if (v) {
        apiKey = v;
        break;
      }
    }
  }

  const headers: Record<string, string> = {
    Accept: "application/json",
    ...(input.extraHeaders || {}),
  };

  if (apiKey) {
    if (input.authStyle === "x-api-key") {
      headers["x-api-key"] = apiKey;
    } else {
      headers.Authorization = `Bearer ${apiKey}`;
    }
  }

  const url = joinModelsUrl(baseUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await fetch(url, {
      method: "GET",
      headers,
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `HTTP ${res.status} ${res.statusText}${body ? `: ${body.slice(0, 200)}` : ""}`,
      );
    }
    const json = (await res.json()) as unknown;
    return parseModelsResponse(json);
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("Fetch models timed out after 30s");
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function parseModelsResponse(json: unknown): FetchedModelInfo[] {
  const out: FetchedModelInfo[] = [];
  const seen = new Set<string>();

  const push = (id: string, name?: string, ownedBy?: string) => {
    const mid = id.trim();
    if (!mid || seen.has(mid)) return;
    seen.add(mid);
    out.push({
      id: mid,
      name: (name || mid).trim(),
      ownedBy: ownedBy?.trim() || undefined,
    });
  };

  if (Array.isArray(json)) {
    for (const item of json) {
      if (typeof item === "string") push(item);
      else if (item && typeof item === "object") {
        const o = item as Record<string, unknown>;
        const id = String(o.id ?? o.model ?? o.name ?? "");
        if (id) push(id, typeof o.name === "string" ? o.name : undefined);
      }
    }
  } else if (json && typeof json === "object") {
    const root = json as Record<string, unknown>;
    const data = root.data ?? root.models ?? root.items;
    if (Array.isArray(data)) {
      for (const item of data) {
        if (typeof item === "string") push(item);
        else if (item && typeof item === "object") {
          const o = item as Record<string, unknown>;
          const id = String(o.id ?? o.model ?? o.name ?? "");
          if (id) {
            push(
              id,
              typeof o.name === "string" ? o.name : undefined,
              typeof o.owned_by === "string" ? o.owned_by : undefined,
            );
          }
        }
      }
    }
  }

  out.sort((a, b) => a.id.localeCompare(b.id));
  return out;
}

export function regionLabel(region: ModelProviderRegion, zh: boolean): string {
  if (region === "cn") return zh ? "国内" : "China";
  if (region === "local") return zh ? "本地" : "Local";
  return zh ? "国际" : "International";
}
