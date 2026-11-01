// Test-only page: the real GameScene and fighter views over the real islands map, three kits side by side. Not shipped.
import { WebGLRenderer } from "three";
import { buildIslandsMap } from "../../../packages/shared/src/config/arena.js";
import { GameScene } from "../../../apps/client/src/scene/GameScene.js";

const renderer = new WebGLRenderer({ antialias: true });
document.body.append(renderer.domElement);
const gs = new GameScene(renderer, buildIslandsMap().colliders, window);
const kits = ["sv", "td", "ea"] as const;
kits.forEach((k, i) => {
  const v = gs.addFighter(k, k);
  v.setPose(-2.2 + i * 2.2, 0.9, 6, Math.PI + 0.3 * (1 - i)); // fronts towards the camera
});
const overview = new URLSearchParams(location.search).get("view") === "overview";
gs.setCamera(overview
  ? { position: { x: 0, y: 20, z: 40 }, pivot: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: 0, distance: 40 }
  : { position: { x: 0, y: 2.2, z: 10.8 }, pivot: { x: 0, y: 1.1, z: 6 }, yaw: 0, pitch: 0, distance: 6 });
let frames = 0, prev = performance.now();
const loop = (now: number): void => { gs.render(Math.min(0.05, (now - prev) / 1000)); prev = now; frames++; requestAnimationFrame(loop); };
requestAnimationFrame(loop);
(window as unknown as { __art: unknown }).__art = {
  frames: () => frames,
  info: () => ({ calls: renderer.info.render.calls, triangles: renderer.info.render.triangles }),
  act: (kit: "sv" | "td" | "ea", action: string, moveId = "") => gs.viewFor(kit)?.setAction(action, moveId, 30),
  clip: (kit: "sv" | "td" | "ea") => gs.viewFor(kit)?.currentClip ?? "",
  hide: (prefix: string) => gs.scene.traverse((o) => { if (o.name.startsWith(prefix)) o.visible = false; }),
  quality: (q: "low" | "medium" | "high") => gs.setQuality(q),
};
