import WebSocket from "ws";

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export type JsonRpcMessage = {
  jsonrpc?: "2.0";
  id?: number | string;
  method?: string;
  params?: JsonValue;
  result?: JsonValue;
  error?: { code: number; message: string; data?: JsonValue };
};

/**
 * Sentinel returned by `request()` when a long-running call (e.g.
 * `session/prompt`) hits its client-side timeout but the server has already
 * started streaming `session/update` notifications for the same session.
 *
 * Without this, callers would treat a benign timing artefact as a real
 * RPC failure and surface it as a red error banner — even though the
 * turn is still progressing via the notification stream.
 */
export const ABSORBED_BY_STREAM = Symbol.for(
  "grok-desktop/acp/absorbed-by-stream",
);
export type AbsorbedByStream = typeof ABSORBED_BY_STREAM;

export function isAbsorbedByStream(value: unknown): boolean {
  return value === ABSORBED_BY_STREAM;
}

export type AcpClientHandlers = {
  onNotification?: (method: string, params: JsonValue | undefined) => void;
  onRequest?: (
    id: number | string,
    method: string,
    params: JsonValue | undefined,
  ) => Promise<JsonValue> | JsonValue;
  onClose?: (code: number, reason: string) => void;
  onError?: (err: Error) => void;
  onOpen?: () => void;
};

/** Build a readable Error from a JSON-RPC error object (include data when useful). */
export function formatAcpError(err: {
  code: number;
  message: string;
  data?: JsonValue;
}): Error {
  let detail = "";
  if (err.data != null) {
    if (typeof err.data === "string" && err.data.trim()) {
      detail = err.data.trim();
    } else if (typeof err.data === "object") {
      try {
        const o = err.data as Record<string, JsonValue>;
        const nested =
          (typeof o.message === "string" && o.message) ||
          (typeof o.error === "string" && o.error) ||
          (typeof o.detail === "string" && o.detail) ||
          "";
        detail = nested || JSON.stringify(err.data);
      } catch {
        detail = String(err.data);
      }
    } else {
      detail = String(err.data);
    }
  }
  // Drop redundant detail when it's the same as message
  if (detail && detail !== err.message) {
    return new Error(`ACP error ${err.code}: ${err.message} — ${detail}`);
  }
  return new Error(`ACP error ${err.code}: ${err.message}`);
}

/**
 * Minimal ACP JSON-RPC client over WebSocket text frames.
 * Matches grok `agent serve` framing (one JSON object per WS text message).
 */
export class AcpClient {
  private ws: WebSocket | null = null;
  private nextId = 1;
  private pending = new Map<
    number | string,
    {
      resolve: (value: JsonValue | AbsorbedByStream) => void;
      reject: (err: Error) => void;
      /** sessionId extracted from request params, if any — used to detect
       *  "stream already in progress" before timing out. */
      sessionId?: string;
    }
  >();
  /** Session ids for which we have already seen at least one
   *  `session/update` notification since the WS was opened. */
  private activeStreamSessions = new Set<string>();
  private handlers: AcpClientHandlers;

  constructor(handlers: AcpClientHandlers = {}) {
    this.handlers = handlers;
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  /** Has a `session/update` notification already arrived for this session?
   *  Used by long-running RPCs (e.g. `session/prompt`) to avoid reporting
   *  a client-side timeout as a real error when the agent is still streaming. */
  hasStreamStarted(sessionId: string | undefined): boolean {
    if (!sessionId) return false;
    return this.activeStreamSessions.has(sessionId);
  }

  /** Forget all "stream has started" markers — typically called on WS close. */
  resetStreamTracker(): void {
    this.activeStreamSessions.clear();
  }

  connect(url: string): Promise<void> {
    if (this.ws) {
      this.close();
    }

    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      this.ws = ws;
      let settled = false;

      ws.on("open", () => {
        settled = true;
        this.handlers.onOpen?.();
        resolve();
      });

      ws.on("message", (data) => {
        const text = typeof data === "string" ? data : data.toString("utf8");
        this.handleMessage(text);
      });

      ws.on("error", (err) => {
        const error = err instanceof Error ? err : new Error(String(err));
        this.handlers.onError?.(error);
        if (!settled) {
          settled = true;
          reject(error);
        }
      });

      ws.on("close", (code, reasonBuf) => {
        const reason = reasonBuf?.toString("utf8") ?? "";
        for (const [, p] of this.pending) {
          p.reject(new Error(`WebSocket closed (${code}): ${reason}`));
        }
        this.pending.clear();
        this.activeStreamSessions.clear();
        this.handlers.onClose?.(code, reason);
      });
    });
  }

  close(): void {
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        /* ignore */
      }
      this.ws = null;
    }
  }

  async request(
    method: string,
    params?: JsonValue,
    timeoutMs = 120_000,
  ): Promise<JsonValue | AbsorbedByStream> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("ACP client is not connected");
    }
    const id = this.nextId++;
    // Best-effort sessionId extraction. Only JSON-object params with a
    // string `sessionId` field are considered; everything else is treated
    // as "no stream context" and times out the normal way.
    const sessionId = extractSessionId(params);
    const payload = {
      jsonrpc: "2.0" as const,
      id,
      method,
      params: params ?? {},
    };

    return new Promise<JsonValue | AbsorbedByStream>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        // If a `session/update` stream for this session has already started
        // (typical for long-running `session/prompt`), the agent is alive
        // and still working — don't surface this as an error.
        if (this.hasStreamStarted(sessionId)) {
          resolve(ABSORBED_BY_STREAM);
          return;
        }
        reject(new Error(`ACP request timed out: ${method}`));
      }, timeoutMs);

      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
        sessionId,
      });

      this.ws!.send(JSON.stringify(payload));
    });
  }

  notify(method: string, params?: JsonValue): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("ACP client is not connected");
    }
    this.ws.send(
      JSON.stringify({
        jsonrpc: "2.0",
        method,
        params: params ?? {},
      }),
    );
  }

  respond(id: number | string, result: JsonValue): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ jsonrpc: "2.0", id, result }));
  }

  respondError(
    id: number | string,
    code: number,
    message: string,
    data?: JsonValue,
  ): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(
      JSON.stringify({
        jsonrpc: "2.0",
        id,
        error: { code, message, data },
      }),
    );
  }

  private handleMessage(text: string): void {
    const trimmed = text.trim();
    if (!trimmed || trimmed === "ping") return;

    let msg: JsonRpcMessage;
    try {
      msg = JSON.parse(trimmed) as JsonRpcMessage;
    } catch {
      this.handlers.onError?.(new Error(`Invalid JSON from agent: ${trimmed.slice(0, 200)}`));
      return;
    }

    // Response to our request
    if (msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined) && !msg.method) {
      const pending = this.pending.get(msg.id);
      if (pending) {
        this.pending.delete(msg.id);
        if (msg.error) {
          pending.reject(formatAcpError(msg.error));
        } else {
          pending.resolve(msg.result ?? null);
        }
      }
      return;
    }

    // Server request (has id + method) — e.g. session/request_permission
    if (msg.method && msg.id !== undefined) {
      const id = msg.id;
      const method = msg.method;
      const params = msg.params;
      void (async () => {
        try {
          if (!this.handlers.onRequest) {
            this.respondError(id, -32601, `Unhandled reverse request: ${method}`);
            return;
          }
          const result = await this.handlers.onRequest(id, method, params);
          this.respond(id, result);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          this.respondError(id, -32000, message);
        }
      })();
      return;
    }

    // Notification (method, no id)
    if (msg.method) {
      if (msg.method === "session/update") {
        const sid = extractSessionId(msg.params);
        if (sid) this.activeStreamSessions.add(sid);
      }
      this.handlers.onNotification?.(msg.method, msg.params);
    }
  }
}

function extractSessionId(params: JsonValue | undefined): string | undefined {
  if (!params || typeof params !== "object" || Array.isArray(params)) {
    return undefined;
  }
  const v = (params as Record<string, JsonValue>).sessionId;
  return typeof v === "string" && v.length > 0 ? v : undefined;
}
