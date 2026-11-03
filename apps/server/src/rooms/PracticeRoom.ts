import type { Client } from "colyseus";
import { meterRequired100 } from "@eb/shared/awakening";
import { ClientMessage, PracticeSetSchema } from "@eb/shared/protocol";
import { COMBAT } from "@eb/shared/config/combat";
import { ARENA, type MapVec3 } from "@eb/shared/config/arena";
import { PlayerSchema } from "../state/PlayerSchema.js";
import { TokenBucket } from "../net/RateLimits.js";
import { applyReaction, isAlive } from "../sim/ActionMachine.js";
import { TutorialTracker } from "../sim/Tutorial.js";
import { BotArenaRoom } from "./BotArenaRoom.js";

/** Dummy home and the player's start, on the main island (islands.v1 main slab covers |x| < 20, |z| < 20). */
// Not the exact origin: a body standing on (0, 0) flips between two heights every tick (probed 0.90 m / 0.45 m, island seam), which shook the dummy.
const DUMMY_AT: readonly [number, number] = [0, -1];
const PLAYER_AT: readonly [number, number] = [0, 5];
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
  dummyId = 0;
  private toggles = { guard: false, ragdoll: false };
  private practiceBucket = new TokenBucket(4, 4, 0);

  override async onCreate(options: { roomCode?: string }): Promise<void> {
    await super.onCreate(options);
    this.maxClients = 1;
    this.awakening.meterEnabled = false;
    this.practiceBucket = new TokenBucket(4, 4, performance.now());
    this.onMessage(ClientMessage.practice, (client, raw) => this.onPractice(client, raw));
    this.spawnDummy();
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
    this.toggles = { guard: m.data.guard, ragdoll: m.data.ragdoll };
    p.owner.dummyGuard = m.data.guard;
    p.owner.dummyRagdoll = m.data.ragdoll;
    if (m.data.bots) {
      this.clearBots(); this.addBots(m.data.bots);
      p.owner.practiceBotCount = m.data.bots.length;
      p.owner.practiceBotDifficulty = m.data.bots[0] ?? "easy";
    }
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
