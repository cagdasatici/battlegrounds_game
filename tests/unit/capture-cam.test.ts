import { describe, expect, test } from "vitest";
import { CaptureCam, CAPTURE_TRACK, type CaptureCamInput } from "../../apps/client/src/fx/CaptureCam.js";
import { CameraRig } from "../../apps/client/src/scene/CameraRig.js";

const base: CaptureCamInput = { action: "Idle", lifeId: 1, connected: true, menuOpen: false, reducedMotion: false };
const setup = () => { const rig = new CameraRig([]); return { rig, cam: new CaptureCam(rig) }; };
const startCapture = (cam: CaptureCam) => { cam.update(base); cam.update({ ...base, action: "Captured" }); };

describe("capture camera", () => {
  test("track is at most 1.2 s, orbits 30 degrees and eases to 4.5 m", () => {
    expect(CAPTURE_TRACK.ms).toBeLessThanOrEqual(1200);
    expect(CAPTURE_TRACK.orbitRad).toBeCloseTo(Math.PI / 6);
    expect(CAPTURE_TRACK.distance).toBe(4.5);
    const { rig, cam } = setup();
    startCapture(cam);
    rig.update({ x: 0, y: 0, z: 0 }, 0, 0, 0.6);
    expect(rig.pose.distance).toBeCloseTo(4.5, 1);
    rig.update({ x: 0, y: 0, z: 0 }, 0, 0, 0.7);
    expect(rig.tracking).toBe(false);
    rig.update({ x: 0, y: 0, z: 0 }, 0, 0, 1);
    expect(rig.pose.distance).toBeCloseTo(6.5, 1);
  });
  test("starts once per capture, not every frame", () => {
    const { rig, cam } = setup();
    startCapture(cam);
    rig.cancelTrack();
    cam.update({ ...base, action: "Captured" });
    expect(rig.tracking).toBe(false);
  });
  const cancels: Array<[string, Partial<CaptureCamInput>]> = [
    ["death", { action: "Dead" }],
    ["release", { action: "Ragdolled" }],
    ["respawn (new life)", { lifeId: 2 }],
    ["disconnect", { connected: false }],
    ["menu", { menuOpen: true }],
    ["reduced motion enabled", { reducedMotion: true }],
  ];
  for (const [name, patch] of cancels) {
    test(`cancels on ${name}`, () => {
      const { rig, cam } = setup();
      startCapture(cam);
      expect(rig.tracking).toBe(true);
      cam.update({ ...base, action: "Captured", ...patch });
      expect(rig.tracking).toBe(false);
      expect(cam.active).toBe(false);
    });
  }
  test("cancels on dispose and stays inert afterwards", () => {
    const { rig, cam } = setup();
    startCapture(cam);
    cam.dispose();
    expect(rig.tracking).toBe(false);
    cam.update({ ...base, action: "Idle" });
    cam.update({ ...base, action: "Captured" });
    expect(rig.tracking).toBe(false);
  });
  test("Reduced Motion produces no track", () => {
    const { rig, cam } = setup();
    cam.update({ ...base, reducedMotion: true });
    cam.update({ ...base, action: "Captured", reducedMotion: true });
    expect(rig.tracking).toBe(false);
    rig.reducedMotion = true;
    rig.playTrack(CAPTURE_TRACK);
    expect(rig.tracking).toBe(false);
  });
});
