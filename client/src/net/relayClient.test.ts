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
});
