import { describe, it, expect, vi } from "vitest";
import { RoomManager, isValidRoomCode, type Peer } from "./rooms";

function fakePeer(): Peer & { messages: string[] } {
  const messages: string[] = [];
  return {
    messages,
    send: (data: string) => messages.push(data),
  };
}

describe("RoomManager", () => {
  it("creates a room and returns a 6-character code", () => {
    const rooms = new RoomManager();
    const creator = fakePeer();

    const code = rooms.createRoom(creator);

    expect(code).toHaveLength(6);
    expect(rooms.hasRoom(code)).toBe(true);
  });

  it("pairs a joiner with the creator and notifies both", () => {
    const rooms = new RoomManager();
    const creator = fakePeer();
    const joiner = fakePeer();
    const code = rooms.createRoom(creator);

    const result = rooms.joinRoom(code, joiner);

    expect(result).toEqual({ ok: true });
    expect(creator.messages).toContain(JSON.stringify({ type: "peer-connected" }));
    expect(joiner.messages).toContain(JSON.stringify({ type: "peer-connected" }));
  });

  it("rejects joining a room that does not exist", () => {
    const rooms = new RoomManager();
    const joiner = fakePeer();

    const result = rooms.joinRoom("NOPE12", joiner);

    expect(result).toEqual({ ok: false, message: "Room not found" });
  });

  it("rejects joining a room that already has two peers", () => {
    const rooms = new RoomManager();
    const creator = fakePeer();
    const joiner = fakePeer();
    const thirdWheel = fakePeer();
    const code = rooms.createRoom(creator);
    rooms.joinRoom(code, joiner);

    const result = rooms.joinRoom(code, thirdWheel);

    expect(result).toEqual({ ok: false, message: "Room is full" });
  });

  it("forwards a message from one peer to the other, not back to the sender", () => {
    const rooms = new RoomManager();
    const creator = fakePeer();
    const joiner = fakePeer();
    const code = rooms.createRoom(creator);
    rooms.joinRoom(code, joiner);

    rooms.forward(creator, "hello");

    expect(joiner.messages).toContain("hello");
    expect(creator.messages).not.toContain("hello");
  });

  it("notifies the remaining peer and keeps the room on a two-peer disconnect", () => {
    const rooms = new RoomManager();
    const creator = fakePeer();
    const joiner = fakePeer();
    const code = rooms.createRoom(creator);
    rooms.joinRoom(code, joiner);

    rooms.disconnect(creator);

    expect(joiner.messages).toContain(JSON.stringify({ type: "peer-disconnected" }));
    expect(rooms.hasRoom(code)).toBe(true);
  });

  it("deletes the room when the last peer disconnects", () => {
    const rooms = new RoomManager();
    const creator = fakePeer();
    const code = rooms.createRoom(creator);

    rooms.disconnect(creator);

    expect(rooms.hasRoom(code)).toBe(false);
  });

  it("expires an unjoined room after the TTL", () => {
    vi.useFakeTimers();
    const rooms = new RoomManager(1000);
    const creator = fakePeer();
    const code = rooms.createRoom(creator);

    vi.advanceTimersByTime(1001);

    expect(rooms.hasRoom(code)).toBe(false);
    vi.useRealTimers();
  });

  it("reports when the active-room cap is reached", () => {
    const rooms = new RoomManager(undefined, 2);

    expect(rooms.atRoomCapacity()).toBe(false);
    rooms.createRoom(fakePeer());
    expect(rooms.atRoomCapacity()).toBe(false);
    rooms.createRoom(fakePeer());
    expect(rooms.atRoomCapacity()).toBe(true);
  });

  it("drops a peer's previous room when they create a second one", () => {
    const rooms = new RoomManager();
    const creator = fakePeer();

    const first = rooms.createRoom(creator);
    const second = rooms.createRoom(creator);

    expect(first).not.toBe(second);
    expect(rooms.hasRoom(first)).toBe(false); // no orphaned room / leaked timer
    expect(rooms.hasRoom(second)).toBe(true);
  });

  it("notifies the partner when a peer abandons a paired room to create a new one", () => {
    const rooms = new RoomManager();
    const creator = fakePeer();
    const joiner = fakePeer();
    const code = rooms.createRoom(creator);
    rooms.joinRoom(code, joiner);

    rooms.createRoom(creator);

    expect(joiner.messages).toContain(JSON.stringify({ type: "peer-disconnected" }));
  });

  it("moves a peer out of their old room when they join another", () => {
    const rooms = new RoomManager();
    const a = fakePeer();
    const b = fakePeer();
    const roomA = rooms.createRoom(a);
    const roomB = rooms.createRoom(b);

    const result = rooms.joinRoom(roomB, a);

    expect(result).toEqual({ ok: true });
    expect(rooms.hasRoom(roomA)).toBe(false); // a's empty old room is torn down
    rooms.forward(a, "hi");
    expect(b.messages).toContain("hi"); // a and b are paired in roomB
  });

  it("rejects a peer joining their own room", () => {
    const rooms = new RoomManager();
    const creator = fakePeer();
    const code = rooms.createRoom(creator);

    const result = rooms.joinRoom(code, creator);

    expect(result).toEqual({ ok: false, message: "Cannot join your own room" });
    expect(rooms.hasRoom(code)).toBe(true); // room left intact
  });
});

describe("isValidRoomCode", () => {
  it("accepts a well-formed code", () => {
    expect(isValidRoomCode("ABCDEF")).toBe(true);
    expect(isValidRoomCode("23456789".slice(0, 6))).toBe(true);
  });

  it("rejects wrong length, wrong alphabet, and non-strings", () => {
    expect(isValidRoomCode("ABCDE")).toBe(false); // too short
    expect(isValidRoomCode("ABCDEFG")).toBe(false); // too long
    expect(isValidRoomCode("ABCDE1")).toBe(false); // 1 is not in the alphabet
    expect(isValidRoomCode("abcdef")).toBe(false); // lowercase
    expect(isValidRoomCode(123456)).toBe(false);
    expect(isValidRoomCode(null)).toBe(false);
    expect(isValidRoomCode(undefined)).toBe(false);
  });
});
