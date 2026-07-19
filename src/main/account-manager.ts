/**
 * Account / auth management for the desktop client.
 * Browser OAuth, device-code, logout, API key. Credentials live in ~/.grok
 * (shared with CLI).
 */

import { spawn, type ChildProcess } from "node:child_process";
import {
  chmod,
  readFile,
  unlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { resolveGrokBinary } from "./backend";
import type {
  AccountLoginMethod,
  AccountStatus,
} from "../shared/types";

function grokHome(): string {
  return join(homedir(), ".grok");
}

function authJsonPath(): string {
  return join(grokHome(), "auth.json");
}

/** Desktop-persisted API key (0600). Injected as XAI_API_KEY for agent serve. */
function desktopApiKeyPath(): string {
  return join(grokHome(), "desktop-api-key");
}

// ── Auth.json ───────────────────────────────────────────────────────

interface AuthEntry {
  email?: string;
  user_id?: string;
  first_name?: string;
  last_name?: string;
  team_id?: string;
  auth_mode?: string;
  expires_at?: string;
  oidc_issuer?: string;
  oidc_client_id?: string;
  key?: string;
  refresh_token?: string;
}

async function readAuthEntries(): Promise<AuthEntry[]> {
  try {
    const raw = await readFile(authJsonPath(), "utf8");
    const data = JSON.parse(raw) as unknown;
    if (!data || typeof data !== "object" || Array.isArray(data)) return [];
    return Object.values(data as Record<string, unknown>).filter(
      (v): v is AuthEntry => !!v && typeof v === "object",
    ) as AuthEntry[];
  } catch {
    return [];
  }
}

function pickPrimaryEntry(entries: AuthEntry[]): AuthEntry | undefined {
  if (entries.length === 0) return undefined;
  // Prefer entries with email / non-empty key
  const withEmail = entries.find((e) => e.email?.trim());
  if (withEmail) return withEmail;
  return entries[0];
}

// ── Desktop API key ─────────────────────────────────────────────────

export async function readDesktopApiKey(): Promise<string | null> {
  try {
    const t = (await readFile(desktopApiKeyPath(), "utf8")).trim();
    return t || null;
  } catch {
    return null;
  }
}

export async function writeDesktopApiKey(key: string | null): Promise<void> {
  if (!key || !key.trim()) {
    try {
      await unlink(desktopApiKeyPath());
    } catch {
      // ignore
    }
    return;
  }
  const trimmed = key.trim();
  await writeFile(desktopApiKeyPath(), trimmed, { mode: 0o600 });
  try {
    await chmod(desktopApiKeyPath(), 0o600);
  } catch {
    // best effort
  }
}

/** Env vars to inject into agent serve / grok CLI child processes. */
export async function accountEnvOverlay(): Promise<Record<string, string>> {
  const desktop = await readDesktopApiKey();
  // Prefer existing process env; only inject desktop key when env is empty.
  if (process.env.XAI_API_KEY?.trim() || process.env.GROK_CODE_XAI_API_KEY?.trim()) {
    return {};
  }
  if (desktop) {
    return { XAI_API_KEY: desktop };
  }
  return {};
}

// ── Status ──────────────────────────────────────────────────────────

/**
 * True iff SOME credential source is configured — either a previously
 * completed `grok login` (auth.json), a desktop-stored API key, or an
 * inline env var. Used by `connectInner` to decide whether to call the
 * agent's `authenticate` step. When this returns `false`, the desktop
 * stays connected but `authenticated = false`; users can still chat via
 * custom providers.
 */
export async function hasAnyAuth(): Promise<boolean> {
  if (process.env.XAI_API_KEY?.trim() || process.env.GROK_CODE_XAI_API_KEY?.trim()) {
    return true;
  }
  const desktop = await readDesktopApiKey();
  if (desktop) return true;
  const entries = await readAuthEntries();
  return entries.some(
    (e) => !!(e.email || e.key || e.refresh_token),
  );
}

export async function getAccountStatus(): Promise<AccountStatus> {
  const entries = await readAuthEntries();
  const primary = pickPrimaryEntry(entries);
  const desktopKey = await readDesktopApiKey();
  const envKey = !!(
    process.env.XAI_API_KEY?.trim() || process.env.GROK_CODE_XAI_API_KEY?.trim()
  );

  const signedIn = !!(primary && (primary.email || primary.key || primary.refresh_token));
  const displayName = [primary?.first_name, primary?.last_name]
    .filter(Boolean)
    .join(" ")
    .trim();

  return {
    signedIn,
    email: primary?.email?.trim() || undefined,
    displayName: displayName || undefined,
    userId: primary?.user_id,
    teamId: primary?.team_id,
    authMode: primary?.auth_mode,
    expiresAt: primary?.expires_at,
    issuer: primary?.oidc_issuer,
    apiKeySet: envKey || !!desktopKey,
    apiKeySource: envKey ? "env" : desktopKey ? "desktop" : null,
    loginInProgress: loginState?.running ?? false,
    loginMethod: loginState?.method,
    deviceUrl: loginState?.deviceUrl,
    deviceUserCode: loginState?.deviceUserCode,
    loginMessage: loginState?.lastMessage,
  };
}

// ── Login process ───────────────────────────────────────────────────

type ProgressHandler = (payload: {
  message: string;
  deviceUrl?: string;
  deviceUserCode?: string;
  raw?: string;
}) => void;

interface LoginState {
  running: boolean;
  method: AccountLoginMethod;
  child: ChildProcess | null;
  deviceUrl?: string;
  deviceUserCode?: string;
  lastMessage?: string;
  abort?: () => void;
}

let loginState: LoginState | null = null;

function extractUrls(text: string): string[] {
  const re = /https?:\/\/[^\s"'<>]+/gi;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    let u = m[0]!;
    // trim trailing punctuation
    u = u.replace(/[),.;]+$/, "");
    out.push(u);
  }
  return out;
}

function extractUserCode(text: string, urls: string[]): string | undefined {
  for (const u of urls) {
    try {
      const q = new URL(u).searchParams.get("user_code");
      if (q && /^[A-Za-z0-9-]+$/.test(q)) return q;
    } catch {
      // ignore
    }
  }
  // Standalone code line like "  ABCD-EFGH"
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const t = line.trim();
    if (/^[A-Z0-9]{4,}-[A-Z0-9]{4,}$/i.test(t)) return t.toUpperCase();
  }
  return undefined;
}

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

export async function startLogin(
  method: AccountLoginMethod,
  onProgress: ProgressHandler,
): Promise<AccountStatus> {
  if (loginState?.running) {
    throw new Error("A login is already in progress");
  }

  const binary = await resolveGrokBinary();
  const args =
    method === "device"
      ? ["login", "--device-auth"]
      : ["login", "--oauth"];

  const timeoutMs = method === "device" ? 15 * 60_000 : 10 * 60_000;

  const overlay = await accountEnvOverlay();
  const child = spawn(binary, args, {
    cwd: process.cwd(),
    env: { ...process.env, ...overlay },
    stdio: ["ignore", "pipe", "pipe"],
  });

  loginState = {
    running: true,
    method,
    child,
    lastMessage:
      method === "device"
        ? "Starting device-code login…"
        : "Opening browser for sign-in…",
  };

  onProgress({ message: loginState.lastMessage! });

  let stdout = "";
  let stderr = "";
  let settled = false;

  const finish = (err?: Error) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    loginState = null;
    if (err) throw err;
  };

  const timer = setTimeout(() => {
    if (settled) return;
    child.kill("SIGTERM");
    setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // ignore
      }
    }, 1500);
  }, timeoutMs);

  const handleChunk = (chunk: Buffer, stream: "out" | "err") => {
    const text = stripAnsi(chunk.toString("utf8"));
    if (stream === "out") stdout += text;
    else stderr += text;
    if (stdout.length > 64_000) stdout = stdout.slice(-32_000);
    if (stderr.length > 64_000) stderr = stderr.slice(-32_000);

    const combined = text;
    const urls = extractUrls(combined);
    const deviceUrl =
      urls.find(
        (u) =>
          /device|oauth2\/device|user_code=/i.test(u) ||
          /accounts\.x\.ai|auth\.x\.ai|console\.x\.ai/i.test(u),
      ) || urls[0];
    const userCode = extractUserCode(combined, urls);

    if (loginState) {
      if (deviceUrl) loginState.deviceUrl = deviceUrl;
      if (userCode) loginState.deviceUserCode = userCode;
      // Prefer informative lines
      const lines = combined
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);
      const useful = lines.find(
        (l) =>
          /sign|login|browser|code|waiting|authoriz|✓|failed|error/i.test(l) &&
          !/^https?:\/\//i.test(l),
      );
      if (useful) loginState.lastMessage = useful.slice(0, 240);
      else if (deviceUrl && !loginState.lastMessage?.includes("URL")) {
        loginState.lastMessage = "Waiting for authorization…";
      }
    }

    onProgress({
      message: loginState?.lastMessage || "Signing in…",
      deviceUrl: loginState?.deviceUrl,
      deviceUserCode: loginState?.deviceUserCode,
      raw: text,
    });
  };

  child.stdout?.on("data", (d: Buffer) => handleChunk(d, "out"));
  child.stderr?.on("data", (d: Buffer) => handleChunk(d, "err"));

  return new Promise<AccountStatus>((resolve, reject) => {
    if (loginState) {
      loginState.abort = () => {
        try {
          child.kill("SIGTERM");
        } catch {
          // ignore
        }
      };
    }

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      loginState = null;
      reject(err);
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      loginState = null;
      void (async () => {
        const status = await getAccountStatus();
        if (code === 0 || status.signedIn) {
          resolve(status);
          return;
        }
        const msg = (
          stripAnsi(stderr) ||
          stripAnsi(stdout) ||
          `grok login exited with code ${code ?? 1}`
        )
          .trim()
          .slice(-800);
        reject(new Error(msg || "Login failed"));
      })();
    });
  });
}

export function cancelLogin(): boolean {
  if (!loginState?.running) return false;
  loginState.abort?.();
  try {
    loginState.child?.kill("SIGTERM");
  } catch {
    // ignore
  }
  loginState = null;
  return true;
}

export async function logout(): Promise<{
  message: string;
  status: AccountStatus;
}> {
  if (loginState?.running) {
    cancelLogin();
  }
  const binary = await resolveGrokBinary();
  const overlay = await accountEnvOverlay();
  const result = await new Promise<{
    stdout: string;
    stderr: string;
    code: number;
  }>((resolvePromise, reject) => {
    const child = spawn(binary, ["logout"], {
      env: { ...process.env, ...overlay },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("grok logout timed out"));
    }, 30_000);
    child.stdout?.on("data", (d: Buffer) => {
      stdout += d.toString("utf8");
    });
    child.stderr?.on("data", (d: Buffer) => {
      stderr += d.toString("utf8");
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolvePromise({ stdout, stderr, code: code ?? 1 });
    });
  });

  if (result.code !== 0) {
    const msg = (result.stderr || result.stdout || `exit ${result.code}`).trim();
    throw new Error(msg || "Logout failed");
  }

  const message = stripAnsi(result.stderr || result.stdout || "Logged out")
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .join(" ");
  const status = await getAccountStatus();
  return { message: message || "Logged out", status };
}

// ── API key ─────────────────────────────────────────────────────────

export async function setApiKey(key: string | null): Promise<AccountStatus> {
  await writeDesktopApiKey(key);
  return getAccountStatus();
}

export function isLoginRunning(): boolean {
  return !!loginState?.running;
}
