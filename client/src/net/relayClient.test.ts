import { describe, it, expect } from "vitest";
import { RelayClient, type MinimalWebSocket } from "./relayClient";

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

  it("includes messageId when sending a ciphertext envelope", () => {
    const socket = fakeSocket();
    const client = new RelayClient("ws://test", () => socket);

    client.send({ type: "ciphertext", payload: "encrypted", messageId: "abc-123" });

    expect(socket.sent).toEqual([
      JSON.stringify({ type: "ciphertext", payload: "encrypted", messageId: "abc-123" }),
    ]);
  });

  it("passes through delivered and read acks", () => {
    const socket = fakeSocket();
    const client = new RelayClient("ws://test", () => socket);
    const received: unknown[] = [];
    client.onMessage((envelope) => received.push(envelope));

    socket.onmessage?.({ data: JSON.stringify({ type: "delivered", messageId: "abc-123" }) });
    socket.onmessage?.({ data: JSON.stringify({ type: "read", messageId: "abc-123" }) });

    expect(received).toEqual([
      { type: "delivered", messageId: "abc-123" },
      { type: "read", messageId: "abc-123" },
    ]);
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
});
