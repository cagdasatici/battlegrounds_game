import type { IncomingMessage, ServerResponse } from "node:http";
import { computeContentHash } from "@eb/shared/config/content";
import { PROTOCOL_VERSION } from "@eb/shared/protocol";
import { SPARRING_GUEST_COOKIE, SPARRING_ROOM_NAME, SparringCreateRequestSchema, SparringEndRequestSchema, SparringLinkRequestSchema, SparringRedeemRequestSchema } from "@eb/shared/sparring";
import { SparringJoinRequestSchema } from "@eb/shared/rooms";
import type { AuthServices } from "../auth/Services.js";
import { SparringError, type SparringPrincipal } from "../auth/SparringDirectory.js";
import { RateLimiter } from "../auth/RateLimiter.js";
import { safeEqual } from "../auth/tokens.js";
import { COOKIE_NAME, TOO_LARGE, clientKey, hdr, originAllowed, parseCookies, readBody, send, type HttpApp } from "./sessionRoutes.js";

export const sparringAuthId = (p: SparringPrincipal): string => `spar:${p.kind}:${p.id}`;
export function sparringPrincipal(id: string): SparringPrincipal | null {
  const m = /^spar:(host|guest):([a-f0-9]{64})$/.exec(id);
  return m ? { kind: m[1] as "host" | "guest", id: m[2]! } : null;
}
function failure(res: ServerResponse, e: unknown): void {
  send(res, e instanceof SparringError ? e.status : 503, { error: e instanceof SparringError ? e.message : "NOT_READY" });
}
function host(req: IncomingMessage, svc: AuthServices): SparringPrincipal {
  const s = svc.sessions.get(parseCookies(hdr(req, "cookie"))[COOKIE_NAME]);
  if (!s) throw new SparringError(401, "UNAUTHENTICATED");
  if (!safeEqual(hdr(req, "x-csrf-token") ?? "", s.csrf)) throw new SparringError(403, "CSRF");
  return { kind: "host", id: s.id };
}
export async function sparringTicket(req: IncomingMessage, res: ServerResponse, svc: AuthServices, code: string, limiter: RateLimiter): Promise<void> {
  try {
    const cookies = parseCookies(hdr(req, "cookie"));
    const adult = svc.sessions.get(cookies[COOKIE_NAME]);
    const info = svc.sparring.describe(code);
    const guest = svc.sparring.guest(cookies[SPARRING_GUEST_COOKIE]);
    const principal: SparringPrincipal | null = adult && info?.hostId === adult.id ? { kind: "host", id: adult.id }
      : guest?.roomCode === code ? guest.principal : null;
    if (!principal) throw new SparringError(401, "UNAUTHENTICATED");
    const csrf = principal.kind === "host" ? adult!.csrf : guest!.csrfToken;
    if (!safeEqual(hdr(req, "x-csrf-token") ?? "", csrf)) throw new SparringError(403, "CSRF");
    const authId = sparringAuthId(principal);
    if (!limiter.allow(authId)) return send(res, 429, { error: "RATE_LIMITED" });
    svc.sparring.authorizeJoin(principal, code);
    if (!svc.ensureRoom) return send(res, 503, { error: "NOT_READY" });
    const roomId = await svc.ensureRoom(SPARRING_ROOM_NAME, code);
    // Recheck after asynchronous room creation, before issuing credentials.
    svc.sparring.authorizeJoin(principal, code);
    const t = svc.tickets.issue({ sessionId: authId, roomName: SPARRING_ROOM_NAME, roomCode: code, contentHash: computeContentHash(), protocolVersion: PROTOCOL_VERSION });
    send(res, 200, { ...t, roomName: SPARRING_ROOM_NAME, roomId });
  } catch (e) { failure(res, e); }
}
export function registerSparringRoutes(app: HttpApp, svc: AuthServices): void {
  const mutations = new RateLimiter(20, 60_000, svc.now);
  const redemption = new RateLimiter(svc.config.sessionsPerMinute ?? 5, 60_000, svc.now);
  const global = new RateLimiter(svc.config.globalSessionsPerMinute ?? 30, 60_000, svc.now);
  for (const operation of ["create", "link", "end", "redeem", "join"] as const) {
    app.post(operation === "create" ? "/api/sparring" : `/api/sparring/${operation}`, async (req, res) => {
      if (!originAllowed(req, svc.config.allowedOrigins)) return send(res, 403, { error: "ORIGIN" });
      try {
        const owner = operation === "redeem" ? null : host(req, svc);
        if (owner ? !mutations.allow(owner.id) : !redemption.allow(clientKey(req)) || !global.allow("*")) return send(res, 429, { error: "RATE_LIMITED" });
        const raw = await readBody(req);
        if (raw === TOO_LARGE) return send(res, 413, { error: "TOO_LARGE" }, { Connection: "close" });
        if (operation === "create") {
          const p = SparringCreateRequestSchema.safeParse(raw);
          if (!p.success) throw new SparringError(400, "BAD_REQUEST");
          send(res, 201, svc.sparring.create(owner!, { bots: p.data.bots, roundTarget: p.data.roundTarget ?? 0, teamPlay: p.data.teamPlay === true }, p.data.listed === true));
        } else if (operation === "link") {
          const p = SparringLinkRequestSchema.safeParse(raw);
          if (!p.success) throw new SparringError(400, "BAD_REQUEST");
          send(res, 201, svc.sparring.link(owner!, p.data.roomCode));
        } else if (operation === "end") {
          const p = SparringEndRequestSchema.safeParse(raw);
          if (!p.success) throw new SparringError(400, "BAD_REQUEST");
          svc.sparring.end(owner!, p.data.roomCode);
          await svc.closeRoom(p.data.roomCode);
          send(res, 204);
        } else if (operation === "join") {
          const p = SparringJoinRequestSchema.safeParse(raw);
          if (!p.success) throw new SparringError(400, "BAD_REQUEST");
          const session = svc.sessions.getById(owner!.id);
          if (!session) throw new SparringError(401, "UNAUTHENTICATED");
          const g = svc.sparring.joinListed(session.id, p.data.roomCode, session.displayName);
          const cookie = `${SPARRING_GUEST_COOKIE}=${g.cookieToken}; ${svc.config.secureCookies ? "Secure; " : ""}HttpOnly; SameSite=Strict; Path=/; Max-Age=86400`;
          send(res, 201, { roomCode: g.roomCode, csrfToken: g.csrfToken }, { "Set-Cookie": cookie });
        } else {
          const p = SparringRedeemRequestSchema.safeParse(raw);
          if (!p.success) throw new SparringError(400, "BAD_REQUEST");
          const g = svc.sparring.redeem(p.data.token, p.data.displayName);
          const cookie = `${SPARRING_GUEST_COOKIE}=${g.cookieToken}; ${svc.config.secureCookies ? "Secure; " : ""}HttpOnly; SameSite=Strict; Path=/; Max-Age=86400`;
          send(res, 201, { roomCode: g.roomCode, csrfToken: g.csrfToken }, { "Set-Cookie": cookie });
        }
      } catch (e) { failure(res, e); }
    });
  }
  app.get("/api/sparring/guest", (req, res) => {
    if (hdr(req, "origin") && !originAllowed(req, svc.config.allowedOrigins)) return send(res, 403, { error: "ORIGIN" });
    const g = svc.sparring.guest(parseCookies(hdr(req, "cookie"))[SPARRING_GUEST_COOKIE]);
    if (!g) return send(res, 401, { error: "UNAUTHENTICATED" });
    send(res, 200, { roomCode: g.roomCode, csrfToken: g.csrfToken });
  });
}
