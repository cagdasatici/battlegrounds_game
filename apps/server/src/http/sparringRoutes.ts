import type { IncomingMessage, ServerResponse } from "node:http";
import { PROTOCOL_VERSION, type JoinTicketResponse } from "@eb/shared/protocol";
import { computeContentHash } from "@eb/shared/config/content";
import {
  SPARRING_GUEST_COOKIE, SPARRING_ROOM_NAME, SparringCreateRequestSchema, SparringEndRequestSchema,
  SparringLinkRequestSchema, SparringRedeemRequestSchema, SparringRoomCodeSchema,
  type SparringGuestResponse,
} from "@eb/shared/sparring";
import type { AuthServices } from "../auth/Services.js";
import { SparringError, type SparringPrincipal } from "../auth/SparringDirectory.js";
import type { RateLimiter } from "../auth/RateLimiter.js";
import { safeEqual, sha256 } from "../auth/tokens.js";
import { roomDirectory } from "../rooms/RoomDirectory.js";
import { GUEST_TICKET_PREFIX, closeSparringRoom, grantSparringRoom, revokeSparringGrant } from "../rooms/SparringRoom.js";
import {
  COOKIE_NAME, TOO_LARGE, clientKey, hdr, originAllowed, parseCookies, readBody, send, type HttpApp,
} from "./sessionRoutes.js";

const GUEST_COOKIE_MAX_AGE_S = 3600;

export interface SparringHttpDeps {
  ticketLimiter: RateLimiter;
  sessionLimiter: RateLimiter;
  globalSessionLimiter: RateLimiter;
}

const ERROR_CODE: Record<SparringError["status"], string> = {
  400: "BAD_REQUEST", 401: "UNAUTHENTICATED", 403: "FORBIDDEN", 409: "CONFLICT",
};

function fail(res: ServerResponse, e: unknown): void {
  if (e instanceof SparringError) return send(res, e.status, { error: ERROR_CODE[e.status] });
  throw e;
}

/** Registers the hosted sparring routes and returns the join-ticket hook used by the shared ticket endpoint. */
export function registerSparringRoutes(app: HttpApp, svc: AuthServices, deps: SparringHttpDeps) {
  const { config } = svc;
  const contentHash = computeContentHash();

  /** Origin, ordinary session, CSRF, rate limit and strict body for host mutations. Returns null after replying. */
  async function hostMutation<T>(req: IncomingMessage, res: ServerResponse, parse: (raw: unknown) => T | null):
    Promise<{ host: SparringPrincipal; body: T } | null> {
    if (!originAllowed(req, config.allowedOrigins)) { send(res, 403, { error: "ORIGIN" }); return null; }
    const s = svc.sessions.get(parseCookies(hdr(req, "cookie"))[COOKIE_NAME]);
    if (!s) { send(res, 401, { error: "UNAUTHENTICATED" }); return null; }
    if (!safeEqual(hdr(req, "x-csrf-token") ?? "", s.csrf)) { send(res, 403, { error: "CSRF" }); return null; }
    if (!deps.ticketLimiter.allow(s.id)) { send(res, 429, { error: "RATE_LIMITED" }); return null; }
    const raw = await readBody(req);
    if (raw === TOO_LARGE) { send(res, 413, { error: "TOO_LARGE" }, { Connection: "close" }); return null; }
    const body = parse(raw);
    if (body === null) { send(res, 400, { error: "BAD_REQUEST" }); return null; }
    return { host: { kind: "host", id: s.id }, body };
  }
  const parseWith = <T>(schema: { safeParse(v: unknown): { success: boolean; data?: T } }) =>
    (raw: unknown): T | null => { const r = schema.safeParse(raw); return r.success ? (r.data as T) : null; };

  app.post("/api/sparring", async (req, res) => {
    const m = await hostMutation(req, res, parseWith(SparringCreateRequestSchema));
    if (!m) return;
    let roomCode: string;
    try { roomCode = svc.sparring.create(m.host, m.body).roomCode; } catch (e) { return fail(res, e); }
    // The room is created now so the host's ticket always finds it; any failure releases every provisional resource.
    grantSparringRoom(roomCode, m.body, m.host.id);
    try {
      if (!svc.ensureRoom) throw new Error("NOT_READY");
      await svc.ensureRoom(SPARRING_ROOM_NAME, roomCode);
    } catch {
      revokeSparringGrant(roomCode);
      try { svc.sparring.end(m.host, roomCode); } catch { /* already closed */ }
      return send(res, 503, { error: "NOT_READY" });
    }
    send(res, 201, { roomCode });
  });

  app.post("/api/sparring/link", async (req, res) => {
    const m = await hostMutation(req, res, parseWith(SparringLinkRequestSchema));
    if (!m) return;
    try { send(res, 201, svc.sparring.link(m.host, m.body.roomCode)); } catch (e) { fail(res, e); }
  });

  app.post("/api/sparring/end", async (req, res) => {
    const m = await hostMutation(req, res, parseWith(SparringEndRequestSchema));
    if (!m) return;
    try { svc.sparring.end(m.host, m.body.roomCode); } catch (e) { return fail(res, e); }
    closeSparringRoom(m.body.roomCode);
    send(res, 204);
  });

  app.post("/api/sparring/redeem", async (req, res) => {
    if (!originAllowed(req, config.allowedOrigins)) return send(res, 403, { error: "ORIGIN" });
    if (!deps.sessionLimiter.allow(clientKey(req)) || !deps.globalSessionLimiter.allow("*")) return send(res, 429, { error: "RATE_LIMITED" });
    const raw = await readBody(req);
    if (raw === TOO_LARGE) return send(res, 413, { error: "TOO_LARGE" }, { Connection: "close" });
    const parsed = SparringRedeemRequestSchema.safeParse(raw);
    if (!parsed.success) return send(res, 400, { error: "BAD_REQUEST" });
    try {
      const m = svc.sparring.redeem(parsed.data.token, parsed.data.displayName);
      const cookie = `${SPARRING_GUEST_COOKIE}=${m.cookieToken}; ${config.secureCookies ? "Secure; " : ""}HttpOnly; SameSite=Strict; Path=/; Max-Age=${GUEST_COOKIE_MAX_AGE_S}`;
      const body: SparringGuestResponse = { roomCode: m.roomCode, csrfToken: m.csrfToken };
      send(res, 201, body, { "Set-Cookie": cookie });
    } catch (e) { fail(res, e); }
  });

  // Recover scoped credentials after a page reload. Reads only the guest cookie; no ordinary authority.
  app.get("/api/sparring/guest", (req, res) => {
    if (hdr(req, "origin") !== undefined && !originAllowed(req, config.allowedOrigins)) return send(res, 403, { error: "ORIGIN" });
    const m = svc.sparring.guest(parseCookies(hdr(req, "cookie"))[SPARRING_GUEST_COOKIE]);
    if (!m) return send(res, 401, { error: "UNAUTHENTICATED" });
    const body: SparringGuestResponse = { roomCode: m.roomCode, csrfToken: m.csrfToken };
    send(res, 200, body);
  });

  /**
   * Ticket for a sparring room code. The ordinary session is used only if it owns that match; otherwise the matching
   * guest cookie. CSRF is checked against whichever principal was chosen. Returns after replying.
   */
  function issueTicket(req: IncomingMessage, res: ServerResponse, roomCode: string): void {
    const cookies = parseCookies(hdr(req, "cookie"));
    const csrf = hdr(req, "x-csrf-token") ?? "";
    let principal: SparringPrincipal | null = null;
    let expectCsrf = "";
    try {
      const s = svc.sessions.get(cookies[COOKIE_NAME]);
      if (s) {
        try { svc.sparring.authorizeJoin({ kind: "host", id: s.id }, roomCode); principal = { kind: "host", id: s.id }; expectCsrf = s.csrf; }
        catch (e) { if (!(e instanceof SparringError) || e.status === 409) throw e; }
      }
      if (!principal) {
        const g = svc.sparring.guest(cookies[SPARRING_GUEST_COOKIE]);
        if (!g || g.roomCode !== roomCode) return send(res, 401, { error: "UNAUTHENTICATED" });
        svc.sparring.authorizeJoin(g.principal, roomCode);
        principal = g.principal; expectCsrf = g.csrfToken;
      }
    } catch (e) { return fail(res, e); }
    if (!safeEqual(csrf, expectCsrf)) return send(res, 403, { error: "CSRF" });
    const roomId = roomDirectory.get(roomCode);
    if (!roomId) return send(res, 409, { error: "CONFLICT" });
    const sessionId = principal.kind === "guest" ? `${GUEST_TICKET_PREFIX}${principal.id}` : principal.id;
    const t = svc.tickets.issue({ sessionId, roomName: SPARRING_ROOM_NAME, roomCode, contentHash, protocolVersion: PROTOCOL_VERSION });
    const body: JoinTicketResponse = { ticket: t.ticket, expiresAt: t.expiresAt, roomName: SPARRING_ROOM_NAME, roomId };
    send(res, 200, body);
  }

  return {
    isSparringCode: (code: string): boolean => SparringRoomCodeSchema.safeParse(code).success,
    issueTicket,
    /** Rate-limit key for a join-ticket request carrying a guest cookie. */
    guestKey: (cookie: string): string => `guest:${sha256(cookie)}`,
  };
}
