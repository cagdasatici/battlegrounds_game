// Test-only page (UX10): the real GameScene, real presentation modules (HitFx, kit fx, telegraphs) and a fake combat bus.
// A script plays replicated action phases and server combat events, exactly the inputs production presents. Not shipped.
import { WebGLRenderer } from "three";
import { buildIslandsMap } from "../../../packages/shared/src/config/arena.js";
import { DENSITY, GLOW_BUDGET } from "../../../apps/client/src/scene/GlowLayer.js";
import { POOL_CAPACITY } from "../../../apps/client/src/scene/EffectsPool.js";
import { GameScene } from "../../../apps/client/src/scene/GameScene.js";
import { CombatBus } from "../../../apps/client/src/app/CombatBus.js";
import { registerPresentation } from "../../../apps/client/src/fx/index.js";
import { layeredFxProbe } from "../../../apps/client/src/fx/LayeredFx.js";
import type { CombatEvent } from "../../../packages/shared/src/protocol.js";

type Kit = "sv" | "td" | "ea";
interface P { x: number; y: number; z: number; facingYaw: number; action: string; moveId: string; actionStartTick: number; actionEndTick: number; kitId: Kit; beast: boolean }

const renderer = new WebGLRenderer({ antialias: true });
document.body.append(renderer.domElement);
const gs = new GameScene(renderer, buildIslandsMap().colliders, window);
const players = new Map<string, P>();
let emit: (e: CombatEvent) => void = () => {};
const bus = new CombatBus((h) => { emit = h; return () => { emit = () => {}; }; }, () => undefined);
const settings = { reducedMotion: false, flashLevel: 0.3 };
const shakes: Array<{ a: number; ms: number }> = [];
const tick = (): number => Math.floor(performance.now() / (1000 / 60));
const dispose = registerPresentation(bus, {
  scene: gs.scene, camera: gs.camera, players: () => players as Map<string, unknown>, settings: { get: () => settings },
  localId: () => "sv", effects: gs.effects, fighters: (id) => gs.viewFor(id), shake: (a, ms) => { shakes.push({ a, ms }); },
  serverTick: tick, surfaceHeight: (_x, _z, y) => y - 0.9,
});

/** Point lights of the effects layer that are actually emitting right now. */
const litLights = (): number => { let n = 0; gs.scene.traverse((o) => { const l = o as unknown as { isLight?: boolean; intensity: number }; if (o.name.startsWith("fx.light.") && l.isLight && l.intensity > 0.001) n++; }); return n; };
const yawQ = (rad: number): number => Math.round((((rad / (Math.PI * 2)) % 1) + 1) % 1 * 1024) % 1024;
let seq = 0;
function place(id: string, kit: Kit, x: number, z: number, yaw: number): void {
  const old = gs.viewFor(id);
  if (!old) gs.addFighter(id, kit);
  gs.viewFor(id)!.setPose(x, 0.9, z, yaw);
  players.set(id, { x: x * 100, y: 90, z: z * 100, facingYaw: yawQ(yaw), action: "Idle", moveId: "", actionStartTick: 0, actionEndTick: 0, kitId: kit, beast: false });
}
// Default lineup: sv attacker faces td victim across 3 m, the other two stand behind as bystanders.
place("sv", "sv", -1.5, 6, -Math.PI / 2 + Math.PI); // yaw irrelevant for pose, facing set below
place("td", "td", 1.5, 6, 0);
place("ea", "ea", -1.5, 9, 0);
place("sv2", "sv", 1.5, 9, 0);
function face(id: string, tx: number, tz: number): void {
  const p = players.get(id)!, dx = tx - p.x / 100, dz = tz - p.z / 100, yaw = Math.atan2(-dx, -dz); // yaw 0 faces -Z
  p.facingYaw = yawQ(yaw);
  gs.viewFor(id)!.setPose(p.x / 100, 0.9, p.z / 100, yaw);
}
face("sv", 1.5, 6); face("td", -1.5, 6); face("ea", 1.5, 9); face("sv2", -1.5, 9);
const cam = (x: number, y: number, z: number, px: number, py: number, pz: number): void => gs.setCamera({ position: { x, y, z }, pivot: { x: px, y: py, z: pz }, yaw: 0, pitch: 0, distance: 6 });
cam(0, 2.6, 12.5, 0, 1.1, 6);

let frames = 0, prev = performance.now();
// Optional moving Ember Orb: fed to the real ProjectileViews exactly as the game loop feeds replicated projectiles.
const peak = { calls: 0, triangles: 0 };
let orb: { x0: number; z: number; t0: number; full: boolean } | null = null;
const loop = (now: number): void => {
  if (orb) {
    const tk = tick(), x = orb.x0 + ((tk - orb.t0) / 60) * 4;
    gs.projectiles.sync(x > 6 ? [] : [["1", { entityId: 1, ownerId: 1, spawnTick: orb.t0, x: Math.round(x * 100), y: 130, z: Math.round(orb.z * 100), vx: 400, vy: 0, vz: 0, chargeClass: orb.full ? "full" : "light", reflectionCount: 0, remainingTicks: 30 }]], tk, tk + 8);
  }
  gs.render(Math.min(0.05, (now - prev) / 1000)); prev = now; frames++;
  const r = renderer.info.render; peak.calls = Math.max(peak.calls, r.calls); peak.triangles = Math.max(peak.triangles, r.triangles);
  requestAnimationFrame(loop);
};
requestAnimationFrame(loop);

(window as unknown as { __fx: unknown }).__fx = {
  frames: () => frames,
  info: () => ({ calls: renderer.info.render.calls, triangles: renderer.info.render.triangles }),
  quality: (q: "low" | "medium" | "high") => gs.setQuality(q),
  settings: (s: Partial<typeof settings>) => { Object.assign(settings, s); },
  cam,
  place, face,
  /** Plays a replicated action phase for one fighter, `ticks` long. */
  act: (id: string, action: string, moveId: string, ticks = 30) => {
    const p = players.get(id)!, t = tick();
    p.action = action; p.moveId = moveId; p.actionStartTick = t; p.actionEndTick = t + ticks;
    gs.viewFor(id)?.setAction(action, moveId, ticks);
  },
  /** FX01: sets the replicated beast flag of a fighter. */
  beast: (id: string, on: boolean) => { players.get(id)!.beast = on; },
  layers: () => ({ decals: layeredFxProbe.decals(), pulses: layeredFxProbe.pulses(), decalMeshes: gs.scene.children.filter((c) => c.name === "fx.decal").length, pulseEl: document.querySelector('[data-fx="screen-pulse"]') !== null }),
  idle: (id: string) => { const p = players.get(id)!; p.action = "Idle"; p.moveId = ""; gs.viewFor(id)?.setAction("Idle", "", 0); },
  /** Emits a server combat event on the bus. */
  event: (e: Partial<CombatEvent>) => { emit({ eventId: `e${seq++}`, tick: tick(), kind: "hit", actorId: "sv", targetId: "td", lifeId: 1, ...e } as CombatEvent); },
  fx: () => ({ active: gs.effects.activeCount, capacity: gs.effects.capacity, glow: gs.effects.glow.stats(), lit: litLights() }),
  /** Peak draw calls and triangles of any rendered frame since the last reset (renderer.info is per frame). */
  peak: () => ({ ...peak }),
  resetPeak: () => { peak.calls = 0; peak.triangles = 0; },
  budget: () => ({ glow: GLOW_BUDGET, pool: POOL_CAPACITY, density: DENSITY }),
  shakes: () => shakes.slice(),
  orb: (on: boolean, x0 = -4, z = 6, full = true) => { orb = on ? { x0, z, t0: tick(), full } : null; if (!on) gs.projectiles.sync([], 0, 0); },
  remove: (id: string) => { players.delete(id); gs.removeFighter(id); },
  dispose: () => { dispose(); bus.dispose(); gs.dispose(); },
};
