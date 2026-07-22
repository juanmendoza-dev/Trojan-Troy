import { randomInt } from "node:crypto";

export interface Peer {
  send(data: string): void;
}

interface Room {
  code: string;
  peers: Peer[];
  timeout: ReturnType<typeof setTimeout>;
}

const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ROOM_CODE_LENGTH = 6;
const DEFAULT_TTL_MS = 10 * 60 * 1000;

export class RoomManager {
  private rooms = new Map<string, Room>();
  private peerRooms = new Map<Peer, string>();

  constructor(private ttlMs: number = DEFAULT_TTL_MS) {}

  private generateCode(): string {
    let code = "";
    for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
      code += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
    }
    return code;
  }

  createRoom(creator: Peer): string {
    // Idempotent per peer: a connection that spams `create` gets its existing
    // room back instead of minting unbounded rooms (each of which would pin a
    // peer reference and a TTL timer in memory until expiry).
    const existing = this.peerRooms.get(creator);
    if (existing !== undefined && this.rooms.has(existing)) {
      return existing;
    }
    let code = this.generateCode();
    while (this.rooms.has(code)) {
      code = this.generateCode();
    }
    const timeout = setTimeout(() => {
      this.rooms.delete(code);
    }, this.ttlMs);
    this.rooms.set(code, { code, peers: [creator], timeout });
    this.peerRooms.set(creator, code);
    return code;
  }

  joinRoom(code: string, joiner: Peer): { ok: true } | { ok: false; message: string } {
    const room = this.rooms.get(code);
    if (!room) {
      return { ok: false, message: "Room not found" };
    }
    if (room.peers.includes(joiner)) {
      return { ok: false, message: "Already in this room" };
    }
    if (room.peers.length >= 2) {
      return { ok: false, message: "Room is full" };
    }
    clearTimeout(room.timeout);
    room.peers.push(joiner);
    this.peerRooms.set(joiner, code);
    for (const peer of room.peers) {
      peer.send(JSON.stringify({ type: "peer-connected" }));
    }
    return { ok: true };
  }

  forward(sender: Peer, message: string): void {
    const code = this.peerRooms.get(sender);
    if (!code) return;
    const room = this.rooms.get(code);
    if (!room) return;
    for (const peer of room.peers) {
      if (peer !== sender) {
        peer.send(message);
      }
    }
  }

  disconnect(peer: Peer): void {
    const code = this.peerRooms.get(peer);
    if (!code) return;
    this.peerRooms.delete(peer);
    const room = this.rooms.get(code);
    if (!room) return;
    room.peers = room.peers.filter((p) => p !== peer);
    if (room.peers.length === 0) {
      clearTimeout(room.timeout);
      this.rooms.delete(code);
    } else {
      for (const p of room.peers) {
        p.send(JSON.stringify({ type: "peer-disconnected" }));
      }
    }
  }

  hasRoom(code: string): boolean {
    return this.rooms.has(code);
  }
}
