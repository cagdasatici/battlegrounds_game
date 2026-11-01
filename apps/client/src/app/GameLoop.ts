/**
 * Client frame loop (T18b, spec sections 8, 9, 22). One requestAnimationFrame callback:
 *   1. clock.frame(), ping at most once per second (wall time only);
 *   2. read replicated state: create/remove fighter views, feed remote SnapshotBuffers, reconcile the owner;
 *   3. step local Prediction once per estimated server tick (60 Hz, integer ticks, never from render dt), sampling
 *      intent from the Pointer/Keyboard routers and sending validated packets at 30 Hz (edges and digital changes
 *      immediately, inside the server's rate bucket);
 *   4. move the camera and render.
 * Render timing never schedules damage: the loop sends intent only and predicts locomotion only.
 */
import { fromCm, fromYaw } from "@eb/shared/schema";
import type { Action } from "@eb/shared/schema";
import { NEUTRAL_MOVE, type MoveIntent } from "@eb/shared/movement";
import { RATE_LIMITS, type InputPacket, type KitId } from "@eb/shared/protocol";
import type { IntentSampler } from "../input/IntentSampler.js";
import type { PointerRouter } from "../input/PointerRouter.js";
import { Prediction, type Collide, type Correction, type OwnerSnapshot } from "../net/Prediction.js";
import type { ClockSync } from "../net/ClockSync.js";
import type { CameraRig } from "../scene/CameraRig.js";
import type { GameScene } from "../scene/GameScene.js";

/** Replicated public record, as read from room.state.players (centimetres, quantized yaw). */
export interface LoopPlayer {
  entityId: number;
  displayName: string;
  kitId: string;
  lifeId: number;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  facingYaw: number;
  hp100: number;
  meter100?: number;
  moveId?: string;
  ready?: boolean;
  action: Action;
  /** Present only on the local player (owner-only view, decision 0007). */
  owner?: { ackInputTick: number; epoch: number } | undefined;
}
export interface LoopState { serverTick: number; players: Iterable<[string, LoopPlayer]> }

export interface LoopDeps {
  scene: GameScene;
  camera: CameraRig;
  collide: Collide;
  router: PointerRouter;
  sampler: IntentSampler;
  clock: ClockSync;
  readState(): LoopState | null;
  sendInput(p: InputPacket): void;
  sendPing(p: { nonce: number; clientMs: number }): void;
  raf?: (cb: (ms: number) => void) => number;
  caf?: (id: number) => void;
  now?: () => number;
}

const PING_INTERVAL_MS = 1000;
const MAX_CATCHUP_TICKS = 8;
const RESYNC_TICKS = 30;
const SEND_EVERY_TICKS = 2; // 30 Hz

const toKit = (k: string): KitId => (k === "td" || k === "ea" ? k : "sv");

export class GameLoop {
  prediction: Prediction | null = null;
  localEntityId: number | null = null;
  reconcileCount = 0;
  readonly correctionCounts: Record<Correction, number> = { none: 0, small: 0, medium: 0, snap: 0, suspended: 0 };

  private readonly raf: (cb: (ms: number) => void) => number;
  private readonly caf: (id: number) => void;
  private readonly now: () => number;
  private rafId: number | null = null;
  private running = false;
  private disposed = false;
  private lastFrameMs: number | null = null;
  private lastPingMs = -Infinity;
  private lastTick: number | null = null;
  private lastSentTick = -Infinity;
  private heldIntent: MoveIntent = NEUTRAL_MOVE;
  private heldSample = 0;
  private lastSig = "";
  private lastSeenServerTick = -1;
  private lastAck = 0;
  private lastLife = -1;
  private lastAction: Action = "Idle";
  private tokens: number = RATE_LIMITS.inputBurst;
  private tokenMs = 0;
  private readonly known = new Set<string>();

  constructor(private readonly d: LoopDeps) {
    this.raf = d.raf ?? ((cb) => requestAnimationFrame(cb));
    this.caf = d.caf ?? ((id) => cancelAnimationFrame(id));
    this.now = d.now ?? (() => performance.now());
  }

  start(): void {
    if (this.running || this.disposed) return;
    this.running = true;
    const tick = (ms: number): void => {
      if (!this.running) return;
      this.frame(ms);
      if (this.running) this.rafId = this.raf(tick);
    };
    this.rafId = this.raf(tick);
  }

  /** Stops the frame callback and removes every fighter view. Idempotent. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.running = false;
    if (this.rafId !== null) this.caf(this.rafId);
    this.rafId = null;
    for (const id of this.known) this.d.scene.removeFighter(id);
    this.known.clear();
    this.prediction = null;
  }

  /** Drops prediction history (new epoch after a resync) so old-epoch input is never replayed. */
  resetPrediction(): void {
    this.prediction = null;
    this.lastTick = null;
    this.lastAck = 0;
    this.lastSig = "";
  }

  frame(nowMs: number): void {
    if (this.disposed) return;
    const dtSec = this.lastFrameMs === null ? 0 : Math.max(0, (nowMs - this.lastFrameMs) / 1000);
    this.lastFrameMs = nowMs;
    const { clock, scene } = this.d;
    clock.frame();
    if (nowMs - this.lastPingMs >= PING_INTERVAL_MS) {
      this.lastPingMs = nowMs;
      this.d.sendPing(clock.makePing(nowMs));
    }
    const est = clock.serverTick(nowMs);
    const st = this.d.readState();
    if (st) this.syncState(st, est);
    if (est !== null) {
      this.refillTokens(nowMs);
      this.stepLocal(est);
      scene.updateRemotes(est);
    }
    this.present(dtSec);
    scene.render();
  }

  // ---- replicated state -------------------------------------------------------------------------------

  private syncState(st: LoopState, est: number | null): void {
    const seen = new Set<string>();
    const newTick = st.serverTick !== this.lastSeenServerTick;
    for (const [key, p] of st.players) {
      seen.add(key);
      if (!this.known.has(key)) {
        this.d.scene.addFighter(key, toKit(p.kitId));
        this.known.add(key);
      }
      if (p.owner !== undefined) {
        this.syncLocal(key, p, st.serverTick, est);
      } else if (newTick) {
        this.d.scene.bufferFor(key)?.push({
          tick: st.serverTick, x: fromCm(p.x), y: fromCm(p.y), z: fromCm(p.z),
          vx: fromCm(p.vx), vy: fromCm(p.vy), vz: fromCm(p.vz), yaw: fromYaw(p.facingYaw),
        });
      }
      this.d.scene.viewFor(key)?.setAction(p.action);
    }
    for (const key of [...this.known]) {
      if (seen.has(key)) continue;
      this.d.scene.removeFighter(key);
      this.known.delete(key);
      if (this.localEntityId !== null && String(this.localEntityId) === key) this.resetPrediction();
    }
    this.lastSeenServerTick = st.serverTick;
  }

  private syncLocal(key: string, p: LoopPlayer, serverTick: number, est: number | null): void {
    this.localEntityId = p.entityId;
    const pos = { x: fromCm(p.x), y: fromCm(p.y), z: fromCm(p.z) };
    if (this.prediction === null) {
      this.prediction = new Prediction(this.d.collide, pos, fromYaw(p.facingYaw));
      this.lastLife = p.lifeId;
      this.lastAction = p.action;
      this.lastAck = p.owner?.ackInputTick ?? 0;
      return;
    }
    const ack = p.owner?.ackInputTick ?? 0;
    const lifeChanged = p.lifeId !== this.lastLife;
    const actionChanged = p.action !== this.lastAction;
    const fresh = serverTick !== this.lastSeenServerTick;
    const acked = ack > this.lastAck;
    if (fresh && (acked || lifeChanged || actionChanged)) {
      this.reconcileCount++;
      const snap: OwnerSnapshot = {
        serverTick, ...pos,
        vx: fromCm(p.vx), vy: fromCm(p.vy), vz: fromCm(p.vz), facingYaw: fromYaw(p.facingYaw), action: p.action,
      };
      if (ack > 0) snap.ackInputTick = ack;
      const c = this.prediction.reconcile(snap, lifeChanged);
      this.correctionCounts[c]++;
      this.lastAck = Math.max(this.lastAck, ack);
    }
    this.lastLife = p.lifeId;
    this.lastAction = p.action;
    void key; void est;
  }

  // ---- fixed 60 Hz local step -------------------------------------------------------------------------

  private refillTokens(nowMs: number): void {
    if (this.tokenMs === 0) this.tokenMs = nowMs;
    this.tokens = Math.min(RATE_LIMITS.inputBurst, this.tokens + ((nowMs - this.tokenMs) * RATE_LIMITS.inputPerSecond) / 1000);
    this.tokenMs = nowMs;
  }

  private stepLocal(est: number): void {
    const pred = this.prediction;
    if (pred === null) return;
    const target = Math.floor(est);
    if (this.lastTick === null || target - this.lastTick > RESYNC_TICKS) this.lastTick = target - 1;
    let n = 0;
    while (this.lastTick < target && n++ < MAX_CATCHUP_TICKS) {
      this.lastTick++;
      this.stepOne(pred, this.lastTick);
    }
    if (this.lastTick < target - MAX_CATCHUP_TICKS) this.lastTick = target - 1;
  }

  private signature(): string {
    const r = this.d.router;
    const still = r.moveX === 0 && r.moveZ === 0;
    return `${r.held("attack")}|${r.held("block")}|${r.held("jump")}|${r.chargeHeldSlot}|${still}`;
  }

  private stepOne(pred: Prediction, tick: number): void {
    const r = this.d.router;
    const due = tick - this.lastSentTick >= SEND_EVERY_TICKS;
    const urgent = r.hasEdges || this.signature() !== this.lastSig;
    if ((due || urgent) && this.tokens >= 1 && tick > this.lastSentTick) {
      const pkt = this.d.sampler.sample(tick);
      if (pkt) {
        this.tokens -= 1;
        this.d.sendInput(pkt);
        this.lastSentTick = tick;
        this.lastSig = this.signature();
        this.heldSample = tick;
        this.heldIntent = {
          moveX: pkt.moveX, moveZ: pkt.moveZ, run: pkt.runHeld, guard: pkt.blockHeld,
          jumpPressed: pkt.edges.some((e) => e.kind === "jump"),
        };
      }
    }
    pred.step(tick, this.heldIntent, this.heldSample);
  }

  // ---- presentation -------------------------------------------------------------------------------------

  private present(dtSec: number): void {
    const pred = this.prediction;
    if (pred === null || this.localEntityId === null) return;
    const mesh = pred.meshPosition(dtSec * 1000);
    const view = this.d.scene.viewFor(String(this.localEntityId));
    view?.setPose(mesh.x, mesh.y, mesh.z, pred.state.facingYaw);
    const r = this.d.router;
    this.d.scene.setCamera(this.d.camera.update(mesh, r.yaw, r.pitch, dtSec));
  }
}
