import { Room, type Client } from "colyseus";
import {
  ChangeKitMessageSchema, ClientMessage, JoinOptionsSchema, MAX_CLIENTS, P0_KITS, PATCH_RATE_MS,
  PROTOCOL_VERSION, PingMessageSchema, RECONNECT_SECONDS, ReadyMessageSchema, ServerMessage, TICK_RATE,
  type KitId, type WelcomeMessage,
} from "@eb/shared/protocol";
import { COMBAT } from "@eb/shared/config/combat";
import { computeContentHash } from "@eb/shared/config/content";
import { ArenaState } from "../state/ArenaSchema.js";
import { PlayerSchema } from "../state/PlayerSchema.js";
import { FixedClock } from "../sim/FixedClock.js";
import { InputChannel } from "../net/ValidateInput.js";
import { TokenBucket } from "../net/RateLimits.js";
import type { AuthServices } from "../auth/Services.js";
import { log } from "../ops/StructuredLog.js";
import { roomDirectory } from "./RoomDirectory.js";

/** Set once by createGameServer. Kept off Colyseus options so clients can never override it. */
let authServices: AuthServices | null = null;
/** Test hook: lets tests shorten the 20 s reservation. Production keeps the spec value. */
export const roomTuning = { reconnectSeconds: RECONNECT_SECONDS as number };

export function setArenaAuth(a: AuthServices | null): void { authServices = a; }

interface Seat {
  sessionAuthId: string; // internal; never replicated or logged
  entityId: number;
  input: InputChannel;
  pendingKit: KitId | null; // owner-only; applied at next respawn (T17)
  readyBucket: TokenBucket;
  pingBucket: TokenBucket;
}

export class ArenaRoom extends Room {
  override maxClients = MAX_CLIENTS;
  override state = new ArenaState();
  override maxMessagesPerSecond = 90;

  roomCode = "";
  readonly sim = new FixedClock();
  private readonly contentHash = computeContentHash();
  private seats = new Map<string, Seat>(); // by Colyseus sessionId
  private seatByAuth = new Map<string, string>(); // auth session id -> colyseus sessionId
  private nextEntityId = 1;
  private lifeSeq = 0;
  private lastTickMs = 0;

  override onCreate(options: { roomCode?: string }): void {
    this.roomCode = typeof options?.roomCode === "string" ? options.roomCode : "";
    if (this.roomCode === "") throw new Error("ROOM_CODE_REQUIRED");
    roomDirectory.register(this.roomCode, this.roomId);
    this.patchRate = PATCH_RATE_MS;
    this.state.protocolVersion = PROTOCOL_VERSION;
    this.state.contentHash = this.contentHash;
    this.lastTickMs = performance.now();
    this.setSimulationInterval(() => this.onSchedulerTick(), 1000 / TICK_RATE);

    this.onMessage(ClientMessage.input, (client, raw) => this.onInput(client, raw));
    this.onMessage(ClientMessage.ready, (client, raw) => this.onReady(client, raw));
    this.onMessage(ClientMessage.changeKit, (client, raw) => this.onChangeKit(client, raw));
    this.onMessage(ClientMessage.ping, (client, raw) => this.onPing(client, raw));
    this.onMessage(ClientMessage.leave, (client) => { void client.leave(); });
    // No arbitrary client events: everything else is dropped.
    this.onMessage("*", () => undefined);
  }

  override async onAuth(_client: Client, options: unknown): Promise<{ authId: string; displayName: string }> {
    const auth = authServices;
    const parsed = JoinOptionsSchema.safeParse(options);
    if (!auth || !parsed.success) throw new Error("AUTH_FAILED");
    const o = parsed.data;
    // Consume first: a failed comparison also burns the ticket.
    const hit = auth.tickets.consume(o.ticket, {
      roomName: this.roomName, roomCode: o.roomCode, contentHash: o.contentHash, protocolVersion: o.protocolVersion,
    });
    if (!hit || o.contentHash !== this.contentHash) throw new Error("AUTH_FAILED");
    if (this.roomCode !== "" && o.roomCode !== this.roomCode) throw new Error("AUTH_FAILED");
    const session = auth.sessions.getById(hit.sessionId);
    if (!session) throw new Error("AUTH_FAILED");
    if (this.seatByAuth.has(session.id)) throw new Error("SEAT_TAKEN");
    return { authId: session.id, displayName: session.displayName };
  }

  override onJoin(client: Client, _options: unknown, auth: { authId: string; displayName: string }): void {
    const entityId = this.nextEntityId++;
    const p = new PlayerSchema();
    p.entityId = entityId;
    p.lifeId = 0;
    p.displayName = auth.displayName;
    p.hp100 = COMBAT.hp100Max;
    p.connected = true;
    this.state.players.set(String(entityId), p);
    const now = performance.now();
    this.seats.set(client.sessionId, {
      sessionAuthId: auth.authId, entityId, input: new InputChannel(now), pendingKit: null,
      readyBucket: new TokenBucket(2, 2, now), pingBucket: new TokenBucket(1, 2, now),
    });
    this.seatByAuth.set(auth.authId, client.sessionId);
    this.sendWelcome(client);
    log("info", "player joined", { room: this.roomId, entity: entityId });
  }

  /** Unexpected disconnect: keep the avatar, neutralize input, reserve the seat for 20 s of wall time. */
  override async onDrop(client: Client): Promise<void> {
    const seat = this.seats.get(client.sessionId);
    const p = seat && this.playerOf(seat);
    if (!seat || !p) return;
    p.connected = false;
    seat.input.neutralize();
    try {
      await this.allowReconnection(client, roomTuning.reconnectSeconds);
    } catch {
      // Reservation expired or was cancelled: Colyseus now calls onLeave.
    }
  }

  override onReconnect(client: Client): void {
    const seat = this.seats.get(client.sessionId);
    const p = seat && this.playerOf(seat);
    if (!seat || !p) return;
    p.connected = true;
    seat.input.renewEpoch(performance.now()); // old epoch packets are now stale
    this.sendWelcome(client);
    log("info", "player reconnected", { room: this.roomId, entity: seat.entityId });
  }

  override onLeave(client: Client): void {
    const seat = this.seats.get(client.sessionId);
    if (!seat) return;
    // Captures held by or on this player are released here once combat exists (T09).
    this.state.players.delete(String(seat.entityId));
    this.seatByAuth.delete(seat.sessionAuthId);
    this.seats.delete(client.sessionId);
    log("info", "player left", { room: this.roomId, entity: seat.entityId });
  }

  override onDispose(): void {
    roomDirectory.unregister(this.roomId);
    this.seats.clear();
    this.seatByAuth.clear();
  }

  // ---- internals ----
  private playerOf(seat: Seat): PlayerSchema | undefined {
    return this.state.players.get(String(seat.entityId));
  }

  private sendWelcome(client: Client): void {
    const seat = this.seats.get(client.sessionId);
    if (!seat) return;
    const msg: WelcomeMessage = {
      epoch: seat.input.epoch, serverTick: this.sim.tick, tickRate: TICK_RATE, contentHash: this.contentHash,
    };
    client.send(ServerMessage.welcome, msg);
  }

  private onSchedulerTick(): void {
    const now = performance.now();
    const elapsed = now - this.lastTickMs;
    this.lastTickMs = now;
    this.sim.advance(elapsed, (tick) => {
      for (const seat of this.seats.values()) seat.input.expireLease(tick, COMBAT.inputLeaseTicks);
      this.state.serverTick = tick;
    }, now);
  }

  private onInput(client: Client, raw: unknown): void {
    const seat = this.seats.get(client.sessionId);
    if (!seat) return;
    const reason = seat.input.accept(raw, this.sim.tick, performance.now());
    if (reason === "RATE_LIMIT") log("warn", "input rate limited", { room: this.roomId, entity: seat.entityId });
  }

  private onReady(client: Client, raw: unknown): void {
    const seat = this.seats.get(client.sessionId);
    const p = seat && this.playerOf(seat);
    if (!seat || !p || !seat.readyBucket.take(performance.now())) return;
    const m = ReadyMessageSchema.safeParse(raw);
    if (!m.success || m.data.contentHash !== this.contentHash || !P0_KITS.includes(m.data.kitId)) return;
    if (p.ready) return;
    p.kitId = m.data.kitId;
    p.ready = true;
    p.lifeId = ++this.lifeSeq; // room-unique so events can identify a victim life
    p.hp100 = COMBAT.hp100Max;
    this.state.phase = "playing";
  }

  private onChangeKit(client: Client, raw: unknown): void {
    const seat = this.seats.get(client.sessionId);
    const p = seat && this.playerOf(seat);
    if (!seat || !p || !seat.readyBucket.take(performance.now())) return;
    const m = ChangeKitMessageSchema.safeParse(raw);
    if (!m.success || !P0_KITS.includes(m.data.kitId)) return;
    if (!p.ready) p.kitId = m.data.kitId;
    else seat.pendingKit = m.data.kitId; // applied at next respawn (T17)
  }

  private onPing(client: Client, raw: unknown): void {
    const seat = this.seats.get(client.sessionId);
    if (!seat || !seat.pingBucket.take(performance.now())) return;
    const m = PingMessageSchema.safeParse(raw);
    if (!m.success) return;
    client.send(ServerMessage.pong, { nonce: m.data.nonce, serverMs: Date.now(), serverTick: this.sim.tick });
  }
}
