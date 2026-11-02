// T18d: practice room over real Colyseus connections. Same server sim, integer ticks, steps confirmed by the server.
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { matchMaker } from "colyseus";
import type { Room } from "@colyseus/sdk";
import { startHarness, loginClient, waitFor, players, freshCode, type Harness } from "../fixtures/harness.js";
import type { InputPacket } from "../../packages/shared/src/protocol.js";
import type { PracticeRoom } from "../../apps/server/src/rooms/PracticeRoom.js";
import type { RoomClient } from "../../apps/client/src/net/RoomClient.js";

let h: Harness;
beforeAll(async () => { h = await startHarness(25712); });
afterAll(async () => { await h.stop(); });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type P = any;

interface Practice { c: RoomClient; room: Room; server: PracticeRoom; me(): P; dummy(): P; step(): number }

async function joinPractice(name: string, kit: "sv" | "td" = "sv"): Promise<Practice> {
  const c = await loginClient(h, name);
  const room = await c.join("practice");
  await waitFor(() => c.welcome !== null && players(room).size === 2, 3000, "dummy and player replicated");
  c.send("ready", { kitId: kit, contentHash: c.localContentHash });
  const me = (): P => [...players(room).values()].find((p: P) => p.owner !== undefined && p.displayName === name);
  const dummy = (): P => [...players(room).values()].find((p: P) => p.displayName === "Practice dummy");
  await waitFor(() => me()?.ready && me().action === "Idle", 3000, "ready");
  const server = matchMaker.getLocalRoomById(room.roomId) as unknown as PracticeRoom;
  // Let the spawn protection pass and the body settle (same pattern as the other integration tests).
  await waitFor(() => server.sim.tick > (server.combat.get(me().entityId)?.protectedUntilTick ?? 0) + 2
    && server.movement!.get(me().entityId)!.state.grounded, 4000, "settled");
  return { c, room, server, me, dummy, step: () => me().owner?.tutorialStep ?? -1 };
}

class Driver {
  private seq = 0; private tick = 0; private edge = 0;
  constructor(private readonly p: Practice) {}
  async hold(ms: number, over: Partial<InputPacket> = {}, edges: InputPacket["edges"] = []): Promise<void> {
    const end = Date.now() + ms;
    let first = true;
    while (Date.now() < end) {
      this.send(over, first ? edges : []);
      first = false;
      await sleep(33);
    }
  }
  send(over: Partial<InputPacket> = {}, edges: InputPacket["edges"] = []): void {
    this.p.c.send("input", {
      v: 1, epoch: this.p.c.welcome!.epoch, seq: ++this.seq, sampleTick: ++this.tick, moveX: 0, moveZ: 0, yaw: 0, pitch: 0,
      attackHeld: false, blockHeld: false, jumpHeld: false, runHeld: false, chargeHeldSlot: 0, edges, ...over,
    } satisfies InputPacket);
  }
  nextEdge(): number { return ++this.edge; }
  async idle(): Promise<void> { this.send(); await waitFor(() => this.p.me().action === "Idle", 4000, "idle"); }
}

/** Test fixture only: stands the player 1.5 m in front of the dummy, facing it (server body API as in other tests). */
function faceDummy(pr: Practice): void {
  const mv = pr.server.movement!;
  const dp = mv.position(pr.server.dummyId)!;
  const a = mv.get(pr.me().entityId)!;
  const p = { x: dp[0], y: dp[1], z: dp[2] + 1.5 };
  a.rb.setTranslation(p, true);
  a.rb.setNextKinematicTranslation(p);
  a.state.facingYaw = 0; a.state.vx = 0; a.state.vz = 0;
}

describe("T18d practice room (real clients)", () => {
  test("joins a private room with a stationary dummy, meter disabled; hits show damage and never build meter", async () => {
    const pr = await joinPractice("Arel");
    expect(pr.server.roomName).toBe("practice");
    expect(pr.server.awakening.meterEnabled).toBe(false);
    expect(pr.dummy().hp100).toBe(10000);
    expect(pr.dummy().action).toBe("Idle");
    const d0 = { x: pr.dummy().x, z: pr.dummy().z };
    faceDummy(pr);
    const drv = new Driver(pr);
    await drv.hold(700, { attackHeld: true });
    await waitFor(() => pr.dummy().hp100 < 10000, 3000, "dummy took server damage");
    expect(pr.me().meter100).toBe(0);
    await sleep(300);
    // Stationary: a light chain does not move the dummy off its home by more than a knockback step.
    expect(Math.hypot(pr.dummy().x - d0.x, pr.dummy().z - d0.z)).toBeLessThan(600);
    await pr.c.leave();
  }, 20000);

  test("steps are confirmed by the server in order; the client cannot complete one by message", async () => {
    const pr = await joinPractice("Nora");
    const drv = new Driver(pr);
    // Tampering: unknown and malformed practice messages change nothing.
    pr.c.send("practice", { tutorialStep: 7 });
    pr.room.send("tutorialStep", { step: 7 });
    pr.room.send("practice", { guard: "yes", ragdoll: 1 });
    await sleep(150);
    expect(pr.step()).toBe(0);
    // Dashing before its step does not count as the dash step (the 3 m it covers may legitimately finish "move").
    drv.send({}, [{ id: drv.nextEdge(), kind: "dash" }]);
    await sleep(400);
    expect(pr.step()).toBeLessThanOrEqual(1);
    await drv.idle();

    await drv.hold(1500, { moveZ: -1 });                    // move
    await waitFor(() => pr.step() >= 1, 2000, "move confirmed");
    await drv.hold(1200, { moveX: 1, moveZ: 1 });           // turn
    await waitFor(() => pr.step() >= 2, 2000, "turn confirmed");
    faceDummy(pr);
    await drv.hold(1200, { attackHeld: true });             // hold attack
    await waitFor(() => pr.step() >= 3, 2000, "attack confirmed");
    await drv.idle();
    await drv.hold(800, { blockHeld: true });               // hold block
    await waitFor(() => pr.step() >= 4, 2000, "block confirmed");
    await drv.hold(100);
    await drv.idle();
    drv.send({ moveZ: -1 }, [{ id: drv.nextEdge(), kind: "dash" }]); // dash
    await waitFor(() => pr.step() >= 5, 2000, "dash confirmed");
    await drv.idle();
    for (const slot of [1, 2, 3, 4] as const) {              // four skills
      await waitFor(() => pr.me().action === "Idle" && pr.me().cooldownEndTicks[slot - 1] <= pr.server.sim.tick, 8000, `slot ${slot} ready`);
      faceDummy(pr);
      await drv.hold(120, {}, [{ id: drv.nextEdge(), kind: "skillDown", slot }]);
      await waitFor(() => (pr.me().owner.tutorialSkillMask & (1 << (slot - 1))) !== 0, 3000, `slot ${slot} confirmed`);
    }
    await waitFor(() => pr.step() >= 6, 2000, "skills confirmed");
    // The server grants the meter for this step only; hits did not build it.
    await waitFor(() => pr.me().meter100 > 0, 2000, "server granted meter for awaken");
    await waitFor(() => pr.me().action === "Idle", 8000, "idle before awaken");
    await drv.hold(100, {}, [{ id: drv.nextEdge(), kind: "awaken" }]);
    await waitFor(() => pr.step() === 7, 6000, "awaken confirmed");
    expect(pr.me().form).toBe("Awakened");
    await pr.c.leave();
  }, 90000);

  test("guard and ragdoll toggles are applied by the server to its dummy and replicated back", async () => {
    const pr = await joinPractice("Arel", "td");
    pr.c.send("practice", { guard: true, ragdoll: false });
    await waitFor(() => pr.dummy().action === "Guard" && pr.me().owner.dummyGuard === true, 2000, "dummy guards");
    pr.c.send("practice", { guard: false, ragdoll: true });
    await waitFor(() => pr.dummy().action === "Ragdolled" && pr.me().owner.dummyRagdoll === true, 2000, "dummy ragdolled");
    pr.c.send("practice", { guard: false, ragdoll: false });
    await waitFor(() => pr.dummy().action === "Idle", 3000, "dummy back to idle");
    await pr.c.leave();
  }, 20000);

  test("practice is isolated: separate rooms per session, FFA scores and meters untouched", async () => {
    const code = freshCode();
    const ffa = await loginClient(h, "Mina");
    const ffaRoom = await ffa.join(code);
    await waitFor(() => ffa.welcome !== null, 3000, "ffa welcome");
    ffa.send("ready", { kitId: "td", contentHash: ffa.localContentHash });
    await waitFor(() => [...players(ffaRoom).values()].some((p: P) => p.ready), 3000, "ffa ready");

    const a = await joinPractice("Arel");
    const b = await joinPractice("Nora");
    expect(a.room.roomId).not.toBe(b.room.roomId);
    expect(a.room.roomId).not.toBe(ffaRoom.roomId);
    faceDummy(a);
    const drv = new Driver(a);
    await drv.hold(700, { attackHeld: true });
    await waitFor(() => a.dummy().hp100 < 10000, 3000, "practice damage");
    // The other practice room and the FFA room saw nothing.
    expect(b.dummy().hp100).toBe(10000);
    const ffaMe = [...players(ffaRoom).values()][0] as P;
    expect([ffaMe.kills, ffaMe.deaths, ffaMe.assists, ffaMe.meter100, ffaMe.hp100]).toEqual([0, 0, 0, 0, 10000]);
    expect(players(ffaRoom).size).toBe(1);
    await a.c.leave(); await b.c.leave(); await ffa.leave();
  }, 30000);

  test("two sessions asking for practice get different private rooms", async () => {
    const a = await joinPractice("Arel");
    // The server derives the code from the session, so the ticket never names another player's room.
    const other = await loginClient(h, "Nora");
    const second = await other.join("practice");
    expect(second.roomId).not.toBe(a.room.roomId);
    await other.leave(); await a.c.leave();
  }, 20000);
});

test("practice bots: add two, remove cleanly, reject over-cap config (real client)", async () => {
  const pr = await joinPractice("Bot practice");
  try {
    pr.c.send("practice", { guard: false, ragdoll: false, bots: ["easy", "hard"] });
    await waitFor(() => players(pr.room).size === 4 && pr.me().owner.practiceBotCount === 2, 3000, "practice bots");
    expect(pr.server.maxClients).toBe(1);
    const ids = [...players(pr.room).values()].filter(p => p.owner === undefined && p.displayName.startsWith("Bot ")).map(p => p.entityId);
    await sleep(300);
    pr.c.send("practice", { guard: false, ragdoll: false, bots: ["easy", "easy", "easy"] });
    await sleep(150);
    expect(players(pr.room).size).toBe(4);
    pr.c.send("practice", { guard: true, ragdoll: false, bots: [] });
    await waitFor(() => players(pr.room).size === 2 && pr.me().owner.practiceBotCount === 0, 3000, "bots removed");
    for (const id of ids) { expect(pr.server.combat.get(id)).toBeUndefined(); expect(pr.server.movement?.get(id)).toBeUndefined(); }
    expect(pr.dummy()).toBeTruthy();
  } finally { await pr.c.leave(); }
}, 15000);
