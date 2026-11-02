import { RATE_LIMITS, parseInputPacket, type Edge, type InputPacket } from "@eb/shared/protocol";
import { clamp } from "@eb/shared/math";
import { TokenBucket } from "./RateLimits.js";

export interface HeldIntent {
  moveX: number; moveZ: number; yaw: number; pitch: number;
  attackHeld: boolean; blockHeld: boolean; jumpHeld: boolean; runHeld: boolean;
  facingLock?: boolean;
  chargeHeldSlot: 0 | 1 | 2 | 3 | 4;
}
export interface QueuedEdge { edge: Edge; arrivalTick: number; seq: number }

/** Per-player input channel state. Identity comes from the authenticated client, never from the packet. */
export class InputChannel {
  epoch = 1;
  lastReceivedSeq = 0;
  lastEdgeId = 0;
  lastInputTick = 0;
  /** Client sampleTick of the last accepted packet (replay anchor for prediction, T08). */
  lastSampleTick = 0;
  held: HeldIntent = neutralIntent();
  queue: QueuedEdge[] = [];
  /** edge id -> seq of the carrying packet, bounded; lets buffered edges be answered with the right seq. */
  private edgeSeqs = new Map<number, number>();
  private packets: TokenBucket;
  private edges: TokenBucket;

  constructor(nowMs: number) {
    this.packets = new TokenBucket(RATE_LIMITS.inputPerSecond, RATE_LIMITS.inputBurst, nowMs);
    this.edges = new TokenBucket(RATE_LIMITS.edgesPerSecond, RATE_LIMITS.edgeBurst, nowMs);
  }

  /** New epoch (reconnect): reset counters, drop queued edges and holds. */
  renewEpoch(nowMs: number): number {
    this.epoch += 1;
    this.lastReceivedSeq = 0;
    this.lastSampleTick = 0;
    this.lastEdgeId = 0;
    this.queue = [];
    this.edgeSeqs.clear();
    this.held = neutralIntent();
    this.packets = new TokenBucket(RATE_LIMITS.inputPerSecond, RATE_LIMITS.inputBurst, nowMs);
    this.edges = new TokenBucket(RATE_LIMITS.edgesPerSecond, RATE_LIMITS.edgeBurst, nowMs);
    return this.epoch;
  }

  neutralize(): void {
    this.held = neutralIntent();
    this.queue = [];
  }

  /** Returns the reason for rejection, or null if accepted. Never throws on hostile input. */
  accept(raw: unknown, tick: number, nowMs: number): string | null {
    const p: InputPacket | null = parseInputPacket(raw);
    if (!p) return "MALFORMED";
    if (p.epoch !== this.epoch) return "STALE_EPOCH";
    if (p.seq <= this.lastReceivedSeq) return "OLD_SEQ";
    if (!this.packets.take(nowMs)) return "RATE_LIMIT";
    for (const e of p.edges) {
      if (e.id > this.lastEdgeId) {
        if (!this.edges.take(nowMs)) break; // excess edges are dropped, not queued
        this.queue.push({ edge: e, arrivalTick: tick, seq: p.seq });
        this.edgeSeqs.set(e.id, p.seq);
        if (this.edgeSeqs.size > 256) this.edgeSeqs.delete(this.edgeSeqs.keys().next().value as number);
        this.lastEdgeId = e.id;
      }
    }
    const len = Math.hypot(p.moveX, p.moveZ);
    const k = len > 1 ? 1 / len : 1;
    this.held = {
      moveX: p.moveX * k, moveZ: p.moveZ * k, yaw: p.yaw, pitch: clamp(p.pitch, -Math.PI / 2, Math.PI / 2),
      attackHeld: p.attackHeld, blockHeld: p.blockHeld, jumpHeld: p.jumpHeld, runHeld: p.runHeld,
      chargeHeldSlot: p.chargeHeldSlot, facingLock: p.facingLock === true,
    };
    this.lastReceivedSeq = p.seq;
    this.lastInputTick = tick;
    this.lastSampleTick = p.sampleTick;
    return null;
  }

  /** Clears holds when no fresh packet arrived within `leaseTicks` (spec: 15). */
  expireLease(tick: number, leaseTicks: number): void {
    if (tick - this.lastInputTick > leaseTicks) this.held = neutralIntent();
  }

  /** Seq of the packet that carried this edge; falls back to the latest seq if it aged out. */
  seqOfEdge(edgeId: number): number {
    return this.edgeSeqs.get(edgeId) ?? this.lastReceivedSeq;
  }

  drain(): QueuedEdge[] {
    const q = this.queue;
    this.queue = [];
    return q;
  }
}

export function neutralIntent(): HeldIntent {
  return { moveX: 0, moveZ: 0, yaw: 0, pitch: 0, attackHeld: false, blockHeld: false, jumpHeld: false, runHeld: false, chargeHeldSlot: 0 };
}
