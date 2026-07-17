import { homedir, platform } from "node:os";
import * as pty from "node-pty";

export type TermEvent =
  | { type: "data"; id: string; data: string }
  | { type: "exit"; id: string; code: number | null };

type TermSession = {
  id: string;
  cwd: string;
  shell: string;
  pty: pty.IPty;
  killed: boolean;
};

/**
 * Interactive PTY host for the right-side terminal (VS Code-style).
 * Spawns a real login shell with a pseudo-terminal so interactive
 * programs (vim, less, git, etc.) work correctly.
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
      return (
        process.env.COMSPEC ||
        process.env.SHELL ||
        "powershell.exe"
      );
    }
    return process.env.SHELL || "/bin/bash";
  }

  start(
    cwd?: string,
    cols = 80,
    rows = 24,
  ): { id: string; cwd: string; shell: string } {
    const workDir =
      (cwd && cwd.trim()) || process.env.HOME || homedir() || process.cwd();
    const shell = this.resolveShell();
    const id = `term-${++this.seq}-${Date.now().toString(36)}`;

    const isWin = platform() === "win32";
    // Login shell on Unix so PATH / profile match a normal terminal.
    const args = isWin ? [] : ["-l"];

    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (typeof v === "string") env[k] = v;
    }
    env.TERM = "xterm-256color";
    env.COLORTERM = env.COLORTERM || "truecolor";
    // Avoid forcing non-interactive quirks; PTY is interactive.
    delete env.ELECTRON_RUN_AS_NODE;

    const spawnOpts: pty.IPtyForkOptions | pty.IWindowsPtyForkOptions = {
      name: "xterm-256color",
      cols: Math.max(2, Math.floor(cols)),
      rows: Math.max(1, Math.floor(rows)),
      cwd: workDir,
      env,
    };
    if (isWin) {
      (spawnOpts as pty.IWindowsPtyForkOptions).useConpty = true;
    }

    let ptyProcess: pty.IPty;
    try {
      ptyProcess = pty.spawn(shell, args, spawnOpts);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to spawn shell: ${msg}`);
    }

    const session: TermSession = {
      id,
      cwd: workDir,
      shell,
      pty: ptyProcess,
      killed: false,
    };
    this.sessions.set(id, session);

    ptyProcess.onData((data) => {
      if (session.killed) return;
      this.emit({ type: "data", id, data });
    });

    ptyProcess.onExit(({ exitCode }) => {
      if (session.killed) return;
      session.killed = true;
      this.sessions.delete(id);
      this.emit({ type: "exit", id, code: exitCode ?? null });
    });

    return { id, cwd: workDir, shell };
  }

  write(id: string, data: string): void {
    const s = this.sessions.get(id);
    if (!s || s.killed) return;
    try {
      s.pty.write(data);
    } catch {
      /* ignore broken pipe */
    }
  }

  resize(id: string, cols: number, rows: number): void {
    const s = this.sessions.get(id);
    if (!s || s.killed) return;
    const c = Math.max(2, Math.floor(cols));
    const r = Math.max(1, Math.floor(rows));
    try {
      s.pty.resize(c, r);
    } catch {
      /* ignore */
    }
  }

  kill(id: string): void {
    const s = this.sessions.get(id);
    if (!s) return;
    s.killed = true;
    this.sessions.delete(id);
    try {
      s.pty.kill();
    } catch {
      /* ignore */
    }
    this.emit({ type: "exit", id, code: 0 });
  }

  killAll(): void {
    for (const id of [...this.sessions.keys()]) {
      this.kill(id);
    }
  }
}
