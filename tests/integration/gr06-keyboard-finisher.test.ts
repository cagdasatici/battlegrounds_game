import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { matchMaker } from "colyseus";
import { startHarness, loginClient, waitFor, players, freshCode, type Harness } from "../fixtures/harness.js";
import type { CombatEvent } from "../../packages/shared/src/protocol.js";
import type { ArenaRoom } from "../../apps/server/src/rooms/ArenaRoom.js";
import { computeLayout } from "../../apps/client/src/input/ControlLayout.js";
import { PointerRouter } from "../../apps/client/src/input/PointerRouter.js";
import { KeyboardRouter } from "../../apps/client/src/input/KeyboardRouter.js";
import { IntentSampler } from "../../apps/client/src/input/IntentSampler.js";

let h: Harness;
beforeAll(async () => { h = await startHarness(25689); });
afterAll(async () => { await h.stop(); });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const L = computeLayout({ x0: 0, y0: 0, W: 1024, H: 768 });

describe("GR06 keyboard Space hold over real clients", () => {
  test("held Space during M1 gives a grounded uppercut with no jump; Space before the combo jumps; repeat adds none", async () => {
    const code = freshCode();
    const a = await loginClient(h, "Arel"), b = await loginClient(h, "Nora");
    const ra = await a.join(code), rb = await b.join(code);
    const events: CombatEvent[] = [];
    rb.onMessage("combatEvent", (e: CombatEvent) => { events.push(e); });
    await waitFor(() => a.welcome !== null && players(ra).size === 2 && players(rb).size === 2, 3000, "joined");
    a.send("ready", { kitId: "sv", contentHash: a.localContentHash });
    b.send("ready", { kitId: "td", contentHash: b.localContentHash });
    const byName = (n: string) => [...players(rb).values()].find((p) => p.displayName === n);
    await waitFor(() => byName("Arel")?.ready && byName("Nora")?.ready && byName("Arel").action === "Idle", 3000, "ready");
    const room = matchMaker.getLocalRoomById(ra.roomId) as unknown as ArenaRoom;
    const aId = byName("Arel").entityId as number, bId = byName("Nora").entityId as number;
    await waitFor(() => room.sim.tick > room.combat.get(bId)!.protectedUntilTick + 2
      && room.sim.tick > room.combat.get(aId)!.protectedUntilTick + 2 && room.movement!.get(bId)!.state.grounded
      && room.movement!.get(aId)!.state.grounded, 4000, "settled");
    const place = () => {
      const mv = room.movement!; const bp = mv.position(bId)!; const m = mv.get(aId)!;
      const p = { x: bp[0], y: bp[1], z: bp[2] + 1.5 };
      m.rb.setTranslation(p, true); m.rb.setNextKinematicTranslation(p);
      m.state.facingYaw = 0; m.state.vx = 0; m.state.vz = 0;
    };
    place(); await sleep(60);

    const router = new PointerRouter(L);
    const kb = new KeyboardRouter(router);
    const sampler = new IntentSampler(router, a.welcome!.epoch);
    let tick = 0;
    const pump = async (ms: number) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { a.send("input", sampler.sample(++tick)!); await sleep(33); } };

    // Hold M1, press/hold Space mid-combo (OS repeat included): uppercut, no ordinary jump.
    const y0 = room.movement!.position(aId)![1];
    const before = events.length;
    let maxRise = 0;
    kb.mouseButton(0, true);
    const t0 = Date.now();
    let spaced = false;
    while (Date.now() - t0 < 1500) {
      const el = Date.now() - t0;
      if (!spaced && el > 300) { kb.keyDown("Space"); spaced = true; }
      if (spaced) kb.keyDown("Space", true);
      a.send("input", sampler.sample(++tick)!);
      maxRise = Math.max(maxRise, room.movement!.position(aId)![1] - y0);
      await sleep(33);
    }
    kb.keyUp("Space"); kb.mouseButton(0, false);
    await pump(200);
    const c1 = events.slice(before).filter((e) => e.kind === "cast" && e.actorId === String(aId)).map((e) => e.moveId);
    expect(c1.slice(0, 4)).toEqual(["m1.1", "m1.2", "m1.3", "m1.4.uppercut"]);
    expect(maxRise).toBeLessThan(0.05);

    // Space before any combo jumps normally.
    await waitFor(() => room.combat.get(bId)!.action === "Idle" && room.movement!.get(bId)!.state.grounded
      && room.combat.get(aId)!.action === "Idle" && room.movement!.get(aId)!.state.grounded, 5000, "recovered");
    place(); await sleep(60);
    const y1 = room.movement!.position(aId)![1];
    kb.keyDown("Space");
    let rise = 0;
    for (let i = 0; i < 12; i++) { a.send("input", sampler.sample(++tick)!); await sleep(33); rise = Math.max(rise, room.movement!.position(aId)![1] - y1); }
    expect(rise).toBeGreaterThan(0.2);
    // Second distinct airborne press yields exactly one air jump; OS repeat none.
    kb.keyUp("Space"); await pump(66);
    kb.keyDown("Space"); kb.keyDown("Space", true); kb.keyDown("Space", true);
    await pump(150);
    await waitFor(() => room.movement!.get(aId)!.state.airJumpsUsed === 1, 1500, "one air jump");
    kb.keyUp("Space");
    kb.keyDown("Space", true); await pump(150);
    expect(room.movement!.get(aId)!.state.airJumpsUsed).toBeLessThanOrEqual(1);
    expect(room.combat.invariantViolations()).toEqual([]);
    await a.leave(); await b.leave();
  }, 30000);
});
