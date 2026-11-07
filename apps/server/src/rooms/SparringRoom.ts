import type { Client } from "colyseus";
import { JoinOptionsSchema } from "@eb/shared/protocol";
import { TEAM_PLAY, teamBotCount, nextTier, TEAM_TIERS, TIER_WINDOW_TICKS } from "@eb/shared/config/teamPlay";
import { COMBAT } from "@eb/shared/config/combat";
import { BotArenaRoom } from "./BotArenaRoom.js";
import { sparringAuthId, sparringPrincipal } from "../http/sparringRoutes.js";
import { originOk } from "../http/securityHeaders.js";
import { BEAST, BEAST_ENTITY_ID, CRATER, craterRadius } from "@eb/shared/config/beast";
import { CraterSystem } from "../sim/Craters.js";
import { BeastSystem, type BeastHuman } from "../sim/BeastSystem.js";
import { botRandom } from "../sim/SparringBrain.js";
import { isAlive } from "../sim/ActionMachine.js";
import type { HitCandidate, HitResult } from "../sim/HitResolver.js";
import type { PipelineSeat } from "../sim/TickPipeline.js";

/** Private hosted FFA. Humans retain ordinary transport seats; bots never have synthetic clients. */
export class SparringRoom extends BotArenaRoom {
  private teamPlay = false;
  /** Humans cannot damage each other in hosted sparring. Test seam only. */
  humansProtected = true;
  private teamStartTick = 0;
  private tierIdx = 0; private tierWindowStart = 0; private lastHumanDeaths = 0; private lastBotDeaths = 0;
  private isBot(id: number): boolean { return [...this.bots.values()].some((b) => b.entityId === id); }
  /** BEAST01: the sparring beast. Created in onCreate; spawns on its own schedule. */
  beast!: BeastSystem;
  /** BEAST02: craters left by transformed humans; sparring only. */
  craters!: CraterSystem;
  private readonly wasBeast = new Set<number>();
  protected override onBeastSpecial(tick: number, id: number, moveId: string): void {
    const r = craterRadius(moveId), pos = this.movement?.position(id), body = this.movement?.get(id);
    if (!r || !pos || !body) return;
    this.craters.add(pos[0] - Math.sin(body.state.facingYaw) * CRATER.forward, pos[2] - Math.cos(body.state.facingYaw) * CRATER.forward, r, tick);
  }
  private beastRound = 1;
  /** Test seam: false keeps the beast away entirely. */
  beastEnabled = true;
  private humanList(): BeastHuman[] {
    const out: BeastHuman[] = [];
    const mv = this.movement;
    for (const p of this.state.players.values()) {
      if (this.isBot(p.entityId) || !p.connected) continue;
      const f = this.combat.get(p.entityId), pos = mv?.position(p.entityId);
      if (!f || !pos || !isAlive(f) || f.beast) continue; // a transformed human is a beast too: the wild one leaves it alone
      out.push({ id: p.entityId, x: pos[0], y: pos[1], z: pos[2], grounded: mv!.get(p.entityId)?.state.grounded ?? false });
    }
    return out;
  }
  protected override pipelineSeats(): ReadonlyMap<string, PipelineSeat> {
    const seats = super.pipelineSeats();
    if (!this.beast?.active) return seats;
    return new Map<string, PipelineSeat>([...seats, ["beast", this.beast.seat]]);
  }
  protected override extraCandidates(tick: number): readonly HitCandidate[] { return this.beast?.candidates(tick) ?? []; }
  protected override extraLaunches(tick: number, results: readonly HitResult[]) { return this.beast?.launches(tick, results) ?? []; }
  protected override discardCandidate(c: HitCandidate): boolean { return BeastSystem.capturesBeast(c); }
  protected override hurtboxOf(id: number) {
    return id === BEAST_ENTITY_ID && this.beast?.active ? { hurtRadius: BEAST.hurtRadius, hurtHalfHeight: BEAST.hurtHalfHeight } : super.hurtboxOf(id);
  }
  /** Hosted sparring: humans never damage each other; in team play bots do not damage bots either. The beast fights humans only. */
  protected override isFriendly(a: number, t: number): boolean {
    if (a === BEAST_ENTITY_ID) return this.isBot(t);
    if (t === BEAST_ENTITY_ID) return this.isBot(a);
    return (this.isBot(a) ? this.teamPlay && this.isBot(t) : this.humansProtected && !this.isBot(t));
  }
  protected override botsNeverWander(): boolean { return this.teamPlay; }
  protected override botTargetAllowed(id: number): boolean { return !this.teamPlay || !this.isBot(id); }
  /** Out-of-combat regen for every fighter in hosted sparring; tick based, driven by observed HP drops. */
  /** Test seam: ticks without damage before regen starts. */
  regenDelayTicks: number = TEAM_PLAY.regenDelayTicks;
  private readonly regen = new Map<number, { hp: number; hurtTick: number }>();
  private regenStep(tick: number): void {
    for (const p of this.state.players.values()) {
      const f = this.combat.get(p.entityId);
      if (!f) continue;
      const r = this.regen.get(p.entityId) ?? { hp: f.hp100, hurtTick: tick };
      if (f.hp100 < r.hp || f.lifeId !== (r as { life?: number }).life) r.hurtTick = tick;
      (r as { life?: number }).life = f.lifeId;
      if (f.hp100 < COMBAT.hp100Max && tick - r.hurtTick >= this.regenDelayTicks && (tick - r.hurtTick) % TEAM_PLAY.regenIntervalTicks === 0) {
        this.combat.heal(f, TEAM_PLAY.regenAmount100, "regen", tick);
      }
      r.hp = f.hp100;
      this.regen.set(p.entityId, r);
    }
  }
  protected override beforeDrain(tick: number): void {
    if (this.beast) {
      if (this.state.roundNumber !== this.beastRound) { this.beastRound = this.state.roundNumber; this.beast.reset(tick); }
      else if (this.beastEnabled) this.beast.update(tick);
    }
    this.regenStep(tick);
    if (this.craters) {
      this.craters.update(tick);
      // The transformation itself stomps a crater under the new beast.
      for (const f of this.combat.all()) {
        if (f.beast && !this.wasBeast.has(f.entityId)) { this.wasBeast.add(f.entityId); const p = this.movement?.position(f.entityId); if (p) this.craters.add(p[0], p[2], CRATER.stompRadius, tick); }
        else if (!f.beast) this.wasBeast.delete(f.entityId);
      }
    }
    if (this.teamPlay) {
      const want = teamBotCount(tick - this.teamStartTick);
      if (tick - this.tierWindowStart >= TIER_WINDOW_TICKS) {
        let hd = 0, bd = 0;
        for (const p of this.state.players.values()) if (this.isBot(p.entityId)) bd += p.deaths; else hd += p.deaths;
        this.tierIdx = nextTier(this.tierIdx, hd - this.lastHumanDeaths, bd - this.lastBotDeaths);
        this.lastHumanDeaths = hd; this.lastBotDeaths = bd; this.tierWindowStart = tick;
      }
      const tier = TEAM_TIERS[this.tierIdx]!;
      if (this.bots.size < want) this.addBots(Array(want - this.bots.size).fill(tier), this.bots.size);
      for (const b of this.bots.values()) if (b.difficulty !== tier) b.difficulty = tier;
    }
    super.beforeDrain(tick);
  }

  override async onCreate(options: { roomCode?: string }): Promise<void> {
    const info = this.authServices()?.sparring.describe(options.roomCode ?? "");
    if (!info) throw new Error("MATCH_CLOSED");
    this.teamPlay = info.teamPlay;
    this.maxClients = info.teamPlay ? TEAM_PLAY.maxHumans : 4 - info.bots.length;
    await super.onCreate(options);
    // COMBAT01: the beast boss is an AI attacker too; it deals damage but never stuns, ragdolls or captures humans.
    this.combat.isBot = (id) => id === BEAST_ENTITY_ID || this.isBot(id);
    // Membership, rather than socket count, owns lifetime (including a completely disconnected host).
    this.autoDispose = false;
    this.roundTarget = info.roundTarget;
    this.teamStartTick = this.sim.tick; this.tierWindowStart = this.sim.tick;
    this.craters = new CraterSystem(this.state.craters, (x, z) => this.world?.walkableTop(x, z) != null);
    const seed = this.roomEpoch & 0x7fffffff;
    this.beast = new BeastSystem({
      state: this.state.beast, combat: this.combat, respawns: this.respawns, movement: () => this.movement, world: () => this.world,
      nextLifeId: () => ++this.lifeSeq, registerOccupant: (id) => this.registerOccupant(id), releaseOccupant: (id) => this.releaseOccupant(id),
      humans: () => this.humanList(), rand: (index, salt) => botRandom(seed, 0, index, salt),
    }, this.sim.tick);
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
