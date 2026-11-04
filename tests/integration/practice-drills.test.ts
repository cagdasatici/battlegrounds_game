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
    pr.c.send("practiceDrill", { action: "start", drill: "block" });
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
    await sleep(300);
    const mine = [...players(ffaRoom).values()].find((p: P) => p.owner !== undefined) as P;
    expect(mine.owner.drillState).toBe("idle");
    expect(mine.hp100).toBe(10000);
    expect(players(ffaRoom).size).toBe(1);
    await ffa.leave(); await pr.c.leave();
  }, 30000);
});
