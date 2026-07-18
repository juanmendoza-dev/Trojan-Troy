import { describe, it, expect, afterEach } from "vitest";
import WebSocket from "ws";
import type { AddressInfo } from "node:net";
import { startRelay } from "./server";

let server: ReturnType<typeof startRelay> | undefined;

afterEach(() => {
  server?.close();
  server = undefined;
});

function waitForListening(s: ReturnType<typeof startRelay>): Promise<void> {
  return new Promise((resolve) => s.once("listening", resolve));
}

function waitForOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve) => ws.once("open", () => resolve()));
}

function waitForMessage(ws: WebSocket): Promise<any> {
  return new Promise((resolve) => {
    ws.once("message", (data) => resolve(JSON.parse(data.toString())));
  });
}

describe("relay server", () => {
  it("pairs a creator and a joiner and forwards messages between them", async () => {
    server = startRelay(0);
    await waitForListening(server);
    const port = (server.address() as AddressInfo).port;
    const url = `ws://localhost:${port}`;

    const alice = new WebSocket(url);
    await waitForOpen(alice);
    alice.send(JSON.stringify({ type: "create" }));
    const created = await waitForMessage(alice);
    expect(created.type).toBe("created");
    const roomCode = created.roomCode;
    expect(typeof roomCode).toBe("string");

    const bob = new WebSocket(url);
    await waitForOpen(bob);

    const aliceConnected = waitForMessage(alice);
    bob.send(JSON.stringify({ type: "join", roomCode }));
    const bobConnected = await waitForMessage(bob);
    expect(bobConnected.type).toBe("peer-connected");
    expect((await aliceConnected).type).toBe("peer-connected");

    const bobReceives = waitForMessage(bob);
    alice.send(JSON.stringify({ type: "pubkey", payload: "abc123" }));
    const forwarded = await bobReceives;
    expect(forwarded).toEqual({ type: "pubkey", payload: "abc123" });

    alice.close();
    bob.close();
  });

  it("sends an error and does not crash when joining a nonexistent room", async () => {
    server = startRelay(0);
    await waitForListening(server);
    const port = (server.address() as AddressInfo).port;
    const url = `ws://localhost:${port}`;

    const client = new WebSocket(url);
    await waitForOpen(client);
    client.send(JSON.stringify({ type: "join", roomCode: "NOPE12" }));
    const response = await waitForMessage(client);

    expect(response).toEqual({ type: "error", message: "Room not found" });
    client.close();
  });
});
