import { open, readdir, stat } from "node:fs/promises";
import {
  basename,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import type { FileEntry, FileReadResult } from "../shared/types";

/** Skip heavy / VCS dirs at list time (still readable if opened by path). */
const HIDDEN_DIR_NAMES = new Set([
  "node_modules",
  ".git",
  ".hg",
  ".svn",
  ".next",
  ".nuxt",
  ".turbo",
  "dist",
  "build",
  "out",
  "target",
  "__pycache__",
  ".venv",
  "venv",
  ".idea",
  ".gradle",
  "coverage",
]);

const MAX_LIST_ENTRIES = 800;
const MAX_READ_BYTES = 512 * 1024; // 512 KiB preview cap
const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8 MiB cap for inline image previews
const BINARY_SAMPLE = 8192;

/** Extension → image MIME mapping (covers the formats the preview can render). */
const IMAGE_MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".svg": "image/svg+xml",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
};

export function imageMimeFor(ext: string): string | undefined {
  return IMAGE_MIME_BY_EXT[ext.toLowerCase()];
}

/**
 * Resolve `relPath` under `workspaceRoot`. Rejects path traversal.
 * Empty / "." → root itself.
 */
export function resolveUnderWorkspace(
  workspaceRoot: string,
  relPath: string,
): string {
  const root = resolve(workspaceRoot);
  const cleaned = (relPath || ".")
    .replace(/\\/g, "/")
    .replace(/^\.\/+/, "")
    .replace(/^\/+/, "");
  const abs =
    cleaned === "" || cleaned === "."
      ? root
      : resolve(root, cleaned);
  const rel = relative(root, abs);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error("Path is outside the workspace");
  }
  // Block null bytes / weird separators
  if (abs.includes("\0")) {
    throw new Error("Invalid path");
  }
  return abs;
}

function toPosixRel(workspaceRoot: string, abs: string): string {
  const rel = relative(resolve(workspaceRoot), abs);
  if (!rel || rel === ".") return "";
  return rel.split(sep).join("/");
}

function looksBinary(buf: Buffer): boolean {
  const n = Math.min(buf.length, BINARY_SAMPLE);
  for (let i = 0; i < n; i++) {
    if (buf[i] === 0) return true;
  }
  return false;
}

export async function listWorkspaceDir(
  workspaceRoot: string,
  relDir = "",
): Promise<FileEntry[]> {
  const abs = resolveUnderWorkspace(workspaceRoot, relDir);
  const st = await stat(abs);
  if (!st.isDirectory()) {
    throw new Error("Not a directory");
  }

  const names = await readdir(abs);
  const out: FileEntry[] = [];

  for (const name of names) {
    if (name === "." || name === "..") continue;
    // Hide dotfiles unless listing a nested path that user expanded
    // (still show .env, .gitignore etc. at root — useful for agents)
    const childAbs = join(abs, name);
    let childStat;
    try {
      childStat = await stat(childAbs);
    } catch {
      continue;
    }
    const isDir = childStat.isDirectory();
    if (isDir && HIDDEN_DIR_NAMES.has(name)) continue;

    out.push({
      name,
      path: toPosixRel(workspaceRoot, childAbs),
      isDir,
      size: isDir ? undefined : childStat.size,
    });
    if (out.length >= MAX_LIST_ENTRIES) break;
  }

  out.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
  return out;
}

export async function readWorkspaceFile(
  workspaceRoot: string,
  relPath: string,
): Promise<FileReadResult> {
  const abs = resolveUnderWorkspace(workspaceRoot, relPath);
  const st = await stat(abs);
  if (!st.isFile()) {
    throw new Error("Not a file");
  }

  const posix = toPosixRel(workspaceRoot, abs);
  const name = basename(abs);
  const ext = extname(name).toLowerCase();
  const size = st.size;
  const imageMime = imageMimeFor(ext);

  if (size === 0) {
    return {
      path: posix,
      name,
      ext,
      size,
      encoding: imageMime ? "binary" : "utf8",
      content: "",
      truncated: false,
      binary: !!imageMime,
      language: "plaintext",
      imageMime,
    };
  }

  // Image: read up to MAX_IMAGE_BYTES for inline preview; never as text.
  if (imageMime) {
    const toRead = Math.min(size, MAX_IMAGE_BYTES);
    const buf = Buffer.alloc(toRead);
    const fh = await open(abs, "r");
    try {
      await fh.read(buf, 0, toRead, 0);
    } finally {
      await fh.close();
    }
    return {
      path: posix,
      name,
      ext,
      size,
      encoding: "binary",
      content: "",
      truncated: size > MAX_IMAGE_BYTES,
      binary: true,
      language: "plaintext",
      imageMime,
      imageBase64: buf.toString("base64"),
    };
  }

  const toRead = Math.min(size, MAX_READ_BYTES);
  const buf = Buffer.alloc(toRead);
  const fh = await open(abs, "r");
  try {
    await fh.read(buf, 0, toRead, 0);
  } finally {
    await fh.close();
  }

  if (looksBinary(buf)) {
    return {
      path: posix,
      name,
      ext,
      size,
      encoding: "binary",
      content: "",
      truncated: false,
      binary: true,
      language: "plaintext",
    };
  }

  // Strip UTF-8 BOM if present
  let text = buf.toString("utf8");
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  return {
    path: posix,
    name,
    ext,
    size,
    encoding: "utf8",
    content: text,
    truncated: size > MAX_READ_BYTES,
    binary: false,
    language: languageFromExt(ext, name),
  };
}

/** Map extension / filename → highlight.js language id. */
export function languageFromExt(ext: string, filename: string): string {
  const lower = filename.toLowerCase();
  if (
    lower === "dockerfile" ||
    lower.startsWith("dockerfile.") ||
    lower === "containerfile"
  ) {
    return "dockerfile";
  }
  if (lower === "makefile" || lower === "gnumakefile") return "makefile";
  if (lower === "cmakelists.txt") return "cmake";
  if (lower === "go.mod" || lower === "go.sum") return "go";
  if (lower === "cargo.toml" || lower === "cargo.lock") return "toml";
  if (lower === "package.json" || lower.endsWith(".json")) return "json";

  const map: Record<string, string> = {
    ".go": "go",
    ".java": "java",
    ".kt": "kotlin",
    ".kts": "kotlin",
    ".js": "javascript",
    ".mjs": "javascript",
    ".cjs": "javascript",
    ".jsx": "javascript",
    ".ts": "typescript",
    ".tsx": "typescript",
    ".py": "python",
    ".rb": "ruby",
    ".rs": "rust",
    ".c": "c",
    ".h": "c",
    ".cpp": "cpp",
    ".cc": "cpp",
    ".cxx": "cpp",
    ".hpp": "cpp",
    ".cs": "csharp",
    ".php": "php",
    ".swift": "swift",
    ".scala": "scala",
    ".r": "r",
    ".sql": "sql",
    ".sh": "bash",
    ".bash": "bash",
    ".zsh": "bash",
    ".fish": "bash",
    ".ps1": "powershell",
    ".css": "css",
    ".scss": "scss",
    ".sass": "scss",
    ".less": "less",
    ".html": "html",
    ".htm": "html",
    ".xhtml": "html",
    ".vue": "vue",
    ".svelte": "xml",
    ".xml": "xml",
    ".svg": "xml",
    ".md": "markdown",
    ".mdx": "markdown",
    ".markdown": "markdown",
    ".json": "json",
    ".jsonc": "json",
    ".yaml": "yaml",
    ".yml": "yaml",
    ".toml": "ini",
    ".ini": "ini",
    ".cfg": "ini",
    ".conf": "ini",
    ".env": "bash",
    ".graphql": "graphql",
    ".gql": "graphql",
    ".proto": "protobuf",
    ".dart": "dart",
    ".lua": "lua",
    ".pl": "perl",
    ".pm": "perl",
    ".ex": "elixir",
    ".exs": "elixir",
    ".erl": "erlang",
    ".hs": "haskell",
    ".clj": "clojure",
    ".cljs": "clojure",
    ".vim": "vim",
    ".diff": "diff",
    ".patch": "diff",
    ".dockerfile": "dockerfile",
    ".tf": "terraform",
    ".hcl": "terraform",
    ".zig": "rust",
    ".nim": "nim",
    ".jl": "julia",
    ".txt": "plaintext",
    ".log": "plaintext",
  };
  return map[ext] ?? "plaintext";
}
