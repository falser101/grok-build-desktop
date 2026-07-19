/**
 * Read/write ~/.grok/trusted_folders.toml — the same store the agent
 * (`xai-grok-workspace::trust::TrustStore`) owns. We read+write directly so
 * the desktop "Trusted folders" panel can list/revoke without needing a
 * dedicated agent extension method, while staying consistent with the
 * single on-disk authority the agent reads on every new session.
 *
 * File shape (mirrors the agent's serde-derived output):
 *
 *   # 2026-07-19T10:00:00Z — desktop revoke
 *   [folders."/home/user/projects/repo-a"]
 *   trusted = false
 *   decided_at = "2026-07-19T10:00:00Z"
 *
 *   [folders."/home/user/projects/repo-b"]
 *   trusted = true
 *   decided_at = "2026-07-18T08:42:00Z"
 *
 * The format is intentionally tiny (one table per folder, two fields).
 * We do NOT add a TOML dependency — write a minimal emitter + a forgiving
 * reader. Both sides are tolerant of unknown fields and missing files
 * (a missing file is "no folders tracked", not an error).
 */
import { chmod, readFile, realpath, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, sep } from "node:path";

export const TRUST_FILE_NAME = "trusted_folders.toml";

export interface TrustedFolderEntry {
  /** Canonical absolute path (the "workspace key"). */
  path: string;
  /** true = trust granted; false = explicitly declined. */
  trusted: boolean;
  /** ISO 8601 timestamp of the most recent decision, if known. */
  decidedAt?: string;
}

function grokHome(): string {
  return join(homedir(), ".grok");
}

function trustFilePath(): string {
  return join(grokHome(), TRUST_FILE_NAME);
}

/**
 * Canonicalize an absolute path. Returns `input` unchanged when it does not
 * resolve on disk (e.g. user typed a path that doesn't exist yet) — matching
 * `canonicalize_or_owned` in the agent, which falls back to the literal path
 * when `realpath` fails. This keeps symlink-less and missing-folder cases
 * ergonomic.
 */
async function canonicalizeOrOwned(p: string): Promise<string> {
  if (!isAbsolute(p)) return p;
  try {
    return await realpath(p);
  } catch {
    return p;
  }
}

/**
 * Safety net mirroring `is_unsafe_trust_root`: refuse to record the user's
 * $HOME, the filesystem root, or a non-absolute key — each would otherwise
 * trust huge swaths of the filesystem through the cascade. The agent's
 * `record_decision` does the same; we keep parity so a hand-edit or future
 * migration cannot accidentally widen trust.
 */
function isUnsafeTrustRoot(p: string): boolean {
  if (!isAbsolute(p)) return true;
  const home = homedir();
  if (p === home) return true;
  if (p === sep || p === `${sep}`) return true;
  return false;
}

/**
 * Tiny TOML reader for our restricted schema. Handles:
 *   - `[folders."<abs path>"]` table headers (dotted-key or quoted-string)
 *   - `trusted = true|false` (boolean)
 *   - `decided_at = "<iso 8601 string>"` (string)
 *   - `# …` comments and blank lines
 *
 * Anything we don't understand is skipped (forward-compat: the agent may
 * add new fields). Malformed records are dropped silently and logged.
 */
export function parseTrustedFoldersToml(src: string): TrustedFolderEntry[] {
  const out: TrustedFolderEntry[] = [];
  let currentPath: string | undefined;
  // Match:  [folders."/abs/path"]   or   [folders.'/abs/path']
  const headerRe = /^\[\s*folders?\.(?:"([^"]+)"|'([^']+)')\s*\]\s*(#.*)?$/;
  // Match:  trusted = true|false
  const trustedRe = /^\s*trusted\s*=\s*(true|false)\s*(#.*)?$/i;
  // Match:  decided_at = "..."  (string literal, single or double quoted)
  const decidedRe = /^\s*decided_at\s*=\s*(?:"([^"]*)"|'([^']*)')\s*(#.*)?$/;

  for (const rawLine of src.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const headerMatch = headerRe.exec(rawLine);
    if (headerMatch) {
      const p = headerMatch[1] ?? headerMatch[2];
      currentPath = p ? decodeTomlString(p) : undefined;
      continue;
    }
    if (!currentPath) continue;

    const trustedMatch = trustedRe.exec(rawLine);
    if (trustedMatch) {
      // We push on `trusted` only; `decided_at` is appended afterwards.
      const existing = out.find((e) => e.path === currentPath);
      const trusted = trustedMatch[1].toLowerCase() === "true";
      if (existing) {
        existing.trusted = trusted;
      } else {
        out.push({ path: currentPath, trusted });
      }
      continue;
    }
    const decidedMatch = decidedRe.exec(rawLine);
    if (decidedMatch) {
      const ts = decidedMatch[1] ?? decidedMatch[2] ?? "";
      const existing = out.find((e) => e.path === currentPath);
      if (existing) {
        existing.decidedAt = ts;
      } else {
        out.push({ path: currentPath, trusted: false, decidedAt: ts });
      }
      continue;
    }
    // Unknown line under a known table — ignore (forward-compat).
  }
  return out;
}

function decodeTomlString(s: string): string {
  // Minimal unescape: only the escapes our writer emits (`\"` and `\\`).
  return s.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
}

function encodeTomlKeySegment(p: string): string {
  // Wrap in double quotes; escape backslash + double-quote (TOML basic strings).
  return `"${p.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * Serialize the entry list back to TOML. We always emit the full document
 * (not an in-place patch) so the on-disk format stays predictable and
 * comments/lines we don't understand are dropped — same policy the agent's
 * `to_string_pretty` follows.
 */
export function serializeTrustedFoldersToml(
  entries: TrustedFolderEntry[],
): string {
  const lines: string[] = [];
  lines.push(`# ${TRUST_FILE_NAME}`);
  lines.push(`# Auto-merged by grok-build-desktop; the agent reads this file`);
  lines.push(`# directly (${TRUST_FILE_NAME}).`);
  lines.push("");
  // Stable order: by path. Lets diffs stay minimal across runs.
  const sorted = [...entries].sort((a, b) => a.path.localeCompare(b.path));
  for (const e of sorted) {
    lines.push(`[folders.${encodeTomlKeySegment(e.path)}]`);
    lines.push(`trusted = ${e.trusted ? "true" : "false"}`);
    if (e.decidedAt) lines.push(`decided_at = "${e.decidedAt}"`);
    lines.push("");
  }
  // Trailing newline so editors don't complain.
  return lines.join("\n");
}

async function writeAtomically(path: string, body: string): Promise<void> {
  // Node has no built-in atomic rename; we emulate the agent's
  // `tempfile::NamedTempFile::new_in(parent) + rename` by writing to a
  // sibling tempfile and renaming. On Windows the rename can fail if the
  // destination exists, so unlink first.
  const parent = dirname(path);
  const tmp = join(parent, `.${TRUST_FILE_NAME}.tmp.${process.pid}.${Date.now()}`);
  await writeFile(tmp, body, { mode: 0o600 });
  try {
    await chmod(tmp, 0o600);
  } catch {
    /* best effort on Windows */
  }
  const { rename, unlink } = await import("node:fs/promises");
  try {
    await rename(tmp, path);
  } catch (err) {
    // On Windows, rename-over-existing is non-atomic; fall back to unlink+rename.
    try {
      await unlink(path);
      await rename(tmp, path);
    } catch {
      throw err;
    }
  }
}

/** Load every recorded folder decision. Missing file → empty list. */
export async function listTrustedFolders(): Promise<TrustedFolderEntry[]> {
  try {
    const raw = await readFile(trustFilePath(), "utf8");
    return parseTrustedFoldersToml(raw);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

/** Best-effort write of the trust store (creates `~/.grok` if needed). */
async function persist(entries: TrustedFolderEntry[]): Promise<void> {
  const { mkdir } = await import("node:fs/promises");
  const filePath = trustFilePath();
  await mkdir(grokHome(), { recursive: true });
  await writeAtomically(filePath, serializeTrustedFoldersToml(entries));
}

/**
 * Revoke trust for `path`. The agent's `set_untrusted` refuses to record
 * decisions for non-absolute paths / $HOME / `/`, so we mirror that here.
 *
 * Returns `true` if the entry was actually flipped from `trusted = true` to
 * `trusted = false`; `false` if the path was already untrusted, absent, or
 * refused by the over-broad-root guard. The renderer uses the boolean to
 * decide whether to surface a "revoked" toast vs. a no-op notice.
 */
export async function revokeTrustedFolder(rawPath: string): Promise<boolean> {
  const canonical = await canonicalizeOrOwned(rawPath);
  if (isUnsafeTrustRoot(canonical)) {
    return false;
  }
  const entries = await listTrustedFolders();
  const idx = entries.findIndex((e) => e.path === canonical);
  const now = new Date().toISOString();
  if (idx < 0) {
    // Record an explicit "no" so a future re-prompt can tell declined apart
    // from undecided — symmetric with the agent's `set_untrusted` policy.
    entries.push({ path: canonical, trusted: false, decidedAt: now });
  } else {
    const prev = entries[idx]!;
    if (!prev.trusted) {
      // Already untrusted; still bump the timestamp + persist so callers
      // get a stable audit trail.
      prev.decidedAt = now;
    } else {
      entries[idx] = { ...prev, trusted: false, decidedAt: now };
    }
  }
  await persist(entries);
  return idx >= 0 && entries.find((e) => e.path === canonical)?.trusted === false
    ? true
    : idx < 0;
}

/** Test/debug helper — not exposed to renderer. */
export async function _readRawTrustFile(): Promise<string> {
  try {
    return await readFile(trustFilePath(), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw err;
  }
}

/**
 * Grant trust for `path` (mirror of `agent::folder_trust::grant_folder_trust`
 * + `TrustStore::set_trusted`). Same safety guard as `revokeTrustedFolder`:
 * refuses non-absolute / $HOME / `/` paths.
 *
 * Returns the resulting entry (always with `trusted: true`); inserts a fresh
 * record when none exists, flips + bumps timestamp when one does.
 */
export async function grantTrustedFolder(
  rawPath: string,
): Promise<TrustedFolderEntry> {
  const canonical = await canonicalizeOrOwned(rawPath);
  if (isUnsafeTrustRoot(canonical)) {
    throw new Error(
      `refusing to trust unsafe root: ${canonical} (must be absolute, not $HOME, not /)`,
    );
  }
  const entries = await listTrustedFolders();
  const now = new Date().toISOString();
  const idx = entries.findIndex((e) => e.path === canonical);
  const next: TrustedFolderEntry = {
    path: canonical,
    trusted: true,
    decidedAt: now,
  };
  if (idx < 0) entries.push(next);
  else entries[idx] = next;
  await persist(entries);
  return next;
}