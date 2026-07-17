import { spawn, type ChildProcess } from "node:child_process";
import { homedir, platform } from "node:os";

export type TermEvent =
  | { type: "data"; id: string; data: string }
  | { type: "exit"; id: string; code: number | null };

type TermSession = {
  id: string;
  cwd: string;
  shell: string;
  /** Active long-running child, if any. */
  child: ChildProcess | null;
  killed: boolean;
};

/**
 * Lightweight shell host for the right-side terminal panel.
 * Runs each submitted line as `shell -c <line>` in the workspace cwd.
 * (No PTY — fine for day-to-day commands; not a full interactive TUI.)
 */
export class TerminalHost {
  private sessions = new Map<string, TermSession>();
  private listeners = new Set<(ev: TermEvent) => void>();
  private seq = 0;

  onEvent(cb: (ev: TermEvent) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private emit(ev: TermEvent): void {
    for (const cb of this.listeners) {
      try {
        cb(ev);
      } catch {
        /* ignore */
      }
    }
  }

  private resolveShell(): string {
    if (platform() === "win32") {
      return process.env.COMSPEC || "cmd.exe";
    }
    return process.env.SHELL || "/bin/bash";
  }

  start(cwd?: string): { id: string; cwd: string; shell: string } {
    const workDir =
      (cwd && cwd.trim()) || process.env.HOME || homedir() || process.cwd();
    const shell = this.resolveShell();
    const id = `term-${++this.seq}-${Date.now().toString(36)}`;
    this.sessions.set(id, {
      id,
      cwd: workDir,
      shell,
      child: null,
      killed: false,
    });

    this.emit({
      type: "data",
      id,
      data: `# ${shell}\n# cwd: ${workDir}\n# Enter a command and press Enter.\n\n`,
    });

    return { id, cwd: workDir, shell };
  }

  write(id: string, data: string): void {
    const s = this.sessions.get(id);
    if (!s || s.killed) return;

    // Treat writes as complete command lines (UI sends line + \n).
    const line = data.replace(/\r?\n$/, "").trimEnd();
    if (!line) return;

    // Kill previous long-running command if still active.
    if (s.child && !s.child.killed) {
      try {
        s.child.kill("SIGTERM");
      } catch {
        /* ignore */
      }
      s.child = null;
    }

    const isWin = platform() === "win32";
    const args = isWin ? ["/d", "/s", "/c", line] : ["-lc", line];
    const child = spawn(s.shell, args, {
      cwd: s.cwd,
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    s.child = child;

    const onChunk = (buf: Buffer) => {
      this.emit({ type: "data", id, data: buf.toString("utf8") });
    };
    child.stdout.on("data", onChunk);
    child.stderr.on("data", onChunk);
    child.on("error", (err) => {
      this.emit({
        type: "data",
        id,
        data: `[error] ${err.message}\n`,
      });
    });
    child.on("exit", (code) => {
      if (s.child === child) s.child = null;
      if (code != null && code !== 0) {
        this.emit({ type: "data", id, data: `\n[exit ${code}]\n` });
      } else {
        this.emit({ type: "data", id, data: "\n" });
      }
    });
  }

  kill(id: string): void {
    const s = this.sessions.get(id);
    if (!s) return;
    s.killed = true;
    this.sessions.delete(id);
    if (s.child) {
      try {
        s.child.kill("SIGTERM");
      } catch {
        /* ignore */
      }
      setTimeout(() => {
        try {
          if (s.child && !s.child.killed) s.child.kill("SIGKILL");
        } catch {
          /* ignore */
        }
      }, 800);
    }
    this.emit({ type: "exit", id, code: 0 });
  }

  killAll(): void {
    for (const id of [...this.sessions.keys()]) {
      this.kill(id);
    }
  }
}
