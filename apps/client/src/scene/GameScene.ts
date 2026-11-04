/**
 * Client scene (spec sections 9, 18, 22, 23). Renders the original island arena and rigged fighter views; remote
 * fighters are sampled from SnapshotBuffer at 100 ms delay. Presentation only: nothing here decides hits, HP or positions.
 */
import {
  DataTexture, RGBAFormat, LinearFilter, Mesh, MeshBasicMaterial, PlaneGeometry,
  Color, DirectionalLight, Group, type InstancedMesh, Fog, HemisphereLight, PCFSoftShadowMap, PerspectiveCamera, PointLight, Scene,
  type BufferGeometry, type Material,
} from "three";
import { surfaceBelow, type Collider } from "@eb/shared/config/arena";
import type { KitId } from "@eb/shared/protocol";
import { buildArena, buildDressing, SKY } from "./ArenaView.js";
import { loadEnvKit, type EnvKit } from "./EnvAssets.js";
import { CAMERA, type CameraPose } from "./CameraRig.js";
import { EffectsPool } from "./EffectsPool.js";
import { makeToonRamp } from "./FighterModel.js";
import { FighterView } from "./FighterView.js";
import { ProjectileViews } from "./ProjectileViews.js";
import { UrnViews } from "./UrnViews.js";
import { SnapshotBuffer } from "../net/SnapshotBuffer.js";

export type Quality = "low" | "medium" | "high";
/** Rendered pixel budget per quality (spec section 24) and the allowed scale relative to CSS pixels. */
export const PIXEL_BUDGET: Readonly<Record<Quality, number>> = { low: 750_000, medium: 1_500_000, high: 2_500_000 };
export const PIXEL_RATIO_RANGE = { min: 0.6, max: 1.5 } as const;
export function pixelRatioFor(q: Quality, cssW: number, cssH: number, dpr: number): number {
  const fit = Math.sqrt(PIXEL_BUDGET[q] / Math.max(1, cssW * cssH));
  return Math.min(PIXEL_RATIO_RANGE.max, Math.max(PIXEL_RATIO_RANGE.min, Math.min(dpr, fit)));
}

/** Subset of WebGLRenderer used here, so tests can inject a fake without a GL context. */
export interface RendererLike {
  setSize(w: number, h: number): void;
  setPixelRatio?(r: number): void;
  shadowMap?: { enabled: boolean; type: number };
  render(scene: Scene, camera: PerspectiveCamera): void;
  dispose(): void;
  /** GR12 lobby preview (optional so test doubles need no GL): a scissored viewport inside the one shared canvas. */
  setViewport?(x: number, y: number, w: number, h: number): void;
  setScissor?(x: number, y: number, w: number, h: number): void;
  setScissorTest?(on: boolean): void;
  setClearColor?(c: number, a?: number): void;
  clear?(): void;
}
/** CSS-pixel rectangle of the reserved preview region, relative to the window. */
export interface PreviewRect { left: number; top: number; width: number; height: number }
const PREVIEW_BG = 0x0a1719;
const PREVIEW_TINT: Readonly<Record<KitId, number>> = { sv: 0x9ad06a, td: 0x5fd0d8, ea: 0xff9a5c };
const PREVIEW_TURN_RAD_PER_S = 0.7;
export interface WindowLike {
  innerWidth: number;
  innerHeight: number;
  devicePixelRatio?: number;
  addEventListener(t: string, fn: () => void): void;
  removeEventListener(t: string, fn: () => void): void;
}

/** True when the GL context is a CPU rasteriser (SwiftShader, llvmpipe): such contexts always get the low tier. */
export function isSoftwareRenderer(gl: { getExtension(n: string): unknown; getParameter(p: number): unknown } | null): boolean {
  try {
    const ext = gl?.getExtension("WEBGL_debug_renderer_info") as { UNMASKED_RENDERER_WEBGL: number } | null | undefined;
    return !!ext && /swiftshader|llvmpipe|software/i.test(String(gl?.getParameter(ext.UNMASKED_RENDERER_WEBGL) ?? ""));
  } catch { return false; }
}

export { hasWebGL2 } from "./webgl.js";

/** Soft ground contact, retained on low quality where shadow maps are disabled. */
function makeContactTexture(): DataTexture {
  const pixels = new Uint8Array(32 * 32 * 4);
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
    const i = (y * 32 + x) * 4, r = Math.hypot((x - 15.5) / 16, (y - 15.5) / 16);
    pixels[i] = 17; pixels[i + 1] = 31; pixels[i + 2] = 28; pixels[i + 3] = Math.max(0, 1 - r) ** 2 * 255;
  }
  const t = new DataTexture(pixels, 32, 32, RGBAFormat); t.magFilter = LinearFilter; t.needsUpdate = true; return t;
}

/** Half-width of the shadow frustum in metres: follows the camera pivot so 1024 texels stay sharp near the action. */
const SHADOW_HALF = 24;

export class GameScene {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(CAMERA.fovDeg, 1, CAMERA.near, CAMERA.far);
  readonly effects = new EffectsPool();
  readonly projectiles = new ProjectileViews(this.scene, this.effects);
  readonly urns = new UrnViews(this.scene);
  private readonly contacts = new Map<string, Mesh<PlaneGeometry, MeshBasicMaterial>>();
  private readonly contactTexture = makeContactTexture();
  private geometries = new Set<BufferGeometry>();
  private materials = new Set<Material>();
  private fighters = new Map<string, { view: FighterView; buffer: SnapshotBuffer }>();
  private onResize = (): void => this.resize();
  private disposed = false;
  private renderPaused = false;
  /** GR09: called after each frame that was actually drawn (never while paused). */
  onFrameRendered: (() => void) | null = null;
  private quality: Quality = "medium";
  private readonly sun = new DirectionalLight(0xffe4bd, 2.25);
  private readonly ramp: DataTexture = makeToonRamp();
  private readonly arena: ReturnType<typeof buildArena>;
  private env: { kit: EnvKit; meshes: InstancedMesh[] } | null = null;
  private envState: "none" | "loading" | "ready" | "failed" = "none";
  private readonly colliders: readonly Collider[];
  /** GR12: the one lobby fighter preview. It lives in its own small scene and is drawn by the shared renderer. */
  private preview: { scene: Scene; camera: PerspectiveCamera; pivot: Group; rim: PointLight; view: FighterView; kit: KitId } | null = null;

  constructor(private readonly renderer: RendererLike, colliders: readonly Collider[], private readonly win: WindowLike) {
    this.colliders = colliders;
    this.scene.background = new Color(SKY.horizon);
    this.scene.fog = new Fog(SKY.fog, 75, 180);
    this.scene.add(new HemisphereLight(0xb9d9f2, 0x44483a, 0.95));
    this.sun.position.set(28, 50, 18);
    this.sun.shadow.mapSize.set(1024, 1024);
    const cam = this.sun.shadow.camera;
    cam.left = -SHADOW_HALF; cam.right = SHADOW_HALF; cam.top = SHADOW_HALF; cam.bottom = -SHADOW_HALF; cam.near = 5; cam.far = 140;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    // Cool fill light from the opposite side gives fighters a bright rim edge; it casts no shadow.
    const rim = new DirectionalLight(0x8fc9ff, 0.65);
    rim.position.set(-25, 18, -30);
    this.scene.add(this.sun, this.sun.target, rim);
    this.arena = buildArena(colliders, this.ramp);
    for (const g of this.arena.geometries) this.geometries.add(g);
    for (const m of this.arena.materials) this.materials.add(m);
    this.scene.add(this.arena.group);
    if (renderer.shadowMap) renderer.shadowMap.type = PCFSoftShadowMap;
    this.setQuality("medium");
    win.addEventListener("resize", this.onResize);
    this.resize();
  }

  get qualityLevel(): Quality { return this.quality; }
  get envStatus(): "none" | "loading" | "ready" | "failed" { return this.envState; }

  /**
   * Loads the CC0 glTF dressing (ART1). Resolves once the instanced props are in the scene; never rejects. On any
   * failure it logs one line and the code-built arena stays as it is.
   */
  async loadEnvironment(): Promise<void> {
    if (this.envState !== "none") return;
    this.envState = "loading";
    try {
      const kit = await loadEnvKit(this.ramp);
      if (this.disposed) { for (const g of kit.geometries) g.dispose(); for (const m of kit.materials) m.dispose(); for (const t of kit.textures) t.dispose(); return; }
      const { group, meshes, extra } = buildDressing(this.colliders, kit);
      this.env = { kit, meshes };
      this.scene.add(group);
      extra.visible = this.quality !== "low";
      const trees = this.arena.group.getObjectByName("deco.isletTrees");
      if (trees) trees.visible = false;
      this.envState = "ready";
    } catch (e) {
      this.envState = "failed";
      console.warn(`[env] glTF environment failed to load, using the code-built arena: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /** Live collider geometry plus material count (test hook for leak checks). */
  get resourceCount(): number { return this.geometries.size + this.materials.size; }
  get fighterCount(): number { return this.fighters.size; }
  get shadowsEnabled(): boolean { return this.sun.castShadow; }

  /** Quality tiers (spec section 23): one shadow casting light at 1024 on medium and high, no shadows on low. */
  setQuality(q: Quality): void {
    this.quality = q;
    this.effects.configure(this.scene, q);
    const shadows = q !== "low";
    this.sun.castShadow = shadows;
    if (this.renderer.shadowMap && this.renderer.shadowMap.enabled !== shadows) {
      this.renderer.shadowMap.enabled = shadows;
      this.scene.traverse((o) => {
        const m = (o as { material?: Material | Material[] }).material;
        for (const x of Array.isArray(m) ? m : m ? [m] : []) x.needsUpdate = true;
      });
    }
    for (const { view } of this.fighters.values()) view.setShadows(shadows);
    // Low tier also drops the purely decorative ground cover; collision, telegraphs and fighters are unaffected.
    const cover = this.arena.group.getObjectByName("deco.cover");
    if (cover) cover.visible = q !== "low";
    // QE02: supporting approach props follow the same rule; core landmarks and the sparse low-tier tufts stay.
    const extra = this.scene.getObjectByName("env.dressing.extra");
    if (extra) extra.visible = q !== "low";
    if (!this.disposed) this.resize();
  }

  /** GR12: kit currently shown in the preview, or null. */
  get previewKit(): KitId | null { return this.preview?.kit ?? null; }
  /** GR12: preview turntable angle (test hook for the reduced-motion check). */
  get previewYaw(): number { return this.preview?.pivot.rotation.y ?? 0; }

  /** GR12: shows `kit` (replacing and disposing the previous preview fighter) or, with null, releases the preview. Never allocates a renderer. */
  setPreviewKit(kit: KitId | null): void {
    if (this.disposed) return;
    if (this.preview?.kit === kit) return;
    if (kit === null) { this.releasePreview(); return; }
    let p = this.preview;
    if (p) { p.pivot.remove(p.view.group); p.view.dispose(); }
    else {
      const scene = new Scene();
      const camera = new PerspectiveCamera(30, 220 / 200, 0.1, 50);
      // The fighter origin is at hip height (feet about 0.9 m below), so frame around y = 0.
      camera.position.set(0, 0.25, 5.2); camera.lookAt(0, 0.05, 0);
      scene.add(new HemisphereLight(0xdff3ff, 0x20342f, 1.6));
      const key = new DirectionalLight(0xffffff, 2.2); key.position.set(2.5, 4, 3); scene.add(key);
      const rim = new PointLight(0xffffff, 12, 9); rim.position.set(-2, 1.8, -2); scene.add(rim);
      const pivot = new Group(); scene.add(pivot);
      p = { scene, camera, pivot, rim, view: null as unknown as FighterView, kit };
      this.preview = p;
    }
    p.view = new FighterView(kit, this.ramp, { outline: true });
    p.view.setShadows(false);
    p.pivot.add(p.view.group);
    p.pivot.rotation.y = Math.PI + 0.35; // fighters face -Z; turn toward the camera so the face shows
    p.rim.color.setHex(PREVIEW_TINT[kit]);
    p.scene.background = new Color(PREVIEW_BG).lerp(new Color(PREVIEW_TINT[kit]), 0.14);
    p.kit = kit;
  }

  private releasePreview(): void {
    const p = this.preview;
    if (!p) return;
    p.pivot.remove(p.view.group); p.view.dispose(); p.scene.clear();
    this.preview = null;
  }

  /** GR12: draws the preview into `rect` of the shared canvas. `animate` false (reduced motion) holds the pose still. */
  renderPreview(rect: PreviewRect, dtSec: number, animate: boolean): void {
    const p = this.preview, r = this.renderer;
    if (!p || this.renderPaused || this.disposed || !r.setViewport || !r.setScissor || !r.setScissorTest) return;
    if (animate) { p.pivot.rotation.y += dtSec * PREVIEW_TURN_RAD_PER_S; p.view.update(dtSec); }
    const w = this.win.innerWidth, h = this.win.innerHeight;
    r.setScissorTest(false);
    r.setViewport(0, 0, w, h);
    r.setClearColor?.(PREVIEW_BG, 1);
    r.clear?.();
    const x = Math.max(0, rect.left), width = Math.max(1, Math.min(rect.width, w - x));
    const height = Math.max(1, rect.height), y = Math.max(0, h - rect.top - height);
    p.camera.aspect = width / height; p.camera.updateProjectionMatrix();
    r.setScissorTest(true); r.setScissor(x, y, width, height); r.setViewport(x, y, width, height);
    r.render(p.scene, p.camera);
    r.setScissorTest(false); r.setViewport(0, 0, w, h);
    this.onFrameRendered?.();
  }

  addFighter(id: string, kit: KitId): FighterView {
    this.removeFighter(id);
    const view = new FighterView(kit, this.ramp);
    view.setShadows(this.quality !== "low");
    this.scene.add(view.group);
    const contact = new Mesh(new PlaneGeometry(1.7, 1.7), new MeshBasicMaterial({ map: this.contactTexture, transparent: true, opacity: .3, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    contact.name = `contact.${id}`; contact.rotation.x = -Math.PI / 2; contact.renderOrder = 1;
    this.contacts.set(id, contact); this.scene.add(contact);
    this.fighters.set(id, { view, buffer: new SnapshotBuffer() });
    return view;
  }

  removeFighter(id: string): void {
    const f = this.fighters.get(id);
    if (!f) return;
    const contact = this.contacts.get(id);
    if (contact) { contact.geometry.dispose(); contact.material.dispose(); contact.removeFromParent(); this.contacts.delete(id); }
    f.view.dispose();
    this.fighters.delete(id);
  }

  /** GR03: a new epoch or reconnect drops every interpolation buffer so no pre-drop snapshot is replayed. */
  clearRemoteBuffers(): void { for (const f of this.fighters.values()) f.buffer.clear(); }

  bufferFor(id: string): SnapshotBuffer | undefined { return this.fighters.get(id)?.buffer; }
  kitOf(id: string): KitId | undefined { return this.fighters.get(id)?.view.kitId; }
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
    // The sun's shadow box follows the pivot, snapped to whole texels so shadow edges do not shimmer.
    const texel = (SHADOW_HALF * 2) / 1024;
    const tx = Math.round(p.pivot.x / texel) * texel, tz = Math.round(p.pivot.z / texel) * texel;
    this.sun.target.position.set(tx, 0, tz);
    this.sun.position.set(tx + 28, 50, tz + 18);
    this.sun.target.updateMatrixWorld();
  }

  resize(): void {
    this.renderer.setSize(this.win.innerWidth, this.win.innerHeight);
    this.renderer.setPixelRatio?.(pixelRatioFor(this.quality, this.win.innerWidth, this.win.innerHeight, this.win.devicePixelRatio ?? 1));
    this.camera.aspect = this.win.innerWidth / Math.max(1, this.win.innerHeight);
    this.camera.updateProjectionMatrix();
  }

  /** GR09: true while the graphics context is lost; render() then makes no renderer call. */
  get renderingPaused(): boolean { return this.renderPaused; }
  pauseRendering(): void { this.renderPaused = true; }
  resumeRendering(): void { this.renderPaused = false; }

  /** GR09: drop transient GPU-backed visuals after a context restore; live fighters, projectiles and urns are re-synced from state by the loop. */
  discardTransient(): void {
    this.effects.discardTransient();
    this.projectiles.clear();
    this.urns.clear();
    this.clearRemoteBuffers();
  }

  /** Draws one frame. `dtSec` advances fighter animation and drifting clouds; it never schedules gameplay. */
  render(dtSec = 0): void {
    if (this.renderPaused || this.disposed) return;
    for (const [id, { view }] of this.fighters) {
      view.update(dtSec);
      const contact = this.contacts.get(id), pos = view.group.position;
      const ground = surfaceBelow(this.colliders, pos.x, pos.z, pos.y);
      if (contact) {
        contact.visible = ground !== null && pos.y - ground < 5;
        if (ground !== null) {
          contact.position.set(pos.x, ground + .025, pos.z);
          const height = Math.max(0, pos.y - ground - .9);
          contact.material.opacity = .32 / (1 + height * 1.5); contact.scale.setScalar(1 + height * .15);
        }
      }
    }
    this.effects.update(dtSec);
    this.urns.update(dtSec);
    this.arena.sky.position.copy(this.camera.position);
    this.arena.clouds.rotation.y += dtSec * 0.003;
    this.renderer.render(this.scene, this.camera);
    this.onFrameRendered?.();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.win.removeEventListener("resize", this.onResize);
    for (const id of [...this.fighters.keys()]) this.removeFighter(id);
    this.releasePreview();
    this.effects.dispose();
    this.projectiles.dispose();
    this.urns.dispose();
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    if (this.env) {
      for (const m of this.env.meshes) m.dispose();
      for (const g of this.env.kit.geometries) g.dispose();
      for (const m of this.env.kit.materials) m.dispose();
      for (const t of this.env.kit.textures) t.dispose();
      this.env = null;
    }
    this.contactTexture.dispose();
    for (const texture of this.arena.textures) texture.dispose();
    this.ramp.dispose();
    this.geometries.clear(); this.materials.clear();
    this.scene.clear();
    this.renderer.dispose();
  }
}
