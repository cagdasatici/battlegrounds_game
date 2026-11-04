import type { Client } from "colyseus";
import { meterRequired100 } from "@eb/shared/awakening";
import { ClientMessage, PracticeDrillSchema, PracticeSetSchema } from "@eb/shared/protocol";
import { COMBAT } from "@eb/shared/config/combat";
import { ARENA, type MapVec3 } from "@eb/shared/config/arena";
import { PlayerSchema } from "../state/PlayerSchema.js";
import { TokenBucket } from "../net/RateLimits.js";
import { applyReaction, isAlive } from "../sim/ActionMachine.js";
import { TutorialTracker } from "../sim/Tutorial.js";
import { DrillTracker, type ResolvedHitSummary } from "../sim/PracticeDrills.js";
import { BotArenaRoom } from "./BotArenaRoom.js";

/** Dummy home and the player's start, on the main island (islands.v1 main slab covers |x| < 20, |z| < 20). */
// Not the exact origin: a body standing on (0, 0) flips between two heights every tick (probed 0.90 m / 0.45 m, island seam), which shook the dummy.
const DUMMY_AT: readonly [number, number] = [0, -1];
const PLAYER_AT: readonly [number, number] = [0, 5];
/** GR15a lesson positions: 3 m apart, facing each other. The dummy keeps its home point because (0, 0) is the island seam. */
const DRILL_PLAYER_AT: readonly [number, number] = [0, 2];
/** The dummy is refilled below this HP so the practice never ends in a knockout (it still takes and shows damage). */
const DUMMY_REFILL_BELOW_100 = 4000;
const DUMMY_RAGDOLL_TICKS = 90;

/**
 * Practice room (spec section 6): the same ArenaRoom tick pipeline with one seatless stationary dummy, guard and
 * ragdoll toggles, awakening meter gain disabled, and server confirmed tutorial steps. One player; its own room
 * code, so nothing here can reach an FFA room, its scores or its meters.
 */
export class PracticeRoom extends BotArenaRoom {
  override maxClients = 1;
  readonly tutorial = new TutorialTracker();
  readonly drill = new DrillTracker();
  dummyId = 0;
  private toggles = { guard: false, ragdoll: false };
  private practiceBucket = new TokenBucket(4, 4, 0);

  override async onCreate(options: { roomCode?: string }): Promise<void> {
    await super.onCreate(options);
    this.maxClients = 1;
    this.awakening.meterEnabled = false;
    this.practiceBucket = new TokenBucket(4, 4, performance.now());
    this.onMessage(ClientMessage.practice, (client, raw) => this.onPractice(client, raw));
    this.onMessage(ClientMessage.practiceDrill, (client, raw) => this.onDrill(client, raw));
    this.spawnDummy();
  }

  override onLeave(client: Client): void {
    this.drill.exit();
    super.onLeave(client);
  }

  protected override botTargetAllowed(id: number): boolean { return id !== this.dummyId; }
  protected override chooseBotSpawn(index: number): MapVec3 { return this.standPoint([index === 0 ? 5 : -5, 0]); }

  protected override extraBodyIds(): readonly number[] { return this.dummyId > 0 ? [this.dummyId] : []; }

  protected override chooseSpawn(): MapVec3 { return this.standPoint(PLAYER_AT); }

  private standPoint(xz: readonly [number, number]): MapVec3 {
    const surface = this.world?.groundHeight(xz[0], xz[1]) ?? 0;
    return [xz[0], surface + ARENA.capsule.centreAboveSurface, xz[1]];
  }

  private spawnDummy(): void {
    this.dummyId = this.allocEntityId();
    this.registerOccupant(this.dummyId);
    const p = new PlayerSchema();
    p.entityId = this.dummyId;
    p.lifeId = ++this.lifeSeq;
    p.displayName = "Practice dummy";
    p.kitId = "td";
    p.hp100 = COMBAT.hp100Max;
    p.connected = true;
    p.ready = true;
    this.state.players.set(String(this.dummyId), p);
    const f = this.combat.add(this.dummyId, p.lifeId, this.sim.tick, "td");
    f.protectedUntilTick = 0;
    this.respawns.startLife(this.dummyId, this.sim.tick);
    this.movement?.add(this.dummyId, this.standPoint(DUMMY_AT), Math.PI); // faces +z, toward the player
    this.pipeline.publishBody(this.dummyId);
  }

  private onPractice(client: Client, raw: unknown): void {
    const seat = this.seats.get(client.sessionId);
    const p = seat && this.playerOf(seat);
    if (!seat || !p || !this.practiceBucket.take(performance.now())) return;
    const m = PracticeSetSchema.safeParse(raw);
    if (!m.success) { this.noteInvalid(client, "practice_invalid"); return; }
    if (this.drill.state !== "idle") return; // GR15a: guard/ragdoll/bot controls are locked while a lesson exists
    this.toggles = { guard: m.data.guard, ragdoll: m.data.ragdoll };
    p.owner.dummyGuard = m.data.guard;
    p.owner.dummyRagdoll = m.data.ragdoll;
    if (m.data.bots) {
      this.clearBots(); this.addBots(m.data.bots);
      p.owner.practiceBotCount = m.data.bots.length;
      p.owner.practiceBotDifficulty = m.data.bots[0] ?? "easy";
    }
  }

  /** GR15a: lesson intent. Shares the 4/s practice bucket; success is only ever set by onResolvedHits. */
  private onDrill(client: Client, raw: unknown): void {
    const seat = this.seats.get(client.sessionId);
    const p = seat && this.playerOf(seat);
    if (!seat || !p || !this.practiceBucket.take(performance.now())) return;
    const m = PracticeDrillSchema.safeParse(raw);
    if (!m.success) { this.noteInvalid(client, "practice_drill_invalid"); return; }
    const tick = this.sim.tick;
    if (m.data.action === "exit") {
      if (this.drill.exit()) this.syncDrill(p);
      return;
    }
    if (!p.ready) return;
    const changed = m.data.action === "start" ? this.drill.start(m.data.drill, tick) : this.drill.retry(tick);
    if (!changed) return;
    this.resetForLesson(seat.entityId, p, tick);
    this.syncDrill(p);
  }

  private syncDrill(p: PlayerSchema): void {
    p.owner.drillId = this.drill.drillId;
    p.owner.drillState = this.drill.state;
    p.owner.drillStartTick = this.drill.startTick;
    p.owner.drillSuccessTick = this.drill.successTick;
  }

  /** Private practice reset: no bots, toggles off, both fighters at base with full HP and cooldowns, placed facing each other. */
  private resetForLesson(playerId: number, p: PlayerSchema, tick: number): void {
    const mv = this.movement;
    if (!mv) return;
    this.clearBots();
    this.toggles = { guard: false, ragdoll: false };
    p.owner.dummyGuard = false; p.owner.dummyRagdoll = false; p.owner.practiceBotCount = 0;
    const put = (id: number, at: readonly [number, number], yaw: number): void => {
      const f = this.combat.get(id), q = this.state.players.get(String(id));
      if (!f || !q) return;
      const lifeId = ++this.lifeSeq;
      this.combat.respawn(id, tick, lifeId);
      f.protectedUntilTick = 0; // a lesson target must be hittable at once
      this.m1.reset(id); this.abilities.reset(id); this.awakening.reset(id); this.urns.drop(id);
      mv.add(id, this.standPoint(at), yaw);
      q.lifeId = lifeId;
      this.respawns.complete(id, tick);
      this.pipeline.publishBody(id);
    };
    put(playerId, DRILL_PLAYER_AT, 0); // yaw 0 faces -z, toward the dummy
    put(this.dummyId, DUMMY_AT, Math.PI);
    this.pipeline.republish(tick);
  }

  protected override onResolvedHits(tick: number, hits: readonly ResolvedHitSummary[]): void {
    const seat = [...this.seats.values()][0];
    const p = seat && this.playerOf(seat);
    if (!seat || !p) return;
    if (this.drill.observe(tick, hits, seat.entityId, this.dummyId)) this.syncDrill(p);
  }

  override stepTick(tick: number): void {
    this.driveDummy(tick);
    super.stepTick(tick);
    this.observeTutorial(tick);
  }

  /** The dummy is driven by server state only: refill, optional guard hold, optional ragdoll loop. */
  private driveDummy(tick: number): void {
    const f = this.combat.get(this.dummyId);
    if (!f || !isAlive(f)) return;
    if (f.hp100 < DUMMY_REFILL_BELOW_100) f.hp100 = COMBAT.hp100Max;
    const grounded = this.movement?.get(this.dummyId)?.state.grounded ?? false;
    this.combat.updateGuard(this.dummyId, tick, this.toggles.guard, grounded);
    if (this.toggles.ragdoll && f.action === "Idle") applyReaction(f, tick, { kind: "ragdoll", ticks: DUMMY_RAGDOLL_TICKS }, false);
  }

  private observeTutorial(_tick: number): void {
    const seat = [...this.seats.values()][0];
    const p = seat && this.playerOf(seat);
    const f = seat && this.combat.get(seat.entityId);
    const pose = seat && this.movement?.position(seat.entityId);
    const body = seat && this.movement?.get(seat.entityId);
    if (!seat || !p || !p.ready || !f || !pose || !body || !isAlive(f)) return;
    let slotOfMove: 1 | 2 | 3 | 4 | null = null;
    if (f.moveId !== "" && f.form === "Base") {
      for (const s of [1, 2, 3, 4] as const) {
        if (this.abilities.registry.slotted(f.kitId, "Base", s)?.id === f.moveId) { slotOfMove = s; break; }
      }
    }
    const ev = this.tutorial.observe({
      x: pose[0], z: pose[2], facingYaw: body.state.facingYaw, action: f.action, moveId: f.moveId, form: f.form, slotOfMove,
    });
    // Practice only: once the four skills are done, the meter is granted by the server so Awaken can be tried.
    // Hits never build meter here (meterEnabled = false), so this is the only way it fills.
    if (ev?.next === "awaken") f.meter100 = meterRequired100(f.kitId);
    p.owner.tutorialStep = this.tutorial.step;
    p.owner.tutorialSkillMask = this.tutorial.skillMask;
  }
}
