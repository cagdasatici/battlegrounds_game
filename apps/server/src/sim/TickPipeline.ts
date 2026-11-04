import type { ActionResult, CombatEvent } from "@eb/shared/protocol";
import { COMBAT } from "@eb/shared/config/combat";
import { ARENA, type MapVec3 } from "@eb/shared/config/arena";
import type { KitId } from "@eb/shared/protocol";
import { NEUTRAL_MOVE, type MoveIntent } from "@eb/shared/movement";
import { quantizeCm, quantizeYaw } from "@eb/shared/schema";
import type { ArenaState } from "../state/ArenaSchema.js";
import type { InputChannel, QueuedEdge } from "../net/ValidateInput.js";
import type { CombatSystem } from "./Combat.js";
import type { M1System, M1Pose } from "./M1.js";
import type { AbilityRunner, SkillOutcome } from "./AbilityRunner.js";
import type { AwakeningSystem, AwakenOutcome } from "./Awakening.js";
import { MOVE_DT } from "@eb/shared/movement";
import { safeTravelDistance } from "@eb/shared/dashSafety";
import type { MovementSystem, HorizontalOverride } from "./Movement.js";
import type { World } from "./World.js";
import type { ProjectileSystem } from "./Projectiles.js";
import type { UrnSystem } from "./Urns.js";
import { UrnSchema } from "../state/UrnSchema.js";
import { ProjectileSchema } from "../state/ProjectileSchema.js";
import type { ResolvedHitSummary } from "./PracticeDrills.js";
import { creditedAttacker, type HitCandidate, type HitResult } from "./HitResolver.js";
import { dashCandidates } from "./DashAttack.js";
import { killRewardFor } from "@eb/shared/config/passives";
import { locomotionLocked, intentsSuppressed, isAlive, type Fighter } from "./ActionMachine.js";
import {
  HOSTILE_REGION_RADIUS_M, pickSpawn, type RespawnSystem, type Pt, type Region,
} from "./RespawnSystem.js";

/** The part of a room seat the pipeline needs. */
export interface PipelineSeat {
  entityId: number;
  input: InputChannel;
  /** Owner-only requested kit, applied at respawn or once out of combat (T17). The pipeline clears it. */
  pendingKit: KitId | null;
}

export interface TickPipelineDeps {
  state: ArenaState;
  combat: CombatSystem;
  m1: M1System;
  abilities: AbilityRunner;
  awakening: AwakeningSystem;
  /** T19: detached projectile simulation; optional so rooms without it keep working. */
  projectiles?: ProjectileSystem;
  /** T23: server owned urns; optional so rooms without props keep working. */
  urns?: UrnSystem;
  movement: () => MovementSystem | null;
  world: () => World | null;
  seats: () => ReadonlyMap<string, PipelineSeat>;
  beforeDrain?: (tick: number) => void;
  /** Seatless simulated entities (practice dummy): body and action are published, no owner record. */
  extraBodies?: () => readonly number[];
  poseOf: (id: number) => M1Pose | undefined;
  /** GR02: server-only occupant generation per entity id; absent in fixtures that never reuse ids. */
  occupantOf?: (id: number) => number | undefined;
  /** T17: death bookkeeping, scoring and respawn deadlines. */
  respawn: RespawnSystem;
  /** T17: a room-unique life id for every spawn. */
  nextLifeId: () => number;
  sendActionResult: (sessionId: string, seat: PipelineSeat, edgeId: number, seq: number, tick: number, accepted: boolean,
    reason?: ActionResult["reason"], castId?: string) => void;
  /** GR15a: called once per resolving tick with immutable summaries, before launches and events. */
  onResolvedHits?: (tick: number, results: readonly ResolvedHitSummary[]) => void;
  broadcastEvent: (tick: number, kind: CombatEvent["kind"], actor: number, target: number | undefined,
    lifeId: number, moveId?: string, damage100?: number, extra?: { hitClass?: "light" | "heavy"; targetHp100?: number }) => void;
}

interface SeatScratch {
  edges: QueuedEdge[];
  jumpPressed: boolean;
}

/**
 * One logical 60 Hz tick in the spec section 21 order. Phases run in this fixed order:
 * expire, drainIntents, leaseClear, actionTransitions, locomotion, queries, resolve, afterHits,
 * deathsAndRespawns, publish. Transport (auth, join, drop, messages) stays in ArenaRoom.
 */
export class TickPipeline {
  private scratch = new Map<string, SeatScratch>();
  private intents = new Map<number, MoveIntent>();
  private candidates: HitCandidate[] = [];
  private results: HitResult[] = [];

  constructor(private readonly d: TickPipelineDeps) {
    // T22: every applied heal is one "heal" event: the healed fighter is actor and target, damage100 is the HP restored.
    d.combat.onHeal = (f, applied100, moveId, tick) =>
      d.broadcastEvent(tick, "heal", f.entityId, f.entityId, f.lifeId, moveId, applied100, { targetHp100: f.hp100 });
  }

  step(tick: number): void {
    const mv = this.d.movement();
    this.expire(tick);
    this.d.beforeDrain?.(tick);
    this.drainIntents();
    this.leaseClear(tick);
    this.actionTransitions(tick);
    this.locomotion(tick);
    if (mv) {
      this.queries(tick);
      if (this.candidates.length > 0) {
        this.resolve(tick);
        this.afterHits(tick);
      }
      this.deathsAndRespawns(tick);
      this.publish(tick);
    }
    this.d.state.serverTick = tick;
    this.scratch.clear();
    this.intents.clear();
    this.candidates = [];
    this.results = [];
  }

  /** Re-mirrors every seat, projectile and urn into replicated state outside a full step (round reset, decision 0054). */
  republish(tick: number): void { this.publish(tick); }

  /** Publishes one body into replicated state. Also used by the room when a player spawns. */
  publishBody(entityId: number): void {
    const p = this.d.state.players.get(String(entityId));
    const mv = this.d.movement();
    const b = mv?.get(entityId);
    const pos = mv?.position(entityId);
    if (!p || !b || !pos) return;
    const i16 = (v: number): number => Math.max(-32768, Math.min(32767, quantizeCm(v)));
    p.x = quantizeCm(pos[0]); p.y = quantizeCm(pos[1]); p.z = quantizeCm(pos[2]);
    p.vx = i16(b.state.vx); p.vy = i16(b.state.vy); p.vz = i16(b.state.vz);
    p.facingYaw = quantizeYaw(b.state.facingYaw);
    p.airJumpUsed = b.state.airJumpsUsed > 0 && !b.state.grounded;
    // GR04: owner locomotion state is published with the pose so client prediction can fully replace its state.
    const o = p.owner, ms = b.state;
    o.grounded = ms.grounded; o.lastGroundedTick = ms.lastGroundedTick; o.jumpPressTick = ms.jumpPressTick;
    o.jumpedSinceGrounded = ms.jumpedSinceGrounded; o.airJumpsUsed = Math.min(255, ms.airJumpsUsed);
  }

  private grounded(id: number): boolean {
    return this.d.movement()?.get(id)?.state.grounded ?? false;
  }

  /** Expiries before input intents. */
  private expire(tick: number): void {
    this.d.combat.expire(tick, (id) => this.grounded(id));
    this.d.awakening.update(tick);
    this.d.urns?.update(tick, (id) => this.d.combat.get(id));
  }

  private drainIntents(): void {
    for (const [sessionId, seat] of this.d.seats()) {
      this.scratch.set(sessionId, { edges: seat.input.drain(), jumpPressed: false });
    }
  }

  private leaseClear(tick: number): void {
    for (const seat of this.d.seats().values()) seat.input.expireLease(tick, COMBAT.inputLeaseTicks);
  }

  private actionTransitions(tick: number): void {
    const { combat, abilities, awakening, m1 } = this.d;
    const mv = this.d.movement();
    for (const [sessionId, seat] of this.d.seats()) {
      const sc = this.scratch.get(sessionId)!;
      const h = seat.input.held;
      const f = combat.get(seat.entityId);
      const body = mv?.get(seat.entityId);
      let jumpPressed = false;
      // Input priority (spec 12): evasive -> awakening -> skill lowest slot -> dash -> M1 -> jump -> guard -> movement.
      // An illegal higher priority request never suppresses a legal lower one.
      const ordered = [...sc.edges].sort((a, b) => this.edgeRank(f, a.edge) - this.edgeRank(f, b.edge));
      if (f) {
        const buffered = abilities.consumeBuffer(f, tick);
        if (buffered) this.reportSkill(sessionId, seat, f, buffered.edgeId, seat.input.seqOfEdge(buffered.edgeId), tick, buffered.outcome);
      }
      for (const q of ordered) {
        if (q.edge.kind === "dash") {
          const r = f && body ? combat.requestDash(seat.entityId, tick, body.state.facingYaw, h.moveX, h.moveZ)
            : { ok: false as const, reason: "STATE" as const };
          this.d.sendActionResult(sessionId, seat, q.edge.id, q.seq, tick, r.ok, r.ok ? undefined : r.reason);
        } else if (q.edge.kind === "skillDown") {
          const o: SkillOutcome = f ? abilities.skillDown(f, tick, q.edge.slot, q.edge.id) : { kind: "rejected", reason: "STATE" };
          if (f) this.reportSkill(sessionId, seat, f, q.edge.id, q.seq, tick, o);
        } else if (q.edge.kind === "awaken") {
          // Never buffered. Rejections are METER, FORM or STATE and are answered immediately.
          const o: AwakenOutcome = f ? awakening.request(f, tick) : { kind: "rejected", reason: "STATE" };
          if (f) this.reportSkill(sessionId, seat, f, q.edge.id, q.seq, tick, o);
        } else if (q.edge.kind === "skillUp") {
          if (f) abilities.skillUp(f, tick, q.edge.slot); // only a running holdRelease cast of that slot reacts
        } else if (q.edge.kind === "jump") jumpPressed = true;
      }
      if (f) {
        // M1 has no edge: the server derives presses and legal repeats from the held attack state.
        const started = m1.update(f, tick, h, this.d.poseOf(seat.entityId));
        if (started?.ok) this.d.broadcastEvent(tick, "cast", f.entityId, undefined, f.lifeId, f.moveId);
        // During an active combo, holding Jump suppresses the ordinary jump (fourth hit uppercut gesture).
        if (h.jumpHeld && m1.comboActive(f, tick)) jumpPressed = false;
        combat.updateGuard(seat.entityId, tick, h.blockHeld, this.grounded(seat.entityId));
        if (intentsSuppressed(f) || locomotionLocked(f) || f.action === "Dash") jumpPressed = false;
      }
      sc.jumpPressed = jumpPressed;
    }
    // A skill edge replaced in the shared offensive buffer is answered so the client clears its outline.
    for (const lost of abilities.buffer.drainRejected()) {
      for (const [sessionId, seat] of this.d.seats()) {
        if (seat.entityId === lost.entityId) this.d.sendActionResult(sessionId, seat, lost.edgeId, seat.input.seqOfEdge(lost.edgeId), tick, false, "STATE");
      }
    }
  }

  private locomotion(tick: number): void {
    const { combat, abilities } = this.d;
    for (const [sessionId, seat] of this.d.seats()) {
      const sc = this.scratch.get(sessionId)!;
      const h = seat.input.held;
      const f = combat.get(seat.entityId);
      const castScale = abilities.moveScaleOf(seat.entityId);
      const locked = !!f && (locomotionLocked(f) || f.action === "Dash" || (castScale === 0 && f.action !== "Idle"));
      // moveScale (spec 14): during an ability cast with 0 < scale < 1 the player's movement intent is scaled and
      // running is suppressed (T12, sv.b2 moveScale 0.15). turnRate is enforced in AbilityRunner.collect (R07).
      const scaled = castScale !== null && castScale > 0 && castScale < 1 && f !== undefined && f.action !== "Idle";
      const mScale = scaled ? castScale : 1;
      this.intents.set(seat.entityId, locked ? NEUTRAL_MOVE
        : { moveX: h.moveX * mScale, moveZ: h.moveZ * mScale, run: scaled ? false : h.runHeld, guard: f?.action === "Guard" || h.blockHeld, jumpPressed: sc.jumpPressed, ...(f && f.action !== "Idle" ? { airJumpBlocked: true } : {}), ...(h.facingLock ? { aimYaw: h.yaw } : {}) });
    }
    this.d.movement()?.step(tick, (id) => this.intents.get(id) ?? NEUTRAL_MOVE, (id) => this.dashOverride(id, tick),
      (id) => this.d.abilities.facingOverrideOf(id), (id) => this.d.abilities.freezesVertical(id, tick));
  }

  /**
   * Hold state of a charge slot for an entity's input channel (T19). The lease is stricter than the generic hold clear:
   * a charge whose input has been missing for inputLeaseTicks ticks is stale (A11); otherwise the slot is held while the
   * latest accepted packet names it in chargeHeldSlot.
   */
  holdOf(entityId: number, slot: 1 | 2 | 3 | 4, tick: number): "held" | "released" | "stale" {
    for (const seat of this.d.seats().values()) {
      if (seat.entityId !== entityId) continue;
      if (tick - seat.input.lastInputTick >= COMBAT.inputLeaseTicks) return "stale";
      return seat.input.held.chargeHeldSlot === slot ? "held" : "released";
    }
    return "released";
  }

  /** Validated camera pitch of an entity's input channel (T20 Vent Rush air branch). Undefined for seatless entities. */
  pitchOf(entityId: number): number | undefined {
    for (const seat of this.d.seats().values()) if (seat.entityId === entityId) return seat.input.held.pitch;
    return undefined;
  }

  /** Collision queries for M1 swings, abilities and awakening at the current server poses (spec 12/13). */
  private queries(tick: number): void {
    const w = this.d.world();
    const pose = (id: number): M1Pose | undefined => this.d.poseOf(id);
    this.candidates = [
      ...this.d.m1.candidates(tick, this.d.combat.all(), pose,
        (a, t) => !!w && w.segmentBlocked([a.x, a.y, a.z], [t.x, t.y, t.z])),
      ...dashCandidates(tick, this.d.combat.all(), pose, (a, t) => !!w && w.segmentBlocked([a.x, a.y, a.z], [t.x, t.y, t.z])),
      ...this.d.abilities.collect(tick),
      ...(this.d.projectiles?.collect(tick) ?? []),
      ...this.d.awakening.collect(tick),
    ];
  }

  private resolve(tick: number): void {
    this.results = this.d.combat.resolve(tick, this.candidates, (id) => {
      const q = this.d.poseOf(id);
      return q && { x: q.x, z: q.z, facingYaw: q.facingYaw, grounded: q.grounded };
    }, this.d.occupantOf);
  }

  /** GR02: the attacker that may be credited for a result (kills, assists, timers, events); undefined when a detached shot's owner left. */
  private creditOf(c: HitCandidate): number | undefined { return creditedAttacker(c, this.d.occupantOf); }

  /** Handler results, awakening meter and launches. */
  private afterHits(tick: number): void {
    const { combat, m1, abilities, awakening } = this.d;
    const results = this.results;
    abilities.afterResolve(tick, results);
    if (this.d.onResolvedHits) {
      this.d.onResolvedHits(tick, Object.freeze(results.map((r) => Object.freeze({
        attackerId: r.candidate.attackerId, targetId: r.candidate.targetId, moveId: r.candidate.moveId,
        outcome: r.outcome, damage100: r.damage100,
      }))));
    }
    this.d.projectiles?.settle(tick, results); // after counter stances had their chance to reflect
    awakening.gain(results);
    // T23: damage or capture drops a carried urn (spec 15). Blocked and countered hits do neither.
    for (const r of results) {
      if ((r.outcome === "hit" && r.damage100 > 0) || r.outcome === "captured") this.d.urns?.drop(r.candidate.targetId);
    }
    const launches = [...m1.launches(tick, results, (id) => combat.get(id), (id) => this.d.poseOf(id)), ...abilities.launches(tick, results)];
    for (const l of launches) {
      const b = this.d.movement()?.get(l.targetId);
      if (!b) continue;
      b.state.vx = l.vx; b.state.vz = l.vz; b.state.vy = l.vy;
      if (l.vy > 0) b.state.grounded = false;
    }
  }

  /**
   * Hit and KO events in result order, then void and boundary KOs, then due respawns and kit changes (T17).
   * Runs every tick: respawn deadlines and the void rule do not depend on this tick having hit candidates.
   */
  private deathsAndRespawns(tick: number): void {
    for (const r of this.results) {
      const c = r.candidate;
      if ((r.outcome === "hit" || r.outcome === "captured") && r.damage100 > 0) {
        const credit = this.creditOf(c);
        if (credit !== undefined) this.d.respawn.recordDamage(credit, c.targetId, tick, r.damage100);
        else this.d.respawn.touchCombat(c.targetId, tick); // departed owner: no attribution, no timer for the id's new occupant
      }
    }
    for (const r of this.results) this.reportHit(tick, r);
    this.voidKos(tick);
    this.respawnDue(tick);
    this.applyKitChanges(tick);
  }

  private publish(tick: number): void {
    for (const seat of this.d.seats().values()) { this.publishBody(seat.entityId); this.publishAction(seat.entityId); this.publishOwner(seat, tick); }
    for (const id of this.d.extraBodies?.() ?? []) { this.publishBody(id); this.publishAction(id); }
    this.publishProjectiles();
    this.publishUrns();
  }

  /** Mirrors the eight urns into replicated state (spec 10). Created on first publish, updated in place. */
  private publishUrns(): void {
    const sys = this.d.urns;
    if (!sys) return;
    const map = this.d.state.urns;
    for (const u of sys.list()) {
      const key = String(u.id);
      let r = map.get(key);
      if (!r) { r = new UrnSchema(); r.id = u.id; map.set(key, r); }
      if (r.state !== u.state) r.state = u.state;
      if (r.holderId !== u.holderId) r.holderId = u.holderId;
      if (r.returnTick !== u.returnTick) r.returnTick = u.returnTick;
      // A carried urn rides with its holder; the replicated position is the anchor otherwise.
      const hp = u.state === "held" || u.state === "reserved" ? this.d.poseOf(u.holderId) : undefined;
      const x = quantizeCm(hp ? hp.x : u.anchor[0]), y = quantizeCm(hp ? hp.y : u.anchor[1]), z = quantizeCm(hp ? hp.z : u.anchor[2]);
      if (r.x !== x) r.x = x;
      if (r.y !== y) r.y = y;
      if (r.z !== z) r.z = z;
    }
  }

  /** Mirrors the live projectile list into replicated state (spec 20): add, update, remove. Centimetres and cm/s. */
  private publishProjectiles(): void {
    const sys = this.d.projectiles;
    if (!sys) return;
    const map = this.d.state.projectiles;
    const live = new Set<string>();
    const i16 = (v: number): number => Math.max(-32768, Math.min(32767, Math.round(v * 100)));
    for (const p of sys.list()) {
      const key = String(p.id);
      live.add(key);
      let r = map.get(key);
      if (!r) {
        r = new ProjectileSchema();
        r.entityId = p.id; r.spawnTick = p.spawnTick;
        map.set(key, r);
      }
      r.castId = p.castId; r.ownerId = p.ownerId; r.ownerLifeId = p.ownerLifeId;
      r.x = quantizeCm(p.x); r.y = quantizeCm(p.y); r.z = quantizeCm(p.z);
      r.vx = i16(p.vx); r.vy = i16(p.vy); r.vz = i16(p.vz);
      r.chargeClass = p.chargeClass; r.remainingTicks = Math.max(0, p.remainingTicks); r.reflectionCount = p.reflectionCount;
    }
    for (const key of [...map.keys()]) if (!live.has(key)) map.delete(key);
  }

  private reportHit(tick: number, r: HitResult): void {
    const { combat } = this.d;
    const c = r.candidate;
    const victim = combat.get(c.targetId);
    const credit = this.creditOf(c);
    const actor = credit ?? c.targetId; // absent scorer: same event format as a ring-out, never the new occupant's identity
    const kind: CombatEvent["kind"] | null = r.outcome === "hit" ? "hit" : r.outcome === "blocked" ? "block"
      : r.outcome === "countered" ? "counter" : null;
    if (kind === "hit" && victim) {
      const heavy = r.damage100 >= 1000 || c.moveId.startsWith("m1.4.finisher") || (credit !== undefined && combat.get(credit)?.form === "Awakened");
      this.d.broadcastEvent(tick, kind, actor, c.targetId, victim.lifeId, c.moveId, r.damage100,
        { hitClass: heavy ? "heavy" : "light", targetHp100: victim.hp100 });
    } else if (kind && victim) this.d.broadcastEvent(tick, kind, actor, c.targetId, victim.lifeId, c.moveId, r.damage100);
    else if (r.outcome === "captured" && victim) this.d.broadcastEvent(tick, "capture", actor, c.targetId, victim.lifeId, c.moveId, r.damage100);
    if (r.killed && victim) this.knockOut(tick, victim, credit, c.moveId, c.projectile?.ownerLifeId);
  }

  /** One KO per life: cleanup, scoring, the finisher passive and the respawn countdown. killer is undefined for a ring-out. */
  private knockOut(tick: number, victim: { entityId: number; lifeId: number }, killer: number | undefined, moveId?: string,
    killerLifeId?: number): void {
    const { m1, abilities, awakening, combat, respawn } = this.d;
    const id = victim.entityId;
    m1.reset(id);
    abilities.reset(id);
    awakening.reset(id);
    this.d.urns?.drop(id);
    // Death resets held inputs (spec 11): neutralize the victim's input channel.
    for (const seat of this.d.seats().values()) if (seat.entityId === id) seat.input.neutralize();
    const { scorer, assists } = respawn.resolveKo(id, tick, killer);
    const pv = this.d.state.players.get(String(id));
    if (pv) pv.deaths += 1;
    const ps = scorer !== undefined ? this.d.state.players.get(String(scorer)) : undefined;
    if (ps) ps.kills += 1;
    for (const a of assists) { const pa = this.d.state.players.get(String(a)); if (pa) pa.assists += 1; }
    if (killer !== undefined && scorer === killer && respawn.claimReward(victim.lifeId)) {
      const k = combat.get(killer);
      // A detached projectile of a previous life heals nobody (spec 15).
      if (k && isAlive(k) && (killerLifeId === undefined || k.lifeId === killerLifeId)) this.payKillReward(tick, k, moveId);
    }
    respawn.schedule(id, tick);
    this.d.broadcastEvent(tick, "ko", scorer ?? id, id, victim.lifeId, moveId);
  }

  /** T22: the registry decides the reward; a heal goes through CombatSystem.heal (which emits "heal"), a reset readies cooldowns. */
  private payKillReward(tick: number, killer: Fighter, moveId: string | undefined): void {
    const reward = killRewardFor(killer.kitId, moveId);
    if (!reward) return;
    if (reward.kind === "heal") this.d.combat.heal(killer, reward.amount100, moveId!, tick);
    else for (const key of reward.moveIds) if ((killer.cooldowns.get(key) ?? 0) > tick) killer.cooldowns.set(key, tick);
  }

  /** Spec 10: y below the void plane or horizontal radius beyond the boundary is one KO per life. */
  private voidKos(tick: number): void {
    const mv = this.d.movement();
    if (!mv) return;
    for (const f of this.d.combat.all()) {
      if (!isAlive(f)) continue;
      const pos = mv.position(f.entityId);
      if (!pos || (pos[1] >= ARENA.voidY && Math.hypot(pos[0], pos[2]) <= ARENA.boundaryRadius)) continue;
      if (this.d.combat.kill(f.entityId, tick)) this.knockOut(tick, f, undefined);
    }
  }

  /** Respawns every victim whose 180 tick countdown ended, choosing the spawn at that tick (spec 10). */
  private respawnDue(tick: number): void {
    const { combat, respawn } = this.d;
    const mv = this.d.movement(), w = this.d.world();
    if (!mv || !w) return;
    for (const id of respawn.due(tick)) {
      const f = combat.get(id);
      if (!f || isAlive(f)) { respawn.complete(id, tick); continue; }
      const pts: Pt[] = [];
      for (const o of combat.all()) {
        if (o.entityId === id || !isAlive(o)) continue;
        const p = mv.position(o.entityId);
        if (p) pts.push({ x: p[0], z: p[2] });
      }
      const regions: Region[] = this.candidates.filter((c) => c.attackerId !== id)
        .map((c) => ({ x: c.originX, z: c.originZ, r: HOSTILE_REGION_RADIUS_M }));
      const choice = pickSpawn(w.map.spawnAnchors, pts, regions, pts);
      if (!choice.valid && !respawn.fallbackReached(id, tick)) continue; // retry next tick for up to 60 ticks
      const [ax, ay, az] = choice.anchor.position;
      const centre: MapVec3 = [ax, (w.groundHeight(ax, az) ?? ay) + ARENA.capsule.centreAboveSurface, az];
      // A queued kit change applies here for a dead fighter (spec 6).
      const seat = [...this.d.seats().values()].find((s) => s.entityId === id);
      if (seat?.pendingKit) { if (seat.pendingKit !== f.kitId) f.meter100 = 0; /* kit change still resets (FB04) */ f.kitId = seat.pendingKit; seat.pendingKit = null; }
      const p = this.d.state.players.get(String(id));
      if (p) p.owner.pendingKit = "";
      const lifeId = this.d.nextLifeId();
      combat.respawn(id, tick, lifeId); // full HP, cooldowns and form reset (meter kept, FB04), standard spawn protection
      this.d.m1.reset(id);
      this.d.abilities.reset(id);
      this.d.awakening.reset(id);
      mv.add(id, centre, Math.atan2(ax, az)); // face the arena centre
      if (p) p.lifeId = lifeId;
      respawn.complete(id, tick);
      this.publishBody(id);
      this.d.broadcastEvent(tick, "respawn", id, id, lifeId);
    }
  }

  /** A living, idle, out of combat fighter switches kit after 480 quiet ticks: meter and cooldowns reset, HP untouched. */
  private applyKitChanges(tick: number): void {
    const { combat, respawn, abilities } = this.d;
    for (const seat of this.d.seats().values()) {
      const f = combat.get(seat.entityId);
      if (!seat.pendingKit || !f || !isAlive(f)) continue;
      const p = this.d.state.players.get(String(f.entityId));
      if (seat.pendingKit === f.kitId) { seat.pendingKit = null; if (p) p.owner.pendingKit = ""; continue; }
      if (respawn.inCombat(f.entityId, tick) || f.action !== "Idle" || f.form !== "Base") continue;
      f.kitId = seat.pendingKit;
      seat.pendingKit = null;
      f.meter100 = 0;
      f.cooldowns.clear();
      abilities.reset(f.entityId);
      if (p) p.owner.pendingKit = "";
    }
  }

  /** evasive (dash while ragdolled) 0, awaken 1, skillDown by slot 2.., dash 6, jump 7, others last. */
  private edgeRank(f: { action: string } | undefined, e: { kind: string; slot?: number }): number {
    if (e.kind === "dash") return f?.action === "Ragdolled" ? 0 : 6;
    if (e.kind === "awaken") return 1;
    if (e.kind === "skillDown") return 1 + (e.slot ?? 4);
    if (e.kind === "jump") return 7;
    return 8;
  }

  private reportSkill(sessionId: string, seat: PipelineSeat, f: { entityId: number; lifeId: number }, edgeId: number, seq: number, tick: number, o: SkillOutcome | AwakenOutcome): void {
    if (o.kind === "buffered") return; // answered when the buffered edge is consumed or expires
    if (o.kind === "started") {
      this.d.sendActionResult(sessionId, seat, edgeId, seq, tick, true, undefined, `${f.entityId}.${o.castCounter}`);
      this.d.broadcastEvent(tick, "cast", f.entityId, undefined, f.lifeId, o.moveId);
    } else this.d.sendActionResult(sessionId, seat, edgeId, seq, tick, false, o.reason);
  }

  /** Facing Movement would pick from this tick's intent (R07 host hook for AbilityRunner turnRate). */
  requestedYawOf(id: number): number | undefined {
    const i = this.intents.get(id);
    return i && (i.moveX !== 0 || i.moveZ !== 0) ? Math.atan2(-i.moveX, -i.moveZ) : undefined;
  }

  /**
   * FB07: the dash travels at its normal speed but stops short of the first path sample without ground under the
   * footprint. Re-checked every tick over the remaining travel. Only the caster's own dash is clamped; knockback is not.
   */
  private dashOverride(id: number, tick: number): HorizontalOverride | null {
    const f = this.d.combat.get(id);
    const d = f?.dash;
    if (!f || !d) return null;
    const w = this.d.world(), pos = this.d.movement()?.position(id);
    if (!w || !pos) return { vx: d.dirX * d.speed, vz: d.dirZ * d.speed };
    const perTick = d.speed * MOVE_DT;
    const remaining = Math.max(1, Number.isFinite(f.actionEndTick) ? f.actionEndTick - tick : 1);
    const safe = safeTravelDistance((x, z) => w.walkableTop(x, z), pos[0], pos[2], d.dirX, d.dirZ, perTick * remaining);
    const k = Math.min(1, safe / perTick);
    return { vx: d.dirX * d.speed * k, vz: d.dirZ * d.speed * k };
  }

  private publishAction(entityId: number): void {
    const p = this.d.state.players.get(String(entityId));
    const f = this.d.combat.get(entityId);
    if (!p || !f) return;
    p.action = f.action;
    p.actionStartTick = f.actionStartTick;
    p.actionEndTick = Math.min(f.actionEndTick, 0xffffffff);
    p.moveId = f.moveId;
    p.hp100 = f.hp100;
    p.protectedUntilTick = f.protectedUntilTick;
    p.kitId = f.kitId;
    p.form = f.form;
    p.formEndTick = Math.min(f.formEndTick, 0xffffffff);
    p.meter100 = f.meter100;
    p.awakenedUsedMask = f.awakenedUsedMask;
    p.contextSpent = f.contextSpent;
    const kit = this.d.abilities.kitOf(entityId);
    for (let i = 0; i < 4; i++) {
      const def = kit ? this.d.abilities.registry.slotted(kit, f.form, (i + 1) as 1 | 2 | 3 | 4) : undefined;
      const end = def ? f.cooldowns.get(def.id) ?? 0 : 0;
      if (p.cooldownEndTicks[i] !== end) p.cooldownEndTicks[i] = end;
    }
  }

  /** Owner-only record (R08). pendingKit is written by ArenaRoom; chargeStartTick awaits hold moves (T19). */
  private publishOwner(seat: PipelineSeat, tick: number): void {
    const p = this.d.state.players.get(String(seat.entityId));
    const f = this.d.combat.get(seat.entityId);
    if (!p) return;
    const o = p.owner;
    o.ackSeq = seat.input.lastReceivedSeq;
    o.ackInputTick = seat.input.lastSampleTick;
    o.epoch = seat.input.epoch;
    o.chargeStartTick = this.d.abilities.chargeStartOf(seat.entityId);
    o.evasiveEndTick = Math.min(f?.cooldowns.get("evasive") ?? 0, 0xffffffff);
    o.lethalCounterRemaining = f ? Math.max(0, Math.min(0xffff, f.lethalCounterUntil - tick)) : 0;
  }
}
