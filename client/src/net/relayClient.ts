export type Envelope =
  | { type: "create" }
  | { type: "created"; roomCode: string }
  | { type: "join"; roomCode: string }
  | { type: "peer-connected" }
  | { type: "peer-disconnected" }
  | { type: "pubkey"; payload: string }
  | { type: "ciphertext"; payload: string }
  | { type: "error"; message: string };

export interface MinimalWebSocket {
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((event: { data: string }) => void) | null;
  onerror: (() => void) | null;
  onclose: (() => void) | null;
}

export type WebSocketFactory = (url: string) => MinimalWebSocket;

const defaultFactory: WebSocketFactory = (url) =>
  new WebSocket(url) as unknown as MinimalWebSocket;

type ConnectionState = "connecting" | "open" | "closed";

export class RelayClient {
  private ws: MinimalWebSocket;
  private listeners = new Set<(envelope: Envelope) => void>();
  private state: ConnectionState = "connecting";
  private pendingOpen: { resolve: () => void; reject: (error: Error) => void } | null = null;

  constructor(url: string, createWebSocket: WebSocketFactory = defaultFactory) {
    this.ws = createWebSocket(url);
    this.ws.onmessage = (event) => {
      try {
        const envelope = JSON.parse(event.data) as Envelope;
        for (const listener of this.listeners) {
          listener(envelope);
        }
      } catch {
        // Silently drop malformed messages
      }
    };
    this.ws.onopen = () => {
      this.state = "open";
      this.pendingOpen?.resolve();
      this.pendingOpen = null;
    };
    this.ws.onerror = () => this.handleFailure("Relay connection error.");
    this.ws.onclose = () => this.handleFailure("Relay connection closed.");
  }

  private handleFailure(message: string): void {
    if (this.state === "closed") return;
    const wasOpen = this.state === "open";
    this.state = "closed";
    if (this.pendingOpen) {
      this.pendingOpen.reject(new Error(message));
      this.pendingOpen = null;
      return;
    }
    if (wasOpen) {
      for (const listener of this.listeners) {
        listener({ type: "error", message });
      }
    }
  }

  onMessage(listener: (envelope: Envelope) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  waitForOpen(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.state === "open") {
        resolve();
        return;
      }
      if (this.state === "closed") {
        reject(new Error("Relay connection closed."));
        return;
      }
      this.pendingOpen = { resolve, reject };
    });
  }

  send(envelope: Envelope): void {
    this.ws.send(JSON.stringify(envelope));
  }

  close(): void {
    this.ws.close();
  }
}
