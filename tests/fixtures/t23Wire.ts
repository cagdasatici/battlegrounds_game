import { matchMaker } from "colyseus";
import { loginClient, waitFor, players, freshCode, type Harness } from "./harness.js";
import type { CombatEvent } from "../../packages/shared/src/protocol.js";
import type { ArenaRoom } from "../../apps/server/src/rooms/ArenaRoom.js";
import { computeLayout } from "../../apps/client/src/input/ControlLayout.js";
import { PointerRouter } from "../../apps/client/src/input/PointerRouter.js";
import { IntentSampler } from "../../apps/client/src/input/IntentSampler.js";

/**
 * Shared three client rig for the T23 wire tests, over real Colyseus connections: three real clients. A drives the real touch input stack
 * (PointerRouter + IntentSampler, Attack button held/released over live packets); B and C only observe and are victims.
 * Every assertion reads what each of the three clients received (replicated players, replicated urns, combat events).
 * Fixtures only place fighters and set A's form, the same server body placement API as the T24 wire test.
 */
const L = computeLayout({ x0: 0, y0: 0, W: 1024, H: 768 });
export type K = "A" | "B" | "C";
export const KEYS: K[] = ["A", "B", "C"];

export async function setup(h: Harness, kitA: "td" | "sv") {
  const code = freshCode();
  const a = await loginClient(h, "Arel");
  const b = await loginClient(h, "Nora");
  const c = await loginClient(h, "Cato");
  const ra = await a.join(code), rb = await b.join(code), rc = await c.join(code);
  const rooms = { A: ra, B: rb, C: rc };
  const events: Record<K, CombatEvent[]> = { A: [], B: [], C: [] };
  KEYS.forEach((k) => rooms[k].onMessage("combatEvent", (e: CombatEvent) => { events[k].push(e); }));
  await waitFor(() => a.welcome !== null && [ra, rb, rc].every((r) => players(r).size === 3), 4000, "joined");
  a.send("ready", { kitId: kitA, contentHash: a.localContentHash });
  b.send("ready", { kitId: "sv", contentHash: b.localContentHash });
  c.send("ready", { kitId: "sv", contentHash: c.localContentHash });
  const by = (r: typeof ra, n: string) => [...players(r).values()].find((p) => p.displayName === n);
  await waitFor(() => ["Arel", "Nora", "Cato"].every((n) => [ra, rb, rc].every((r) => by(r, n)?.ready && by(r, n).action === "Idle")), 4000, "ready");
  const room = matchMaker.getLocalRoomById(ra.roomId) as unknown as ArenaRoom;
  const id = (n: string) => by(ra, n).entityId as number;
  const aId = id("Arel"), bId = id("Nora"), cId = id("Cato");
  await waitFor(() => [aId, bId, cId].every((i) => room.sim.tick > room.combat.get(i)!.protectedUntilTick + 2 && room.movement!.get(i)!.state.grounded), 5000, "settled");
  const router = new PointerRouter(L);
  const sampler = new IntentSampler(router, a.welcome!.epoch);
  let tick = 0;
  // Live input: one packet every 16 ms so the server hold lease never lapses (test harness driver, not game code).
  const timer = setInterval(() => { const p = sampler.sample(++tick); if (p) a.send("input", p); }, 16);
  const atk = L.controls.attack;
  let pid = 500;
  const pressAttack = (): number => { const p = ++pid; router.down({ pointerId: p, x: atk.cx, y: atk.cy }); return p; };
  const releaseAttack = (p: number) => router.up(p);
  const place = (i: number, x: number, y: number, z: number, yaw: number) => {
    const body = room.movement!.get(i)!;
    body.rb.setTranslation({ x, y, z }, true);
    body.rb.setNextKinematicTranslation({ x, y, z });
    body.state.facingYaw = yaw; body.state.vx = 0; body.state.vz = 0;
  };
  const urnOn = (k: K, i: number) => (rooms[k].state as unknown as { urns: Map<string, { state: string; holderId: number; returnTick: number }> }).urns.get(String(i));
  const stop = async () => { clearInterval(timer); for (const cl of [a, b, c]) await cl.leave(); };
  return { clients: { a, b, c }, rooms, events, by, room, aId, bId, cId, place, pressAttack, releaseAttack, urnOn, stop };
}
export type Ctx = Awaited<ReturnType<typeof setup>>;
export const hpOn = (x: Ctx, k: K, name: string): number => x.by(x.rooms[k], name).hp100;
export const everywhere = <T,>(f: (k: K) => T) => KEYS.map(f);

