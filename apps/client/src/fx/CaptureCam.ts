import { CAMERA_TRACK_MAX_MS, type CameraTrack } from "../scene/CameraRig.js";

/**
 * Capture camera (FX5, decision 0029; spec section 9 "cinematic"). When the local player becomes Captured the camera
 * plays one short original track (30 degree orbit, distance eased to 4.5 m, at most 1.2 s). Other players are untouched.
 * The track is cancelled at once on death, respawn, leaving Captured, disconnect, menu open or dispose, and never
 * plays under Reduced Motion. Presentation only.
 */
export const CAPTURE_TRACK: CameraTrack = { ms: CAMERA_TRACK_MAX_MS, orbitRad: (30 * Math.PI) / 180, distance: 4.5 };

export interface CaptureCamInput {
  action: string | undefined;
  lifeId: number | undefined;
  connected: boolean;
  menuOpen: boolean;
  reducedMotion: boolean;
}
export interface CaptureCamRig { playTrack(t: CameraTrack): void; cancelTrack(): void }

export class CaptureCam {
  private prevAction: string | undefined;
  private lifeId: number | undefined;
  private playing = false;
  private disposed = false;

  constructor(private readonly rig: CaptureCamRig) {}

  get active(): boolean { return this.playing; }

  /** Call once per render frame with the local player's replicated state. */
  update(s: CaptureCamInput): void {
    if (this.disposed) return;
    const lifeChanged = this.lifeId !== undefined && s.lifeId !== undefined && s.lifeId !== this.lifeId;
    this.lifeId = s.lifeId;
    const captured = s.action === "Captured";
    const blocked = !s.connected || s.menuOpen || s.reducedMotion || lifeChanged;
    if (this.playing && (!captured || blocked)) this.stop();
    else if (!this.playing && captured && this.prevAction !== "Captured" && !blocked) {
      this.playing = true;
      this.rig.playTrack(CAPTURE_TRACK);
    }
    this.prevAction = s.action;
  }

  private stop(): void {
    this.playing = false;
    this.rig.cancelTrack();
  }

  dispose(): void {
    if (this.disposed) return;
    if (this.playing) this.stop();
    this.disposed = true;
  }
}
