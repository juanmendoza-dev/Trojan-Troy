import { describe, it, expect } from "vitest";
import { RelayClient, type Envelope, type MinimalWebSocket } from "./relayClient";

function fakeSocket(): MinimalWebSocket & { sent: string[] } {
  const sent: string[] = [];
  return {
    sent,
    send: (data: string) => sent.push(data),
    close: () => {},
    onopen: null,
    onmessage: null,
    onerror: null,
    onclose: null,
  };
}

describe("RelayClient", () => {
  it("sends envelopes as JSON over the socket", () => {
    const socket = fakeSocket();
    const client = new RelayClient("ws://test", () => socket);

    client.send({ type: "create" });

    expect(socket.sent).toEqual([JSON.stringify({ type: "create" })]);
  });

  it("sends an opaque msg envelope with nothing but a payload", () => {
    const socket = fakeSocket();
    const client = new RelayClient("ws://test", () => socket);

    // v5: the sealed header rides inside `payload`, so there is no cleartext class
    // selector and no cleartext ratchet header for the relay to read.
    const env: Envelope = { type: "msg", payload: "sealed-header-and-body" };
    client.send(env);

    expect(socket.sent).toEqual([JSON.stringify(env)]);
    expect(Object.keys(JSON.parse(socket.sent[0])).sort()).toEqual(["payload", "type"]);
  });

  it("passes msg envelopes through to listeners", () => {
    const socket = fakeSocket();
    const client = new RelayClient("ws://test", () => socket);
    const received: unknown[] = [];
    client.onMessage((envelope) => received.push(envelope));

    const content: Envelope = { type: "msg", payload: "one" };
    const ack: Envelope = { type: "msg", payload: "two" };
    socket.onmessage?.({ data: JSON.stringify(content) });
    socket.onmessage?.({ data: JSON.stringify(ack) });

    expect(received).toEqual([content, ack]);
  });

  it("sends and receives a static msg envelope both ways", () => {
    const socket = fakeSocket();
    const client = new RelayClient("ws://test", () => socket);
    const received: unknown[] = [];
    client.onMessage((envelope) => received.push(envelope));

    const card: Envelope = { type: "msg", payload: "sealed-card" };
    client.send(card);
    socket.onmessage?.({ data: JSON.stringify(card) });

    expect(socket.sent).toEqual([JSON.stringify(card)]);
    expect(received).toEqual([card]);
  });

  it("notifies listeners when a message arrives", () => {
    const socket = fakeSocket();
    const client = new RelayClient("ws://test", () => socket);
    const received: unknown[] = [];
    client.onMessage((envelope) => received.push(envelope));

    socket.onmessage?.({ data: JSON.stringify({ type: "created", roomCode: "ABC123" }) });

    expect(received).toEqual([{ type: "created", roomCode: "ABC123" }]);
  });

  it("stops notifying a listener after it unsubscribes", () => {
    const socket = fakeSocket();
    const client = new RelayClient("ws://test", () => socket);
    const received: unknown[] = [];
    const unsubscribe = client.onMessage((envelope) => received.push(envelope));
    unsubscribe();

    socket.onmessage?.({ data: JSON.stringify({ type: "peer-connected" }) });

    expect(received).toEqual([]);
  });

  it("resolves waitForOpen when the socket opens", async () => {
    const socket = fakeSocket();
    const client = new RelayClient("ws://test", () => socket);

    const opened = client.waitForOpen();
    socket.onopen?.();

    await expect(opened).resolves.toBeUndefined();
  });

  it("silently drops malformed messages without notifying listeners", () => {
    const socket = fakeSocket();
    const client = new RelayClient("ws://test", () => socket);
    const received: unknown[] = [];
    client.onMessage((envelope) => received.push(envelope));

    socket.onmessage?.({ data: "not json" });

    expect(received).toEqual([]);
  });

  it("rejects waitForOpen when the socket errors before opening", async () => {
    const socket = fakeSocket();
    const client = new RelayClient("ws://test", () => socket);

    const opened = client.waitForOpen();
    socket.onerror?.();

    await expect(opened).rejects.toThrow();
  });

  it("rejects waitForOpen when the socket closes before opening", async () => {
    const socket = fakeSocket();
    const client = new RelayClient("ws://test", () => socket);

    const opened = client.waitForOpen();
    socket.onclose?.();

    await expect(opened).rejects.toThrow();
  });

  it("notifies listeners with an error envelope when the socket closes after opening", async () => {
    const socket = fakeSocket();
    const client = new RelayClient("ws://test", () => socket);
    const opened = client.waitForOpen();
    socket.onopen?.();
    await opened;

    const received: unknown[] = [];
    client.onMessage((envelope) => received.push(envelope));
    socket.onclose?.();

    expect(received).toEqual([{ type: "error", message: "Relay connection closed." }]);
  });

  it("notifies listeners with an error envelope when the socket errors after opening", async () => {
    const socket = fakeSocket();
    const client = new RelayClient("ws://test", () => socket);
    const opened = client.waitForOpen();
    socket.onopen?.();
    await opened;

    const received: unknown[] = [];
    client.onMessage((envelope) => received.push(envelope));
    socket.onerror?.();

    expect(received).toEqual([{ type: "error", message: "Relay connection error." }]);
  });

  it("does not emit an error to listeners when closed intentionally", async () => {
    const socket = fakeSocket();
    const client = new RelayClient("ws://test", () => socket);
    const opened = client.waitForOpen();
    socket.onopen?.();
    await opened;

    const received: unknown[] = [];
    client.onMessage((envelope) => received.push(envelope));

    // Intentional local close, followed by the async onclose the browser fires.
    client.close();
    socket.onclose?.();

    expect(received).toEqual([]);
  });
});
