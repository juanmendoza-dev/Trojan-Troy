export type Envelope =
  | { type: "create" }
  | { type: "created"; roomCode: string }
  | { type: "join"; roomCode: string }
  | { type: "peer-connected" }
  | { type: "peer-disconnected" }
  | { type: "pubkey"; payload: string }
  | { type: "error"; message: string };

export interface MinimalWebSocket {
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((event: { data: string }) => void) | null;
  onclose: (() => void) | null;
}

export type WebSocketFactory = (url: string) => MinimalWebSocket;

const defaultFactory: WebSocketFactory = (url) =>
  new WebSocket(url) as unknown as MinimalWebSocket;

export class RelayClient {
  private ws: MinimalWebSocket;
  private listeners = new Set<(envelope: Envelope) => void>();

  constructor(url: string, createWebSocket: WebSocketFactory = defaultFactory) {
    this.ws = createWebSocket(url);
    this.ws.onmessage = (event) => {
      const envelope = JSON.parse(event.data) as Envelope;
      for (const listener of this.listeners) {
        listener(envelope);
      }
    };
  }

  onMessage(listener: (envelope: Envelope) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  waitForOpen(): Promise<void> {
    return new Promise((resolve) => {
      this.ws.onopen = () => resolve();
    });
  }

  send(envelope: Envelope): void {
    this.ws.send(JSON.stringify(envelope));
  }

  close(): void {
    this.ws.close();
  }
}
