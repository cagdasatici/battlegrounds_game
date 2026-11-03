import { describe, expect, test } from "vitest";
import { cueAngle, DamageCues, vignetteAlpha } from "../../apps/client/src/ui/DamageCues.js";
import { edgePoint } from "../../apps/client/src/ui/Nameplates.js";

class FakeEl {
  children: FakeEl[] = []; attrs = new Map<string, string>(); style: Record<string, string> = {}; parent: FakeEl | null = null;
  append(...n: FakeEl[]): void { for (const c of n) { c.parent = this; this.children.push(c); } }
  remove(): void { if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this); this.parent = null; }
  setAttribute(k: string, v: string): void { this.attrs.set(k, v); }
  find(k: string): FakeEl[] { return [...(this.attrs.has(k) ? [this] : []), ...this.children.flatMap((c) => c.find(k))]; }
}
const fakeDoc = { createElement: () => new FakeEl() } as unknown as Document;

describe("cueAngle", () => {
  test("attacker straight behind points down", () => {
    expect(cueAngle({ x: 0, y: 0, depth: -1 })).toBeCloseTo(Math.PI / 2);
    expect(edgePoint({ x: 0, y: 0, depth: -1 }, 1000, 600).angleRad).toBeCloseTo(Math.PI / 2);
  });
  test("attacker to the right in view points right", () => {
    expect(cueAngle({ x: 0.8, y: 0, depth: 4 })).toBeCloseTo(0);
  });
});

describe("DamageCues DOM", () => {
  test("caps at 4 arcs and fades out after the duration", () => {
    const parent = new FakeEl();
    const c = new DamageCues(parent as unknown as HTMLElement, fakeDoc);
    for (let i = 0; i < 5; i++) c.hit(0, false, 1000 + i);
    c.frame(1010, 1, false);
    expect(parent.find("data-arc")).toHaveLength(4);
    c.frame(2100, 1, false);
    expect(parent.find("data-arc")).toHaveLength(0);
    c.hit(0, true, 3000);
    c.frame(3700, 1, false);
    expect(parent.find("data-arc")).toHaveLength(1); // heavy lasts 900 ms
    c.dispose();
    expect(parent.children).toHaveLength(0);
  });
  test("vignette alpha: 0 above 30%, constant 0.4 when reduced motion", () => {
    expect(vignetteAlpha(0.31, 123, false)).toBe(0);
    expect(vignetteAlpha(0.1, 123, true)).toBe(0.4);
    expect(vignetteAlpha(0.1, 0, false)).toBeCloseTo(0.35);
    const parent = new FakeEl();
    const c = new DamageCues(parent as unknown as HTMLElement, fakeDoc);
    c.frame(0, 0.1, true);
    expect(parent.find("data-vignette")[0]!.style.boxShadow).toContain("rgba(160,0,0,0.4)");
    c.frame(0, 0.31, true);
    expect(parent.find("data-vignette")[0]!.style.boxShadow).toBe("none");
  });
});
