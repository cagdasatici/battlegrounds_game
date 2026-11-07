import { describe, expect, test } from "vitest";
import { CombatSystem } from "../../apps/server/src/sim/Combat.js";
import type { HitCandidate } from "../../apps/server/src/sim/HitResolver.js";

const T = 1000;
const cand = (attackerId: number, targetId: number, over: Partial<HitCandidate> = {}): HitCandidate => ({
  attackerId, attackerGeneration: 0, castCounter: 1, hitIndex: 0, toi: 0, targetId, moveId: "ea.b1", originX: 0, originZ: 0,
  block: "B", counterable: false, armorBreak: false, damage100: 500, reaction: { kind: "stun", ticks: 30 }, maxHitsPerTarget: 1, ...over,
});
const rig = () => {
  const cs = new CombatSystem();
  for (const i of [1, 2]) cs.add(i, i, 0, "ea").protectedUntilTick = 0;
  cs.isBot = (id) => id === 1; // 1 = bot, 2 = human
  const poses = { x: 0, z: 0, facingYaw: 0, grounded: true };
  return { cs, hit: (c: HitCandidate) => cs.resolve(T, [c], () => poses)[0]! };
};

describe("COMBAT01 bot attacks never freeze humans", () => {
  test("bot -> human: damage applies, no stun", () => {
    const { cs, hit } = rig();
    expect(hit(cand(1, 2)).outcome).toBe("hit");
    expect(cs.get(2)!.hp100).toBe(10000 - 500);
    expect(cs.get(2)!.action).toBe("Idle");
  });
  test("bot -> human ragdoll: no ragdoll", () => {
    const { cs, hit } = rig();
    hit(cand(1, 2, { reaction: { kind: "ragdoll", ticks: 60 } }));
    expect(cs.get(2)!.action).toBe("Idle");
  });
  test("bot -> human capture: not captured, damage still applies", () => {
    const { cs, hit } = rig();
    const r = hit(cand(1, 2, { capture: { cinematic: false, maxTicks: 60 } }));
    expect(r.outcome).toBe("hit");
    expect(cs.captures.isCaptured(2)).toBe(false);
    expect(cs.get(2)!.hp100).toBe(10000 - 500);
  });
  test("human -> bot: still stunned and damaged", () => {
    const { cs, hit } = rig();
    hit(cand(2, 1));
    expect(cs.get(1)!.action).toBe("Stunned");
    expect(cs.get(1)!.hp100).toBe(10000 - 500);
  });
  test("bot -> bot keeps stun", () => {
    const { cs, hit } = rig();
    cs.isBot = () => true;
    hit(cand(1, 2));
    expect(cs.get(2)!.action).toBe("Stunned");
  });
});
