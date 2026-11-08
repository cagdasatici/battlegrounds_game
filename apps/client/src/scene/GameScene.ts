/**
 * Client scene (spec sections 9, 18, 22, 23). Renders the original island arena and rigged fighter views; remote
 * fighters are sampled from SnapshotBuffer at 100 ms delay. Presentation only: nothing here decides hits, HP or positions.
 */
import {
  DataTexture, RGBAFormat, LinearFilter, Mesh, MeshBasicMaterial, PlaneGeometry,
  Color, DirectionalLight, Group, type InstancedMesh, HemisphereLight, PCFSoftShadowMap, PerspectiveCamera, PointLight, Scene,
  type BufferGeometry, type Material,
} from "three";
import { surfaceBelow, type Collider } from "@eb/shared/config/arena";
import { GROVE_MAP, MAP_REGISTRY, type MapDefinition } from "@eb/shared/config/maps";
import type { KitId } from "@eb/shared/protocol";
import { buildDressing, SCENERY_ISLETS, type ArenaBuild } from "./ArenaView.js";
import { buildWorldView } from "../render/worlds/index.js";
import {
  EnvironmentLayer, QUALITY_PROFILES, aimSun, applyAtmosphere, applyShadowProfile, createLights, getEnvTheme, pixelRatioForProfile, profileFor,
  type EnvTheme,
} from "../render/environment/index.js";
import { wearPointsFor } from "../render/environment/groundShading.js";
import { loadEnvKit, type EnvKit } from "./EnvAssets.js";
import { CAMERA, type CameraPose } from "./CameraRig.js";
import { EffectsPool } from "./EffectsPool.js";
import { makeToonRamp } from "./FighterModel.js";
import { FighterView } from "./FighterView.js";
import { ProjectileViews } from "./ProjectileViews.js";
import { UrnViews } from "./UrnViews.js";
import { BeastView } from "./BeastView.js";
import { CraterViews } from "./CraterViews.js";
import { SnapshotBuffer } from "../net/SnapshotBuffer.js";

export type Quality = "low" | "medium" | "high";
/** Rendered pixel budget per quality and the allowed scale relative to CSS pixels. GFX01: the table lives in render/environment/quality.ts so every tier row is in one place. */
export const PIXEL_BUDGET: Readonly<Record<Quality, number>> = { low: QUALITY_PROFILES.low.pixelBudget, medium: QUALITY_PROFILES.medium.pixelBudget, high: QUALITY_PROFILES.high.pixelBudget };
export const PIXEL_RATIO_RANGE = { min: 0.6, max: 2 } as const;
export function pixelRatioFor(q: Quality, cssW: number, cssH: number, dpr: number): number {
  return pixelRatioForProfile(profileFor(q), cssW, cssH, dpr);
}

/** Subset of WebGLRenderer used here, so tests can inject a fake without a GL context. */
export interface RendererLike {
  setSize(w: number, h: number): void;
  setPixelRatio?(r: number): void;
  shadowMap?: { enabled: boolean; type: number };
  /** GFX01: ACES tone mapping on medium and high (optional so test doubles need no GL). */
  toneMapping?: number;
  toneMappingExposure?: number;
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
  matchMedia?(q: string): { matches: boolean };
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

export class GameScene {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(CAMERA.fovDeg, 1, CAMERA.near, CAMERA.far);
  readonly effects = new EffectsPool();
  readonly projectiles = new ProjectileViews(this.scene, this.effects);
  readonly urns = new UrnViews(this.scene);
  /** BEAST01: the sparring beast presentation. */
  readonly beast = new BeastView(this.scene, this.effects);
  /** BEAST02: sparring craters left by transformed fighters. */
  readonly craters = new CraterViews(this.scene);
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
  private theme!: EnvTheme;
  private lights!: ReturnType<typeof createLights>;
  private sun!: DirectionalLight;
  /** GFX01: instanced ground cover, procedural trees and ambient particles for the map theme. */
  private envLayer!: EnvironmentLayer;
  private focus = { x: 0, z: 0 };
  private readonly ramp: DataTexture = makeToonRamp();
  private arena!: ArenaBuild;
  private env: { kit: EnvKit; meshes: InstancedMesh[]; group: Group } | null = null;
  private envState: "none" | "loading" | "ready" | "failed" = "none";
  private colliders!: readonly Collider[];
  /** WORLD01: the collider set the glTF grove dressing was planned from, kept so it can be shown again when the grove returns. */
  private readonly groveColliders: readonly Collider[];
  private map: MapDefinition = GROVE_MAP;
  /** GR12: the one lobby fighter preview. It lives in its own small scene and is drawn by the shared renderer. */
  private preview: { scene: Scene; camera: PerspectiveCamera; pivot: Group; rim: PointLight; view: FighterView; kit: KitId } | null = null;

  constructor(private readonly renderer: RendererLike, colliders: readonly Collider[], private readonly win: WindowLike, themeId = "grove") {
    this.groveColliders = colliders;
    try { this.reducedMotion = win.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true; } catch { this.reducedMotion = false; }
    this.mountWorld(Object.values(MAP_REGISTRY).find((m) => m.themeId === themeId) ?? GROVE_MAP, colliders);
    if (renderer.shadowMap) renderer.shadowMap.type = PCFSoftShadowMap;
    this.setQuality("medium");
    win.addEventListener("resize", this.onResize);
    this.resize();
  }

  /** Builds the lights, ground, props and environment layer of one map. */
  private mountWorld(map: MapDefinition, colliders: readonly Collider[]): void {
    this.map = map;
    this.theme = getEnvTheme(map.themeId);
    this.lights = createLights(this.theme);
    this.sun = this.lights.sun;
    this.colliders = colliders;
    applyAtmosphere(this.scene, this.renderer, this.theme, profileFor(this.quality), CAMERA.far);
    this.scene.add(this.lights.hemi, this.sun, this.sun.target, this.lights.rim);
    this.arena = buildWorldView(map, colliders, this.ramp);
    for (const g of this.arena.geometries) this.geometries.add(g);
    for (const m of this.arena.materials) this.materials.add(m);
    this.scene.add(this.arena.group);
    this.craters.cutGround(this.arena.terrain);
    for (const m of this.arena.groundMaterials ?? []) this.craters.cutGround(m);
    const grove = map.themeId === "grove";
    this.envLayer = new EnvironmentLayer(this.scene, colliders, this.ramp, this.theme, grove ? SCENERY_ISLETS : [], wearPointsFor(colliders, map.spawnPoints), this.craters.cutUniform);
    if (this.env) this.env.group.visible = grove;
  }

  /** Releases everything `mountWorld` made (lights, shadow map, ground, props, environment layer). Fighters, craters and effects stay. */
  private unmountWorld(): void {
    this.scene.remove(this.lights.hemi, this.sun, this.sun.target, this.lights.rim);
    this.sun.shadow.map?.dispose();
    this.envLayer.dispose();
    this.arena.group.removeFromParent();
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    for (const t of this.arena.textures) t.dispose();
    this.geometries.clear(); this.materials.clear();
  }

  /** Registry id of the map on screen. */
  get mapId(): string { return this.map.id; }

  /**
   * WORLD01: swaps the shown world (the room's map, known after joining). Same id is a no-op. Quality, fighters and effects carry over;
   * the colliders drive contact shadows and the environment layer. Presentation only: collision and spawns are the server's.
   */
  setWorld(map: MapDefinition, colliders: readonly Collider[]): void {
    if (this.disposed || map.id === this.map.id) return;
    this.unmountWorld();
    this.mountWorld(map, colliders);
    this.setQuality(this.quality);
    aimSun(this.sun, this.theme, this.focus.x, this.focus.z); // the new sun follows the camera focus from the next frame on
  }

  get qualityLevel(): Quality { return this.quality; }
  /** FB08: true freezes the ambient motes and cloud drift. Defaults to the OS preference; the app sets the in-game setting. */
  reducedMotion = false;
  private ambientTime = 0;
  /** FB08 test hook: ambient mote visibility and the first few mote heights. */
  ambientState(): { visible: boolean; sample: number[] } {
    const a = this.arena.motes, e = a.instanceMatrix.array;
    return { visible: a.visible, sample: [e[13]!, e[29]!, e[45]!].map((v) => Math.round(v * 1e4) / 1e4) };
  }
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
      const { group, meshes, extra } = buildDressing(this.groveColliders, kit);
      this.env = { kit, meshes, group };
      group.visible = this.map.themeId === "grove";
      this.scene.add(group);
      extra.visible = profileFor(this.quality).extraProps;
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

  /**
   * Quality tiers (GFX01, supersedes spec section 23): each tier row in render/environment/quality.ts changes shadow map size and softness, pixel budget,
   * tone mapping, grass/flower/pebble pools, wind sway, ambient particles, fog distance, scenery tree share, clouds and supporting props.
   */
  setQuality(q: Quality): void {
    this.quality = q;
    const p = profileFor(q);
    this.effects.configure(this.scene, q);
    const shadows = p.shadowMapSize > 0;
    this.sun.castShadow = shadows;
    applyShadowProfile(this.sun, p);
    const toneChanged = applyAtmosphere(this.scene, this.renderer, this.theme, p, CAMERA.far);
    let recompile = toneChanged;
    if (this.renderer.shadowMap && this.renderer.shadowMap.enabled !== shadows) { this.renderer.shadowMap.enabled = shadows; recompile = true; }
    if (recompile) {
      this.scene.traverse((o) => {
        const m = (o as { material?: Material | Material[] }).material;
        for (const x of Array.isArray(m) ? m : m ? [m] : []) x.needsUpdate = true;
      });
    }
    for (const { view } of this.fighters.values()) view.setShadows(shadows);
    this.envLayer.setProfile(p);
    this.envLayer.setAnimated(!this.reducedMotion);
    // Low tier also drops the purely decorative ground cover; collision, telegraphs and fighters are unaffected.
    const cover = this.arena.group.getObjectByName("deco.cover");
    if (cover) cover.visible = q !== "low";
    // FB08: cloud shell and motes follow the profile, so low never exceeds the baseline draw calls.
    this.arena.cloudShell.visible = p.cloudShell;
    this.arena.motes.visible = p.motes;
    // QE02: supporting approach props follow the same rule; core landmarks and the sparse low-tier tufts stay.
    const extra = this.scene.getObjectByName("env.dressing.extra");
    if (extra) extra.visible = p.extraProps;
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
    const w = this.win.innerWidth, h = this.win.innerHeight;
    const left = Math.max(0, rect.left), top = Math.max(0, rect.top);
    const right = Math.min(w, rect.left + rect.width), bottom = Math.min(h, rect.top + rect.height);
    if (right <= left || bottom <= top) return;
    if (animate) { p.pivot.rotation.y += dtSec * PREVIEW_TURN_RAD_PER_S; p.view.update(dtSec); }
    r.setScissorTest(false);
    r.setViewport(0, 0, w, h);
    r.setClearColor?.(PREVIEW_BG, 1);
    r.clear?.();
    p.camera.aspect = rect.width / rect.height; p.camera.updateProjectionMatrix();
    r.setScissorTest(true);
    r.setScissor(left, h - bottom, right - left, bottom - top);
    r.setViewport(rect.left, h - rect.top - rect.height, rect.width, rect.height);
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
    const pr = profileFor(this.quality), texel = (pr.shadowHalf * 2) / (pr.shadowMapSize || 1024);
    const tx = Math.round(p.pivot.x / texel) * texel, tz = Math.round(p.pivot.z / texel) * texel;
    aimSun(this.sun, this.theme, tx, tz);
    this.focus = { x: p.pivot.x, z: p.pivot.z };
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
    this.beast.clear();
    this.craters.clear();
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
    this.beast.setViewer(this.camera.position);
    this.beast.update(dtSec);
    this.arena.sky.position.copy(this.camera.position);
    if (!this.reducedMotion) {
      this.arena.clouds.rotation.y += dtSec * 0.003;
      if (this.quality !== "low") {
        this.ambientTime += dtSec;
        this.arena.cloudShell.rotation.y += dtSec * 0.002;
        this.arena.setMotes(this.ambientTime);
      }
    }
    if (!this.reducedMotion) this.arena.animate?.(dtSec);
    this.envLayer.setAnimated(!this.reducedMotion);
    this.envLayer.update(dtSec, this.focus.x, this.focus.z, this.camera, this.win.innerHeight * pixelRatioFor(this.quality, this.win.innerWidth, this.win.innerHeight, this.win.devicePixelRatio ?? 1));
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
    this.beast.dispose();
    this.craters.dispose();
    this.envLayer.dispose();
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
