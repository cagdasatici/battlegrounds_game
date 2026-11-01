import { WebGLRenderer } from "three";
import { parseArenaMap, type ArenaMap } from "@eb/shared/config/arena";
import { ServerMessage, type PongMessage, type WelcomeMessage } from "@eb/shared/protocol";
import islandsUrl from "../../../assets/maps/islands.v1.json?url";
import { GameLoop, type LoopPlayer, type LoopState } from "./app/GameLoop.js";
import { computeLayout } from "./input/ControlLayout.js";
import { attachKeyboardRouter } from "./input/KeyboardRouter.js";
import { IntentSampler } from "./input/IntentSampler.js";
import { PointerRouter, attachPointerRouter } from "./input/PointerRouter.js";
import { ClockSync } from "./net/ClockSync.js";
import { createRapierCollide, initRapier } from "./net/RapierCollide.js";
import { RoomClient } from "./net/RoomClient.js";
import { CameraRig } from "./scene/CameraRig.js";
import { GameScene, hasWebGL2 } from "./scene/GameScene.js";
import { Hud, readSafeRect } from "./ui/Hud.js";

export interface BootOptions {
  /** Invitation consumed from the URL fragment; without it only the static arena is shown. */
  invite: string | null;
  roomCode: string;
  displayName: string;
  kitId: "sv" | "td";
  /** Exposes a read-only state probe on window for browser tests (`?debug=1`). */
  debug: boolean;
}

export interface Session { scene: GameScene; dispose(): void }

/** Boots the scene, or shows a readable message with Retry when WebGL2 is missing (spec section 6). */
export async function boot(app: HTMLElement, opts: BootOptions = readBootOptions()): Promise<Session | null> {
  app.textContent = "Preparing arena…";
  if (!hasWebGL2()) {
    app.textContent = "This device cannot show the 3D arena (WebGL2 is unavailable). ";
    const retry = document.createElement("button");
    retry.textContent = "Retry";
    retry.addEventListener("click", () => { void boot(app, opts); }, { once: true });
    app.append(retry);
    return null;
  }
  const map = parseArenaMap(await (await fetch(islandsUrl)).json());
  const renderer = new WebGLRenderer({ antialias: true });
  app.textContent = "";
  app.append(renderer.domElement);
  const gs = new GameScene(renderer, map.colliders, window);
  gs.setCamera({ position: { x: 0, y: 20, z: 40 }, pivot: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: 0, distance: 40 });

  const cleanups: (() => void)[] = [];
  let raf = 0;
  let disposed = false;
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(raf);
    for (const c of cleanups.reverse()) { try { c(); } catch { /* keep disposing */ } }
    cleanups.length = 0;
    gs.dispose();
  };
  window.addEventListener("pagehide", dispose, { once: true });

  if (opts.invite === null) {
    const loop = (): void => { gs.render(); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    return { scene: gs, dispose };
  }

  try {
    await startMatch(gs, renderer.domElement, map, opts, cleanups);
  } catch (e) {
    app.append(Object.assign(document.createElement("p"), { textContent: `Could not join the room (${e instanceof Error ? e.message : "error"}).` }));
    dispose();
    return null;
  }
  return { scene: gs, dispose };
}

async function startMatch(
  gs: GameScene, canvas: HTMLCanvasElement, map: ArenaMap, opts: BootOptions, cleanups: (() => void)[],
): Promise<void> {
  const colliders = map.colliders;
  await initRapier();
  const kit = createRapierCollide(map);
  cleanups.push(() => kit.dispose());

  const rc = createRoomClient();
  await rc.login(opts.invite as string, opts.displayName);
  if (opts.debug) console.info("[eb] logged in");
  const room = await rc.joinWithRetry(opts.roomCode).catch((e: unknown) => { if (opts.debug) console.info("[eb] join failed", String(e)); throw e; });
  if (opts.debug) console.info("[eb] joined");
  cleanups.push(() => { void rc.leave().catch(() => undefined); });

  const clock = new ClockSync();
  const welcome = await waitFor(() => rc.welcome, 5000, "welcome");
  const router = new PointerRouter(computeLayout({ x0: 0, y0: 0, W: window.innerWidth, H: window.innerHeight }), {
    awakeningReady: () => hudMeter() >= 1,
  });
  const sampler = new IntentSampler(router, welcome.epoch);
  const players = (): Map<string, LoopPlayer> => (room.state as { players?: Map<string, LoopPlayer> }).players ?? new Map();
  const localOf = (): LoopPlayer | undefined => { for (const p of players().values()) if (p.owner !== undefined) return p; return undefined; };
  const hudMeter = (): number => (localOf()?.meter100 ?? 0) / 10000;

  room.onMessage(ServerMessage.pong, (m: PongMessage) => { clock.onPong(m, performance.now()); });
  room.onMessage(ServerMessage.welcome, (w: WelcomeMessage) => { sampler.setEpoch(w.epoch); });

  const probe = document.createElement("div");
  probe.style.cssText = "position:fixed;inset:0;visibility:hidden;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)";
  document.body.append(probe);
  const hud = new Hud(document.body);
  cleanups.push(() => { hud.dispose(); probe.remove(); });
  let hudKey = "";
  const relayout = (): void => {
    const layout = computeLayout(readSafeRect(window, probe));
    router.setLayout(layout);
    hudKey = "";
    lastLayout = layout;
  };
  let lastLayout = computeLayout(readSafeRect(window, probe));
  router.setLayout(lastLayout);
  window.addEventListener("resize", relayout);
  window.addEventListener("orientationchange", relayout);
  cleanups.push(() => { window.removeEventListener("resize", relayout); window.removeEventListener("orientationchange", relayout); });

  cleanups.push(attachPointerRouter(router, canvas, window, document));
  cleanups.push(attachKeyboardRouter(router, window, canvas));

  const loop = new GameLoop({
    scene: gs, camera: new CameraRig(colliders), collide: kit.collide, router, sampler, clock,
    readState: (): LoopState => ({ serverTick: (room.state as { serverTick?: number }).serverTick ?? 0, players: players().entries() }),
    sendInput: (p) => { rc.send("input", p); },
    sendPing: (p) => { rc.send("ping", p); },
  });
  cleanups.push(() => loop.dispose());
  const drawHud = (): void => {
    const me = localOf();
    const key = `${me?.hp100 ?? -1}|${me?.meter100 ?? 0}|${router.facingLock}|${lastLayout.s}|${window.innerWidth}x${window.innerHeight}`;
    if (key === hudKey) return;
    hudKey = key;
    hud.render(lastLayout, {
      name: me?.displayName ?? opts.displayName, hp: (me?.hp100 ?? 10000) / 100, maxHp: 100, meter: hudMeter(),
      facingLock: router.facingLock, portrait: window.innerHeight > window.innerWidth,
    });
  };
  const hudTimer = window.setInterval(drawHud, 100);
  cleanups.push(() => window.clearInterval(hudTimer));
  drawHud();

  rc.send("ready", { kitId: opts.kitId, contentHash: rc.localContentHash });
  loop.start();

  if (opts.debug) {
    (window as unknown as { __eb: unknown }).__eb = {
      snapshot: () => ({
        localEntityId: loop.localEntityId,
        serverTick: (room.state as { serverTick?: number }).serverTick ?? 0,
        reconciles: loop.reconcileCount,
        corrections: { ...loop.correctionCounts },
        predicted: loop.prediction ? { ...loop.prediction.pos } : null,
        players: [...players().values()].map((p) => ({
          entityId: p.entityId, name: p.displayName, kitId: p.kitId, hp100: p.hp100, action: p.action, moveId: p.moveId ?? "", ready: p.ready ?? false,
          x: p.x / 100, y: p.y / 100, z: p.z / 100, local: p.owner !== undefined,
        })),
      }),
    };
    cleanups.push(() => { delete (window as unknown as { __eb?: unknown }).__eb; });
  }
}

async function waitFor<T>(get: () => T | null, ms: number, what: string): Promise<T> {
  const t0 = performance.now();
  for (;;) {
    const v = get();
    if (v !== null) return v;
    if (performance.now() - t0 > ms) throw new Error(`timeout waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

/** Reads boot options from the URL. The invitation comes from the fragment only and is removed from the address bar. */
export function readBootOptions(loc: Location = location, hist: History = history): BootOptions {
  const q = new URLSearchParams(loc.search);
  const invite = consumeInviteFragment(loc, hist);
  const kit = q.get("kit");
  return {
    invite, roomCode: q.get("room") ?? "play", displayName: (q.get("name") ?? "Player").slice(0, 24),
    kitId: kit === "td" ? "td" : "sv", debug: q.get("debug") === "1",
  };
}

const app = document.getElementById("app");
if (app) void boot(app);

/** Reads the invitation from the URL fragment and removes it before any request (spec section 20). */
export function consumeInviteFragment(loc: Location = location, hist: History = history): string | null {
  const m = /(?:^#|&)invite=([A-Za-z0-9_-]{8,128})/.exec(loc.hash);
  if (!m) return null;
  hist.replaceState(null, "", loc.pathname + loc.search);
  return m[1] ?? null;
}

export function createRoomClient(): RoomClient {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return new RoomClient({
    httpBase: "",
    wsEndpoint: `${proto}://${location.host}`,
    storage: sessionStorage,
  });
}
