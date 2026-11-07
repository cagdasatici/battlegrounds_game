import type { Client } from "colyseus";
import { JoinOptionsSchema } from "@eb/shared/protocol";
import { TEAM_PLAY, teamBotCount } from "@eb/shared/config/teamPlay";
import { BotArenaRoom } from "./BotArenaRoom.js";
import { sparringAuthId, sparringPrincipal } from "../http/sparringRoutes.js";
import { originOk } from "../http/securityHeaders.js";

/** Private hosted FFA. Humans retain ordinary transport seats; bots never have synthetic clients. */
export class SparringRoom extends BotArenaRoom {
  private teamPlay = false;
  private teamStartTick = 0;
  private isBot(id: number): boolean { return [...this.bots.values()].some((b) => b.entityId === id); }
  protected override isFriendly(a: number, t: number): boolean { return this.teamPlay && this.isBot(a) === this.isBot(t); }
  protected override botsNeverWander(): boolean { return this.teamPlay; }
  protected override botTargetAllowed(id: number): boolean { return !this.teamPlay || !this.isBot(id); }
  protected override beforeDrain(tick: number): void {
    if (this.teamPlay) {
      const want = teamBotCount(tick - this.teamStartTick);
      if (this.bots.size < want) this.addBots(Array(want - this.bots.size).fill(TEAM_PLAY.startDifficulty), this.bots.size);
    }
    super.beforeDrain(tick);
  }

  override async onCreate(options: { roomCode?: string }): Promise<void> {
    const info = this.authServices()?.sparring.describe(options.roomCode ?? "");
    if (!info) throw new Error("MATCH_CLOSED");
    this.teamPlay = info.teamPlay;
    this.maxClients = info.teamPlay ? TEAM_PLAY.maxHumans : 4 - info.bots.length;
    await super.onCreate(options);
    // Membership, rather than socket count, owns lifetime (including a completely disconnected host).
    this.autoDispose = false;
    this.roundTarget = info.roundTarget;
    this.teamStartTick = this.sim.tick;
    this.addBots(info.bots);
    this.maxClients = info.teamPlay ? TEAM_PLAY.maxHumans : 4 - info.bots.length;
  }

  override async onAuth(client: Client, options: unknown, context?: { headers?: Headers }): Promise<{ authId: string; displayName: string }> {
    const svc = this.authServices();
    const parsed = JoinOptionsSchema.safeParse(options);
    if (!svc || !parsed.success || originOk(context?.headers?.get("origin"), svc.config.allowedOrigins) === "foreign"
      || this.sim.isOverloaded(this.wallNow())) throw new Error("AUTH_FAILED");
    const o = parsed.data;
    const ticket = svc.tickets.consume(o.ticket, { roomName: this.roomName, roomCode: this.roomCode,
      contentHash: this.state.contentHash, protocolVersion: this.state.protocolVersion });
    if (!ticket || o.roomCode !== this.roomCode || o.contentHash !== this.state.contentHash || o.protocolVersion !== this.state.protocolVersion) throw new Error("AUTH_FAILED");
    const principal = sparringPrincipal(ticket.sessionId);
    if (!principal) throw new Error("AUTH_FAILED");
    const membership = svc.sparring.authorizeJoin(principal, this.roomCode);
    const adult = principal.kind === "host" ? svc.sessions.getById(principal.id) : null;
    // Synchronous claim before returning to Colyseus: concurrent tickets cannot duplicate a seat.
    svc.sparring.connected(principal, this.roomCode, client.sessionId);
    return { authId: sparringAuthId(principal), displayName: adult?.displayName ?? membership.displayName };
  }

  override async onDrop(client: Client): Promise<void> {
    const principal = sparringPrincipal(this.seats.get(client.sessionId)?.sessionAuthId ?? "");
    if (principal) this.authServices()!.sparring.dropped(principal, this.roomCode, client.sessionId);
    await super.onDrop(client);
  }
  override onReconnect(client: Client): void {
    const principal = sparringPrincipal(this.seats.get(client.sessionId)?.sessionAuthId ?? "");
    if (!principal) { void client.leave(); return; }
    try { this.authServices()!.sparring.connected(principal, this.roomCode, client.sessionId); }
    catch { void client.leave(); return; }
    super.onReconnect(client);
  }
  override onLeave(client: Client): void {
    const svc = this.authServices()!;
    const principal = sparringPrincipal(this.seats.get(client.sessionId)?.sessionAuthId ?? "");
    if (principal) svc.sparring.left(principal, this.roomCode, client.sessionId);
    super.onLeave(client);
    if (!svc.sparring.describe(this.roomCode)) void svc.closeRoom(this.roomCode);
  }
}
