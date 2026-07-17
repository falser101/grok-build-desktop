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
      resolve: (value: JsonValue) => void;
      reject: (err: Error) => void;
    }
  >();
  private handlers: AcpClientHandlers;

  constructor(handlers: AcpClientHandlers = {}) {
    this.handlers = handlers;
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
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
  ): Promise<JsonValue> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("ACP client is not connected");
    }
    const id = this.nextId++;
    const payload = {
      jsonrpc: "2.0" as const,
      id,
      method,
      params: params ?? {},
    };

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
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
          pending.reject(
            new Error(`ACP error ${msg.error.code}: ${msg.error.message}`),
          );
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
      this.handlers.onNotification?.(msg.method, msg.params);
    }
  }
}
