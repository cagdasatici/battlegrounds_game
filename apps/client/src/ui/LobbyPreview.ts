/**
 * Lobby fighter preview: a small separate Three.js stage that shows the selected kit and turns it slowly. Cosmetic
 * only (no sim, no server state). Three.js loads on demand so the welcome screen stays light. start()/stop() and
 * dispose() cancel the frame loop and release the renderer, rig and lights.
 */
import type { KitId } from "@eb/shared/protocol";

const KIT_TINT: Readonly<Record<KitId, number>> = { sv: 0x9ad06a, td: 0x5fd0d8, ea: 0xff9a5c };
const TURN_RAD_PER_S = 0.7;

interface Stage {
  renderer: import("three").WebGLRenderer;
  scene: import("three").Scene;
  camera: import("three").PerspectiveCamera;
  pivot: import("three").Group;
  rim: import("three").PointLight;
  ramp: import("three").DataTexture;
  view: import("../scene/FighterView.js").FighterView | null;
  FighterView: typeof import("../scene/FighterView.js").FighterView;
}

export class LobbyPreview {
  readonly el: HTMLElement;
  private stage: Stage | null = null;
  private kit: KitId | null = null;
  private raf = 0;
  private last = 0;
  private running = false;
  private disposed = false;
  private loading: Promise<void> | null = null;

  constructor(doc: Document = document) {
    this.el = doc.createElement("div");
    this.el.className = "eb-preview";
    this.el.setAttribute("aria-hidden", "true");
    this.el.dataset["ui"] = "fighter-preview";
  }

  /** Shows `kit`, creating the stage on first use. Safe to call repeatedly. */
  start(kit: KitId): void {
    this.kit = kit;
    this.el.dataset["kit"] = kit;
    this.running = true;
    this.loading ??= this.init().catch(() => { /* WebGL unavailable: the lobby works without a preview */ });
    void this.loading.then(() => { if (!this.disposed) this.applyKit(); this.schedule(); });
  }

  stop(): void {
    this.running = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private async init(): Promise<void> {
    const T = await import("three");
    const { FighterView } = await import("../scene/FighterView.js");
    const { makeToonRamp } = await import("../scene/FighterModel.js");
    if (this.disposed) return;
    let renderer: import("three").WebGLRenderer;
    try { renderer = new T.WebGLRenderer({ antialias: true, alpha: true }); } catch { return; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0);
    this.el.append(renderer.domElement);
    const scene = new T.Scene();
    const camera = new T.PerspectiveCamera(30, 1, 0.1, 50);
    // The fighter origin is at hip height (feet about 0.9 m below), so frame around y = 0.
    camera.position.set(0, 0.25, 5.2);
    camera.lookAt(0, 0.05, 0);
    scene.add(new T.HemisphereLight(0xdff3ff, 0x20342f, 1.6));
    const key = new T.DirectionalLight(0xffffff, 2.2); key.position.set(2.5, 4, 3); scene.add(key);
    const rim = new T.PointLight(0xffffff, 12, 9); rim.position.set(-2, 1.8, -2); scene.add(rim);
    const pivot = new T.Group(); scene.add(pivot);
    this.stage = { renderer, scene, camera, pivot, rim, ramp: makeToonRamp(), view: null, FighterView };
    this.resize();
  }

  private applyKit(): void {
    const s = this.stage;
    if (!s || !this.kit || s.view?.kitId === this.kit) return;
    if (s.view) { s.pivot.remove(s.view.group); s.view.dispose(); s.view = null; }
    const view = new s.FighterView(this.kit, s.ramp, { outline: true });
    s.pivot.add(view.group);
    s.pivot.rotation.y = -0.5;
    s.rim.color.setHex(KIT_TINT[this.kit]);
    s.view = view;
  }

  private resize(): void {
    const s = this.stage;
    if (!s) return;
    const w = Math.max(1, this.el.clientWidth), h = Math.max(1, this.el.clientHeight);
    s.renderer.setSize(w, h, false);
    s.camera.aspect = w / h;
    s.camera.updateProjectionMatrix();
  }

  private schedule(): void {
    if (this.raf || !this.running || this.disposed || !this.stage) return;
    this.last = 0;
    const frame = (now: number): void => {
      this.raf = 0;
      const s = this.stage;
      if (!s || !this.running || this.disposed) return;
      const dt = this.last ? Math.min(0.1, (now - this.last) / 1000) : 0;
      this.last = now;
      if (this.el.isConnected) {
        if (s.renderer.domElement.clientWidth !== this.el.clientWidth) this.resize();
        s.pivot.rotation.y += dt * TURN_RAD_PER_S;
        s.view?.update(dt);
        s.renderer.render(s.scene, s.camera);
      }
      this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
  }

  dispose(): void {
    this.disposed = true;
    this.stop();
    const s = this.stage;
    if (s) {
      if (s.view) { s.pivot.remove(s.view.group); s.view.dispose(); }
      s.ramp.dispose();
      s.renderer.dispose();
      s.renderer.domElement.remove();
    }
    this.stage = null;
    this.el.remove();
  }
}
