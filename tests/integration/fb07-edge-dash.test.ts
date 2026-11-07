import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { matchMaker } from "colyseus";
import { startHarness, loginClient, waitFor, players, freshCode, type Harness } from "../fixtures/harness.js";
import type { ArenaRoom } from "../../apps/server/src/rooms/ArenaRoom.js";

let h: Harness;
beforeAll(async () => { h = await startHarness(25691); });
afterAll(async () => { await h.stop(); });

const pkt = (epoch: number, seq: number, o: Record<string, unknown> = {}) => ({
  v: 1, epoch, seq, sampleTick: 0, moveX: 0, moveZ: 0, yaw: 0, pitch: 0,
  attackHeld: false, blockHeld: false, jumpHeld: false, runHeld: false, chargeHeldSlot: 0, edges: [], ...o,
});
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function twoPlayers() {
  const code = freshCode();
  const a = await loginClient(h, "Arel"), b = await loginClient(h, "Nora");
  const ra = await a.join(code), rb = await b.join(code);
  await waitFor(() => a.welcome !== null && players(ra).size === 2 && players(rb).size === 2, 3000, "joined");
  a.send("ready", { kitId: "sv", contentHash: a.localContentHash });
  b.send("ready", { kitId: "td", contentHash: b.localContentHash });
  const room = matchMaker.getLocalRoomById(ra.roomId) as unknown as ArenaRoom;
  const aId = [...players(ra).values()].find((p) => p.displayName === "Arel")!.entityId as number;
  await waitFor(() => room.combat.get(aId)?.action === "Idle" && room.movement!.get(aId)!.state.grounded, 4000, "settled");
  const place = (x: number, z: number, y: number) => {
    const body = room.movement!.get(aId)!;
    body.rb.setTranslation({ x, y, z }, true); body.rb.setNextKinematicTranslation({ x, y, z });
    body.state.vx = body.state.vz = body.state.vy = 0;
  };
  const pos = () => room.movement!.position(aId)!;
  return { a, ra, room, aId, place, pos, epoch: a.welcome!.epoch, done: async () => { await a.leave(); await (await Promise.resolve(b)).leave(); } };
}

/** First edge along (ux, uz) from (sx, sz): last x,z with ground, found with the server's own probe. */
function edgeAlong(room: ArenaRoom, sx: number, sz: number, ux: number, uz: number): [number, number] {
  let d = 0;
  while (room.world!.walkableTop(sx + ux * (d + 0.05), sz + uz * (d + 0.05)) !== null && d < 60) d += 0.05;
  return [sx + ux * d, sz + uz * d];
}

describe("FB07 edge-aware dash (real client input)", () => {
  test("open ground: full dash plus coast distance (measurement)", async () => {
    const t = await twoPlayers();
    const y = t.pos()[1];
    t.place(6, -10, y);
    await sleep(100);
    t.a.send("input", pkt(t.epoch, 1, { moveZ: 1, edges: [{ id: 1, kind: "dash" }] }));
    await waitFor(() => t.room.combat.get(t.aId)!.action === "Dash", 1000, "dash started");
    t.a.send("input", pkt(t.epoch, 2));
    await waitFor(() => t.room.combat.get(t.aId)!.action !== "Dash", 1500, "dash ended");
    await sleep(1200);
    const travelled = t.pos()[2] + 10;
    console.log("FB07 open ground total travel", travelled);
    expect(travelled).toBeGreaterThan(6.5); // full dash plus coast, unclamped on open ground
    await t.done();
  });

  test("dash toward an island edge from 3 m away stops short and does not fall", async () => {
    const t = await twoPlayers();
    const [, ez] = edgeAlong(t.room, 6, 0, 0, 1); // main deck north-south edge (no guardrail, clear of the bridge)
    const y = t.pos()[1];
    t.place(6, ez - 3, y);
    await sleep(100);
    t.a.send("input", pkt(t.epoch, 1, { moveZ: 1, edges: [{ id: 1, kind: "dash" }] }));
    await waitFor(() => t.room.combat.get(t.aId)!.action === "Dash", 1000, "dash started");
    t.a.send("input", pkt(t.epoch, 2)); // release the stick: only the dash itself is under test, not walking off
    await waitFor(() => t.room.combat.get(t.aId)!.action !== "Dash", 1500, "dash ended");
    await sleep(800);
    const p = t.pos();
    expect(p[2]).toBeLessThan(ez);
    expect(p[2]).toBeGreaterThan(ez - 3 + 0.2); // still travelled some distance
    expect(Math.abs(p[1] - y)).toBeLessThan(0.5);
    expect(t.room.combat.get(t.aId)!.action).not.toBe("Dead");
    await t.done();
  });

  test("a dash along a bridge stays on the bridge", async () => {
    const t = await twoPlayers();
    const y = t.pos()[1];
    // West bridge runs along x at z = 0 (x -60..-54 since ARENA01); start on it. GFX01: the old x -22 start now meets wall.0 (x -18..-14).
    const sx = -59;
    expect(t.room.world!.walkableTop(sx, 0)).not.toBeNull();
    t.place(sx, 0, y);
    await sleep(100);
    t.a.send("input", pkt(t.epoch, 1, { moveX: 1, edges: [{ id: 1, kind: "dash" }] }));
    await waitFor(() => t.room.combat.get(t.aId)!.action === "Dash", 1000, "dash started");
    await waitFor(() => t.room.combat.get(t.aId)!.action !== "Dash", 1500, "dash ended");
    await sleep(300);
    const p = t.pos();
    expect(p[0]).toBeGreaterThan(sx + 4); // full-length dash along the bridge
    expect(Math.abs(p[2])).toBeLessThan(0.5);
    expect(Math.abs(p[1] - y)).toBeLessThan(0.5);
    await t.done();
  });

  test("knockback off an edge still makes the player fall", async () => {
    const t = await twoPlayers();
    const [, ez] = edgeAlong(t.room, 6, 0, 0, 1);
    const y = t.pos()[1];
    t.place(6, ez - 1, y);
    await sleep(100);
    t.room.movement!.setVelocity(t.aId, 0, 4, 14); // server-side launch, as an enemy knockback would
    let fell = false, minY = y;
    for (let i = 0; i < 300 && !fell; i++) {
      await sleep(10);
      minY = Math.min(minY, t.pos()[1]);
      fell = minY < y - 3 || t.room.combat.get(t.aId)!.action === "Dead";
    }
    console.log("FB07 knockback", { minY, y, action: t.room.combat.get(t.aId)!.action, z: t.pos()[2], ez });
    expect(fell).toBe(true);
    await t.done();
  });
});
