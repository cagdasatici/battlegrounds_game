import { randomBytes } from "node:crypto";
import { SparringConfigSchema, SparringRedeemRequestSchema, type Difficulty, type SparringConfig } from "@eb/shared/sparring";
import { newToken, sha256 } from "./tokens.js";

export const SPARRING_LINK_MS = 600_000;
export const SPARRING_RESERVATION_MS = 60_000;
export const SPARRING_RECONNECT_MS = 20_000;
export type SparringPrincipal = { kind: "host" | "guest"; id: string };
export class SparringError extends Error {
  constructor(public readonly status: 400 | 401 | 403 | 409, message: string) { super(message); }
}
interface Seat {
  principal: SparringPrincipal;
  displayName: string;
  csrfToken: string;
  connectionId: string | null;
  deadline: number | null;
}
interface Match {
  roomCode: string;
  hostId: string;
  bots: Difficulty[];
  seats: Map<string, Seat>;
  link: { hash: string; expiresAt: number } | null;
}
export interface SparringMembership {
  roomCode: string;
  principal: SparringPrincipal;
  displayName: string;
  csrfToken: string;
}
const key = (p: SparringPrincipal): string => `${p.kind}:${p.id}`;

/** In-memory authority only. HTTP validates origin/CSRF and binds authenticated
 * principals; BOT4 must call sweep independently of connected clients and close
 * every returned room. isHostLive must query ordinary sessions without touching
 * their idle expiry. Guest IDs are hashes of cookies, never ordinary sessions. */
export class SparringDirectory {
  private readonly matches = new Map<string, Match>();
  constructor(
    private readonly isHostLive: (sessionId: string) => boolean,
    private readonly now: () => number = Date.now,
  ) {}

  create(host: SparringPrincipal, config: SparringConfig): { roomCode: string } {
    this.requireHost(host);
    const parsed = SparringConfigSchema.safeParse(config);
    if (!parsed.success) throw new SparringError(400, "Invalid sparring config");
    if ([...this.matches.values()].some((m) => m.hostId === host.id)) throw new SparringError(409, "Already hosting");
    const roomCode = `sp-${randomBytes(16).toString("hex")}`;
    this.matches.set(roomCode, {
      roomCode, hostId: host.id, bots: [...parsed.data.bots], link: null,
      seats: new Map([[key(host), { principal: { ...host }, displayName: "", csrfToken: "", connectionId: null, deadline: this.now() + SPARRING_RESERVATION_MS }]]),
    });
    return { roomCode };
  }

  link(host: SparringPrincipal, roomCode: string): { token: string; expiresAt: number } {
    const match = this.owned(host, roomCode);
    // Sharing is available after the host has joined, and only for free seats.
    if (!match.seats.get(key(host))?.connectionId) throw new SparringError(409, "Host has not joined");
    if (match.bots.length + match.seats.size >= 4) throw new SparringError(409, "Match full");
    const token = newToken(32);
    const expiresAt = this.now() + SPARRING_LINK_MS;
    match.link = { hash: sha256(token), expiresAt };
    return { token, expiresAt };
  }

  redeem(token: string, displayName: string): SparringMembership & { cookieToken: string } {
    const parsed = SparringRedeemRequestSchema.safeParse({ token, displayName });
    if (!parsed.success) throw new SparringError(400, "Invalid redemption");
    const hash = sha256(token);
    const match = [...this.matches.values()].find((m) => m.link?.hash === hash);
    if (!match || !this.live(match) || !match.link || match.link.expiresAt <= this.now()) throw new SparringError(401, "Invalid link");
    this.pruneGuests(match);
    if (match.bots.length + match.seats.size >= 4) throw new SparringError(409, "Match full");
    const cookieToken = newToken(32);
    const principal: SparringPrincipal = { kind: "guest", id: sha256(cookieToken) };
    const seat: Seat = { principal, displayName: parsed.data.displayName, csrfToken: newToken(24), connectionId: null, deadline: this.now() + SPARRING_RESERVATION_MS };
    // Synchronous consume + reserve, with no await or external resource creation.
    match.link = null;
    match.seats.set(key(principal), seat);
    return { ...this.membership(match, seat), cookieToken };
  }

  /** Recover scoped credentials for reload. No authority outside this directory. */
  guest(cookieToken: string | undefined): SparringMembership | null {
    if (!cookieToken) return null;
    const id = sha256(cookieToken);
    for (const match of this.matches.values()) {
      if (!this.live(match)) continue;
      this.pruneGuests(match);
      const seat = match.seats.get(key({ kind: "guest", id }));
      if (seat) return this.membership(match, seat);
    }
    return null;
  }

  /** Ticket requests reuse the existing seat and never extend its deadline.
   * connected must atomically claim it after ticket consumption, before await. */
  authorizeJoin(principal: SparringPrincipal, roomCode: string): SparringMembership {
    const [match, seat] = this.seat(principal, roomCode);
    if (seat.connectionId !== null) throw new SparringError(409, "Already connected");
    return this.membership(match, seat);
  }

  connected(principal: SparringPrincipal, roomCode: string, connectionId: string): void {
    if (!connectionId) throw new SparringError(400, "Invalid connection");
    const [, seat] = this.seat(principal, roomCode);
    if (seat.connectionId !== null) throw new SparringError(409, "Already connected");
    seat.connectionId = connectionId;
    seat.deadline = null;
  }

  dropped(principal: SparringPrincipal, roomCode: string, connectionId: string): void {
    const seat = this.matches.get(roomCode)?.seats.get(key(principal));
    if (!seat || seat.connectionId !== connectionId) return;
    seat.connectionId = null;
    seat.deadline = this.now() + SPARRING_RECONNECT_MS;
  }

  /** Stale callbacks from old connections cannot remove a replacement seat. */
  left(principal: SparringPrincipal, roomCode: string, connectionId: string): void {
    const match = this.matches.get(roomCode);
    const seat = match?.seats.get(key(principal));
    if (!match || !seat || seat.connectionId !== connectionId) return;
    if (principal.kind === "host") this.matches.delete(roomCode);
    else match.seats.delete(key(principal));
  }

  end(host: SparringPrincipal, roomCode: string): void {
    this.owned(host, roomCode);
    this.matches.delete(roomCode);
  }

  /** Returns closed room codes for BOT4 to disconnect guests/dispose rooms.
   * No timers or subscriptions are installed by this directory. */
  sweep(): string[] {
    const closed: string[] = [];
    for (const [code, match] of this.matches) {
      if (!this.live(match)) {
        this.matches.delete(code);
        closed.push(code);
        continue;
      }
      this.pruneGuests(match);
      if (match.link && match.link.expiresAt <= this.now()) match.link = null;
    }
    return closed;
  }

  /** True while the match exists and its host session and grace period are valid. */
  isOpen(roomCode: string): boolean {
    const match = this.matches.get(roomCode);
    return !!match && this.live(match);
  }

  /** Immutable roster snapshot for authoritative room creation. */
  config(host: SparringPrincipal, roomCode: string): SparringConfig {
    return { bots: [...this.owned(host, roomCode).bots] };
  }

  private live(match: Match): boolean {
    const host = match.seats.get(key({ kind: "host", id: match.hostId }));
    return this.isHostLive(match.hostId) && !!host && (host.deadline === null || host.deadline > this.now());
  }
  private requireHost(host: SparringPrincipal): void {
    if (host.kind !== "host") throw new SparringError(403, "Host authority required");
    if (!this.isHostLive(host.id)) throw new SparringError(401, "Invalid host session");
  }
  private owned(host: SparringPrincipal, code: string): Match {
    this.requireHost(host);
    const match = this.match(code);
    if (match.hostId !== host.id) throw new SparringError(403, "Not match owner");
    return match;
  }
  private match(code: string): Match {
    const match = this.matches.get(code);
    if (!match || !this.live(match)) throw new SparringError(409, "Match closed");
    this.pruneGuests(match);
    return match;
  }
  private seat(principal: SparringPrincipal, code: string): [Match, Seat] {
    const match = this.match(code);
    const seat = match.seats.get(key(principal));
    if (!seat) throw new SparringError(403, "Not a member");
    return [match, seat];
  }
  private pruneGuests(match: Match): void {
    for (const [id, seat] of match.seats) {
      if (seat.principal.kind === "guest" && seat.deadline !== null && seat.deadline <= this.now()) match.seats.delete(id);
    }
  }
  private membership(match: Match, seat: Seat): SparringMembership {
    return { roomCode: match.roomCode, principal: { ...seat.principal }, displayName: seat.displayName, csrfToken: seat.csrfToken };
  }
}
