import { afterAll, beforeAll, expect, test } from "vitest";
import { Client, type Room } from "@colyseus/sdk";
import { matchMaker } from "colyseus";
import { startHarness, waitFor, players, type Harness } from "../fixtures/harness.js";
import { ARENA } from "../../packages/shared/src/config/arena.js";
import { BEAST, BEAST_ENTITY_ID } from "../../packages/shared/src/config/beast.js";
import { computeContentHash } from "../../packages/shared/src/config/content.js";
import { PROTOCOL_VERSION, type CombatEvent } from "../../packages/shared/src/protocol.js";
import type { SparringRoom } from "../../apps/server/src/rooms/SparringRoom.js";

let h: Harness;
beforeAll(async () => { h = await startHarness(); });
afterAll(async () => { await h.stop(); });
const hash = computeContentHash();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function http(cookie = "", csrf = "") {
  return async (path: string, data?: unknown) => fetch(`${h.origin}${path}`, {
    method: data === undefined ? "GET" : "POST", headers: { origin: h.origin, cookie, "x-csrf-token": csrf, "content-type": "application/json" },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
}
async function hostRoom(bots: string[] = []) {
  const adult = h.svc.sessions.create("Host");
  const api = http(`eb_session=${adult.cookieToken}`, adult.session.csrf);
  const code = ((await (await api("/api/sparring", { bots })).json()) as { roomCode: string }).roomCode;
  const t = (await (await api("/api/join-ticket", { roomCode: code })).json()) as { ticket: string; roomId: string };
  const room = await new Client(`ws://localhost:${h.port}`).joinById(t.roomId, { ticket: t.ticket, roomCode: code, protocolVersion: PROTOCOL_VERSION, contentHash: hash });
  const events: CombatEvent[] = [];
  room.onMessage("welcome", () => undefined); room.onMessage("actionResult", () => undefined);
  room.onMessage("combatEvent", (e: CombatEvent) => events.push(e));
  await waitFor(() => players(room).size > 0);
  return { api, code, room, events };
}
const live = (r: Room): SparringRoom => matchMaker.getLocalRoomById(r.roomId) as unknown as SparringRoom;
function place(room: SparringRoom, id: number, x: number, z: number) {
  const b = room.movement!.get(id)!;
  const pos = { x, y: (room.world!.groundHeight(x, z) ?? 0) + ARENA.capsule.centreAboveSurface, z };
  b.rb.setTranslation(pos, true); b.rb.setNextKinematicTranslation(pos);
  b.state.vx = b.state.vz = b.state.vy = 0;
}
const beastOf = (r: Room) => (r.state as unknown as { beast: { phase: string; hp100: number; hpMax100: number; x: number; z: number; scale100: number } }).beast;

test("a real client sees the warning, the spawn and a human thrown near the rim lands on the island; defeat heals", async () => {
  const { api, code, room, events } = await hostRoom();
  room.send("ready", { kitId: "sv", contentHash: hash });
  await waitFor(() => [...players(room).values()].every((p) => p.ready));
  const sr = live(room);
  const me = [...players(room).values()][0].entityId as number;
  await waitFor(() => sr.sim.tick > sr.combat.get(me)!.protectedUntilTick + 2, 4000);
  (sr as unknown as { regenDelayTicks: number }).regenDelayTicks = 1e9;
  expect(beastOf(room).phase).toBe("none");
  sr.beast.spawnAt(sr.sim.tick + 1);
  await waitFor(() => beastOf(room).phase === "warning", 3000, "warning");
  await waitFor(() => beastOf(room).phase === "alive", 6000, "beast alive");
  expect(beastOf(room).scale100).toBe(550);
  expect(beastOf(room).hpMax100).toBeGreaterThanOrEqual(30000);
  expect(sr.combat.get(BEAST_ENTITY_ID)).toBeDefined();
  // It is not a roster entry: no scoreboard row, no nameplate, no bot bookkeeping.
  expect([...players(room).values()].some((p) => p.entityId === BEAST_ENTITY_ID)).toBe(false);

  // Put the human in front of the beast, close to the island's far corner so an outward throw would be fatal.
  const b = sr.movement!.position(BEAST_ENTITY_ID)!;
  const sx = Math.sign(b[0]), sz = Math.sign(b[2]);
  const hx = sx * 33, hz = sz * 27; // 3 m from the 36 x 30 corner
  place(sr, me, hx, hz);
  const bb = sr.movement!.get(BEAST_ENTITY_ID)!;
  const bpos = { x: hx - sx * 4, y: b[1], z: hz - sz * 4 };
  bb.rb.setTranslation(bpos, true); bb.rb.setNextKinematicTranslation(bpos); // the beast is toward the centre, the rim behind the human
  const hpBefore = sr.combat.get(me)!.hp100;
  await waitFor(() => events.some((e) => e.kind === "hit" && e.actorId === String(BEAST_ENTITY_ID) && e.targetId === String(me)), 12000, "beast hit");
  expect(sr.combat.get(me)!.hp100).toBeLessThan(hpBefore);
  expect(sr.combat.get(me)!.hp100).toBeGreaterThanOrEqual(100);
  // Watch the whole flight and the landing: never below the void plane, always back over walkable ground.
  let lowest = Infinity;
  const until = sr.sim.tick + 240;
  while (sr.sim.tick < until) { lowest = Math.min(lowest, sr.movement!.position(me)![1]); await sleep(15); }
  const end = sr.movement!.position(me)!;
  expect(lowest).toBeGreaterThan(ARENA.voidY);
  expect(sr.world!.walkableTop(end[0], end[2])).not.toBeNull();
  expect(events.some((e) => e.kind === "ko" && e.targetId === String(me))).toBe(false);

  // Defeat: living humans are healed, the beast entity is gone and no respawn is queued for it.
  sr.combat.get(me)!.hp100 = 3000;
  sr.combat.kill(BEAST_ENTITY_ID, sr.sim.tick);
  await waitFor(() => beastOf(room).phase === "defeated", 3000, "defeated");
  expect(sr.combat.get(BEAST_ENTITY_ID)).toBeUndefined();
  expect(sr.respawns.isPending(BEAST_ENTITY_ID)).toBe(false);
  expect(sr.combat.get(me)!.hp100).toBeGreaterThanOrEqual(3000 + BEAST.defeatHeal100 - 100);
  await waitFor(() => beastOf(room).phase === "none", 6000, "cleared");
  expect(sr.combat.invariantViolations()).toEqual([]);
  await api("/api/sparring/end", { roomCode: code });
}, 60000);

test("bots cannot hurt the beast and the beast never targets bots", async () => {
  const { api, code, room } = await hostRoom(["easy"]);
  room.send("ready", { kitId: "sv", contentHash: hash });
  await waitFor(() => [...players(room).values()].every((p) => p.ready));
  const sr = live(room);
  // Friendly rules are the whole contract here; they are pure on the room.
  const f = (a: number, t: number) => (sr as unknown as { isFriendly(a: number, t: number): boolean }).isFriendly(a, t);
  const bot = [...players(room).values()].find((p) => p.displayName === "Bot 1")!.entityId as number;
  const human = [...players(room).values()].find((p) => p.displayName === "Host")!.entityId as number;
  expect(f(bot, BEAST_ENTITY_ID)).toBe(true);
  expect(f(BEAST_ENTITY_ID, bot)).toBe(true);
  expect(f(human, BEAST_ENTITY_ID)).toBe(false);
  expect(f(BEAST_ENTITY_ID, human)).toBe(false);
  await api("/api/sparring/end", { roomCode: code });
}, 20000);
