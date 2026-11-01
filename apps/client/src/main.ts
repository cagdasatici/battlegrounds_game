import { WebGLRenderer } from "three";
import { parseArenaMap } from "@eb/shared/config/arena";
import islandsUrl from "../../../assets/maps/islands.v1.json?url";
import { RoomClient } from "./net/RoomClient.js";
import { GameScene, hasWebGL2 } from "./scene/GameScene.js";

/** Boots the scene, or shows a readable message with Retry when WebGL2 is missing (spec section 6). */
export async function boot(app: HTMLElement): Promise<GameScene | null> {
  app.textContent = "Preparing arena…";
  if (!hasWebGL2()) {
    app.textContent = "This device cannot show the 3D arena (WebGL2 is unavailable). ";
    const retry = document.createElement("button");
    retry.textContent = "Retry";
    retry.addEventListener("click", () => { void boot(app); }, { once: true });
    app.append(retry);
    return null;
  }
  const map = parseArenaMap(await (await fetch(islandsUrl)).json());
  const renderer = new WebGLRenderer({ antialias: true });
  app.textContent = "";
  app.append(renderer.domElement);
  const gs = new GameScene(renderer, map.colliders, window);
  gs.setCamera({ position: { x: 0, y: 20, z: 40 }, pivot: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: 0, distance: 40 });
  let raf = 0;
  const loop = (): void => { gs.render(); raf = requestAnimationFrame(loop); };
  raf = requestAnimationFrame(loop);
  window.addEventListener("pagehide", () => { cancelAnimationFrame(raf); gs.dispose(); }, { once: true });
  return gs;
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
