import { describe, expect, test } from "vitest";
import { SV_DEFS } from "../../packages/shared/src/config/kits/index.js";
import { BLOCK_DRILL, DrillTracker, EVADE_DRILL, inFaultStrikeFootprint, type ResolvedHitSummary } from "../../apps/server/src/sim/PracticeDrills.js";

const P = 1, D = 2, BOT = 3;
const hit = (o: Partial<ResolvedHitSummary> = {}): ResolvedHitSummary =>
  ({ attackerId: P, targetId: D, moveId: "m1.1", outcome: "hit", damage100: 500, ...o });
const running = (): DrillTracker => { const t = new DrillTracker(); t.start("hit", 10); return t; };

describe("GR15a DrillTracker", () => {
  test("idle ignores hits; start runs once; duplicate start changes nothing", () => {
    const t = new DrillTracker();
    expect(t.observe(5, [hit()], P, D)).toBe(false);
    expect(t.start("hit", 10)).toBe(true);
    expect(t.start("hit", 99)).toBe(false);
    expect([t.state, t.startTick, t.drillId]).toEqual(["running", 10, "hit"]);
  });
  test("a valid M1 hit on the dummy completes exactly once", () => {
    const t = running();
    expect(t.observe(20, [hit()], P, D)).toBe(true);
    expect([t.state, t.successTick]).toEqual(["success", 20]);
    expect(t.observe(30, [hit()], P, D)).toBe(false);
    expect(t.successTick).toBe(20);
  });
  test.each([
    ["miss/absent", []],
    ["blocked", [hit({ outcome: "blocked" })]],
    ["countered", [hit({ outcome: "countered" })]],
    ["zero damage", [hit({ damage100: 0 })]],
    ["cast (not M1)", [hit({ moveId: "sv.b1" })]],
    ["hit on a bot", [hit({ targetId: BOT })]],
    ["dummy hit by someone else", [hit({ attackerId: BOT })]],
    ["duplicate outcome", [hit({ outcome: "duplicate" })]],
  ])("%s does not complete", (_n, hits) => {
    const t = running();
    expect(t.observe(20, hits as ResolvedHitSummary[], P, D)).toBe(false);
    expect(t.state).toBe("running");
  });
  test("retry restarts, exit clears, retry from idle is refused", () => {
    const t = running();
    t.observe(20, [hit()], P, D);
    expect(t.retry(40)).toBe(true);
    expect([t.state, t.startTick, t.successTick]).toEqual(["running", 40, 0]);
    expect(t.exit()).toBe(true);
    expect([t.state, t.drillId]).toEqual(["idle", ""]);
    expect(t.retry(50)).toBe(false);
    expect(t.exit()).toBe(false);
    expect(t.observe(60, [hit()], P, D)).toBe(false);
  });
});

describe("GR15b block lesson tracker", () => {
  const blocked = (o: Partial<ResolvedHitSummary> = {}): ResolvedHitSummary =>
    ({ attackerId: D, targetId: P, moveId: "m1.1", outcome: "blocked", damage100: 0, ...o });
  const blockRun = (): DrillTracker => { const t = new DrillTracker(); t.start("block", 10); return t; };
  test("a dummy M1 blocked by the player completes once", () => {
    const t = blockRun();
    expect(t.observe(200, [blocked()], P, D)).toBe(true);
    expect([t.state, t.successTick]).toEqual(["success", 200]);
    expect(t.observe(300, [blocked()], P, D)).toBe(false);
  });
  test.each([
    ["unguarded hit (wrong facing / before guard startup)", [blocked({ outcome: "hit", damage100: 300 })]],
    ["countered", [blocked({ outcome: "countered" })]],
    ["captured", [blocked({ outcome: "captured" })]],
    ["player's own blocked result (wrong direction)", [blocked({ attackerId: P, targetId: D })]],
    ["bot attacker", [blocked({ attackerId: 9 })]],
    ["non-M1 move", [blocked({ moveId: "sv.b1" })]],
    ["nothing resolved", []],
  ])("%s does not complete", (_n, hits) => {
    const t = blockRun();
    expect(t.observe(200, hits as ResolvedHitSummary[], P, D)).toBe(false);
    expect(t.state).toBe("running");
  });
  test("a hit-lesson result never completes a block lesson and vice versa", () => {
    const b = blockRun();
    expect(b.observe(20, [hit()], P, D)).toBe(false);
    const h = running();
    expect(h.observe(20, [blocked()], P, D)).toBe(false);
  });
  test("attack schedule is integer ticks: first after prep, then every period; none when idle, succeeded or exited", () => {
    const t = blockRun();
    const due = (from: number, to: number): number[] => { const o: number[] = []; for (let k = from; k <= to; k++) if (t.attackDue(k)) o.push(k); return o; };
    const first = 10 + BLOCK_DRILL.prepTicks;
    expect(BLOCK_DRILL).toEqual({ prepTicks: 120, periodTicks: 180 });
    expect(due(0, 600)).toEqual([first, first + 180, first + 360]);
    t.retry(1000);
    expect(due(1000, 1119)).toEqual([]);
    expect(t.attackDue(1120)).toBe(true);
    t.observe(1130, [blocked()], P, D);
    expect(due(1130, 1600)).toEqual([]); // stops after success
    t.retry(2000);
    t.exit();
    expect(due(2000, 2700)).toEqual([]); // stops after exit
    const h = running();
    expect(h.attackDue(130)).toBe(false); // the hit lesson has no dummy attacks
  });
});

describe("GR15c evade lesson tracker", () => {
  const cast = { castCounter: 1, activeStart: 144, activeEnd: 148 };
  const touch = (o: Partial<ResolvedHitSummary> = {}): ResolvedHitSummary =>
    ({ attackerId: D, targetId: P, moveId: "sv.b1", outcome: "hit", damage100: 2000, ...o });
  const trial = (): DrillTracker => { const t = new DrillTracker(); t.start("evade", 10); return t; };
  const drive = (t: DrillTracker, o: { inside?: boolean; outside?: boolean; clean?: boolean; hits?: ResolvedHitSummary[] }): string | null => {
    t.evadeBind(cast, o.inside ?? true);
    let r: string | null = null;
    for (let k = cast.activeStart; k < cast.activeEnd; k++) {
      t.evadeNote(k, k === cast.activeStart ? (o.hits ?? []) : [], P, D);
      r = t.evadeStep(k, o.outside ?? true, o.clean ?? true) ?? r;
    }
    return r;
  };
  test("cast is due exactly once at preparation tick + 120", () => {
    const t = trial();
    expect(EVADE_DRILL.prepTicks).toBe(120);
    const due: number[] = []; for (let k = 0; k < 400; k++) if (t.evadeCastDue(k)) due.push(k);
    expect(due).toEqual([130]);
    t.evadeBind(cast, true);
    expect(t.evadeCastDue(130)).toBe(false);
    expect(new DrillTracker().evadeCastDue(130)).toBe(false);
  });
  test("starting inside and leaving all footprints with no result passes once", () => {
    const t = trial();
    expect(drive(t, {})).toBe("success");
    expect([t.state, t.successTick]).toEqual(["success", 147]);
    expect(t.evadeStep(148, true, true)).toBeNull();
  });
  test.each([
    ["stationary hit", { outside: false, hits: [touch()] }],
    ["stationary but no result (still inside)", { outside: false }],
    ["started outside the footprint", { inside: false }],
    ["guarded (blocked)", { outside: false, hits: [touch({ outcome: "blocked", damage100: 0 })] }],
    ["countered", { hits: [touch({ outcome: "countered", damage100: 0 })] }],
    ["captured", { hits: [touch({ outcome: "captured", damage100: 0 })] }],
    ["protected", { hits: [touch({ outcome: "protected", damage100: 0 })] }],
    ["invulnerable", { hits: [touch({ outcome: "invulnerable", damage100: 0 })] }],
    ["protection active (not clean)", { clean: false }],
  ])("%s fails and shows failure state", (_n, o) => {
    const t = trial();
    expect(drive(t, o)).toBe("failed");
    expect(t.state).toBe("failed");
    expect(t.successTick).toBe(0);
  });
  test("results from other attackers or moves are not this cast", () => {
    const t = trial();
    expect(drive(t, { hits: [touch({ attackerId: 9 }), touch({ moveId: "m1.1" })] })).toBe("success");
  });
  test("death, leave or kit change voids the trial: no result, Retry still available", () => {
    const t = trial();
    t.evadeBind(cast, true);
    t.evadeVoid();
    for (let k = 144; k < 150; k++) expect(t.evadeStep(k, true, true)).toBeNull();
    expect(t.state).toBe("running");
    expect(t.retry(500)).toBe(true);
    expect(t.trial?.phase).toBe("wait");
  });
  test("retry builds a fresh trial with fresh cast identity; exit clears it", () => {
    const t = trial();
    drive(t, { outside: false });
    const old = t.trial;
    expect(t.retry(300)).toBe(true);
    expect(t.trial).not.toBe(old);
    expect([t.state, t.trial?.castCounter, t.trial?.phase]).toEqual(["running", 0, "wait"]);
    expect(t.evadeCastDue(420)).toBe(true);
    t.evadeBind({ castCounter: 2, activeStart: 444, activeEnd: 448 }, true);
    expect(t.trial?.castCounter).toBe(2);
    expect(t.exit()).toBe(true);
    expect(t.trial).toBeNull();
  });
  test("other lessons never create a trial or evade results", () => {
    const h = running();
    expect(h.trial).toBeNull();
    expect(h.evadeBind(cast, true)).toBe(false);
    expect(trial().observe(20, [hit()], P, D)).toBe(false);
  });
  test("footprint helper uses the ability's geometry: 2 m ahead is inside, 3 m to the side is outside, wave skips ragdolled", () => {
    const def = SV_DEFS.find((d) => d.id === "sv.b1")!;
    const at = (x: number, z: number) => ({ x, y: 0.9, z, facingYaw: 0, grounded: true });
    const dummy = at(0, 0);
    expect(inFaultStrikeFootprint(def, Math.PI, dummy, at(0, 2), false)).toBe(true); // facing +z
    expect(inFaultStrikeFootprint(def, Math.PI, dummy, at(3, 2), false)).toBe(false);
    expect(inFaultStrikeFootprint(def, Math.PI, dummy, at(0, -2), false)).toBe(false); // behind
    expect(inFaultStrikeFootprint(def, Math.PI, dummy, at(0, 6), false)).toBe(true); // wave reaches 8 m
    expect(inFaultStrikeFootprint(def, Math.PI, dummy, at(0, 6), true)).toBe(false); // ragdolled: not in the wave
  });
});
