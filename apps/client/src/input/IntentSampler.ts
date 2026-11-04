/**
 * Builds one strict InputPacket per fixed 60 Hz sample tick from the router state.
 * Packets are validated with the shared protocol parser before they leave the client.
 * Never contains damage, hit or target claims.
 */
import { MAX_EDGES_PER_PACKET, parseInputPacket, type Edge, type InputPacket } from "@eb/shared";
import type { LocalEdge, PointerRouter } from "./PointerRouter.js";
import { cameraRelativeToWorld } from "../scene/CameraRig.js";

export class IntentSampler {
  private run = false;
  private highTicks = 0;
  private lastExcursion = -100;
  private forwardHigh = false;
  private seq = 0;
  private edgeId = 0;
  private pending: Edge[] = [];

  constructor(private readonly router: PointerRouter, public epoch = 0) {}

  /** Resync starts a new epoch; queued edges from the old epoch are discarded. */
  setEpoch(epoch: number): void {
    this.run = false; this.highTicks = 0; this.forwardHigh = false; this.lastExcursion = -100;
    this.epoch = epoch;
    this.pending = [];
  }

  /** GR05: drops queued edges and held-derived state without changing the epoch. */
  reset(): void { this.setEpoch(this.epoch); }

  private toEdge(e: LocalEdge): Edge {
    const id = ++this.edgeId >>> 0;
    return e.kind === "skillDown" || e.kind === "skillUp" ? { id, kind: e.kind, slot: e.slot } : { id, kind: e.kind };
  }

  /** Samples intent for a logical tick. Returns null only if the packet would fail validation. */
  sample(sampleTick: number): InputPacket | null {
    const r = this.router;
    for (const e of r.takeEdges()) this.pending.push(this.toEdge(e));
    const edges = this.pending.splice(0, MAX_EDGES_PER_PACKET);
    const blockHeld = r.held("block");
    // Server treats moveX/moveZ as world space (T06): rotate the camera relative stick by camera yaw.
    const world = cameraRelativeToWorld(r.moveX, r.moveZ, r.yaw);
    const magnitude = Math.hypot(r.moveX, r.moveZ);
    const forward = r.moveZ >= 0.9;
    if (r.autoRun) {
      this.highTicks = magnitude >= 0.9 ? this.highTicks + 1 : 0;
      if (this.highTicks >= 6) this.run = true;
      if (magnitude < 0.75) this.run = false;
    } else {
      if (forward && !this.forwardHigh) { this.run = sampleTick - this.lastExcursion <= 18; this.lastExcursion = sampleTick; }
      if (magnitude < 0.2) this.run = false;
    }
    this.forwardHigh = forward;
    const raw = {
      v: 1 as const,
      epoch: this.epoch,
      seq: ++this.seq >>> 0,
      sampleTick: sampleTick >>> 0,
      moveX: world.x,
      moveZ: world.z,
      yaw: r.yaw,
      pitch: r.pitch,
      // Cannot attack and guard simultaneously: guard wins locally; server re-checks.
      attackHeld: r.held("attack") && !blockHeld,
      blockHeld,
      jumpHeld: r.held("jump"),
      runHeld: this.run && !blockHeld,
      facingLock: r.facingLock,
      chargeHeldSlot: r.chargeHeldSlot,
      edges,
    };
    return parseInputPacket(raw);
  }

  /** Neutral packet sent immediately on cancel; carries no edges. */
  neutral(sampleTick: number): InputPacket | null {
    this.run = false; this.highTicks = 0; this.forwardHigh = false; this.lastExcursion = -100;
    return parseInputPacket({
      v: 1, epoch: this.epoch, seq: ++this.seq >>> 0, sampleTick: sampleTick >>> 0,
      moveX: 0, moveZ: 0, yaw: this.router.yaw, pitch: this.router.pitch,
      attackHeld: false, blockHeld: false, jumpHeld: false, runHeld: false, chargeHeldSlot: 0, edges: [],
    });
  }
}
