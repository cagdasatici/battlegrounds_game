import { afterEach, beforeAll, describe, expect, test } from "vitest";
import { buildIslandsMap } from "../../packages/shared/src/config/arena.js";
import { parseInputPacket, type InputPacket } from "../../packages/shared/src/index.js";
import { computeLayout } from "../../apps/client/src/input/ControlLayout.js";
import { PointerRouter } from "../../apps/client/src/input/PointerRouter.js";
import { IntentSampler } from "../../apps/client/src/input/IntentSampler.js";
import { ClockSync } from "../../apps/client/src/net/ClockSync.js";
import { createRapierCollide, initRapier, type RapierCollide } from "../../apps/client/src/net/RapierCollide.js";
import { CameraRig } from "../../apps/client/src/scene/CameraRig.js";
import { GameScene, type RendererLike, type WindowLike } from "../../apps/client/src/scene/GameScene.js";
import { GameLoop, type LoopPlayer, type LoopState } from "../../apps/client/src/app/GameLoop.js";

const map = buildIslandsMap();
const L = computeLayout({ x0: 0, y0: 0, W: 1024, H: 768 });
beforeAll(async () => { await initRapier(); });

const win: WindowLike = { innerWidth: 800, innerHeight: 600, addEventListener() {}, removeEventListener() {} };
const renderer: RendererLike = { setSize() {}, render() {}, dispose() {} };

interface Rig {
  loop: GameLoop; router: PointerRouter; scene: GameScene; kit: RapierCollide;
  sent: InputPacket[]; pings: { nonce: number; clientMs: number }[];
  state: { serverTick: number; players: Map<string, LoopPlayer> };
  clockAt(ms: number, tick: number): void;
}
const rigs: Rig[] = [];
afterEach(() => { for (const r of rigs.splice(0)) { r.loop.dispose(); r.scene.dispose(); r.kit.dispose(); } });

const player = (o: Partial<LoopPlayer> & { entityId: number }): LoopPlayer => ({
  displayName: "p", kitId: "sv", lifeId: 1, x: 0, y: 90, z: 0, vx: 0, vy: 0, vz: 0, facingYaw: 0,
  hp100: 10000, action: "Idle", ...o,
});

function makeRig(): Rig {
  const router = new PointerRouter(L, { awakeningReady: () => true });
  const sampler = new IntentSampler(router, 1);
  const kit = createRapierCollide(map);
  const scene = new GameScene(renderer, map.colliders, win);
  const clock = new ClockSync();
  const sent: InputPacket[] = [];
  const pings: { nonce: number; clientMs: number }[] = [];
  const state = {
    serverTick: 100,
    players: new Map<string, LoopPlayer>([
      ["1", player({ entityId: 1, owner: { ackInputTick: 0, epoch: 1 } })],
      ["2", player({ entityId: 2, x: 500, z: -300, kitId: "" })],
    ]),
  };
  const loop = new GameLoop({
    scene, camera: new CameraRig(map.colliders), collide: kit.collide, router, sampler, clock,
    readState: (): LoopState => state,
    sendInput: (p) => { sent.push(p); },
    sendPing: (p) => { pings.push(p); },
  });
  const rig: Rig = {
    loop, router, scene, kit, sent, pings, state,
    clockAt(ms, tick) {
      const p = clock.makePing(ms);
      clock.onPong({ nonce: p.nonce, serverMs: 1_000_000 + ms + 5, serverTick: tick }, ms + 10);
    },
  };
  rigs.push(rig);
  return rig;
}

/** Drives frames at 16.67 ms; the estimated server tick follows wall time at 60 Hz. */
function run(rig: Rig, fromMs: number, frames: number): number {
  let t = fromMs;
  for (let i = 0; i < frames; i++) { t += 1000 / 60; rig.loop.frame(t); }
  return t;
}

describe("B2 fighter view follows replicated kit", () => {
  test("no view for an empty kit, then one per kit change, and the old view is disposed", () => {
    const r = makeRig();
    r.clockAt(0, 100);
    let t = run(r, 0, 2);
    expect(r.scene.kitOf("2")).toBeUndefined();
    expect(r.scene.fighterCount).toBe(1);
    r.state.players.get("2")!.kitId = "sv";
    t = run(r, t, 2);
    expect(r.scene.kitOf("2")).toBe("sv");
    const first = r.scene.viewFor("2");
    r.state.players.get("2")!.kitId = "td";
    t = run(r, t, 2);
    expect(r.scene.kitOf("2")).toBe("td");
    expect(r.scene.viewFor("2")).not.toBe(first);
    expect(r.scene.fighterCount).toBe(2);
    const second = r.scene.viewFor("2");
    run(r, t, 2); // unchanged kit must not rebuild
    expect(r.scene.viewFor("2")).toBe(second);
  });
});
