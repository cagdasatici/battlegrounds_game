import { describe, expect, test } from "vitest";
import { BLOCK_DRILL, DrillTracker, type ResolvedHitSummary } from "../../apps/server/src/sim/PracticeDrills.js";

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
