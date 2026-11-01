import type { IncomingMessage, ServerResponse } from "node:http";
import {
  ARENA_ROOM_NAME, JoinTicketRequestSchema, PRACTICE_ROOM_NAME, PROTOCOL_VERSION, SessionRequestSchema,
  type JoinTicketResponse, type SessionResponse, type VersionResponse,
} from "@eb/shared/protocol";
import { computeContentHash } from "@eb/shared/config/content";
import type { AuthServices } from "../auth/Services.js";
import { RateLimiter } from "../auth/RateLimiter.js";
import { safeEqual } from "../auth/tokens.js";
import { log } from "../ops/StructuredLog.js";
import { registerAdminRoutes } from "./adminRoutes.js";
import { registerRoomListRoutes } from "./roomListRoutes.js";
import { sparringTicket } from "./sparringRoutes.js";
import { securityHeaders } from "./securityHeaders.js";

type Handler = (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;
export interface HttpApp {
  get(path: string, h: Handler): unknown;
  post(path: string, h: Handler): unknown;
  delete(path: string, h: Handler): unknown;
  put(path: string, h: Handler): unknown;
  patch(path: string, h: Handler): unknown;
}

export const COOKIE_NAME = "eb_session";
const MAX_BODY = 1024;

let baseHeaders: Record<string, string> = { "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" };

export function send(res: ServerResponse, status: number, body?: unknown, headers: Record<string, string> = {}): void {
  res.statusCode = status;
  res.setHeader("Cache-Control", "no-store");
  for (const [k, v] of Object.entries(baseHeaders)) res.setHeader(k, v);
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  if (body === undefined) { res.end(); return; }
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

export const TOO_LARGE = Symbol("TOO_LARGE");

export function readBody(req: IncomingMessage): Promise<unknown | undefined | typeof TOO_LARGE> {
  return new Promise((resolve) => {
    let size = 0;
    const chunks: Buffer[] = [];
    let done = false;
    const finish = (v: unknown | undefined | typeof TOO_LARGE) => { if (!done) { done = true; resolve(v); } };
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) { finish(TOO_LARGE); chunks.length = 0; return; } // discard the rest
      chunks.push(c);
    });
    req.on("end", () => {
      if (size > MAX_BODY) return finish(TOO_LARGE);
      try { finish(JSON.parse(Buffer.concat(chunks).toString("utf8"))); } catch { finish(undefined); }
    });
    req.on("error", () => finish(undefined));
  });
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

export const hdr = (req: IncomingMessage, name: string): string | undefined => {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v;
};

export function originAllowed(req: IncomingMessage, allowed: string[]): boolean {
  const o = hdr(req, "origin");
  return o !== undefined && allowed.includes(o);
}

export function clientKey(req: IncomingMessage): string {
  return req.socket.remoteAddress ?? "unknown";
}

export function registerSessionRoutes(app: HttpApp, svc: AuthServices, now: () => number = Date.now): void {
  const { config } = svc;
  const contentHash = computeContentHash();
  baseHeaders = securityHeaders(config.allowedOrigins[0] ?? "http://localhost");
  // Spec 24: 5 invitation attempts per minute per source plus 30 per minute across all sources.
  const sessionLimiter = new RateLimiter(config.sessionsPerMinute ?? 5, 60_000, now);
  const globalSessionLimiter = new RateLimiter(config.globalSessionsPerMinute ?? 30, 60_000, now);
  const ticketLimiter = new RateLimiter(20, 60_000, now);

  app.get("/healthz", (_req, res) => send(res, 200, { ok: true }));

  app.get("/api/version", (_req, res) => {
    const body: VersionResponse = { protocolVersion: PROTOCOL_VERSION, contentHash, buildId: config.buildId };
    send(res, 200, body);
  });

  app.post("/api/session", async (req, res) => {
    if (!originAllowed(req, config.allowedOrigins)) return send(res, 403, { error: "ORIGIN" });
    if (!sessionLimiter.allow(clientKey(req)) || !globalSessionLimiter.allow("*")) return send(res, 429, { error: "RATE_LIMITED" });
    const raw = await readBody(req);
    if (raw === TOO_LARGE) return send(res, 413, { error: "TOO_LARGE" }, { Connection: "close" });
    const parsed = SessionRequestSchema.safeParse(raw);
    if (!parsed.success) return send(res, 401, { error: "INVITE_INVALID" });
    if (!svc.invites.consume(parsed.data.invite)) {
      log("warn", "invite rejected", { ip: clientKey(req) });
      return send(res, 401, { error: "INVITE_INVALID" });
    }
    const { cookieToken, session, expiresAt } = svc.sessions.create(parsed.data.displayName);
    const cookie = `${COOKIE_NAME}=${cookieToken}; ${config.secureCookies ? "Secure; " : ""}HttpOnly; SameSite=Strict; Path=/; Max-Age=${8 * 3600}`;
    log("info", "session created", { session: session.id.slice(0, 8) });
    const body: SessionResponse = { expiresAt };
    send(res, 201, body, { "Set-Cookie": cookie });
  });

  const authed = (req: IncomingMessage) =>
    svc.sessions.get(parseCookies(hdr(req, "cookie"))[COOKIE_NAME]);

  app.get("/api/csrf", (req, res) => {
    if (!originAllowed(req, config.allowedOrigins) && hdr(req, "origin") !== undefined) return send(res, 403, { error: "ORIGIN" });
    const s = authed(req);
    if (!s) return send(res, 401, { error: "UNAUTHENTICATED" });
    send(res, 200, { csrfToken: s.csrf });
  });

  registerRoomListRoutes(app, svc, authed, ticketLimiter);
  registerAdminRoutes(app, svc, contentHash);

  app.post("/api/join-ticket", async (req, res) => {
    if (!originAllowed(req, config.allowedOrigins)) return send(res, 403, { error: "ORIGIN" });
    const raw = await readBody(req);
    if (raw === TOO_LARGE) return send(res, 413, { error: "TOO_LARGE" }, { Connection: "close" });
    const parsed = JoinTicketRequestSchema.safeParse(raw);
    if (!parsed.success) return send(res, 403, { error: "BAD_REQUEST" });
    if (parsed.data.roomCode.startsWith("sp-")) {
      await sparringTicket(req, res, svc, parsed.data.roomCode, ticketLimiter);
      return;
    }
    const s = authed(req);
    if (!s) return send(res, 401, { error: "UNAUTHENTICATED" });
    if (!safeEqual(hdr(req, "x-csrf-token") ?? "", s.csrf)) return send(res, 403, { error: "CSRF" });
    if (!ticketLimiter.allow(s.id)) return send(res, 429, { error: "RATE_LIMITED" });
    const roomName = Object.hasOwn(config.roomCodes, parsed.data.roomCode) ? config.roomCodes[parsed.data.roomCode] : undefined;
    if (!roomName) return send(res, 409, { error: "UNKNOWN_ROOM" });
    if (!svc.ensureRoom) return send(res, 503, { error: "NOT_READY" });
    if (roomName === ARENA_ROOM_NAME) {
      const o = svc.occupancy(roomName, parsed.data.roomCode);
      if (o.players >= o.capacity) return send(res, 409, { error: "ROOM_FULL" });
    }
    // Practice is private to one session: the server derives the room code, so two children never share a dummy room.
    const roomCode = roomName === PRACTICE_ROOM_NAME ? `${parsed.data.roomCode}-${s.id.slice(0, 16)}` : parsed.data.roomCode;
    let roomId: string;
    try { roomId = await svc.ensureRoom(roomName, roomCode); } catch { return send(res, 503, { error: "NOT_READY" }); }
    const t = svc.tickets.issue({ sessionId: s.id, roomName, roomCode, contentHash, protocolVersion: PROTOCOL_VERSION });
    const body: JoinTicketResponse = { ticket: t.ticket, expiresAt: t.expiresAt, roomName, roomId };
    if (roomCode !== parsed.data.roomCode) body.roomCode = roomCode;
    send(res, 200, body);
  });

  app.delete("/api/session", (req, res) => {
    if (!originAllowed(req, config.allowedOrigins)) return send(res, 403, { error: "ORIGIN" });
    const token = parseCookies(hdr(req, "cookie"))[COOKIE_NAME];
    const s = svc.sessions.get(token, false);
    if (!s || !token) return send(res, 401, { error: "UNAUTHENTICATED" });
    if (!safeEqual(hdr(req, "x-csrf-token") ?? "", s.csrf)) return send(res, 403, { error: "CSRF" });
    svc.sessions.revoke(token);
    send(res, 204, undefined, { "Set-Cookie": `${COOKIE_NAME}=; Max-Age=0; Path=/; HttpOnly; SameSite=Strict` });
  });
}
