/**
 * Remote presentation buffer (spec section 22): render 100 ms behind the newest estimate, interpolate
 * position and shortest path yaw, extrapolate at most 100 ms with last velocity, then freeze and flag
 * connection uncertainty. Presentation only; never drives damage or hit detection.
 */
import { TICK_RATE } from "@eb/shared/protocol";

export const SNAPSHOT = { delayMs: 100, maxExtrapolateMs: 100, capacity: 32 } as const;
const TICKS_PER_MS = TICK_RATE / 1000;

export interface RemoteSnapshot { tick: number; x: number; y: number; z: number; vx: number; vy: number; vz: number; yaw: number }
export interface RemoteSample { x: number; y: number; z: number; yaw: number; uncertain: boolean }

export function lerpAngle(a: number, b: number, t: number): number {
  const d = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + d * t;
}

export class SnapshotBuffer {
  private items: RemoteSnapshot[] = [];

  push(s: RemoteSnapshot): void {
    const last = this.items[this.items.length - 1];
    if (last && s.tick <= last.tick) return; // out of order or duplicate
    this.items.push(s);
    if (this.items.length > SNAPSHOT.capacity) this.items.shift();
  }

  clear(): void { this.items = []; }
  get size(): number { return this.items.length; }

  /** Samples at estimated server tick `nowTick` minus the 100 ms interpolation delay. */
  sample(nowTick: number): RemoteSample | null {
    const n = this.items.length;
    if (n === 0) return null;
    const t = nowTick - SNAPSHOT.delayMs * TICKS_PER_MS;
    const first = this.items[0]!;
    if (t <= first.tick) return { x: first.x, y: first.y, z: first.z, yaw: first.yaw, uncertain: false };
    for (let i = 1; i < n; i++) {
      const b = this.items[i]!;
      if (t <= b.tick) {
        const a = this.items[i - 1]!;
        const k = (t - a.tick) / (b.tick - a.tick);
        return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k, yaw: lerpAngle(a.yaw, b.yaw, k), uncertain: false };
      }
    }
    const last = this.items[n - 1]!;
    const maxTicks = SNAPSHOT.maxExtrapolateMs * TICKS_PER_MS;
    const ahead = t - last.tick;
    const e = Math.min(ahead, maxTicks) / TICK_RATE; // seconds
    return { x: last.x + last.vx * e, y: last.y + last.vy * e, z: last.z + last.vz * e, yaw: last.yaw, uncertain: ahead > maxTicks };
  }
}
