// GR15a: server-confirmed "Land a strike" lesson over real Colyseus clients (no mocked callbacks).
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { matchMaker } from "colyseus";
import type { Room } from "@colyseus/sdk";
import { startHarness, loginClient, waitFor, players, freshCode, type Harness } from "../fixtures/harness.js";
import type { InputPacket } from "../../packages/shared/src/protocol.js";
import type { PracticeRoom } from "../../apps/server/src/rooms/PracticeRoom.js";
import type { RoomClient } from "../../apps/client/src/net/RoomClient.js";

let h: Harness;
beforeAll(async () => { h = await startHarness(25713); });
afterAll(async () => { await h.stop(); });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type P = any;
interface Practice { c: RoomClient; room: Room; server: PracticeRoom; me(): P; dummy(): P }

async function joinPractice(name: string): Promise<Practice> {
  const c = await loginClient(h, name);
  const room = await c.join("practice");
  await waitFor(() => c.welcome !== null && players(room).size === 2, 3000, "dummy and player replicated");
  c.send("ready", { kitId: "sv", contentHash: c.localContentHash });
  const me = (): P => [...players(room).values()].find((p: P) => p.owner !== undefined && p.displayName === name);
  const dummy = (): P => [...players(room).values()].find((p: P) => p.displayName === "Practice dummy");
  await waitFor(() => me()?.ready && me().action === "Idle", 3000, "ready");
  const server = matchMaker.getLocalRoomById(room.roomId) as unknown as PracticeRoom;
  await waitFor(() => server.sim.tick > (server.combat.get(me().entityId)?.protectedUntilTick ?? 0) + 2
    && server.movement!.get(me().entityId)!.state.grounded, 4000, "settled");
  return { c, room, server, me, dummy };
}

class Driver {
  private seq = 0; private tick = 0;
  constructor(private readonly p: Practice) {}
  async hold(ms: number, over: Partial<InputPacket> = {}): Promise<void> {
    const end = Date.now() + ms;
    while (Date.now() < end) { this.send(over); await sleep(33); }
  }
  send(over: Partial<InputPacket> = {}): void {
    this.p.c.send("input", {
      v: 1, epoch: this.p.c.welcome!.epoch, seq: ++this.seq, sampleTick: ++this.tick, moveX: 0, moveZ: 0, yaw: 0, pitch: 0,
      attackHeld: false, blockHeld: false, jumpHeld: false, runHeld: false, chargeHeldSlot: 0, edges: [], ...over,
    } satisfies InputPacket);
  }
}

/** Test fixture only: place the player `gap` m in front of the dummy. */
function place(pr: Practice, gap: number): void {
  const mv = pr.server.movement!;
  const dp = mv.position(pr.server.dummyId)!;
  const a = mv.get(pr.me().entityId)!;
  const p = { x: dp[0], y: dp[1], z: dp[2] + gap };
  a.rb.setTranslation(p, true); a.rb.setNextKinematicTranslation(p);
  a.state.facingYaw = 0; a.state.vx = 0; a.state.vz = 0;
}

const state = (pr: Practice): string => pr.me().owner.drillState;

describe("GR15a confirmed-hit lesson (real clients)", () => {
  test("start resets the pair, a miss does not complete, one real M1 hit completes once; no client success message exists", async () => {
    const pr = await joinPractice("Arel");
    expect(state(pr)).toBe("idle");
    pr.c.send("practiceDrill", { action: "start", drill: "hit" });
    await waitFor(() => state(pr) === "running", 2000, "running");
    expect(pr.me().owner.drillId).toBe("hit");
    expect(pr.me().owner.drillStartTick).toBeGreaterThan(0);
    const mv = pr.server.movement!;
    const pp = mv.position(pr.me().entityId)!, dp = mv.position(pr.server.dummyId)!;
    expect(Math.hypot(pp[0] - dp[0], pp[2] - dp[2])).toBeCloseTo(3, 0);
    expect(pr.dummy().hp100).toBe(10000);
    // Tampering: a client-claimed success changes nothing.
    pr.c.send("practiceDrill", { action: "start", drill: "hit", success: true });
    pr.c.send("practiceDrill", { action: "success", drill: "hit" });
    pr.room.send("practiceDrillSuccess", {});
    // Miss: swing facing away from the dummy at range.
    const drv = new Driver(pr);
    await drv.hold(700, { attackHeld: true, yaw: Math.PI });
    expect(state(pr)).toBe("running");
    expect(pr.dummy().hp100).toBe(10000);
    // Hit.
    await drv.hold(100); // release
    await waitFor(() => pr.me().action === "Idle", 3000, "idle");
    place(pr, 1.5);
    await drv.hold(700, { attackHeld: true, yaw: 0 });
    await waitFor(() => state(pr) === "success", 3000, "success");
    const t = pr.me().owner.drillSuccessTick;
    expect(t).toBeGreaterThanOrEqual(pr.me().owner.drillStartTick);
    expect(pr.dummy().hp100).toBeLessThan(10000);
    await drv.hold(700, { attackHeld: true });
    expect(pr.me().owner.drillSuccessTick).toBe(t); // completes once
    expect(pr.me().owner.tutorialStep).toBeLessThanOrEqual(3); // the 7-step tutorial is a separate system
    await pr.c.leave();
  }, 40000);

  test("duplicate start does not reset or spawn; retry resets; exit restores controls; bots cleared on start", async () => {
    const pr = await joinPractice("Nora");
    pr.c.send("practice", { guard: false, ragdoll: false, bots: ["easy", "easy"] });
    await waitFor(() => players(pr.room).size === 4, 3000, "bots");
    pr.c.send("practiceDrill", { action: "start", drill: "hit" });
    await waitFor(() => state(pr) === "running" && players(pr.room).size === 2, 3000, "bots cleared, running");
    const startTick = pr.me().owner.drillStartTick;
    pr.c.send("practiceDrill", { action: "start", drill: "hit" });
    await sleep(200);
    expect(pr.me().owner.drillStartTick).toBe(startTick);
    expect(players(pr.room).size).toBe(2);
    // Practice toggles and bots are locked during the lesson.
    pr.c.send("practice", { guard: true, ragdoll: false, bots: ["hard"] });
    await sleep(200);
    expect(pr.me().owner.dummyGuard).toBe(false);
    expect(players(pr.room).size).toBe(2);
    // Win, then retry.
    place(pr, 1.5);
    const drv = new Driver(pr);
    await drv.hold(700, { attackHeld: true });
    await waitFor(() => state(pr) === "success", 3000, "success");
    await sleep(300); // practice bucket refill
    pr.c.send("practiceDrill", { action: "retry", drill: "hit" });
    await waitFor(() => state(pr) === "running" && pr.dummy().hp100 === 10000 && pr.me().owner.drillSuccessTick === 0, 3000, "retry");
    expect(pr.me().owner.drillStartTick).toBeGreaterThan(startTick);
    await sleep(300);
    pr.c.send("practiceDrill", { action: "exit", drill: "hit" });
    await waitFor(() => state(pr) === "idle" && pr.me().owner.drillId === "", 3000, "exit");
    await sleep(300);
    pr.c.send("practice", { guard: true, ragdoll: false });
    await waitFor(() => pr.me().owner.dummyGuard === true, 2000, "controls restored");
    await pr.c.leave();
  }, 40000);

  test("invalid payloads and other rooms are rejected", async () => {
    const pr = await joinPractice("Mina");
    pr.c.send("practiceDrill", { action: "start", drill: "parry" });
    pr.c.send("practiceDrill", { action: "bogus", drill: "hit" });
    await sleep(200);
    expect(state(pr)).toBe("idle");
    // An ordinary FFA room has no handler and never grows lesson state.
    const ffa = await loginClient(h, "Ola");
    const ffaRoom = await ffa.join(freshCode());
    await waitFor(() => ffa.welcome !== null, 3000, "ffa welcome");
    ffa.send("ready", { kitId: "td", contentHash: ffa.localContentHash });
    await waitFor(() => [...players(ffaRoom).values()].some((p: P) => p.ready), 3000, "ffa ready");
    ffa.send("practiceDrill", { action: "start", drill: "hit" });
    ffa.send("practiceDrill", { action: "start", drill: "block" });
    await sleep(300);
    const mine = [...players(ffaRoom).values()].find((p: P) => p.owner !== undefined) as P;
    expect(mine.owner.drillState).toBe("idle");
    expect(mine.hp100).toBe(10000);
    expect(players(ffaRoom).size).toBe(1);
    await ffa.leave(); await pr.c.leave();
  }, 30000);
});

// GR15b: the lesson dummy attacks through the ordinary pipeline seat; only a server `blocked` result completes it.
const seatOf = (pr: Practice): unknown => (pr.server as unknown as { dummySeat: unknown }).dummySeat;
const startBlock = async (pr: Practice): Promise<number> => {
  pr.c.send("practiceDrill", { action: "start", drill: "block" });
  await waitFor(() => state(pr) === "running" && pr.me().owner.drillId === "block", 3000, "block running");
  return pr.me().owner.drillStartTick as number;
};

describe("GR15b confirmed-block lesson (real clients)", () => {
  test("placement, one attack per period through a temporary seat, holding guard early does not pass, frontal block passes once", async () => {
    const pr = await joinPractice("Bram");
    const start = await startBlock(pr);
    const mv = pr.server.movement!;
    const pp = mv.position(pr.me().entityId)!, dp = mv.position(pr.server.dummyId)!;
    expect(Math.hypot(pp[0] - dp[0], pp[2] - dp[2])).toBeCloseTo(1.6, 1);
" + rows.join("
    expect(Math.abs(pp[1] - dp[1])).toBeLessThan(0.2);
    expect(seatOf(pr)).not.toBeNull();
    const ids = (pr.server as unknown as { extraBodyIds(): number[] }).extraBodyIds();
    expect(ids).toEqual([]); // not published twice while it has a seat
    const drv = new Driver(pr);
    // Guard held from the start: holding alone, before the first attack, does not complete.
    await drv.hold(1000, { blockHeld: true });
    expect(pr.server.sim.tick).toBeLessThan(start + 120);
    expect(state(pr)).toBe("running");
    await drv.hold(3500, { blockHeld: true });
    await waitFor(() => state(pr) === "success", 4000, "block success");
    const t = pr.me().owner.drillSuccessTick as number;
    expect(t).toBeGreaterThanOrEqual(start + 120);
    expect(t).toBeLessThan(start + 120 + 30);
    expect(pr.me().hp100).toBe(10000); // block chip is zero for an M1
    expect(seatOf(pr)).toBeNull(); // dummy attacks stop after success
    expect((pr.server as unknown as { extraBodyIds(): number[] }).extraBodyIds()).toEqual([pr.server.dummyId]);
    await drv.hold(3500, { blockHeld: true });
    expect(pr.me().owner.drillSuccessTick).toBe(t);
    expect(pr.me().hp100).toBe(10000);
    await pr.c.leave();
  }, 40000);

  test("wrong facing and late guard do not pass; each attack is one ordinary first hit, 180 ticks apart; retry rearms; exit cancels", async () => {
    const pr = await joinPractice("Cleo");
    const start = await startBlock(pr);
    const drv = new Driver(pr);
    const me = pr.server.combat.get(pr.me().entityId)!;
    const hpLog: { tick: number; hp: number }[] = [];
    let last = me.hp100;
    // Wrong facing: turned away from the dummy while holding guard.
    pr.server.movement!.get(pr.me().entityId)!.state.facingYaw = Math.PI;
    const end = Date.now() + 2800;
    while (Date.now() < end) {
      drv.send({ blockHeld: true, yaw: Math.PI });
      if (me.hp100 !== last) { hpLog.push({ tick: pr.server.sim.tick, hp: me.hp100 }); last = me.hp100; }
      await sleep(10);
    }
    expect(state(pr)).toBe("running");
    expect(hpLog.length).toBe(1);
    const first = 10000 - hpLog[0]!.hp;
    expect(first).toBeGreaterThan(0);
    expect(hpLog[0]!.tick).toBeGreaterThanOrEqual(start + 120 + 8);
    // Second scheduled attack lands 180 ticks after the first (integer schedule; the same single first-hit damage).
    await waitFor(() => hpLog.length >= 1 && (drv.send({ blockHeld: true, yaw: Math.PI }), me.hp100 !== last), 6000, "second attack");
    expect(last - me.hp100).toBe(first);
    expect(state(pr)).toBe("running");
    // Retry rearms with a fresh preparation delay and a fresh seat.
    await sleep(300);
    pr.c.send("practiceDrill", { action: "retry", drill: "block" });
    await waitFor(() => pr.me().owner.drillStartTick > start && pr.me().hp100 === 10000, 3000, "retry");
    expect(seatOf(pr)).not.toBeNull();
    // Exit before the first attack: the seat is gone and nothing ever lands.
    await sleep(300);
    pr.c.send("practiceDrill", { action: "exit", drill: "block" });
    await waitFor(() => state(pr) === "idle", 3000, "exit");
    expect(seatOf(pr)).toBeNull();
    const home = pr.server.movement!.position(pr.server.dummyId)!;
    expect([Math.round(home[0]), Math.round(home[2])]).toEqual([0, -1]); // exit restores the dummy's home point
    const until = pr.server.sim.tick + 400;
    await waitFor(() => pr.server.sim.tick > until, 8000, "wait past a full schedule");
    expect(pr.me().hp100).toBe(10000);
    await pr.c.leave();
  }, 60000);

  test("a guard that starts during the swing is too late; player death stops the dummy and leaves Retry (no success)", async () => {
    const pr = await joinPractice("Dara");
    const start = await startBlock(pr);
    const drv = new Driver(pr);
    const me = pr.server.combat.get(pr.me().entityId)!;
    // Guard requested only after the first attack began: lands as an unguarded hit.
    await waitFor(() => pr.server.sim.tick >= start + 120 + 5, 8000, "attack began");
    await drv.hold(500, { blockHeld: true });
    expect(state(pr)).toBe("running");
    expect(me.hp100).toBeLessThan(10000);
    // Lethal state: the next ordinary hit kills; the lesson must not grant success and the dummy stops.
    await sleep(300);
    pr.c.send("practiceDrill", { action: "retry", drill: "block" });
    await waitFor(() => pr.me().owner.drillStartTick > start && me.hp100 === 10000, 3000, "retry");
    const fresh = pr.server.combat.get(pr.me().entityId)!;
    fresh.hp100 = 1;
    await waitFor(() => fresh.action === "Dead" || fresh.hp100 === 0 || seatOf(pr) === null, 8000, "death");
    await waitFor(() => seatOf(pr) === null, 3000, "dummy seat removed");
    expect(state(pr)).toBe("running");
    const hold = pr.server.sim.tick + 400;
    await waitFor(() => pr.server.sim.tick > hold, 8000, "wait past a full schedule");
    expect(state(pr)).toBe("running"); // Retry is offered by the panel; success was never granted
    expect(pr.me().owner.drillSuccessTick).toBe(0);
    await pr.c.leave();
  }, 60000);
});

// GR15c: the dummy is a Stone Vanguard casting the existing sv.b1 once at preparation tick + 120; only server geometry + results judge it.
const startEvade = async (pr: Practice): Promise<number> => {
  pr.c.send("practiceDrill", { action: "start", drill: "evade" });
  await waitFor(() => state(pr) === "running" && pr.me().owner.drillId === "evade", 3000, "evade running");
  return pr.me().owner.drillStartTick as number;
};
const trialOf = (pr: Practice): unknown => pr.server.drill.trial;
const dummyKit = (pr: Practice): string => pr.server.combat.get(pr.server.dummyId)!.kitId;
const teleportX = (pr: Practice, x: number): void => {
  const a = pr.server.movement!.get(pr.me().entityId)!;
  const t = a.rb.translation();
  const p = { x, y: t.y, z: t.z };
  a.rb.setTranslation(p, true); a.rb.setNextKinematicTranslation(p);
};

describe("GR15c leave-the-warning lesson (real clients)", () => {
  test("placement, Stone Vanguard dummy, a stationary player is hit once and fails; no auto repeat; Exit restores the Tide Duelist", async () => {
    const pr = await joinPractice("Edda");
    const start = await startEvade(pr);
    const mv = pr.server.movement!;
    const pp = mv.position(pr.me().entityId)!, dp = mv.position(pr.server.dummyId)!;
    expect(Math.hypot(pp[0] - dp[0], pp[2] - dp[2])).toBeCloseTo(2, 1);
    expect(Math.abs(pp[1] - dp[1])).toBeLessThan(0.2);
    expect(dummyKit(pr)).toBe("sv");
    expect(seatOf(pr)).not.toBeNull();
    expect(pr.me().hp100).toBe(10000);
    await waitFor(() => state(pr) === "failed", 8000, "stationary player fails");
    expect(pr.me().hp100).toBe(8000); // one direct 20 HP hit, no wave
    expect(pr.me().owner.drillSuccessTick).toBe(0);
    expect(pr.server.sim.tick).toBeGreaterThanOrEqual(start + 120 + 24);
    expect(seatOf(pr)).toBeNull();
    const until = pr.server.sim.tick + 400; // no automatic repeat
    await waitFor(() => pr.server.sim.tick > until, 8000, "wait past two prep periods");
    expect(state(pr)).toBe("failed");
    expect(pr.me().hp100).toBe(7000); // the ability's own +10 HP landing bonus after the launch; a second cast would be lower
    pr.c.send("practiceDrill", { action: "exit", drill: "evade" });
    await waitFor(() => state(pr) === "idle", 3000, "exit");
    expect(dummyKit(pr)).toBe("td");
    const home = mv.position(pr.server.dummyId)!;
    expect([Math.round(home[0]) + 0, Math.round(home[2])]).toEqual([0, -1]);
    expect(trialOf(pr)).toBeNull();
    await pr.c.leave();
  }, 40000);

  test("timely sideways movement passes once untouched; Retry uses a fresh trial; starting outside and holding guard do not pass", async () => {
    const pr = await joinPractice("Fynn");
    const start = await startEvade(pr);
    const drv = new Driver(pr);
    const first = trialOf(pr);
    await waitFor(() => (drv.send(), pr.server.sim.tick >= start + 119), 8000, "just before the cast");
    await drv.hold(700, { moveX: 1 });
    await waitFor(() => state(pr) === "success", 3000, "evade success");
    const t = pr.me().owner.drillSuccessTick as number;
    expect(t).toBeGreaterThanOrEqual(start + 120 + 24);
    expect(pr.me().hp100).toBe(10000);
    expect(seatOf(pr)).toBeNull();
    await sleep(600);
    expect(pr.me().owner.drillSuccessTick).toBe(t);
    // Retry: fresh trial, fresh preparation, positions reset (player back inside the box).
    pr.c.send("practiceDrill", { action: "retry", drill: "evade" });
    await waitFor(() => state(pr) === "running" && pr.me().owner.drillStartTick > start, 3000, "retry");
    expect(trialOf(pr)).not.toBe(first);
    const s2 = pr.me().owner.drillStartTick as number;
    expect(pr.me().owner.drillSuccessTick).toBe(0);
    expect(seatOf(pr)).not.toBeNull();
    // Starting outside the footprint when the windup begins does not count as evasion (and nothing hits).
    teleportX(pr, pr.server.movement!.position(pr.server.dummyId)![0] + 4);
    await waitFor(() => state(pr) === "failed", 8000, "outside start fails");
    expect(pr.me().hp100).toBe(10000);
    expect(pr.server.sim.tick).toBeGreaterThanOrEqual(s2 + 120 + 24);
    // Retry again: guarding in place gets a blocked result, which is not evasion.
    pr.c.send("practiceDrill", { action: "retry", drill: "evade" });
    await waitFor(() => state(pr) === "running" && pr.me().owner.drillStartTick > s2, 3000, "retry 2");
    await drv.hold(2800, { blockHeld: true });
    await waitFor(() => state(pr) !== "running", 3000, "guard judged");
    expect(state(pr)).toBe("failed");
    await pr.c.leave();
  }, 60000);

  test("player death and a kit change cancel the trial: no success, no failure, Retry/Exit remain", async () => {
    const pr = await joinPractice("Gwen");
    const start = await startEvade(pr);
    pr.server.combat.get(pr.me().entityId)!.hp100 = 1; // the cast kills
    await waitFor(() => seatOf(pr) === null, 8000, "trial cancelled by death");
    expect(state(pr)).toBe("running");
    expect(pr.me().owner.drillSuccessTick).toBe(0);
    await sleep(500);
    expect(state(pr)).toBe("running");
    pr.c.send("practiceDrill", { action: "retry", drill: "evade" });
    await waitFor(() => pr.me().owner.drillStartTick > start && pr.me().hp100 === 10000, 4000, "retry after death");
    pr.server.combat.get(pr.me().entityId)!.kitId = "td"; // simulate an applied kit change mid-preparation
    await waitFor(() => seatOf(pr) === null, 3000, "trial cancelled by kit change");
    const until = pr.server.sim.tick + 250;
    await waitFor(() => pr.server.sim.tick > until, 8000, "past the cast tick");
    expect(state(pr)).toBe("running");
    expect(pr.me().hp100).toBe(10000);
    await pr.c.leave();
  }, 60000);
});
