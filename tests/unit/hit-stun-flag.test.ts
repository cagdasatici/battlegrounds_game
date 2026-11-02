import { afterEach, describe, expect, test } from "vitest";
import { COMBAT, HIT_STUN } from "../../packages/shared/src/config/combat.js";
import { CombatSystem } from "../../apps/server/src/sim/Combat.js";
import { locomotionLocked } from "../../apps/server/src/sim/ActionMachine.js";
import { M1System, type M1Held, type M1Pose } from "../../apps/server/src/sim/M1.js";

const T0 = 1000;
const held = (o: Partial<M1Held> = {}): M1Held => ({ attackHeld: false, blockHeld: false, jumpHeld: false, ...o });
afterEach(() => { HIT_STUN.enabled = false; });

function firstHit() {
  const cs = new CombatSystem();
  const m1 = new M1System();
  for (let i = 1; i <= 2; i++) cs.add(i, i, 0, "sv").protectedUntilTick = 0;
  const poses = new Map<number, M1Pose>([
    [1, { x: 0, y: 1, z: 0, facingYaw: 0, grounded: true }],
    [2, { x: 0, y: 1, z: -1.5, facingYaw: Math.PI, grounded: true }],
  ]);
  let hitTick = -1;
  for (let t = T0; t <= T0 + 8; t++) {
    cs.expire(t, () => true);
    m1.update(cs.get(1)!, t, held({ attackHeld: true }), poses.get(1));
    const cands = m1.candidates(t, cs.all(), (id) => poses.get(id), () => false);
    for (const r of cs.resolve(t, cands, (id) => poses.get(id))) if (r.outcome === "hit") hitTick = t;
  }
  return { cs, hitTick };
}

describe("HIT_STUN flag", () => {
  test("defaults to disabled", () => { expect(HIT_STUN.enabled).toBe(false); });

  test("disabled: hit target takes damage and is free to act on the next tick", () => {
    const { cs, hitTick } = firstHit();
    expect(hitTick).toBeGreaterThan(0);
    const v = cs.get(2)!;
    expect(v.hp100).toBe(10000 - COMBAT.m1.damage[0] * 100);
    expect(v.action).not.toBe("Stunned");
    expect(locomotionLocked(v)).toBe(false);
  });

  test("enabled: legacy stun lock still applies", () => {
    HIT_STUN.enabled = true;
    const { cs } = firstHit();
    const v = cs.get(2)!;
    expect(v.action).toBe("Stunned");
    expect(v.actionEndTick - v.actionStartTick).toBe(COMBAT.m1.stunTicks);
    expect(locomotionLocked(v)).toBe(true);
  });
});
