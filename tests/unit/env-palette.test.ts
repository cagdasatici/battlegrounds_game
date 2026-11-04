import { describe, expect, it } from "vitest";
import { cloudAlpha, mixHex, motePlacements, moteBob, plankHex, skyHex, strataHex } from "../../apps/client/src/scene/EnvPalette.js";

describe("EnvPalette (FB08)", () => {
  it("is deterministic and stays in range", () => {
    expect(cloudAlpha(64, 32, 7)).toEqual(cloudAlpha(64, 32, 7));
    expect(cloudAlpha(64, 32, 7)).not.toEqual(cloudAlpha(64, 32, 8));
    expect(Math.max(...cloudAlpha(64, 32, 7))).toBeGreaterThan(40);
    expect(cloudAlpha(64, 32, 7)[0]).toBe(0); // zenith row is clear
    expect(motePlacements(24, 3)).toEqual(motePlacements(24, 3));
    for (const p of motePlacements(24, 3)) expect(p.y).toBeLessThan(0);
    for (const v of [0, 1, 2]) {
      for (let d = 0; d <= 1; d += 0.05) { const c = strataHex(v, d, 0x8a7f78, 0x403b4a, 0x4e3a28); expect(c).toBeGreaterThanOrEqual(0); expect(c).toBeLessThanOrEqual(0xffffff); }
      expect(plankHex(v, 3, 10, 0xa87a48, 0x6b4a2c)).toBe(plankHex(v, 3, 10, 0xa87a48, 0x6b4a2c));
    }
  });
  it("strata variants form discrete bands; variant 0 is the smooth baseline", () => {
    expect(strataHex(1, 0.5, 1, 2, 3)).toBe(strataHex(1, 0.51, 1, 2, 3));
    expect(strataHex(0, 0.5, 0x8a7f78, 0x403b4a, 0x4e3a28)).toBe(mixHex(0x8a7f78, 0x403b4a, 1 / 3));
  });
  it("sky is warmest towards the sun and returns the baseline for variant 0", () => {
    const h = 0xc2d5df, z = 0x326b9e, n = 0x6e9eae;
    expect(skyHex(0, 0.5, 0, h, z, n)).toBe(mixHex(h, z, Math.pow(0.5, 0.6)));
    const sun = skyHex(1, 0.05, Math.atan2(-111, 68), h, z, n), away = skyHex(1, 0.05, Math.atan2(111, -68), h, z, n);
    expect((sun >> 16) - (away >> 16)).toBeGreaterThan(0);
  });
  it("rest pose bob is the same offset every call", () => { expect(moteBob(1, 0)).toBe(moteBob(1, 0)); });
});
