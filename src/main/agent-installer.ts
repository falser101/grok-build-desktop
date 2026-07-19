/**
 * Installer + lifecycle for the external `grok` CLI that the desktop shells out to.
 *
 * Responsibilities:
 *   - Locate a `grok` binary on disk (PATH, well-known dirs, $GROK_BINARY).
 *   - Drive the official one-line installer (`https://x.ai/cli/install.{sh,ps1}`)
 *     for first-time installs and upgrades.
 *   - Detect available updates by comparing `grok --version` against the
 *     channel-pointer endpoint (`https://x.ai/cli/<channel>`).
 *   - Roll back to a `.bak` copy if the freshly-installed agent fails to
 *     come up healthy within 30s.
 *   - Persist the chosen channel (`stable` / `alpha` / `enterprise`) to
 *     `~/.grok/config.toml [cli].channel`.
 *
 * This module owns the on-disk binary lifecycle. `backend.ts` drives
 * the agent process itself — we feed it a resolved path and let it
 * handle spawn / connect / teardown.
 */
import {
  chmod,
  copyFile,
  mkdir,
  readFile,
  realpath,
  rename,
  stat,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import {
  spawn,
  execFile,
  type ChildProcess,
} from "node:child_process";
import { homedir } from "node:os";
import { basename, dirname, join, sep } from "node:path";

const INSTALL_TIMEOUT_MS = 5 * 60 * 1000; // 5 min
const VERSION_PROBE_TIMEOUT_MS = 10_000;
const ROLLBACK_TIMEOUT_MS = 5_000;
const BACKUP_SUFFIX = ".bak";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type InstallerChannel = "stable" | "alpha" | "enterprise";

export type InstallerStatus =
  | { kind: "absent" }
  | { kind: "ready"; version: string; path: string }
  | {
      kind: "update-available";
      current: string;
      latest: string;
      path: string;
    }
  | { kind: "installing"; startedAt: number }
  | { kind: "upgrading"; from: string; to: string; startedAt: number }
  | { kind: "rollback"; fromVersion: string; reason: string }
  | { kind: "error"; message: string };

export interface InstallerResult {
  ok: boolean;
  /** Resolved path to the binary after install (when ok=true). */
  path?: string;
  /** Aggregated stdout+stderr from the installer. */
  output: string;
  /** Exit code from the underlying installer (null if killed). */
  code: number | null;
  /** Wall-clock duration in ms. */
  durationMs: number;
  /** Error message when ok=false (network failure, non-zero exit, etc.). */
  error?: string;
}

export interface UpdateCheck {
  hasUpdate: boolean;
  current: string;
  latest: string;
}

// ---------------------------------------------------------------------------
// Channels & URLs
// ---------------------------------------------------------------------------

export const VALID_CHANNELS: readonly InstallerChannel[] = [
  "stable",
  "alpha",
  "enterprise",
] as const;

const BASE_URL_PRIMARY = "https://x.ai/cli";
const BASE_URL_FALLBACK =
  "https://storage.googleapis.com/grok-build-public-artifacts/cli";

export const GROK_INSTALL_URL_SH = "https://x.ai/cli/install.sh";
export const GROK_INSTALL_URL_PS1 = "https://x.ai/cli/install.ps1";
/** Back-compat alias for older imports. */
export const GROK_INSTALL_URL = GROK_INSTALL_URL_SH;

export function grokInstallCommand(platform: NodeJS.Platform): string {
  if (platform === "win32") return "irm https://x.ai/cli/install.ps1 | iex";
  return "curl -fsSL https://x.ai/cli/install.sh | bash";
}

// ---------------------------------------------------------------------------
// Binary discovery
// ---------------------------------------------------------------------------

export type ResolveGrokResult =
  | { kind: "found"; path: string; source: string }
  | { kind: "missing"; searched: string[]; fallback: string };

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    // On Windows, an unqualified `grok` or `agent` resolves to `grok.exe` /
    // `agent.exe`. Try both before giving up so the well-known list above
    // can stay extension-less without false negatives.
    if (process.platform === "win32") {
      try {
        await stat(p + ".exe");
        return true;
      } catch {
        /* fall through */
      }
      try {
        await stat(p + ".cmd");
        return true;
      } catch {
        /* fall through */
      }
    }
    return false;
  }
}

/** On Windows, given a path without extension that exists, return the
 *  exact file on disk (e.g. add `.exe` if that's what was installed).
 *  Prefers `.exe` over `.cmd` since the official installer writes a
 *  real binary. Falls back to the input path when the extension is
 *  already present or nothing matches. */
async function resolveWindowsExtension(p: string): Promise<string> {
  if (process.platform !== "win32") return p;
  if (/\.(exe|cmd|bat)$/i.test(p)) return p;
  for (const ext of [".exe", ".cmd"]) {
    try {
      await stat(p + ext);
      return p + ext;
    } catch {
      /* try next */
    }
  }
  return p;
}

export function grokHome(): string {
  return join(homedir(), ".grok");
}

export function grokConfigPath(): string {
  return join(grokHome(), "config.toml");
}

/**
 * Locate the `grok` CLI binary on disk. Returns a structured result so the
 * caller can render a helpful "install instructions" UI when it's missing,
 * rather than relying on a generic spawn ENOENT.
 */
export async function resolveGrokBinary(): Promise<string> {
  const result = await resolveGrokBinaryDetailed();
  return result.kind === "found" ? result.path : result.fallback;
}

export async function resolveGrokBinaryDetailed(): Promise<ResolveGrokResult> {
  const envPath = process.env.GROK_BINARY;
  const searched: string[] = [];

  if (envPath) {
    searched.push(envPath);
    if (await pathExists(envPath)) {
      return { kind: "found", path: envPath, source: "$GROK_BINARY" };
    }
  }

  const candidates: string[] = [];

  if (process.resourcesPath) {
    candidates.push(join(process.resourcesPath, "bin", "grok"));
  }
  candidates.push(join(grokHome(), "bin", "grok"));

  if (process.platform === "win32") {
    candidates.push(
      join(process.env.LOCALAPPDATA ?? "", "Programs", "grok", "grok.exe"),
      join(process.env.LOCALAPPDATA ?? "", "Programs", "Grok", "grok.exe"),
      join(
        process.env.LOCALAPPDATA ?? "",
        "Microsoft",
        "WindowsApps",
        "grok.exe",
      ),
      join(process.env.PROGRAMFILES ?? "C:\\Program Files", "grok", "grok.exe"),
      join(
        process.env["PROGRAMFILES(X86)"] ?? "C:\\Program Files (x86)",
        "grok",
        "grok.exe",
      ),
      join(process.env.USERPROFILE ?? homedir(), "scoop", "shims", "grok.exe"),
      join(
        process.env.ChocolateyInstall ?? "C:\\ProgramData\\chocolatey",
        "bin",
        "grok.exe",
      ),
      join(process.env.APPDATA ?? "", "npm", "grok.cmd"),
      join(process.env.APPDATA ?? "", "npm", "grok.exe"),
    );
  } else if (process.platform === "darwin") {
    candidates.push(
      "/usr/local/bin/grok",
      "/opt/homebrew/bin/grok",
      "/usr/bin/grok",
    );
  } else {
    candidates.push(
      "/usr/local/bin/grok",
      "/usr/bin/grok",
      "/snap/bin/grok",
    );
  }

  for (const c of candidates) {
    if (!c) continue;
    searched.push(c);
    if (await pathExists(c)) {
      // On Windows, prefer the .exe variant if both exist — `spawn` needs
      // an extension to be safe and to match what the installer wrote.
      const resolved =
        process.platform === "win32" && !/\.(exe|cmd|bat)$/i.test(c)
          ? await resolveWindowsExtension(c)
          : c;
      return { kind: "found", path: resolved, source: "well-known" };
    }
  }

  // PATH lookup (best effort; not fatal if `which`/`where` is unavailable).
  try {
    const which = process.platform === "win32" ? "where" : "which";
    const stdoutRaw: unknown = await new Promise((res, rej) => {
      execFile(
        which,
        ["grok"],
        { windowsHide: true },
        (err, stdout, _stderr) => {
          if (err) {
            rej(err);
            return;
          }
          res(stdout);
        },
      );
    });
    const stdout =
      typeof stdoutRaw === "string"
        ? stdoutRaw
        : Buffer.isBuffer(stdoutRaw)
          ? stdoutRaw.toString("utf8")
          : "";
    const first = stdout
      .split(/\r?\n/)
      .map((s) => s.trim())
      .find(Boolean);
    if (first && (await pathExists(first))) {
      const resolved =
        process.platform === "win32"
          ? await resolveWindowsExtension(first)
          : first;
      return { kind: "found", path: resolved, source: "$PATH" };
    }
  } catch {
    /* `which`/`where` failed or `grok` not on PATH — fall through */
  }

  return { kind: "missing", searched, fallback: "grok" };
}

// ---------------------------------------------------------------------------
// Installer (fresh install / upgrade)
// ---------------------------------------------------------------------------

/**
 * Drive the official `grok` CLI installer. Used for both first-time installs
 * (no binary present) and upgrades (binary present, channel target unchanged).
 *
 * The installer always writes to `$HOME/.grok/bin/{grok,agent}` which is the
 * first well-known path searched by `resolveGrokBinaryDetailed()`.
 */
export async function runGrokInstaller(): Promise<InstallerResult> {
  return runInstallerScript({ withChannel: undefined });
}

export async function runGrokInstallerForChannel(
  channel: InstallerChannel,
): Promise<InstallerResult> {
  return runInstallerScript({ withChannel: channel });
}

async function runInstallerScript(opts: {
  withChannel?: InstallerChannel;
}): Promise<InstallerResult> {
  const start = Date.now();
  const isWin = process.platform === "win32";

  const home = homedir();
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    GROK_CHANNEL:
      opts.withChannel ??
      process.env.GROK_CHANNEL ??
      "stable",
  };

  const cmd = isWin
    ? {
        file: "powershell.exe",
        args: [
          "-NoProfile",
          "-ExecutionPolicy",
          "Bypass",
          "-Command",
          `try { irm ${GROK_INSTALL_URL_PS1} | iex } catch { Write-Error $_; exit 1 }`,
        ],
      }
    : {
        file: "bash",
        args: ["-lc", `curl -fsSL ${GROK_INSTALL_URL_SH} | bash`],
      };

  return new Promise<InstallerResult>((resolve) => {
    let child: ChildProcess;
    try {
      child = spawn(cmd.file, cmd.args, {
        env,
        cwd: home,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch (err) {
      resolve({
        ok: false,
        output: "",
        code: null,
        durationMs: Date.now() - start,
        error: `Failed to spawn installer: ${err instanceof Error ? err.message : String(err)}`,
      });
      return;
    }

    let buf = "";
    const onChunk = (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      buf += text;
      if (buf.length > 1024 * 1024) buf = buf.slice(-512 * 1024);
    };
    child.stdout?.on("data", onChunk);
    child.stderr?.on("data", onChunk);

    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        /* already dead */
      }
      resolve({
        ok: false,
        output: buf,
        code: null,
        durationMs: Date.now() - start,
        error: `Installer timed out after ${Math.round(INSTALL_TIMEOUT_MS / 1000)}s.`,
      });
    }, INSTALL_TIMEOUT_MS);

    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({
        ok: false,
        output: buf,
        code: null,
        durationMs: Date.now() - start,
        error: `Installer failed to start: ${err.message}`,
      });
    });

    child.on("exit", async (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        resolve({
          ok: false,
          output: buf,
          code,
          durationMs: Date.now() - start,
          error: `Installer exited with code ${code}.`,
        });
        return;
      }
      const resolved = await resolveGrokBinaryDetailed();
      if (resolved.kind === "found") {
        resolve({
          ok: true,
          path: resolved.path,
          output: buf,
          code,
          durationMs: Date.now() - start,
        });
        return;
      }
      resolve({
        ok: false,
        output: buf,
        code,
        durationMs: Date.now() - start,
        error:
          "Installer finished successfully but `grok` is still not on disk. " +
          "Try running the install command manually in a terminal.",
      });
    });
  });
}

// ---------------------------------------------------------------------------
// Version detection
// ---------------------------------------------------------------------------

/**
 * Run `grok --version` and parse the result. Returns undefined when the
 * binary can't be reached or doesn't speak the expected format.
 *
 * The CLI outputs something like `grok 0.1.42 (stable)`. We extract the
 * first semver-looking token.
 *
 * Symlink-aware: we resolve symlinks before invoking the binary so the
 * version we report is the version of the *real* file the installer
 * wrote, not whatever a stale symlink happens to be pointing at. This
 * matters right after an upgrade when the installer rewrites
 * `~/.grok/downloads/grok-linux-x86_64` but a `~/.grok/bin/grok`
 * symlink to the old path could still be lingering.
 */
export async function readInstalledVersion(
  binaryPath: string,
): Promise<string | undefined> {
  // Resolve symlinks so spawn() goes straight to the real file.
  let probePath = binaryPath;
  try {
    probePath = await realpath(binaryPath);
  } catch {
    /* symlink may be broken; fall through to spawn the input path */
  }
  if (!existsSync(probePath)) return undefined;
  try {
    const stdout = await new Promise<string>((resolve, reject) => {
      const child = spawn(probePath, ["--version"], {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
      let buf = "";
      let settled = false;
      const finish = (err?: Error) => {
        if (settled) return;
        settled = true;
        if (err) reject(err);
        else resolve(buf);
      };
      child.stdout?.on("data", (c: Buffer) => {
        buf += c.toString("utf8");
      });
      child.on("error", (e) => finish(e));
      child.on("exit", (code) => {
        if (code === 0) finish();
        else finish(new Error(`exit ${code}`));
      });
      setTimeout(
        () => finish(new Error("version probe timeout")),
        VERSION_PROBE_TIMEOUT_MS,
      );
    });
    const m = stdout.match(/(\d+\.\d+\.\d+(?:[-+][\w.]+)?)/);
    return m ? m[1] : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Fetch the latest version string for a given channel. The installer
 * scripts use the same endpoint as a version pointer (plain-text body).
 */
export async function fetchLatestVersion(
  channel: InstallerChannel,
): Promise<string> {
  const url = `${BASE_URL_PRIMARY}/${channel}`;
  try {
    const v = await httpGetText(url);
    if (v) return v;
  } catch {
    /* fall through */
  }
  const fb = await httpGetText(`${BASE_URL_FALLBACK}/${channel}`);
  if (!fb) {
    throw new Error(
      `Failed to fetch latest ${channel} version from ${url} (and fallback)`,
    );
  }
  return fb;
}

async function httpGetText(url: string): Promise<string> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 15_000);
  try {
    const res = await fetch(url, { signal: ctl.signal });
    if (!res.ok) return "";
    const text = (await res.text()).trim();
    const m = text.match(/(\d+\.\d+\.\d+(?:[-+][\w.]+)?)/);
    return m ? m[1] : text;
  } catch {
    return "";
  } finally {
    clearTimeout(timer);
  }
}

export function isNewerVersion(latest: string, current: string): boolean {
  // Strip pre-release / build suffix for the comparison; for the desktop's
  // purposes "0.1.42-alpha.1" should still trigger an upgrade to "0.1.42".
  const norm = (v: string) =>
    v.replace(/[-+][\w.]+$/, "").split(".").map((n) => parseInt(n, 10) || 0);
  const [aMaj, aMin, aPat] = norm(latest);
  const [bMaj, bMin, bPat] = norm(current);
  if (aMaj !== bMaj) return aMaj > bMaj;
  if (aMin !== bMin) return aMin > bMin;
  return aPat > bPat;
}

// ---------------------------------------------------------------------------
// Backup / rollback
// ---------------------------------------------------------------------------

/**
 * Resolve symlinks to the underlying file. The official installer on
 * macOS/Linux keeps `~/.grok/bin/grok` as a symlink to a version-named
 * file under `~/.grok/downloads/`. Calling `rename()` on the symlink
 * itself would either fail (some systems) or, worse, track the link
 * and rename the *target* — leaving the symlink dangling and us
 * without a usable backup. Always back up / roll back the real file.
 */
async function realpathBinary(binaryPath: string): Promise<string> {
  try {
    return await realpath(binaryPath);
  } catch {
    // realpath() throws on broken symlinks; fall back to the input so
    // we still attempt the rename on whatever happens to be there.
    return binaryPath;
  }
}

/**
 * Stash the binary at `binaryPath` to a `.bak-<timestamp>` sibling.
 *
 * Symlink-aware: backs up the *target* of the symlink rather than the
 * symlink itself, so the installer can rewrite the symlink (or its
 * target) freely without losing the previous version.
 *
 * Returns the backup path on success, or undefined on failure. We never
 * block an upgrade because we couldn't stash the previous binary —
 * rollback just becomes a no-op in that case.
 */
export async function backupBinary(
  binaryPath: string,
): Promise<string | undefined> {
  if (!existsSync(binaryPath)) return undefined;
  const realPath = await realpathBinary(binaryPath);
  const stamp = Date.now();
  const backupPath = `${realPath}${BACKUP_SUFFIX}-${stamp}`;
  try {
    // Stale backups from prior upgrades get evicted first; we keep
    // only one `.bak-<ts>` per real path so disk usage stays bounded.
    const parent = dirname(realPath);
    const base = basename(realPath);
    const { readdir } = await import("node:fs/promises");
    const entries = await readdir(parent).catch(() => [] as string[]);
    for (const e of entries) {
      if (e.startsWith(`${base}${BACKUP_SUFFIX}-`)) {
        await unlink(join(parent, e)).catch(() => {
          /* best effort */
        });
      }
    }
    // If the symlink and its target live in different directories
    // (e.g. ~/.grok/bin/grok -> ~/.grok/downloads/grok-linux-x86_64)
    // we want the backup next to the target, not next to the symlink,
    // so a re-spawn of `grok` resolves through the same code path.
    if (realPath !== binaryPath) {
      // Detach the symlink before renaming the target so we don't end
      // up with a symlink that points at the freshly-renamed file.
      try {
        await unlink(binaryPath);
      } catch {
        /* may already be gone */
      }
    }
    await rename(realPath, backupPath);
    // If we deleted the symlink above, restore it pointing at the
    // backup so the running `grok` agent still has something to
    // resolve. The installer will later overwrite this symlink with
    // the new version.
    if (realPath !== binaryPath) {
      try {
        await symlink(backupPath, binaryPath);
      } catch {
        /* best effort — installer will recreate */
      }
    }
    return backupPath;
  } catch {
    return undefined;
  }
}

/**
 * Restore the most recent `.bak-<timestamp>` backup onto `binaryPath`.
 *
 * Symlink-aware: looks for backups next to the *real* binary (after
 * resolving symlinks), then restores the target file in place. If
 * `binaryPath` itself was a symlink that got blown away during the
 * upgrade, this also recreates the symlink so the user can still run
 * `grok` from `$PATH` / `~/.grok/bin/`.
 */
export async function rollbackBinary(binaryPath: string): Promise<boolean> {
  const realPath = await realpathBinary(binaryPath);
  const parent = dirname(realPath);
  const base = basename(realPath);
  let backupPath: string | undefined;
  try {
    const { readdir } = await import("node:fs/promises");
    const entries = await readdir(parent).catch(() => [] as string[]);
    const candidates = entries
      .filter((e) => e.startsWith(`${base}${BACKUP_SUFFIX}-`))
      .sort();
    if (candidates.length === 0) {
      // Fallback: look for a `.bak-<ts>` next to the symlink itself,
      // in case an older desktop version created one there.
      const linkParent = dirname(binaryPath);
      const linkBase = basename(binaryPath);
      const linkEntries = await readdir(linkParent).catch(() => [] as string[]);
      const linkCandidates = linkEntries
        .filter((e) => e.startsWith(`${linkBase}${BACKUP_SUFFIX}-`))
        .sort();
      if (linkCandidates.length === 0) return false;
      backupPath = join(linkParent, linkCandidates[linkCandidates.length - 1]!);
    } else {
      backupPath = join(parent, candidates[candidates.length - 1]!);
    }
  } catch {
    return false;
  }
  try {
    // If the current binary is still alive (zombie) we can't unlink it
    // on Windows; copy-then-rename handles the locked case.
    try {
      await unlink(realPath);
    } catch {
      await copyFile(backupPath, realPath);
      // Restore the symlink if it used to exist and is now missing.
      if (realPath !== binaryPath && !existsSync(binaryPath)) {
        await symlink(realPath, binaryPath).catch(() => {
          /* best effort */
        });
      }
      return true;
    }
    await rename(backupPath, realPath);
    if (realPath !== binaryPath && !existsSync(binaryPath)) {
      await symlink(realPath, binaryPath).catch(() => {
        /* best effort */
      });
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Wait for the backup to appear on disk (best effort, ≤
 * ROLLBACK_TIMEOUT_MS). Resolves symlinks before polling so we look
 * next to the *real* binary file rather than next to its (possibly
 * dangling) symlink.
 */
export async function ensureBackupExists(
  binaryPath: string,
): Promise<boolean> {
  const deadline = Date.now() + ROLLBACK_TIMEOUT_MS;
  // Resolve symlinks once, at the start. The backup lives next to the
  // real file — see backupBinary() for why.
  let probePath = binaryPath;
  try {
    probePath = await realpath(binaryPath);
  } catch {
    /* symlink may have been blown away by the installer; try both */
  }
  const probeParent = dirname(probePath);
  const probeBase = basename(probePath);
  const linkParent = dirname(binaryPath);
  const linkBase = basename(binaryPath);
  while (Date.now() < deadline) {
    if (!existsSync(binaryPath)) return true;
    try {
      const { readdir } = await import("node:fs/promises");
      // Check next to the real file (the canonical location).
      const realEntries = await readdir(probeParent).catch(() => [] as string[]);
      if (realEntries.some((e) => e.startsWith(`${probeBase}${BACKUP_SUFFIX}-`))) {
        return true;
      }
      // Also accept a backup next to the symlink itself, in case an
      // older release placed one there.
      const linkEntries = await readdir(linkParent).catch(() => [] as string[]);
      if (linkEntries.some((e) => e.startsWith(`${linkBase}${BACKUP_SUFFIX}-`))) {
        return true;
      }
    } catch {
      /* keep polling */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

// ---------------------------------------------------------------------------
// Channel persistence
// ---------------------------------------------------------------------------

/**
 * Read `channel` from `~/.grok/config.toml [cli]` block. Defaults to
 * `"stable"` when missing or invalid.
 */
export async function getChannel(): Promise<InstallerChannel> {
  try {
    const text = await readFile(grokConfigPath(), "utf8");
    let inCli = false;
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      if (trimmed.startsWith("[")) {
        inCli = trimmed === "[cli]" || trimmed.startsWith("[cli.");
        continue;
      }
      if (!inCli) continue;
      const m = /^channel\s*=\s*"([^"]+)"\s*(?:#.*)?$/i.exec(trimmed);
      if (m) {
        const v = m[1] as InstallerChannel;
        if ((VALID_CHANNELS as readonly string[]).includes(v)) return v;
      }
    }
  } catch {
    /* missing or unreadable */
  }
  return "stable";
}

/**
 * Upsert `[cli].channel = "<ch>"` in config.toml. Preserves unrelated
 * content via the same line-rewrite strategy used elsewhere.
 */
export async function setChannel(ch: InstallerChannel): Promise<void> {
  if (!(VALID_CHANNELS as readonly string[]).includes(ch)) {
    throw new Error(`Invalid channel: ${ch}`);
  }
  const path = grokConfigPath();
  let text = "";
  try {
    text = await readFile(path, "utf8");
  } catch {
    text = "";
  }

  const lines = text.length > 0 ? text.split(/\r?\n/) : [];
  let inCli = false;
  let sawCli = false;
  let channelIdx = -1;
  let cliHeaderIdx = -1;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i]!.trim();
    if (trimmed.startsWith("[")) {
      inCli = trimmed === "[cli]" || trimmed.startsWith("[cli.");
      if (trimmed === "[cli]") {
        sawCli = true;
        cliHeaderIdx = i;
      }
      continue;
    }
    if (!inCli) continue;
    if (/^channel\s*=/.test(trimmed)) channelIdx = i;
  }

  const channelLine = `channel = "${ch}"`;
  if (channelIdx >= 0) {
    lines[channelIdx] = channelLine;
  } else if (!sawCli) {
    if (lines.length > 0 && lines[lines.length - 1] !== "") lines.push("");
    lines.push("[cli]");
    lines.push(channelLine);
  } else {
    lines.splice(cliHeaderIdx + 1, 0, channelLine);
  }

  const out = lines.join("\n").replace(/\n{3,}/g, "\n\n");
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, out.endsWith("\n") ? out : `${out}\n`, "utf8");
}

// ---------------------------------------------------------------------------
// High-level lifecycle
// ---------------------------------------------------------------------------

/**
 * Snapshot of the installer state for the renderer. Re-resolves everything
 * from disk so the UI always reflects ground truth.
 */
export async function getInstallerStatus(): Promise<InstallerStatus> {
  const resolved = await resolveGrokBinaryDetailed();
  if (resolved.kind === "missing") return { kind: "absent" };
  const version = await readInstalledVersion(resolved.path);
  if (!version) {
    return {
      kind: "error",
      message: `Found grok at ${resolved.path} but it did not respond to --version.`,
    };
  }
  return { kind: "ready", version, path: resolved.path };
}

/**
 * Compare installed version against the channel pointer.
 * Network failure → no update signal (return hasUpdate=false silently).
 */
export async function checkForUpdate(): Promise<UpdateCheck> {
  const status = await getInstallerStatus();
  if (status.kind !== "ready") {
    return { hasUpdate: false, current: "", latest: "" };
  }
  const channel = await getChannel();
  const latest = await fetchLatestVersion(channel);
  return {
    hasUpdate: isNewerVersion(latest, status.version),
    current: status.version,
    latest,
  };
}

/**
 * Upgrade path: snapshot the current binary to .bak, then run the
 * installer to pull the latest version. Caller is responsible for
 * triggering a re-connect and verifying health.
 */
export async function upgrade(): Promise<InstallerResult> {
  const before = await getInstallerStatus();
  if (before.kind !== "ready") {
    return {
      ok: false,
      output: "",
      code: null,
      durationMs: 0,
      error: `Cannot upgrade: grok is not currently installed (status: ${before.kind}).`,
    };
  }
  await backupBinary(before.path);
  const channel = await getChannel();
  return runGrokInstallerForChannel(channel);
}

/**
 * Ensure the binary on disk is executable (Unix). The installer on
 * Windows writes the .exe with correct attrs automatically.
 */
export async function ensureExecutable(binaryPath: string): Promise<void> {
  if (process.platform === "win32") return;
  try {
    await chmod(binaryPath, 0o755);
  } catch {
    /* best effort */
  }
}

/**
 * Run `grok --version` end-to-end through the resolver so callers get a
 * structured pass/fail without having to import the lower-level helpers.
 */
export async function probeHealth(): Promise<{
  ok: boolean;
  version?: string;
  path?: string;
  error?: string;
}> {
  const status = await getInstallerStatus();
  if (status.kind !== "ready") {
    return {
      ok: false,
      error:
        status.kind === "absent"
          ? "grok CLI not installed"
          : status.kind === "error"
            ? status.message
            : "grok CLI not ready",
    };
  }
  return { ok: true, version: status.version, path: status.path };
}

// Cross-platform path separator re-export for callers that want to scan
// well-known dirs without importing node:path.
export const PATH_SEP = sep;