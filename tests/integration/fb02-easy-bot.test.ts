import { afterAll, beforeAll, expect, test } from "vitest";
import { Client, type Room } from "@colyseus/sdk";
import { matchMaker } from "colyseus";
import { startHarness, waitFor, players, type Harness } from "../fixtures/harness.js";
import { computeContentHash } from "../../packages/shared/src/config/content.js";
import { PROTOCOL_VERSION } from "../../packages/shared/src/protocol.js";
import { ARENA } from "../../packages/shared/src/config/arena.js";
import { neutralIntent } from "../../apps/server/src/net/ValidateInput.js";
import type { SparringRoom } from "../../apps/server/src/rooms/SparringRoom.js";
import type { Difficulty } from "../../packages/shared/src/sparring.js";

let h: Harness;
beforeAll(async () => { h = await startHarness(); });
afterAll(async () => { await h.stop(); });
const hash = computeContentHash();

interface Result { botKilled: boolean; humanDied: boolean; ticks: number; dmgToHuman: number }

/**
 * FB02: a real joined client plus a scripted human that only walks to the bot and presses basic strike when in
 * range. The fight is stepped by manual ticks. Seeds vary the room (entity IDs, spawn ticks) and the warm-up.
 */
async function fight(tier: Difficulty, seed: number, maxTicks: number, sustain: boolean): Promise<Result> {
  const adult = h.svc.sessions.create(`Host${tier}${seed}`);
  const headers = { origin: h.origin, cookie: `eb_session=${adult.cookieToken}`, "x-csrf-token": adult.session.csrf, "content-type": "application/json" };
  const created = await fetch(`${h.origin}/api/sparring`, { method: "POST", headers, body: JSON.stringify({ bots: [tier] }) });
  const { roomCode } = await created.json() as { roomCode: string };
  const t = await (await fetch(`${h.origin}/api/join-ticket`, { method: "POST", headers, body: JSON.stringify({ roomCode }) })).json() as { ticket: string; roomId: string };
  const room: Room = await new Client(`ws://localhost:${h.port}`).joinById(t.roomId, { ticket: t.ticket, roomCode, protocolVersion: PROTOCOL_VERSION, contentHash: hash });
  room.onMessage("welcome", () => undefined); room.onMessage("actionResult", () => undefined); room.onMessage("combatEvent", () => undefined);
  await waitFor(() => players(room).size === 2);
  room.send("ready", { kitId: "sv", contentHash: hash });
  await waitFor(() => [...players(room).values()].every(p => p.ready));
  const live = matchMaker.getLocalRoomById(room.roomId) as unknown as SparringRoom;
  live.setSimulationInterval(() => undefined, 1000);
  const botId = [...players(room).values()].find(p => p.displayName === "Bot 1")!.entityId as number;
  const humanId = [...players(room).values()].find(p => p.displayName === `Host${tier}${seed}`)!.entityId as number;
  const seat = [...(live as unknown as { seats: Map<string, { input: import("../../apps/server/src/net/ValidateInput.js").InputChannel }> }).seats.values()][0]!;
  const place = (id: number, x: number, z: number) => {
    const b = live.movement!.get(id)!;
    const pos = { x, y: (live.world!.groundHeight(x, z) ?? 0) + ARENA.capsule.centreAboveSurface, z };
    b.rb.setTranslation(pos, true); b.rb.setNextKinematicTranslation(pos);
    b.state.vx = b.state.vz = b.state.vy = 0;
  };
  let tick = live.sim.tick;
  for (let i = 0; i < 20 + seed * 17; i++) live.stepTick(++tick);
  const lives = new Map<number, number>();
  const result: Result = { botKilled: false, humanDied: false, ticks: 0, dmgToHuman: 0 };
  let humanHp = live.combat.get(humanId)!.hp100;
  for (let i = 0; i < maxTicks; i++) {
    for (const [id, x, z] of [[botId, 0, 0], [humanId, 0, -5]] as const) {
      const f = live.combat.get(id);
      if (f && lives.get(id) !== f.lifeId) { lives.set(id, f.lifeId); place(id, x, z); }
    }
    const bp = live.movement!.position(botId), hp = live.movement!.position(humanId);
    if (bp && hp) {
      const dx = bp[0] - hp[0], dz = bp[2] - hp[2], dist = Math.hypot(dx, dz);
      const yaw = Math.atan2(-dx, -dz);
      const inRange = dist <= 1.8;
      seat.input.held = { ...neutralIntent(), moveX: inRange ? 0 : -Math.sin(yaw), moveZ: inRange ? 0 : -Math.cos(yaw), yaw, attackHeld: inRange };
      seat.input.lastInputTick = tick; seat.input.lastReceivedSeq++;
    }
    live.stepTick(++tick);
    result.ticks = i + 1;
    const hf = live.combat.get(humanId)!, bf = live.combat.get(botId)!;
    if (hf.hp100 < humanHp) result.dmgToHuman += humanHp - hf.hp100;
    humanHp = hf.hp100;
    if (sustain) {
      if (hf.hp100 < 3000) { hf.hp100 = 10000; humanHp = 10000; }
      if (bf.hp100 < 3000) bf.hp100 = 10000;
    } else if (bf.hp100 <= 0 || (players(room).get(String(botId)).deaths as number) > 0) { result.botKilled = true; break; }
    else if ((players(room).get(String(humanId)).deaths as number) > 0 || hf.hp100 <= 0) { result.humanDied = true; break; }
  }
  await fetch(`${h.origin}/api/sparring/end`, { method: "POST", headers, body: JSON.stringify({ roomCode }) });
  await room.leave().catch(() => undefined);
  return result;
}

test("FB02: a strike-only scripted player beats an easy bot in >= 4 of 5 seeds", async () => {
  let wins = 0;
  for (let seed = 1; seed <= 5; seed++) {
    const r = await fight("easy", seed, 3600, false);
    if (r.botKilled && !r.humanDied) wins++;
  }
  expect(wins).toBeGreaterThanOrEqual(4);
}, 120000);

test("FB02: easy bot deals at most half the damage per minute of a medium bot", async () => {
  let easy = 0, medium = 0;
  for (let seed = 1; seed <= 5; seed++) {
    easy += (await fight("easy", seed, 3600, true)).dmgToHuman;
    medium += (await fight("medium", seed, 3600, true)).dmgToHuman;
  }
  expect(medium).toBeGreaterThan(0);
  expect(easy / medium).toBeLessThanOrEqual(0.5);
}, 180000);
