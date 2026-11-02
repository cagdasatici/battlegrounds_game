import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { matchMaker } from "colyseus";
import { startHarness, loginClient, waitFor, players, freshCode, type Harness } from "../fixtures/harness.js";
import type { ArenaRoom } from "../../apps/server/src/rooms/ArenaRoom.js";
import { ACTION_OPEN_END } from "../../apps/server/src/sim/ActionMachine.js";
import { COMBAT, DOUBLE_JUMP_VELOCITY_SCALE } from "../../packages/shared/src/config/combat.js";

let h: Harness;
beforeAll(async () => { h = await startHarness(); });
afterAll(async () => { await h.stop(); });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const pkt = (epoch: number, seq: number, o: Record<string, unknown> = {}) => ({
  v: 1, epoch, seq, sampleTick: 0, moveX: 0, moveZ: 0, yaw: 0, pitch: 0,
  attackHeld: false, blockHeld: false, jumpHeld: false, runHeld: false, chargeHeldSlot: 0, edges: [], ...o,
});

async function setup() {
  const code = freshCode();
  const a = await loginClient(h, "Arel"), b = await loginClient(h, "Nora");
  const ra = await a.join(code), rb = await b.join(code);
  await waitFor(() => a.welcome !== null && players(ra).size === 2 && players(rb).size === 2, 3000, "joined");
  a.send("ready", { kitId: "sv", contentHash: a.localContentHash });
  b.send("ready", { kitId: "td", contentHash: b.localContentHash });
  const mine = () => [...players(ra).values()].find((p) => p.displayName === "Arel");
  const seenByB = () => [...players(rb).values()].find((p) => p.displayName === "Arel");
  await waitFor(() => mine()?.ready === true && mine().action === "Idle", 3000, "ready");
  const room = matchMaker.getLocalRoomById(ra.roomId) as unknown as ArenaRoom;
  const id = mine().entityId as number;
  await waitFor(() => room.sim.tick > room.combat.get(id)!.protectedUntilTick + 2 && room.movement!.get(id)!.state.grounded, 4000, "settled");
  await sleep(100);
  // A death/respawn replaces the movement body, so always look it up fresh.
  const body = { get state() { return room.movement!.get(id)!.state; }, get rb() { return room.movement!.get(id)!.rb; } };
  // Death/respawn replace the Fighter record too: proxy to the live one.
  const f = new Proxy({} as NonNullable<ReturnType<typeof room.combat.get>>, {
    get: (_t, k) => (room.combat.get(id) as never)[k], set: (_t, k, v) => { (room.combat.get(id) as never)[k] = v; return true; },
  });
  let seq = 0, edge = 0;
  const epoch = a.welcome!.epoch;
  const jump = () => a.send("input", pkt(epoch, ++seq, { jumpHeld: true, edges: [{ id: ++edge, kind: "jump" }] }));
  const idle = () => a.send("input", pkt(epoch, ++seq));
  const groundJump = async () => { jump(); await waitFor(() => !body.state.grounded && body.state.vy > 0, 1000, "airborne"); idle(); };
  const landed = () => waitFor(() => body.state.grounded && body.state.vy === 0 && body.state.airJumpsUsed === 0 && f.action === "Idle", 3000, "landed and idle");
  return { nextEdge: () => ++edge, a, b, ra, rb, room, body, f, jump, idle, groundJump, landed, mine, seenByB, send: (o: Record<string, unknown>) => a.send("input", pkt(epoch, ++seq, o)) };
}

describe("DJ01 double jump over real Colyseus clients", () => {
  test("second client sees the air jump; one air jump per airtime; reset on landing", async () => {
    const t = await setup();
    const y0 = t.body.rb.translation().y;
    await t.groundJump();
    expect(t.body.state.airJumpsUsed).toBe(0);
    await sleep(300); // near the apex, where a set-not-add air jump adds the most height
    t.jump(); // air jump
    await waitFor(() => t.body.state.airJumpsUsed === 1, 1000, "air jump spent");
    expect(t.body.state.vy).toBeGreaterThan(COMBAT.capsule.jumpSpeed * DOUBLE_JUMP_VELOCITY_SCALE + COMBAT.movement.gravity * 0.1);
    await waitFor(() => t.seenByB()?.airJumpUsed === true, 2000, "B sees airJumpUsed");
    expect(t.mine().airJumpUsed).toBe(true);
    let maxY = y0;
    t.jump(); t.jump(); // third and fourth presses are ignored
    const until = Date.now() + 1500;
    while (Date.now() < until && !(t.body.state.grounded && Date.now() > until - 1000)) { maxY = Math.max(maxY, t.body.rb.translation().y); expect(t.body.state.airJumpsUsed).toBeLessThanOrEqual(1); await sleep(8); }
    expect(maxY - y0).toBeGreaterThan(2.0); // two stacked jumps; a single jump peaks near 1.4 m
    expect(maxY - y0).toBeLessThan(4.2);
    await t.landed();
    await waitFor(() => t.seenByB()?.airJumpUsed === false, 2000, "B sees flag cleared on landing");
    await t.a.leave(); await t.b.leave();
  });

  test("air jump is ignored during cast windup, guard, stun, ragdoll, dash and death, and works once the state clears", async () => {
    const t = await setup();
    const setState = (action: string) => { t.f.action = action as typeof t.f.action; t.f.actionStartTick = t.room.sim.tick; t.f.actionEndTick = ACTION_OPEN_END; };
    for (const action of ["Windup", "Active", "Recovery", "Awakening", "Stunned", "Ragdolled", "Captured", "Dead"]) {
      await t.landed();
      await t.groundJump();
      await sleep(30);
      setState(action);
      t.jump();
      await sleep(100);
      expect(t.body.state.airJumpsUsed, `blocked during ${action}`).toBe(0);
      expect(t.mine().airJumpUsed).toBe(false);
      t.f.action = "Idle"; t.f.actionEndTick = 0;
      if (t.body.state.grounded) continue;
      t.jump();
      await waitFor(() => t.body.state.airJumpsUsed === 1, 500, `air jump works after ${action} clears`);
    }
    // Guard held (real input, not a state poke).
    await t.landed();
    await t.groundJump();
    t.send({ blockHeld: true, edges: [{ id: t.nextEdge(), kind: "jump" }] });
    await sleep(100);
    expect(t.body.state.airJumpsUsed).toBe(0);
    t.idle();
    // Dash through the real request path.
    await t.landed();
    await t.groundJump();
    t.f.cooldowns.clear();
    expect(t.room.combat.requestDash(t.f.entityId, t.room.sim.tick, t.body.state.facingYaw, 1, 0).ok).toBe(true);
    t.jump();
    await sleep(60);
    expect(t.body.state.airJumpsUsed).toBe(0);
    await t.a.leave(); await t.b.leave();
  });
});
