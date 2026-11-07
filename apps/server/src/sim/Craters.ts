import { CRATER } from "@eb/shared/config/beast";
import { quantizeCm } from "@eb/shared/schema";
import type { CraterSchema } from "../state/ArenaSchema.js";
import { CraterSchema as Crater } from "../state/ArenaSchema.js";
import type { ArraySchema } from "@colyseus/schema";

/**
 * BEAST02: the live crater list. Integer tick lifetimes; oldest are dropped when `maxLive` is exceeded; everything is
 * removed on clear (round reset) and dispose. `onGround` lets the room refuse a centre that is over the void.
 */
export class CraterSystem {
  private seq = 0;
  constructor(private readonly out: ArraySchema<CraterSchema>, private readonly onGround: (x: number, z: number) => boolean) {}

  add(x: number, z: number, radius: number, tick: number): boolean {
    if (!(radius > 0) || !Number.isFinite(x + z) || !this.onGround(x, z)) return false;
    const c = new Crater();
    c.id = ++this.seq & 0xffff; c.x = quantizeCm(x); c.z = quantizeCm(z); c.radius100 = Math.min(0xffff, quantizeCm(radius)); c.startTick = tick;
    this.out.push(c);
    while (this.out.length > CRATER.maxLive) this.out.shift();
    return true;
  }

  /** Drops fully healed craters. */
  update(tick: number): void {
    for (let i = this.out.length - 1; i >= 0; i--) if (tick - this.out[i]!.startTick >= CRATER.healTicks) this.out.splice(i, 1);
  }

  clear(): void { this.out.clear(); }
  get size(): number { return this.out.length; }
}
