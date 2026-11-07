// Test-only page: the real GameScene and fighter views over the real islands map, three kits side by side. Not shipped.
import { WebGLRenderer } from "three";
import { buildIslandsMap } from "../../../packages/shared/src/config/arena.js";
import { GameScene } from "../../../apps/client/src/scene/GameScene.js";
import { MAP_REGISTRY, buildMapCollision } from "../../../packages/shared/src/config/maps.js";

import { ENV_VARIANT } from "../../../apps/client/src/scene/EnvPalette.js";
// FB08 drafting: ?sky=N&rock=N&bridge=N override the chosen look before the scene is built.
for (const k of ["sky", "rock", "bridge"] as const) { const v = new URLSearchParams(location.search).get(k); if (v !== null) ENV_VARIANT[k] = Number(v); }
const renderer = new WebGLRenderer({ antialias: true });
const startQuality = new URLSearchParams(location.search).get("q"); // GFX01: ?q=low|medium|high selects the tier before the first frame
document.body.append(renderer.domElement);
const gs = new GameScene(renderer, buildIslandsMap().colliders, window);
// WORLD01: ?map=<registry id> shows that world (the grove loads first, exactly like the game, then the scene swaps).
const mapParam = new URLSearchParams(location.search).get("map") ?? "grove";
if (mapParam !== "grove" && Object.hasOwn(MAP_REGISTRY, mapParam)) { const def = MAP_REGISTRY[mapParam]!; gs.setWorld(def, buildMapCollision(def).colliders); }
if (startQuality === "low" || startQuality === "medium" || startQuality === "high") gs.setQuality(startQuality);
if (new URLSearchParams(location.search).get("lite") === "1") { const e = gs.scene.getObjectByName("deco.env"); if (e) e.visible = false; } // GFX01: fighter timing specs hide the environment layer
void gs.loadEnvironment();
const kits = ["sv", "td", "ea"] as const;
kits.forEach((k, i) => {
  const v = gs.addFighter(k, k);
  v.setPose(-2.2 + i * 2.2, 0.9, 6, Math.PI + 0.3 * (1 - i)); // fronts towards the camera
});
const route = new URLSearchParams(location.search).get("view");
if (route === "route" || route === "reverse") kits.forEach((k, i) => gs.viewFor(k)?.setPose(32 + i * 1.5, 0.9, -1, Math.PI / 2));
// QF01: rear view, all three kits facing away from the camera on one line, camera `dist` metres behind them.
const rearDist = Number(new URLSearchParams(location.search).get("dist") ?? 8);
if (route === "rear") kits.forEach((k, i) => gs.viewFor(k)?.setPose(-1.5 + i * 1.5, 0.9, 0, 0));
// QF02: side view, same line along z, camera `dist` metres out on +x.
if (route === "side") kits.forEach((k, i) => gs.viewFor(k)?.setPose(0, 0.9, -1.5 + i * 1.5, 0));
// QE02: coverage shots. Attacker (sv) stands at `from`, defender (td) 2.2 m ahead facing back; the camera sits 5.2 m behind
// the attacker, 2.4 m up, looking at a point ahead of them (the same framing as the default gameplay camera).
// view=spawn&i=0..7 (spawn anchor facing the centre), view=bridge|sat&n=north|south|east|west (on the bridge facing out,
// or on the satellite facing back to the main island), view=wall&i=0|1 (across a wall, camera on the centre side).
const qp = new URLSearchParams(location.search);
let cover: { camera: { position: { x: number; y: number; z: number }; pivot: { x: number; y: number; z: number } } } | null = null;
if (route === "spawn" || route === "bridge" || route === "sat" || route === "wall") {
  const dirs = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] } as const;
  const n = (qp.get("n") ?? "east") as keyof typeof dirs;
  const i = Number(qp.get("i") ?? 0);
  const anchors = [[-27, -21], [27, -21], [-27, 21], [27, 21], [-64, -3], [64, -3], [-64, 3], [64, 3]] as const;
  let from: [number, number], d: [number, number];
  if (route === "spawn") { from = [anchors[i]![0], anchors[i]![1]]; const l = Math.hypot(from[0], from[1]); d = [-from[0] / l, -from[1] / l]; }
  else if (route === "bridge") { const v = dirs[n]; from = [v[0] * 25.5, v[1] * 23]; d = [v[0], v[1]]; if (n === "east" || n === "west") from = [v[0] * 25.2, 0]; else from = [0, v[1] * 21.2]; }
  else if (route === "sat") { const v = dirs[n]; from = [v[0] * 36, v[1] * 32]; if (n === "east" || n === "west") from = [v[0] * 36, 0]; else from = [0, v[1] * 32]; d = [-v[0], -v[1]]; }
  else { const wx = i === 0 ? -16 : 16; from = [wx, -2.4]; d = [0, 1]; }
  const yawOf = (dx: number, dz: number): number => Math.atan2(-dx, -dz);
  const defender: [number, number] = route === "wall" ? [from[0], 2.4] : [from[0] + d[0] * 2.2, from[1] + d[1] * 2.2];
  gs.viewFor("sv")?.setPose(from[0], 0.9, from[1], yawOf(d[0], d[1]));
  gs.viewFor("td")?.setPose(defender[0], 0.9, defender[1], yawOf(-d[0], -d[1]));
  gs.viewFor("ea")?.setPose(0, -60, 0, 0);
  cover = { camera: { position: { x: from[0] - d[0] * 5.2, y: 2.4, z: from[1] - d[1] * 5.2 }, pivot: { x: from[0] + d[0] * 1.6, y: 1.1, z: from[1] + d[1] * 1.6 } } };
}
const overview = new URLSearchParams(location.search).get("view") === "overview";
if (cover) gs.setCamera({ ...cover.camera, yaw: 0, pitch: 0, distance: 6 });
else gs.setCamera(route === "side"
  ? { position: { x: rearDist, y: 1.9, z: 0 }, pivot: { x: 0, y: 0.9, z: 0 }, yaw: Math.PI / 2, pitch: 0, distance: rearDist }
  : route === "rear"
  ? { position: { x: 0, y: 1.9, z: rearDist }, pivot: { x: 0, y: 0.9, z: 0 }, yaw: 0, pitch: 0, distance: rearDist }
  : route === "sea" ? { position: { x: 0, y: 7, z: -6 }, pivot: { x: 0, y: 0, z: 40 }, yaw: 0, pitch: 0, distance: 46 } // WORLD01: looking south over the beach to the sea
  : route === "shore" ? { position: { x: 30, y: 3.2, z: 30 }, pivot: { x: 40, y: 0, z: 46 }, yaw: 0, pitch: 0, distance: 18 }
  : route === "north" ? { position: { x: 0, y: 9, z: 24 }, pivot: { x: 0, y: 2, z: -40 }, yaw: 0, pitch: 0, distance: 66 }
  : route === "route"
  ? { position: { x: 40, y: 4, z: -4 }, pivot: { x: 25, y: 1, z: 0 }, yaw: 0, pitch: 0, distance: 15 }
  : route === "reverse" ? { position: { x: 24, y: 3, z: 2 }, pivot: { x: 34, y: 1, z: 0 }, yaw: 0, pitch: 0, distance: 10 }
  : overview
  ? { position: { x: 0, y: 20, z: 40 }, pivot: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: 0, distance: 40 }
  : { position: { x: 0, y: 2.2, z: 10.8 }, pivot: { x: 0, y: 1.1, z: 6 }, yaw: 0, pitch: 0, distance: 6 });
let frames = 0, prev = performance.now();
const loop = (now: number): void => { gs.render(Math.min(0.05, (now - prev) / 1000)); prev = now; frames++; requestAnimationFrame(loop); };
requestAnimationFrame(loop);
(window as unknown as { __art: unknown }).__art = {
  fourth: () => {
    const source = gs.viewFor("sv")!;
    const pos = source.group.position;
    gs.addFighter("fourth", "ea").setPose(pos.x + 1, pos.y, pos.z, source.group.rotation.y);
  },
  frames: () => frames,
  info: () => ({ calls: renderer.info.render.calls, triangles: renderer.info.render.triangles }),
  act: (kit: "sv" | "td" | "ea", action: string, moveId = "") => gs.viewFor(kit)?.setAction(action, moveId, 30),
  clip: (kit: "sv" | "td" | "ea") => gs.viewFor(kit)?.currentClip ?? "",
  hide: (prefix: string) => gs.scene.traverse((o) => { if (o.name.startsWith(prefix)) o.visible = false; }),
  envState: () => gs.envStatus,
  visible: (name: string) => gs.scene.getObjectByName(name)?.visible ?? false,
  count: (prefix: string) => { let n = 0; gs.scene.traverse((o) => { if (o.name.startsWith(prefix)) n++; }); return n; },
  /** Triangles per mesh name (instances counted, culling ignored) for budget analysis. */
  breakdown: () => { const r: Record<string, number> = {}; gs.scene.traverse((o) => { const m = o as unknown as { isMesh?: boolean; geometry: { index: { count: number } | null; attributes: { position: { count: number } } }; count?: number; visible: boolean }; if (!m.isMesh || !m.visible) return; r[o.name] = (m.geometry.index?.count ?? m.geometry.attributes.position.count) / 3 * ((m as { isInstancedMesh?: boolean }).isInstancedMesh ? (m.count ?? 1) : 1); }); return r; },
  awaken: (kit: "sv" | "td" | "ea", on: boolean) => gs.viewFor(kit)?.setAwakened(on),
  reduced: (on: boolean) => { gs.reducedMotion = on; },
  ambient: () => gs.ambientState(),
  quality: (q: "low" | "medium" | "high") => gs.setQuality(q),
  /** GFX01: GPU-inclusive frame cost. Renders `n` frames back to back with a 1-pixel readback after each (a full pipeline sync), returns ms per frame. */
  bench: (n: number): number[] => {
    const gl = renderer.getContext(), px = new Uint8Array(4), out: number[] = [];
    for (let i = 0; i < n; i++) { const t0 = performance.now(); gs.render(1 / 60); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); out.push(performance.now() - t0); }
    return out;
  },
  gl: () => { const gl = renderer.getContext(); const e = gl.getExtension("WEBGL_debug_renderer_info"); return { renderer: e ? String(gl.getParameter(e.UNMASKED_RENDERER_WEBGL)) : "unknown", ratio: renderer.getPixelRatio(), size: [renderer.domElement.width, renderer.domElement.height] }; },
  stats: () => ({ calls: renderer.info.render.calls, triangles: renderer.info.render.triangles }),
};
