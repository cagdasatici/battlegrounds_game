import { matchMaker } from "colyseus";

/**
 * Maps private room codes to live room IDs. The server owns room creation (spec section 20): clients are
 * given a roomId with their ticket and never create or discover rooms themselves.
 */
export class RoomDirectory {
  private byCode = new Map<string, string>();
  private pending = new Map<string, Promise<string>>();

  get(code: string): string | undefined { return this.byCode.get(code); }

  /** Called from the room's onCreate. Refuses a second live room for the same code. */
  register(code: string, roomId: string): void {
    const existing = this.byCode.get(code);
    if (existing !== undefined && existing !== roomId) throw new Error("ROOM_CODE_IN_USE");
    this.byCode.set(code, roomId);
  }

  unregister(roomId: string): void {
    for (const [c, id] of this.byCode) if (id === roomId) this.byCode.delete(c);
  }

  async ensure(roomName: string, code: string): Promise<string> {
    const live = this.byCode.get(code);
    if (live) return live;
    let p = this.pending.get(code);
    if (!p) {
      p = matchMaker.createRoom(roomName, { roomCode: code }).then((r) => r.roomId).finally(() => this.pending.delete(code));
      this.pending.set(code, p);
    }
    return p;
  }
}

export const roomDirectory = new RoomDirectory();
