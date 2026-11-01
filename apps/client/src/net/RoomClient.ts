import {
  SparringConfigSchema, SparringCreateResponseSchema, SparringGuestResponseSchema,
  SparringLinkResponseSchema, SparringRedeemRequestSchema, SparringRoomCodeSchema,
  type SparringConfig,
} from "@eb/shared/sparring";
import { RoomListResponseSchema, type RoomSummary } from "@eb/shared/rooms";
import { Client, type Room } from "@colyseus/sdk";
import {
  ClientMessage, PROTOCOL_VERSION, ServerMessage, checkCompatibility,
  type ClientErrorCode, type JoinTicketResponse, type VersionResponse, type WelcomeMessage,
} from "@eb/shared/protocol";
import { computeContentHash } from "@eb/shared/config/content";

export class ClientError extends Error {
  constructor(readonly code: ClientErrorCode, readonly retryable: boolean) {
    super(code);
  }
}

export interface StorageLike {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

export interface RoomClientDeps {
  /** http(s) base, same origin as the page. Empty string means relative URLs. */
  httpBase: string;
  /** ws(s) endpoint for Colyseus. */
  wsEndpoint: string;
  fetchFn?: typeof fetch;
  /** sessionStorage only; the reconnection token must never reach localStorage. */
  storage?: StorageLike;
  sleep?: (ms: number) => Promise<void>;
}

const TOKEN_KEY = "eb.reconnect";
const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Bounded exponential backoff: 0.5 s, 1 s, 2 s ... capped at 8 s, at most `attempts` tries. */
export async function withRetry<T>(
  fn: () => Promise<T>, attempts: number, sleep: (ms: number) => Promise<void> = defaultSleep,
): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (e instanceof ClientError && !e.retryable) throw e;
      if (i < attempts - 1) await sleep(Math.min(8000, 500 * 2 ** i));
    }
  }
  throw last;
}

export class RoomClient {
  readonly localContentHash = computeContentHash();
  room: Room | null = null;
  welcome: WelcomeMessage | null = null;
  private readonly f: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private csrf: string | null = null;
  private guest: { roomCode: string; csrfToken: string } | null = null;

  private routeError(r: Response): never {
    if (r.status === 409) throw new ClientError("ROOM_FULL", true);
    if (r.status === 429 || r.status >= 500) throw new ClientError("SERVER_OFFLINE", true);
    throw new ClientError("INVITE_INVALID", false);
  }

  /** Rooms other players can join. Needs the ordinary session cookie; a missing one reads as INVITE_INVALID. */
  async listRooms(): Promise<RoomSummary[]> {
    const r = await this.http("/api/rooms");
    if (r.status !== 200) this.routeError(r);
    return RoomListResponseSchema.parse(await r.json()).rooms;
  }

  /** Reserves a guest seat in a listed sparring match for this signed-in session. */
  async joinListedSparring(roomCode: string): Promise<string> {
    const csrf = await this.ensureCsrf();
    const r = await this.http("/api/sparring/join", {
      method: "POST", headers: { "content-type": "application/json", "x-csrf-token": csrf },
      body: JSON.stringify({ roomCode: SparringRoomCodeSchema.parse(roomCode) }),
    });
    if (r.status !== 201) this.routeError(r);
    this.guest = SparringGuestResponseSchema.parse(await r.json());
    return this.guest.roomCode;
  }

  async createSparring(config: SparringConfig, listed = false): Promise<string> {
    const csrf = await this.ensureCsrf();
    const r = await this.http("/api/sparring", {
      method: "POST", headers: { "content-type": "application/json", "x-csrf-token": csrf },
      body: JSON.stringify(listed ? { ...SparringConfigSchema.parse(config), listed: true } : SparringConfigSchema.parse(config)),
    });
    if (r.status !== 201) this.routeError(r);
    return SparringCreateResponseSchema.parse(await r.json()).roomCode;
  }

  async redeemSparring(token: string, displayName: string): Promise<string> {
    const request = SparringRedeemRequestSchema.safeParse({ token, displayName });
    if (!request.success) throw new ClientError("INVITE_INVALID", false);
    const r = await this.http("/api/sparring/redeem", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify(request.data),
    });
    if (r.status !== 201) this.routeError(r);
    this.guest = SparringGuestResponseSchema.parse(await r.json());
    return this.guest.roomCode;
  }

  async recoverSparringGuest(): Promise<string | null> {
    const r = await this.http("/api/sparring/guest");
    if (r.status === 401 || r.status === 404) { this.guest = null; return null; }
    if (!r.ok) this.routeError(r);
    this.guest = SparringGuestResponseSchema.parse(await r.json());
    return this.guest.roomCode;
  }

  async copySparringLink(roomCode: string, origin: string): Promise<string> {
    const csrf = await this.ensureCsrf();
    const r = await this.http("/api/sparring/link", {
      method: "POST", headers: { "content-type": "application/json", "x-csrf-token": csrf },
      body: JSON.stringify({ roomCode: SparringRoomCodeSchema.parse(roomCode) }),
    });
    if (r.status !== 201) this.routeError(r);
    const link = SparringLinkResponseSchema.parse(await r.json());
    return new URL("/#spar=" + link.token, origin).href;
  }

  async endSparring(roomCode: string): Promise<void> {
    const csrf = await this.ensureCsrf();
    const r = await this.http("/api/sparring/end", {
      method: "POST", headers: { "content-type": "application/json", "x-csrf-token": csrf },
      body: JSON.stringify({ roomCode: SparringRoomCodeSchema.parse(roomCode) }),
    });
    if (r.status !== 204) this.routeError(r);
  }

  constructor(private readonly deps: RoomClientDeps) {
    this.f = deps.fetchFn ?? ((...a) => fetch(...a));
    this.sleep = deps.sleep ?? defaultSleep;
  }

  private async http(path: string, init: RequestInit = {}): Promise<Response> {
    try {
      return await this.f(this.deps.httpBase + path, { credentials: "include", cache: "no-store", ...init });
    } catch {
      throw new ClientError("SERVER_OFFLINE", true);
    }
  }

  async checkVersion(): Promise<void> {
    const r = await this.http("/api/version");
    if (!r.ok) throw new ClientError("SERVER_OFFLINE", true);
    const v = (await r.json()) as VersionResponse;
    if (checkCompatibility(v, { protocolVersion: PROTOCOL_VERSION, contentHash: this.localContentHash }) !== "ok") {
      throw new ClientError("VERSION_MISMATCH", false);
    }
  }

  /** Exchanges an adult supplied invitation for a session. A display name never authenticates. */
  async login(invite: string, displayName: string): Promise<void> {
    const r = await this.http("/api/session", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ invite, displayName }),
    });
    if (r.status === 201) return;
    if (r.status === 429 || r.status >= 500) throw new ClientError("SERVER_OFFLINE", true);
    throw new ClientError("INVITE_INVALID", false);
  }

  private async ensureCsrf(): Promise<string> {
    if (this.csrf) return this.csrf;
    const r = await this.http("/api/csrf");
    if (!r.ok) throw new ClientError("INVITE_INVALID", false);
    this.csrf = ((await r.json()) as { csrfToken: string }).csrfToken;
    return this.csrf;
  }

  async requestTicket(roomCode: string): Promise<JoinTicketResponse> {
    const csrf = this.guest?.roomCode === roomCode ? this.guest.csrfToken : await this.ensureCsrf();
    const r = await this.http("/api/join-ticket", {
      method: "POST", headers: { "content-type": "application/json", "x-csrf-token": csrf }, body: JSON.stringify({ roomCode }),
    });
    if (r.status === 200) return (await r.json()) as JoinTicketResponse;
    if (r.status === 409) throw new ClientError("ROOM_FULL", true);
    if (r.status === 429 || r.status >= 500) throw new ClientError("SERVER_OFFLINE", true);
    throw new ClientError("INVITE_INVALID", false);
  }

  /** Fetches a fresh ticket and joins. Never silently enters a different room. */
  async join(roomCode: string): Promise<Room> {
    await this.checkVersion();
    const t = await this.requestTicket(roomCode);
    const client = new Client(this.deps.wsEndpoint);
    let room: Room;
    try {
      room = await client.joinById(t.roomId, {
        roomCode: t.roomCode ?? roomCode, ticket: t.ticket, protocolVersion: PROTOCOL_VERSION, contentHash: this.localContentHash,
      });
    } catch (e) {
      throw this.mapJoinError(e);
    }
    this.attach(room);
    return room;
  }

  private mapJoinError(e: unknown): ClientError {
    const m = e instanceof Error ? e.message : String(e);
    if (/full|locked/i.test(m)) return new ClientError("ROOM_FULL", true);
    if (/AUTH_FAILED|SEAT_TAKEN/.test(m)) return new ClientError("INVITE_INVALID", false);
    return new ClientError("SERVER_OFFLINE", true);
  }

  private attach(room: Room): void {
    this.room = room;
    // Old epoch input must never be replayed after a resync: no offline message buffering.
    room.reconnection.maxEnqueuedMessages = 0;
    room.onMessage(ServerMessage.welcome, (w: WelcomeMessage) => { this.welcome = w; });
    try { this.deps.storage?.setItem(TOKEN_KEY, room.reconnectionToken); } catch { /* storage may be unavailable */ }
    room.onLeave(() => { try { this.deps.storage?.removeItem(TOKEN_KEY); } catch { /* ignore */ } });
  }

  send(type: keyof typeof ClientMessage, payload?: unknown): void {
    this.room?.send(ClientMessage[type], payload);
  }

  async leave(): Promise<void> {
    await this.room?.leave(true);
    this.room = null;
    this.welcome = null;
  }

  async logout(): Promise<void> {
    const csrf = await this.ensureCsrf();
    await this.http("/api/session", { method: "DELETE", headers: { "x-csrf-token": csrf } });
    this.csrf = null;
  }

  /** Reload recovery: reconnect with the sessionStorage token, otherwise null (return to lobby). */
  async tryResume(): Promise<Room | null> {
    let token: string | null = null;
    try { token = this.deps.storage?.getItem(TOKEN_KEY) ?? null; } catch { /* ignore */ }
    if (!token) return null;
    try {
      const room = await new Client(this.deps.wsEndpoint).reconnect(token);
      this.attach(room);
      return room;
    } catch {
      try { this.deps.storage?.removeItem(TOKEN_KEY); } catch { /* ignore */ }
      return null;
    }
  }

  joinWithRetry(roomCode: string, attempts = 4): Promise<Room> {
    return withRetry(() => this.join(roomCode), attempts, this.sleep);
  }
}
