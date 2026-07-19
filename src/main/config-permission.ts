import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

/** Path to the shared Grok user config (CLI + Desktop). */
export function grokConfigPath(): string {
  return join(homedir(), ".grok", "config.toml");
}

/**
 * Read always-approve / yolo preference from `~/.grok/config.toml`.
 * `permission_mode = "always-approve"` wins; otherwise `yolo = true`.
 */
export async function readAlwaysApproveFromConfig(): Promise<boolean> {
  try {
    const text = await readFile(grokConfigPath(), "utf8");
    // Prefer the last matching key in file (later sections can override in
    // simple flat configs; good enough for single [ui] block).
    let mode: string | undefined;
    let yolo: boolean | undefined;
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const modeM = trimmed.match(/^permission_mode\s*=\s*"([^"]+)"\s*(?:#.*)?$/);
      if (modeM) {
        mode = modeM[1];
        continue;
      }
      const yoloM = trimmed.match(/^yolo\s*=\s*(true|false)\s*(?:#.*)?$/i);
      if (yoloM) {
        yolo = yoloM[1]!.toLowerCase() === "true";
      }
    }
    if (mode === "always-approve") return true;
    if (mode === "ask" || mode === "default") return false;
    return yolo === true;
  } catch {
    return false;
  }
}

/**
 * Upsert `[ui].permission_mode` and `[ui].yolo` in config.toml.
 * Preserves unrelated content as best-effort line rewrite.
 */
export async function writeAlwaysApproveToConfig(
  enabled: boolean,
): Promise<void> {
  const path = grokConfigPath();
  let text = "";
  try {
    text = await readFile(path, "utf8");
  } catch {
    text = "";
  }

  const modeValue = enabled ? "always-approve" : "ask";
  const yoloValue = enabled ? "true" : "false";
  const lines = text.length > 0 ? text.split(/\r?\n/) : [];
  let inUi = false;
  let sawUi = false;
  let modeIdx = -1;
  let yoloIdx = -1;
  let uiHeaderIdx = -1;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i]!.trim();
    if (trimmed.startsWith("[")) {
      inUi = trimmed === "[ui]" || trimmed.startsWith("[ui.");
      if (trimmed === "[ui]") {
        sawUi = true;
        uiHeaderIdx = i;
      }
      continue;
    }
    if (!inUi) continue;
    if (/^permission_mode\s*=/.test(trimmed)) modeIdx = i;
    if (/^yolo\s*=/.test(trimmed)) yoloIdx = i;
  }

  const modeLine = `permission_mode = "${modeValue}"`;
  const yoloLine = `yolo = ${yoloValue}`;

  if (modeIdx >= 0) lines[modeIdx] = modeLine;
  if (yoloIdx >= 0) lines[yoloIdx] = yoloLine;

  if (modeIdx < 0 || yoloIdx < 0) {
    if (!sawUi) {
      if (lines.length > 0 && lines[lines.length - 1] !== "") lines.push("");
      lines.push("[ui]");
      if (modeIdx < 0) lines.push(modeLine);
      if (yoloIdx < 0) lines.push(yoloLine);
    } else {
      // Insert missing keys right after [ui] header.
      let insertAt = uiHeaderIdx + 1;
      if (modeIdx < 0) {
        lines.splice(insertAt, 0, modeLine);
        insertAt++;
        if (yoloIdx >= 0 && yoloIdx >= insertAt - 1) yoloIdx++;
      }
      if (yoloIdx < 0) {
        // Prefer next to permission_mode if we just added or found it.
        const afterMode = lines.findIndex((l) =>
          /^\s*permission_mode\s*=/.test(l),
        );
        const at = afterMode >= 0 ? afterMode + 1 : insertAt;
        lines.splice(at, 0, yoloLine);
      }
    }
  }

  const out = lines.join("\n").replace(/\n{3,}/g, "\n\n");
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, out.endsWith("\n") ? out : `${out}\n`, "utf8");
}

/**
 * Read `auto_trust_new_sessions` (or older alias `trust_workspace_on_launch`)
 * from `~/.grok/config.toml [ui]` block. Defaults to `false` when the key is
 * absent — desktop deliberately keeps the gate "ask first" by default,
 * matching the agent's own opt-in behavior.
 */
export async function readAutoTrustNewSessionsFromConfig(): Promise<boolean> {
  try {
    const text = await readFile(grokConfigPath(), "utf8");
    let inUi = false;
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      if (trimmed.startsWith("[")) {
        inUi = trimmed === "[ui]" || trimmed.startsWith("[ui.");
        continue;
      }
      if (!inUi) continue;
      // Prefer the explicit modern key, fall back to the legacy name.
      const m =
        /^auto_trust_new_sessions\s*=\s*(true|false)\b/i.exec(trimmed) ??
        /^trust_workspace_on_launch\s*=\s*(true|false)\b/i.exec(trimmed);
      if (m) return m[1]!.toLowerCase() === "true";
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Upsert `[ui].auto_trust_new_sessions` (modern key). Preserves unrelated
 * content via the same line-rewrite strategy as `writeAlwaysApproveToConfig`.
 */
export async function writeAutoTrustNewSessionsToConfig(
  enabled: boolean,
): Promise<void> {
  const path = grokConfigPath();
  let text = "";
  try {
    text = await readFile(path, "utf8");
  } catch {
    text = "";
  }
  const value = enabled ? "true" : "false";
  const key = "auto_trust_new_sessions";
  const lines = text.length > 0 ? text.split(/\r?\n/) : [];
  let inUi = false;
  let sawUi = false;
  let keyIdx = -1;
  let uiHeaderIdx = -1;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i]!.trim();
    if (trimmed.startsWith("[")) {
      inUi = trimmed === "[ui]" || trimmed.startsWith("[ui.");
      if (trimmed === "[ui]") {
        sawUi = true;
        uiHeaderIdx = i;
      }
      continue;
    }
    if (!inUi) continue;
    if (new RegExp(`^${key}\\s*=`).test(trimmed)) keyIdx = i;
  }

  const keyLine = `${key} = ${value}`;
  if (keyIdx >= 0) {
    lines[keyIdx] = keyLine;
  } else if (!sawUi) {
    if (lines.length > 0 && lines[lines.length - 1] !== "") lines.push("");
    lines.push("[ui]");
    lines.push(keyLine);
  } else {
    // Insert right after [ui] header. We don't try to colocate with other
    // keys — they may not exist yet.
    lines.splice(uiHeaderIdx + 1, 0, keyLine);
  }

  const out = lines.join("\n").replace(/\n{3,}/g, "\n\n");
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, out.endsWith("\n") ? out : `${out}\n`, "utf8");
}
