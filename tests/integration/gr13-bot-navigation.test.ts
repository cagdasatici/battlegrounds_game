import { afterAll, beforeAll, expect, test } from "vitest";
import { Client, type Room } from "@colyseus/sdk";
import { matchMaker } from "colyseus";
import { startHarness, waitFor, players, type Harness } from "../fixtures/harness.js";
import { computeContentHash } from "../../packages/shared/src/config/content.js";
import { PROTOCOL_VERSION } from "../../packages/shared/src/protocol.js";
import { ARENA } from "../../packages/shared/src/config/arena.js";
import type { SparringRoom } from "../../apps/server/src/rooms/SparringRoom.js";

let h: Harness;
beforeAll(async () => { h = await startHarness(); });
afterAll(async () => { await h.stop(); });
const hash = computeContentHash();

async function setup() {
  const adult = h.svc.sessions.create("Host");
  const headers = { origin: h.origin, cookie: `eb_session=${adult.cookieToken}`, "x-csrf-token": adult.session.csrf, "content-type": "application/json" };
  const created = await fetch(`${h.origin}/api/sparring`, { method: "POST", headers, body: JSON.stringify({ bots: ["medium"] }) });
  expect(created.status).toBe(201);
  const { roomCode } = await created.json() as { roomCode: string };
  const ticketRes = await fetch(`${h.origin}/api/join-ticket`, { method: "POST", headers, body: JSON.stringify({ roomCode }) });
  const t = await ticketRes.json() as { ticket: string; roomId: string };
  const room: Room = await new Client(`ws://localhost:${h.port}`).joinById(t.roomId, { ticket: t.ticket, roomCode, protocolVersion: PROTOCOL_VERSION, contentHash: hash });
  room.onMessage("welcome", () => undefined); room.onMessage("actionResult", () => undefined); room.onMessage("combatEvent", () => undefined);
  await waitFor(() => players(room).size === 2);
  room.send("ready", { kitId: "sv", contentHash: hash });
  await waitFor(() => [...players(room).values()].every(p => p.ready));
  const live = matchMaker.getLocalRoomById(room.roomId) as unknown as SparringRoom;
  live.setSimulationInterval(() => undefined, 1000);
  const botId = [...players(room).values()].find(p => /^Bot /.test(p.displayName as string))!.entityId as number;
  const humanId = [...players(room).values()].find(p => p.displayName === "Host")!.entityId as number;
  const place = (id: number, x: number, z: number) => {
    const b = live.movement!.get(id)!;
    const pos = { x, y: (live.world!.groundHeight(x, z) ?? 0) + ARENA.capsule.centreAboveSurface, z };
    b.rb.setTranslation(pos, true); b.rb.setNextKinematicTranslation(pos);
    b.state.vx = b.state.vz = b.state.vy = 0;
  };
  let tick = live.sim.tick;
  /** Step until the bot is within 2.5 m of the idle human; returns ticks used or null. Fails on a fall. */
  const run = (bx: number, bz: number, hx: number, hz: number, max = 900): { ticks: number | null; maxPath: number } => {
    place(botId, bx, bz); place(humanId, hx, hz);
    // Put the bot's reaction window behind it: fresh life age is measured from the bot's spawnTick.
    let maxPath = 0;
    for (let i = 0; i < max; i++) {
      live.stepTick(++tick);
      place(humanId, hx, hz); // idle human: ignore any incidental push
      const f = live.combat.get(botId)!, hp = live.combat.get(humanId)!;
      expect(f.action, "bot must not fall").not.toBe("Dead");
      expect(hp.action).not.toBe("Dead");
      const nav = (live as unknown as { bots: Map<string, { nav: { path: number[] } }> }).bots.get(`bot:${botId}`)!.nav;
      maxPath = Math.max(maxPath, nav.path.length);
      const p = live.movement!.position(botId)!;
      if (Math.hypot(p[0] - hx, p[2] - hz) <= 2.5) return { ticks: i, maxPath };
    }
    return { ticks: null, maxPath };
  };
  return { live, run, botId, humanId, place, step: (n: number) => { for (let i = 0; i < n; i++) live.stepTick(++tick); }, end: () => fetch(`${h.origin}/api/sparring/end`, { method: "POST", headers, body: JSON.stringify({ roomCode }) }) };
}

test("a bot crosses each bridge from every satellite to an idle human at the centre, and back", async () => {
  const s = await setup();
  const report: string[] = [];
  for (const [name, x, z] of [["west", -36, 0], ["east", 36, 0], ["north", 0, -32], ["south", 0, 32]] as const) {
    const there = s.run(x, z, 0, 0);
    expect(there.ticks, `${name} -> centre`).not.toBeNull();
    const back = s.run(0, 0, x, z);
    expect(back.ticks, `centre -> ${name}`).not.toBeNull();
    report.push(`${name}: ${there.ticks}/${back.ticks} ticks, route nodes ${there.maxPath}/${back.maxPath}`);
  }
  console.log("GR13 routes", report.join("; "));
  await s.end();
}, 120_000);

test("a target behind a pillar is reached instead of stopping on its front face", async () => {
  const s = await setup();
  for (const [bx, bz, hx, hz] of [[20, -13.5, 20, -19], [-20, -13.5, -20, -19], [20, 13.5, 20, 19], [-20, 13.5, -20, 19]] as const) {
    const r = s.run(bx, bz, hx, hz);
    expect(r.ticks, `${bx},${bz} -> ${hx},${hz}`).not.toBeNull();
    expect(r.maxPath).toBeGreaterThan(2);
  }
  // Wall: bot on one side of wall.1, human on the other.
  expect(s.run(16, -2, 16, 2).ticks).not.toBeNull();
  await s.end();
}, 120_000);

test("an unreachable target (void) stops the bot safely and keeps it alive", async () => {
  const s = await setup();
  s.place(s.botId, 10, -43.5); s.place(s.humanId, 10, -55); // ARENA01: main island north edge is z=-45; x=10 is off the bridge
  s.step(300);
  const p = s.live.movement!.position(s.botId)!;
  expect(p[2]).toBeGreaterThan(-43.7);
  expect(s.live.combat.get(s.botId)!.action).not.toBe("Dead");
  await s.end();
}, 60_000);
