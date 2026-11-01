import type { IncomingMessage } from "node:http";
import { ARENA_ROOM_NAME } from "@eb/shared/protocol";
import type { RoomListResponse, RoomSummary } from "@eb/shared/rooms";
import type { AuthServices } from "../auth/Services.js";
import type { RateLimiter } from "../auth/RateLimiter.js";
import type { SessionRecord } from "../auth/SessionStore.js";
import { hdr, originAllowed, send, type HttpApp } from "./sessionRoutes.js";

const label = (code: string): string => (code.charAt(0).toUpperCase() + code.slice(1)).slice(0, 32);

/** Pure listing: arena codes from config plus listed sparring matches. Counts only; no ids, names or tokens. */
export function listRooms(svc: AuthServices): RoomSummary[] {
  const rooms: RoomSummary[] = [];
  for (const [roomCode, roomName] of Object.entries(svc.config.roomCodes)) {
    if (roomName !== ARENA_ROOM_NAME) continue;
    const o = svc.occupancy(roomName, roomCode);
    rooms.push({ roomCode, name: label(roomCode), kind: "arena", players: o.players, capacity: o.capacity, bots: 0 });
  }
  let n = 0;
  for (const m of svc.sparring.listed()) {
    n++;
    rooms.push({ roomCode: m.roomCode, name: `Sparring ${n}`, kind: "sparring", players: m.humans, capacity: 4, bots: m.bots });
  }
  return rooms;
}

export function registerRoomListRoutes(
  app: HttpApp, svc: AuthServices, authed: (req: IncomingMessage) => SessionRecord | null | undefined, limiter: RateLimiter,
): void {
  app.get("/api/rooms", (req, res) => {
    if (!originAllowed(req, svc.config.allowedOrigins) && hdr(req, "origin") !== undefined) return send(res, 403, { error: "ORIGIN" });
    const s = authed(req);
    if (!s) return send(res, 401, { error: "UNAUTHENTICATED" });
    if (!limiter.allow(s.id)) return send(res, 429, { error: "RATE_LIMITED" });
    const body: RoomListResponse = { rooms: listRooms(svc) };
    send(res, 200, body);
  });
}
