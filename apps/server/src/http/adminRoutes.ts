import { randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  ADMIN_COOKIE, AdminAnnouncementPutSchema, AdminInviteCreateSchema, AdminLoginRequestSchema, AdminRoomCreateSchema, AdminRoomPatchSchema,
  type AdminRoomRow, type AdminStatus,
} from "@eb/shared/admin";
import { ARENA_ROOM_NAME, PROTOCOL_VERSION } from "@eb/shared/protocol";
import { ADMIN_ABSOLUTE_MS, type AdminSession } from "../admin/AdminAuth.js";
import type { AuthServices } from "../auth/Services.js";
import { RateLimiter } from "../auth/RateLimiter.js";
import { safeEqual } from "../auth/tokens.js";
import { log, recentLogLines } from "../ops/StructuredLog.js";
import { TOO_LARGE, clientKey, hdr, originAllowed, parseCookies, readBody, send, type HttpApp } from "./sessionRoutes.js";

const PREFIX = "/api/admin";
const label = (code: string): string => (code.charAt(0).toUpperCase() + code.slice(1)).slice(0, 32);
const lastSegment = (req: IncomingMessage): string => {
  const path = new URL(req.url ?? "/", "http://x").pathname;
  try { return decodeURIComponent(path.slice(path.lastIndexOf("/") + 1)); } catch { return ""; }
};

export function registerAdminRoutes(app: HttpApp, svc: AuthServices, contentHash: string): void {
  const { config } = svc;
  // 5 per minute per source and 20 per hour across all sources (WEB4 design).
  const perIp = new RateLimiter(5, 60_000, svc.now);
  const global = new RateLimiter(20, 3600_000, svc.now);
  const api = new RateLimiter(120, 60_000, svc.now);

  const arenaRows = (): AdminRoomRow[] => Object.entries(config.roomCodes)
    .filter(([, name]) => name === ARENA_ROOM_NAME)
    .map(([roomCode, name]) => {
      const meta = svc.roomMeta.get(roomCode);
      return { roomCode, name: meta?.name ?? label(roomCode), kind: "arena" as const, players: svc.occupancy(name, roomCode).players, bots: 0, listed: meta?.listed ?? true };
    });
  const sparRows = (): AdminRoomRow[] => svc.sparring.all().map((m, i) => ({
    roomCode: m.roomCode, name: `Sparring ${i + 1}`, kind: "sparring" as const, players: m.humans, bots: m.bots, listed: m.listed,
  }));

  /** Order: feature switch (404), origin (403), admin cookie (401), CSRF (403), rate (429). Returns null after answering. */
  const guard = (req: IncomingMessage, res: ServerResponse, mutating: boolean): AdminSession | null => {
    if (!svc.admin) { send(res, 404, { error: "NOT_FOUND" }); return null; }
    const hasOrigin = hdr(req, "origin") !== undefined;
    // Same-origin GETs carry no Origin header in browsers; every other method must present an allowed one.
    if ((mutating || hasOrigin) && !originAllowed(req, config.allowedOrigins)) { send(res, 403, { error: "ORIGIN" }); return null; }
    const s = svc.admin.get(parseCookies(hdr(req, "cookie"))[ADMIN_COOKIE]);
    if (!s) { send(res, 401, { error: "UNAUTHENTICATED" }); return null; }
    if (!safeEqual(hdr(req, "x-csrf-token") ?? "", s.csrf)) { send(res, 403, { error: "CSRF" }); return null; }
    if (!api.allow(s.id)) { send(res, 429, { error: "RATE_LIMITED" }); return null; }
    return s;
  };
  const body = async (req: IncomingMessage, res: ServerResponse): Promise<unknown | typeof TOO_LARGE> => {
    const raw = await readBody(req);
    if (raw === TOO_LARGE) send(res, 413, { error: "TOO_LARGE" }, { Connection: "close" });
    return raw;
  };
  const bad = (res: ServerResponse): void => send(res, 400, { error: "BAD_REQUEST" });
  const notFound = (res: ServerResponse): void => send(res, 404, { error: "NOT_FOUND" });
  const cookieAttrs = `${config.secureCookies ? "Secure; " : ""}HttpOnly; SameSite=Strict; Path=${PREFIX}`;

  app.post(`${PREFIX}/login`, async (req, res) => {
    if (!svc.admin) return send(res, 404, { error: "NOT_FOUND" });
    if (!originAllowed(req, config.allowedOrigins)) return send(res, 403, { error: "ORIGIN" });
    const ip = clientKey(req);
    if (!perIp.allow(ip) || !global.allow("*") || svc.admin.locked(ip)) return send(res, 429, { error: "RATE_LIMITED" });
    const raw = await body(req, res);
    if (raw === TOO_LARGE) return;
    const parsed = AdminLoginRequestSchema.safeParse(raw);
    if (!parsed.success) return bad(res);
    const ok = await svc.admin.login(ip, parsed.data.password);
    if (!ok) { log("warn", "admin login failed"); return send(res, 401, { error: "LOGIN_FAILED" }); }
    log("info", "admin login ok");
    send(res, 200, { csrfToken: ok.csrf, expiresAt: ok.expiresAt },
      { "Set-Cookie": `${ADMIN_COOKIE}=${ok.cookieToken}; ${cookieAttrs}; Max-Age=${ADMIN_ABSOLUTE_MS / 1000}` });
  });

  app.post(`${PREFIX}/logout`, (req, res) => {
    if (!guard(req, res, true)) return;
    svc.admin?.logout(parseCookies(hdr(req, "cookie"))[ADMIN_COOKIE]);
    send(res, 204, undefined, { "Set-Cookie": `${ADMIN_COOKIE}=; ${cookieAttrs}; Max-Age=0` });
  });

  app.get(`${PREFIX}/status`, (req, res) => {
    if (!guard(req, res, false)) return;
    const rows = [...arenaRows(), ...sparRows()];
    const out: AdminStatus = {
      buildId: config.buildId, protocolVersion: PROTOCOL_VERSION, contentHash,
      uptimeSeconds: Math.floor((svc.now() - svc.startedAt) / 1000),
      rooms: rows.map((r) => ({ roomCode: r.roomCode, kind: r.kind, players: r.players, bots: r.bots })),
      playerCount: rows.reduce((n, r) => n + r.players, 0),
      logs: recentLogLines(),
    };
    send(res, 200, out);
  });

  app.get(`${PREFIX}/invites`, (req, res) => {
    if (!guard(req, res, false)) return;
    send(res, 200, { invites: svc.invites.list() });
  });
  app.post(`${PREFIX}/invites`, async (req, res) => {
    if (!guard(req, res, true)) return;
    const raw = await body(req, res);
    if (raw === TOO_LARGE) return;
    const p = AdminInviteCreateSchema.safeParse(raw);
    if (!p.success) return bad(res);
    const inv = svc.invites.create({ ttlMs: p.data.ttlHours * 3600_000, maxUses: p.data.maxUses });
    log("info", "admin invite created", { id: inv.id });
    // The only response that ever carries a token, shown once as a link.
    send(res, 201, { id: inv.id, expiresAt: inv.expiresAt, link: `${(config.allowedOrigins[0] ?? "").replace(/\/$/, "")}/#invite=${inv.token}` });
  });
  app.delete(`${PREFIX}/invites/:id`, (req, res) => {
    if (!guard(req, res, true)) return;
    if (!svc.invites.revoke(lastSegment(req))) return notFound(res);
    send(res, 204);
  });

  app.get(`${PREFIX}/sessions`, (req, res) => {
    if (!guard(req, res, false)) return;
    send(res, 200, { sessions: svc.sessions.list() });
  });
  app.delete(`${PREFIX}/sessions/:idPrefix`, (req, res) => {
    if (!guard(req, res, true)) return;
    if (!svc.sessions.revokeById(lastSegment(req))) return notFound(res);
    log("info", "admin session revoked");
    send(res, 204);
  });

  app.get(`${PREFIX}/rooms`, (req, res) => {
    if (!guard(req, res, false)) return;
    send(res, 200, { rooms: [...arenaRows(), ...sparRows()] });
  });
  app.post(`${PREFIX}/rooms`, async (req, res) => {
    if (!guard(req, res, true)) return;
    const raw = await body(req, res);
    if (raw === TOO_LARGE) return;
    const p = AdminRoomCreateSchema.safeParse(raw);
    if (!p.success) return bad(res);
    const roomCode = `a-${randomBytes(4).toString("hex")}`;
    config.roomCodes[roomCode] = ARENA_ROOM_NAME;
    svc.roomMeta.set(roomCode, { name: p.data.name, listed: true });
    send(res, 201, { roomCode, name: p.data.name, kind: "arena", players: 0, bots: 0, listed: true } satisfies AdminRoomRow);
  });
  app.delete(`${PREFIX}/rooms/:code`, async (req, res) => {
    if (!guard(req, res, true)) return;
    const code = lastSegment(req);
    if (svc.sparring.adminClose(code)) {
      await svc.closeRoom(code);
      return send(res, 204);
    }
    if (!Object.hasOwn(config.roomCodes, code) || config.roomCodes[code] !== ARENA_ROOM_NAME) return notFound(res);
    // Admin-created rooms disappear; rooms from startup config are only emptied (the code stays joinable).
    if (svc.roomMeta.has(code) && code.startsWith("a-")) { delete config.roomCodes[code]; svc.roomMeta.delete(code); }
    await svc.closeRoom(code);
    send(res, 204);
  });
  app.patch(`${PREFIX}/rooms/:code`, async (req, res) => {
    if (!guard(req, res, true)) return;
    const raw = await body(req, res);
    if (raw === TOO_LARGE) return;
    const p = AdminRoomPatchSchema.safeParse(raw);
    if (!p.success) return bad(res);
    const code = lastSegment(req);
    if (svc.sparring.setListed(code, p.data.listed)) return send(res, 200, { roomCode: code, listed: p.data.listed });
    if (!Object.hasOwn(config.roomCodes, code) || config.roomCodes[code] !== ARENA_ROOM_NAME) return notFound(res);
    svc.roomMeta.set(code, { name: svc.roomMeta.get(code)?.name ?? label(code), listed: p.data.listed });
    send(res, 200, { roomCode: code, listed: p.data.listed });
  });

  app.get(`${PREFIX}/announcement`, (req, res) => {
    if (!guard(req, res, false)) return;
    send(res, 200, { announcement: svc.announcement.get() });
  });
  app.put(`${PREFIX}/announcement`, async (req, res) => {
    if (!guard(req, res, true)) return;
    const raw = await body(req, res);
    if (raw === TOO_LARGE) return;
    const p = AdminAnnouncementPutSchema.safeParse(raw);
    if (!p.success) return bad(res);
    const text = p.data.text.trim();
    const expiresAt = p.data.expiresAt ?? null;
    if (expiresAt !== null && expiresAt <= svc.now()) return bad(res);
    svc.announcement.set(text === "" ? null : { text, expiresAt });
    send(res, 200, { announcement: svc.announcement.get() });
  });
  // Public: the client banner. No credentials, no admin state.
  app.get("/api/announcement", (_req, res) => send(res, 200, { announcement: svc.announcement.get() }));
}
