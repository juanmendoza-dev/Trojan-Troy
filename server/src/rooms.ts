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
const DEFAULT_MAX_ROOMS = 5000;

export class RoomManager {
  private rooms = new Map<string, Room>();
  private peerRooms = new Map<Peer, string>();

  constructor(
    private ttlMs: number = DEFAULT_TTL_MS,
    private maxRooms: number = DEFAULT_MAX_ROOMS,
  ) {}

  // Whether the global active-room cap is reached. The relay consults this
  // before accepting a `create` so a flood of unpaired rooms (each holding a
  // TTL timer) can't exhaust memory. (Review H3.)
  atRoomCapacity(): boolean {
    return this.rooms.size >= this.maxRooms;
  }

  private generateCode(): string {
    let code = "";
    for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
      code += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
    }
    return code;
  }

  createRoom(creator: Peer): string {
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
