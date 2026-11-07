import { describe, expect, test } from "vitest";
import { CameraRig, followYaw, subjectDistanceScale } from "../../apps/client/src/scene/CameraRig.js";
import { defaultSettings, parseSettings } from "../../apps/client/src/app/SettingsStore.js";

describe("CAM01 camera follows behind", () => {
  test("idle: eases toward the facing yaw by the shortest way round, never overshooting", () => {
    let y = 0;
    for (let i = 0; i < 120; i++) y = followYaw(y, 1, 1 / 60);
    expect(y).toBeGreaterThan(0.9); expect(y).toBeLessThanOrEqual(1);
    const wrapped = followYaw(3.0, -3.0, 0.1); // across the +-pi seam: moves up, not the long way down
    expect(wrapped).toBeGreaterThan(3.0);
  });
  test("backing up holds the camera; strafing turns it much more slowly than going forward", () => {
    expect(followYaw(0, 1, 0.1, 0, -1)).toBe(0);
    const fwd = followYaw(0, 1, 0.1, 0, 1), side = followYaw(0, 1, 0.1, 1, 0);
    expect(side).toBeGreaterThan(0); expect(side).toBeLessThan(fwd * 0.3);
  });
  test("is on by default; a save from before the setting keeps its other values and gets follow on", () => {
    expect(defaultSettings().cameraFollow).toBe(true);
    const { cameraFollow: _drop, ...old } = { ...defaultSettings(), sensitivity: 1.5 };
    const p = parseSettings(old)!;
    expect(p.sensitivity).toBe(1.5); expect(p.cameraFollow).toBe(true);
    expect(parseSettings({ ...defaultSettings(), cameraFollow: false })!.cameraFollow).toBe(false);
    expect(parseSettings({ ...defaultSettings(), cameraFollow: "yes" })).toBeNull();
  });
});

describe("BEAST05 beast camera framing", () => {
  test("the pivot rises and the boom lengthens toward the beast scale, easing in", () => {
    const rig = new CameraRig([]);
    const centre = { x: 0, y: 1, z: 0 };
    const normal = rig.update(centre, 0, 0.3, 1 / 60);
    const nPivot = normal.pivot.y, nDist = normal.distance;
    rig.setSubjectScale(5.5, 1 / 60);
    expect(rig.subjectScale).toBeGreaterThan(1); expect(rig.subjectScale).toBeLessThan(5.5);
    for (let i = 0; i < 240; i++) { rig.setSubjectScale(5.5, 1 / 60); rig.update(centre, 0, 0.3, 1 / 60); }
    const beast = rig.update(centre, 0, 0.3, 1 / 60);
    expect(rig.subjectScale).toBe(5.5);
    expect(beast.pivot.y).toBeGreaterThan(nPivot + 4);
    expect(beast.distance).toBeCloseTo(nDist * subjectDistanceScale(5.5), 1);
  });
});
