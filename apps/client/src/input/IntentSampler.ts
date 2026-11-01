/**
 * Builds one strict InputPacket per fixed 60 Hz sample tick from the router state.
 * Packets are validated with the shared protocol parser before they leave the client.
 * Never contains damage, hit or target claims.
 */
import { MAX_EDGES_PER_PACKET, parseInputPacket, type Edge, type InputPacket } from "@eb/shared";
import type { LocalEdge, PointerRouter } from "./PointerRouter.js";
import { cameraRelativeToWorld } from "../scene/CameraRig.js";

export class IntentSampler {
  private seq = 0;
  private edgeId = 0;
  private pending: Edge[] = [];

  constructor(private readonly router: PointerRouter, public epoch = 0) {}

  /** Resync starts a new epoch; queued edges from the old epoch are discarded. */
  setEpoch(epoch: number): void {
    this.epoch = epoch;
    this.pending = [];
  }

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
      runHeld: false, // auto run is decided by the server from move magnitude (section 13)
      chargeHeldSlot: r.chargeHeldSlot,
      edges,
    };
    return parseInputPacket(raw);
  }

  /** Neutral packet sent immediately on cancel; carries no edges. */
  neutral(sampleTick: number): InputPacket | null {
    return parseInputPacket({
      v: 1, epoch: this.epoch, seq: ++this.seq >>> 0, sampleTick: sampleTick >>> 0,
      moveX: 0, moveZ: 0, yaw: this.router.yaw, pitch: this.router.pitch,
      attackHeld: false, blockHeld: false, jumpHeld: false, runHeld: false, chargeHeldSlot: 0, edges: [],
    });
  }
}
