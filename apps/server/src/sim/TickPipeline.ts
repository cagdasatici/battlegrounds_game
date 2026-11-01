import type { ActionResult, CombatEvent } from "@eb/shared/protocol";
import { COMBAT } from "@eb/shared/config/combat";
import { NEUTRAL_MOVE, type MoveIntent } from "@eb/shared/movement";
import { quantizeCm, quantizeYaw } from "@eb/shared/schema";
import type { ArenaState } from "../state/ArenaSchema.js";
import type { InputChannel, QueuedEdge } from "../net/ValidateInput.js";
import type { CombatSystem } from "./Combat.js";
import type { M1System, M1Pose } from "./M1.js";
import type { AbilityRunner, SkillOutcome } from "./AbilityRunner.js";
import type { AwakeningSystem, AwakenOutcome } from "./Awakening.js";
import type { MovementSystem, HorizontalOverride } from "./Movement.js";
import type { World } from "./World.js";
import type { HitCandidate, HitResult } from "./HitResolver.js";
import { locomotionLocked, intentsSuppressed } from "./ActionMachine.js";

/** The part of a room seat the pipeline needs. */
export interface PipelineSeat {
  entityId: number;
  input: InputChannel;
}

export interface TickPipelineDeps {
  state: ArenaState;
  combat: CombatSystem;
  m1: M1System;
  abilities: AbilityRunner;
  awakening: AwakeningSystem;
  movement: () => MovementSystem | null;
  world: () => World | null;
  seats: () => ReadonlyMap<string, PipelineSeat>;
  poseOf: (id: number) => M1Pose | undefined;
  sendActionResult: (sessionId: string, seat: PipelineSeat, edgeId: number, seq: number, tick: number, accepted: boolean,
    reason?: ActionResult["reason"], castId?: string) => void;
  broadcastEvent: (tick: number, kind: CombatEvent["kind"], actor: number, target: number | undefined,
    lifeId: number, moveId?: string, damage100?: number) => void;
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

  constructor(private readonly d: TickPipelineDeps) {}

  step(tick: number): void {
    const mv = this.d.movement();
    this.expire(tick);
    this.drainIntents();
    this.leaseClear(tick);
    this.actionTransitions(tick);
    this.locomotion(tick);
    if (mv) {
      this.queries(tick);
      if (this.candidates.length > 0) {
        this.resolve(tick);
        this.afterHits(tick);
        this.deathsAndRespawns(tick);
      }
      this.publish(tick);
    }
    this.d.state.serverTick = tick;
    this.scratch.clear();
    this.intents.clear();
    this.candidates = [];
    this.results = [];
  }

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
  }

  private grounded(id: number): boolean {
    return this.d.movement()?.get(id)?.state.grounded ?? false;
  }

  /** Expiries before input intents. */
  private expire(tick: number): void {
    this.d.combat.expire(tick, (id) => this.grounded(id));
    this.d.awakening.update(tick);
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
        } else if (q.edge.kind === "jump") jumpPressed = true;
        // skillUp: press moves ignore the release; holdRelease moves arrive with T19. awaken: T14.
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
      // running is suppressed (T12, sv.b2 moveScale 0.15). turnRate facing lock is not enforced yet.
      const scaled = castScale !== null && castScale > 0 && castScale < 1 && f !== undefined && f.action !== "Idle";
      const mScale = scaled ? castScale : 1;
      this.intents.set(seat.entityId, locked ? NEUTRAL_MOVE
        : { moveX: h.moveX * mScale, moveZ: h.moveZ * mScale, run: scaled ? false : h.runHeld, guard: f?.action === "Guard" || h.blockHeld, jumpPressed: sc.jumpPressed });
    }
    this.d.movement()?.step(tick, (id) => this.intents.get(id) ?? NEUTRAL_MOVE, (id) => this.dashOverride(id));
  }

  /** Collision queries for M1 swings, abilities and awakening at the current server poses (spec 12/13). */
  private queries(tick: number): void {
    const w = this.d.world();
    const pose = (id: number): M1Pose | undefined => this.d.poseOf(id);
    this.candidates = [
      ...this.d.m1.candidates(tick, this.d.combat.all(), pose,
        (a, t) => !!w && w.segmentBlocked([a.x, a.y, a.z], [t.x, t.y, t.z])),
      ...this.d.abilities.collect(tick),
      ...this.d.awakening.collect(tick),
    ];
  }

  private resolve(tick: number): void {
    this.results = this.d.combat.resolve(tick, this.candidates, (id) => {
      const q = this.d.poseOf(id);
      return q && { x: q.x, z: q.z, facingYaw: q.facingYaw, grounded: q.grounded };
    });
  }

  /** Handler results, awakening meter and launches. */
  private afterHits(tick: number): void {
    const { combat, m1, abilities, awakening } = this.d;
    const results = this.results;
    abilities.afterResolve(tick, results);
    awakening.gain(results);
    const launches = [...m1.launches(tick, results, (id) => combat.get(id), (id) => this.d.poseOf(id)), ...abilities.launches(tick, results)];
    for (const l of launches) {
      const b = this.d.movement()?.get(l.targetId);
      if (!b) continue;
      b.state.vx = l.vx; b.state.vz = l.vz; b.state.vy = l.vy;
      if (l.vy > 0) b.state.grounded = false;
    }
  }

  /** Hit and KO events in result order. Respawns are not implemented yet (T17). */
  private deathsAndRespawns(tick: number): void {
    for (const r of this.results) this.reportHit(tick, r);
  }

  private publish(tick: number): void {
    for (const seat of this.d.seats().values()) { this.publishBody(seat.entityId); this.publishAction(seat.entityId); this.publishOwner(seat, tick); }
  }

  private reportHit(tick: number, r: HitResult): void {
    const { combat, m1, abilities, awakening } = this.d;
    const c = r.candidate;
    const victim = combat.get(c.targetId);
    const kind: CombatEvent["kind"] | null = r.outcome === "hit" ? "hit" : r.outcome === "blocked" ? "block"
      : r.outcome === "countered" ? "counter" : null;
    if (kind && victim) this.d.broadcastEvent(tick, kind, c.attackerId, c.targetId, victim.lifeId, c.moveId, r.damage100);
    else if (r.outcome === "captured" && victim) this.d.broadcastEvent(tick, "capture", c.attackerId, c.targetId, victim.lifeId, c.moveId, r.damage100);
    if (r.killed && victim) {
      m1.reset(c.targetId);
      abilities.reset(c.targetId);
      awakening.reset(c.targetId);
      // Death resets held inputs (spec 11): neutralize the victim's input channel.
      for (const seat of this.d.seats().values()) if (seat.entityId === c.targetId) seat.input.neutralize();
      this.d.broadcastEvent(tick, "ko", c.attackerId, c.targetId, victim.lifeId, c.moveId);
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

  private dashOverride(id: number): HorizontalOverride | null {
    const d = this.d.combat.get(id)?.dash;
    return d ? { vx: d.dirX * d.speed, vz: d.dirZ * d.speed } : null;
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
    o.evasiveEndTick = Math.min(f?.cooldowns.get("evasive") ?? 0, 0xffffffff);
    o.lethalCounterRemaining = f ? Math.max(0, Math.min(0xffff, f.lethalCounterUntil - tick)) : 0;
  }
}
