// Bumped whenever the handshake / post-handshake wire format changes. Sent on
// `commit`/`pubkey` and checked by the peer, so a stale client hits an error
// screen instead of deriving keys against a format it can't speak. v3 added the
// hybrid post-quantum handshake (KEM public key on `pubkey` + the `kemct`
// envelope); v4 added the commit-then-reveal `commit` round + transcript binding;
// v5 seals the ratchet header (so the key class and chain counters leave the wire)
// and folds post-quantum secrets into the ratchet's root chain; v6 binds the
// static channels (presence/ack/profile) to the hybrid root key, so they inherit
// the post-quantum and transcript binding instead of resting on X25519 alone.
export const PROTOCOL_VERSION = 6;

// After the handshake, every content/signal envelope collapses into one opaque
// `msg` so the relay can't tell text from voice from a receipt. As of v5 there is
// nothing else on it: `payload` is base64 of `sealed header (84 bytes) ‖ body
// ciphertext`, and the key class, ratchet public key, chain counters, channel, id,
// mimeType, ack kind and exact size are all inside the encryption.
export type Envelope =
  | { type: "create" }
  | { type: "created"; roomCode: string }
  | { type: "join"; roomCode: string }
  | { type: "peer-connected" }
  | { type: "peer-disconnected" }
  // `commit` = base64 hash commitment to a party's ephemeral handshake key(s),
  // sent before the `pubkey` reveal so keys can't be chosen adaptively (v4).
  // Opaque to the relay, forwarded verbatim like `pubkey`/`kemct`/`msg`.
  | { type: "commit"; v: number; commit: string }
  // `payload` = base64 X25519 handshake public key. `kem` (responder only) =
  // base64 ML-KEM-768 public key for the hybrid post-quantum leg.
  | { type: "pubkey"; payload: string; v: number; kem?: string }
  // ML-KEM ciphertext (base64), sent by the initiator after encapsulating to the
  // responder's `kem` key. Forwarded opaquely by the relay, like `pubkey`/`msg`.
  | { type: "kemct"; payload: string }
  | { type: "msg"; payload: string }
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
    // Mark closed *before* closing the socket so the async `onclose` that
    // follows is treated as an intentional local close (handleFailure
    // early-returns) rather than a relay failure that would clobber the UI.
    this.state = "closed";
    this.pendingOpen = null;
    this.ws.close();
  }
}
