import { describe, expect, test } from "vitest";
import { buildAbilityRegistry, defineAbility, type AbilitySpec } from "../../packages/shared/src/abilities.js";
import { CombatSystem } from "../../apps/server/src/sim/Combat.js";
import { AbilityRunner, MELEE_HANDLER, type AbilityPose, type SkillOutcome } from "../../apps/server/src/sim/AbilityRunner.js";
import { M1System, type M1Pose } from "../../apps/server/src/sim/M1.js";
import { OffensiveBuffer } from "../../apps/server/src/sim/OffensiveBuffer.js";

const T0 = 1000;
const spec = (id: string): AbilitySpec => ({
  id, label: "T", handler: "melee", startup: 2, active: 2, recovery: 10, cooldown: 0, damage100: [1000], range: 2, block: "B",
});

/** Fighter 1 with the shared buffer, stepped in the pipeline order: expiry, buffered skill, skill press, M1. */
function rig() {
  const buffer = new OffensiveBuffer();
  const registry = buildAbilityRegistry([defineAbility(spec("sv.b1")), defineAbility(spec("sv.b2"))], new Set(["melee"]));
  const cs = new CombatSystem();
  cs.add(1, 1, 0).protectedUntilTick = 0;
  const pose: AbilityPose & M1Pose = { x: 0, y: 1, z: 0, facingYaw: 0, grounded: true };
  const runner = new AbilityRunner(registry, [MELEE_HANDLER], { combat: cs, pose: () => pose, blocked: () => false }, buffer);
  const m1 = new M1System(buffer);
  runner.setKit(1, "sv");
  const commits: { tick: number; what: string }[] = [];
  const answers: { tick: number; edgeId: number; kind: string; reason?: string }[] = [];
  const step = (tick: number, o: { skill?: 1 | 2; edge?: number; attack?: boolean } = {}) => {
    cs.expire(tick, () => true);
    const f = cs.get(1)!;
    const b = runner.consumeBuffer(f, tick);
    if (b) {
      answers.push({ tick, edgeId: b.edgeId, kind: b.outcome.kind, ...(b.outcome.kind === "rejected" ? { reason: b.outcome.reason } : {}) });
      if (b.outcome.kind === "started") commits.push({ tick, what: b.outcome.moveId });
    }
    if (o.skill) {
      const r: SkillOutcome = runner.skillDown(f, tick, o.skill, o.edge ?? 1);
      if (r.kind === "started") commits.push({ tick, what: r.moveId });
      else if (r.kind === "rejected") answers.push({ tick, edgeId: o.edge ?? 1, kind: "rejected", reason: r.reason });
    }
    const held = { attackHeld: o.attack ?? false, blockHeld: false, jumpHeld: false };
    const r = m1.update(f, tick, held, pose);
    if (r?.ok) commits.push({ tick, what: f.moveId });
    for (const lost of buffer.drainRejected()) answers.push({ tick, edgeId: lost.edgeId, kind: "rejected", reason: "STATE" });
  };
  /** Start an M1 at T0 (ends T0+21 with startup 8, active 3, recovery 10). */
  const startBusy = () => { step(T0, { attack: true }); for (let t = T0 + 1; t < T0 + 8; t++) step(t); };
  return { buffer, step, commits, answers, startBusy, cs };
}

describe("R03 one offensive buffer", () => {
  test("during recovery, skill press at t then attack press at t+2: only M1 commits", () => {
    const r = rig();
    r.startBusy();
    for (let t = T0 + 8; t < T0 + 15; t++) r.step(t);
    r.step(T0 + 15, { skill: 1, edge: 7 });
    r.step(T0 + 16);
    r.step(T0 + 17, { attack: true });
    for (let t = T0 + 18; t <= T0 + 24; t++) r.step(t);
    expect(r.commits.map((c) => c.what)).toEqual(["m1.1", "m1.2"]);
    expect(r.answers).toEqual([{ tick: T0 + 17, edgeId: 7, kind: "rejected", reason: "STATE" }]);
    expect(r.cs.get(1)!.cooldowns.has("sv.b1")).toBe(false);
  });

  test("reverse order: attack press at t then skill press at t+2: only the skill commits", () => {
    const r = rig();
    r.startBusy();
    for (let t = T0 + 8; t < T0 + 15; t++) r.step(t);
    r.step(T0 + 15, { attack: true });
    r.step(T0 + 16);
    r.step(T0 + 17, { skill: 2, edge: 9 });
    for (let t = T0 + 18; t <= T0 + 24; t++) r.step(t);
    expect(r.commits.map((c) => c.what)).toEqual(["m1.1", "sv.b2"]);
    expect(r.answers.filter((a) => a.kind === "rejected")).toEqual([]);
  });

  test("same tick: the skill wins", () => {
    const r = rig();
    r.startBusy();
    for (let t = T0 + 8; t < T0 + 15; t++) r.step(t);
    r.step(T0 + 15, { skill: 1, edge: 3, attack: true });
    for (let t = T0 + 16; t <= T0 + 24; t++) r.step(t);
    expect(r.commits.map((c) => c.what)).toEqual(["m1.1", "sv.b1"]);
    expect(r.answers.filter((a) => a.kind === "rejected")).toEqual([]);
  });

  test("expiry at exactly 7 ticks drops the entry, 6 ticks still fires", () => {
    const r = rig();
    r.startBusy();
    for (let t = T0 + 8; t < T0 + 14; t++) r.step(t);
    r.step(T0 + 14, { attack: true }); // Idle at T0+21: 7 ticks later
    for (let t = T0 + 15; t <= T0 + 30; t++) r.step(t);
    expect(r.commits.map((c) => c.what)).toEqual(["m1.1"]);
    expect(r.buffer.size).toBe(0);
    const s = rig();
    s.startBusy();
    for (let t = T0 + 8; t < T0 + 15; t++) s.step(t);
    s.step(T0 + 15, { attack: true }); // 6 ticks before Idle
    for (let t = T0 + 16; t <= T0 + 24; t++) s.step(t);
    expect(s.commits.map((c) => c.what)).toEqual(["m1.1", "m1.2"]);
  });

  test("buffer unit: tie keeps lower action number, replace reports the lost skill edge, drop empties", () => {
    const b = new OffensiveBuffer();
    expect(b.set(1, { kind: "skill", slot: 2, edgeId: 1, tick: 5 })).toBeNull();
    expect(b.set(1, { kind: "skill", slot: 1, edgeId: 2, tick: 5 })).toMatchObject({ edgeId: 1 });
    expect(b.set(1, { kind: "skill", slot: 3, edgeId: 3, tick: 5 })).toMatchObject({ edgeId: 3 });
    expect(b.peek(1)).toMatchObject({ slot: 1 });
    expect(b.drainRejected()).toEqual([{ entityId: 1, edgeId: 1 }]);
    b.drop(1);
    expect(b.size).toBe(0);
  });
});
