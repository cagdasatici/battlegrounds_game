import { describe, expect, test } from "vitest";
import { DASH_SAFETY, safeTravelDistance, type GroundProbe } from "../../packages/shared/src/dashSafety.js";

// Island: ground for x in [-10, 10], z in [-10, 10], top at y 0.
const island: GroundProbe = (x, z) => (Math.abs(x) <= 10 && Math.abs(z) <= 10 ? 0 : null);
// Two islands separated by a 0.3 m gap at x in (4.85, 5.15), bridge-free.
const gapped: GroundProbe = (x, z) => (Math.abs(z) <= 2 && !(x > 4.85 && x < 5.15) && Math.abs(x) <= 12 ? 0 : null);
// Bridge: 1.6 m wide strip along x.
const bridge: GroundProbe = (x, z) => (Math.abs(z) <= 0.8 && x >= 0 && x <= 20 ? 0 : null);

describe("FB07 safeTravelDistance", () => {
  test("open ground returns the full distance", () => {
    expect(safeTravelDistance(island, 0, 0, 1, 0, 6.6)).toBe(6.6);
  });
  test("edge ahead shortens to the safe point minus margin", () => {
    const d = safeTravelDistance(island, 8, 0, 1, 0, 6.6);
    expect(d).toBeGreaterThan(0);
    expect(d).toBeLessThanOrEqual(2 - DASH_SAFETY.margin - DASH_SAFETY.coast + 1e-9);
  });
  test("already at the edge facing the void gives zero", () => {
    expect(safeTravelDistance(island, 9.9, 0, 1, 0, 6.6)).toBe(0);
  });
  test("a gap narrower than the step is not treated as ground across a void", () => {
    const d = safeTravelDistance(gapped, 2, 0, 1, 0, 6);
    expect(d).toBeLessThan(2.9); // must stop before x = 4.85
  });
  test("dash along a bridge stays full; across its side is stopped", () => {
    expect(safeTravelDistance(bridge, 2, 0, 1, 0, 6)).toBe(6);
    expect(safeTravelDistance(bridge, 5, 0.3, 0, 1, 6)).toBeLessThan(1);
  });
  test("a drop deeper than maxDrop counts as a fall; airborne start never interferes", () => {
    const step: GroundProbe = (x) => (x < 3 ? 0 : -5);
    expect(safeTravelDistance(step, 0, 0, 1, 0, 6)).toBeLessThan(3);
    expect(safeTravelDistance(() => null, 0, 0, 1, 0, 6)).toBe(6);
  });
});
