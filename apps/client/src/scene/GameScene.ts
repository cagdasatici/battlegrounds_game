/**
 * Client scene (spec sections 9, 18, 22). Renders island colliders and fighter views; remote fighters are
 * sampled from SnapshotBuffer (100 ms delay). Presentation only: nothing here decides hits, HP or positions.
 */
import {
  AmbientLight, BoxGeometry, CylinderGeometry, DirectionalLight, Mesh, MeshStandardMaterial,
  PerspectiveCamera, Scene, type BufferGeometry, type Material,
} from "three";
import type { Collider } from "@eb/shared/config/arena";
import type { KitId } from "@eb/shared/protocol";
import { CAMERA, type CameraPose } from "./CameraRig.js";
import { EffectsPool } from "./EffectsPool.js";
import { FighterView } from "./FighterView.js";
import { SnapshotBuffer } from "../net/SnapshotBuffer.js";

/** Subset of WebGLRenderer used here, so tests can inject a fake without a GL context. */
export interface RendererLike {
  setSize(w: number, h: number): void;
  render(scene: Scene, camera: PerspectiveCamera): void;
  dispose(): void;
}
export interface WindowLike {
  innerWidth: number;
  innerHeight: number;
  addEventListener(t: string, fn: () => void): void;
  removeEventListener(t: string, fn: () => void): void;
}

const ROLE_COLORS: Record<string, number> = { ground: 0x6f8f5a, bridge: 0x9a7b50, obstacle: 0x7a7a86, guardrail: 0x8a6a6a };

export function hasWebGL2(): boolean {
  try {
    return !!document.createElement("canvas").getContext("webgl2");
  } catch { return false; }
}

export class GameScene {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(CAMERA.fovDeg, 1, CAMERA.near, CAMERA.far);
  readonly effects = new EffectsPool();
  private geometries = new Set<BufferGeometry>();
  private materials = new Set<Material>();
  private fighters = new Map<string, { view: FighterView; buffer: SnapshotBuffer }>();
  private onResize = (): void => this.resize();
  private disposed = false;

  constructor(private readonly renderer: RendererLike, colliders: readonly Collider[], private readonly win: WindowLike) {
    this.scene.add(new AmbientLight(0xffffff, 0.7));
    const sun = new DirectionalLight(0xffffff, 1.2);
    sun.position.set(20, 40, 10);
    this.scene.add(sun);
    for (const c of colliders) this.addCollider(c);
    win.addEventListener("resize", this.onResize);
    this.resize();
  }

  /** Live collider geometry plus material count (test hook for leak checks). */
  get resourceCount(): number { return this.geometries.size + this.materials.size; }
  get fighterCount(): number { return this.fighters.size; }

  private addCollider(c: Collider): void {
    const color = ROLE_COLORS[c.role] ?? 0x888888;
    const g = c.shape === "cuboid"
      ? new BoxGeometry(c.halfExtents[0] * 2, c.halfExtents[1] * 2, c.halfExtents[2] * 2)
      : new CylinderGeometry(c.radius, c.radius, c.halfHeight * 2, 24);
    const m = new MeshStandardMaterial({ color });
    this.geometries.add(g); this.materials.add(m);
    const mesh = new Mesh(g, m);
    mesh.position.set(c.centre[0], c.centre[1], c.centre[2]);
    mesh.name = c.id;
    this.scene.add(mesh);
  }

  addFighter(id: string, kit: KitId): FighterView {
    this.removeFighter(id);
    const view = new FighterView(kit);
    this.scene.add(view.group);
    this.fighters.set(id, { view, buffer: new SnapshotBuffer() });
    return view;
  }

  removeFighter(id: string): void {
    const f = this.fighters.get(id);
    if (!f) return;
    f.view.dispose();
    this.fighters.delete(id);
  }

  bufferFor(id: string): SnapshotBuffer | undefined { return this.fighters.get(id)?.buffer; }
  viewFor(id: string): FighterView | undefined { return this.fighters.get(id)?.view; }

  /** Moves every buffered fighter to its interpolated pose for estimated server tick `nowTick`. */
  updateRemotes(nowTick: number): void {
    for (const { view, buffer } of this.fighters.values()) {
      const s = buffer.sample(nowTick);
      if (s) view.setPose(s.x, s.y, s.z, s.yaw);
    }
  }

  setCamera(p: CameraPose): void {
    this.camera.position.set(p.position.x, p.position.y, p.position.z);
    this.camera.lookAt(p.pivot.x, p.pivot.y, p.pivot.z);
  }

  resize(): void {
    this.renderer.setSize(this.win.innerWidth, this.win.innerHeight);
    this.camera.aspect = this.win.innerWidth / Math.max(1, this.win.innerHeight);
    this.camera.updateProjectionMatrix();
  }

  render(): void { this.renderer.render(this.scene, this.camera); }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.win.removeEventListener("resize", this.onResize);
    for (const id of [...this.fighters.keys()]) this.removeFighter(id);
    this.effects.dispose();
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    this.geometries.clear(); this.materials.clear();
    this.scene.clear();
    this.renderer.dispose();
  }
}
