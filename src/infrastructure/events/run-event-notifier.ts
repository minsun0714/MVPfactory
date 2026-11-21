import { Client } from "pg";
import type { RunEventSource } from "@/application/ports";
import { RUN_EVENT_CHANNEL } from "@/infrastructure/prisma/event-log";

type Listener = (runId: string | "*") => void;

/**
 * PostgreSQL `LISTEN`으로 새 이벤트 신호를 받아 구독자에게 전달한다.
 * 신호에는 Run ID만 담기며, 이벤트 내용은 구독자가 DB에서 읽는다.
 * 연결이 끊기면 다시 연결하고, 그동안 놓친 신호를 보충하도록 구독자에게 `"*"`를 보낸다.
 * `LISTEN`은 연결을 오래 유지하므로 풀링을 거치지 않는 전용 연결을 쓴다.
 */
export class RunEventNotifier implements RunEventSource {
  private readonly listeners = new Set<Listener>();
  private client: Client | null = null;
  private connecting: Promise<void> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;

  constructor(private readonly connectionString: string) {}

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    void this.ensureConnected();
    return () => {
      this.listeners.delete(listener);
    };
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    const client = this.client;
    this.client = null;
    if (client) await client.end().catch(() => undefined);
  }

  private emit(runId: string | "*") {
    for (const listener of this.listeners) listener(runId);
  }

  private ensureConnected(): Promise<void> {
    if (this.closed || this.client) return Promise.resolve();
    this.connecting ??= this.connect().finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }

  private async connect(): Promise<void> {
    const client = new Client({ connectionString: this.connectionString });
    try {
      await client.connect();
      client.on("notification", (message) => {
        if (message.channel === RUN_EVENT_CHANNEL && message.payload)
          this.emit(message.payload);
      });
      client.on("error", () => this.handleLost(client));
      client.on("end", () => this.handleLost(client));
      await client.query(`LISTEN ${RUN_EVENT_CHANNEL}`);
      this.client = client;
      // 연결이 없던 동안 놓친 이벤트가 있을 수 있으니 모든 구독자가 다시 확인한다.
      this.emit("*");
    } catch {
      await client.end().catch(() => undefined);
      this.scheduleRetry();
    }
  }

  private handleLost(client: Client) {
    if (this.client !== client) return;
    this.client = null;
    this.scheduleRetry();
  }

  private scheduleRetry() {
    if (this.closed || this.retryTimer || this.listeners.size === 0) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.ensureConnected();
    }, 1000);
  }
}
