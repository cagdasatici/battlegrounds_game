import { describe, expect, test } from "vitest";
import { ARROW_MARGIN, Nameplates, plateLayout, type PlateFighter, type Projected, type V3 } from "../../apps/client/src/ui/Nameplates.js";

const W = 1000, H = 600;
const fighter = (o: Partial<PlateFighter> = {}): PlateFighter => ({ id: "2", name: "Nora", hpFrac: 1, pos: { x: 0, y: 0, z: 0 }, local: false, alive: true, kitId: "td", ...o });
const stub = (q: Projected) => (_p: V3): Projected => q;

describe("plateLayout", () => {
  test("in-view fighter gets a plate at the expected pixel", () => {
    const out = plateLayout([fighter()], stub({ x: 0.5, y: 0.5, depth: 5 }), W, H);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: "plate", id: "2", left: 750, top: 150 });
  });
  test("behind the camera gives an in-margin arrow", () => {
    const out = plateLayout([fighter()], stub({ x: 0.2, y: 0.1, depth: -3 }), W, H);
    const a = out[0]!;
    expect(a.kind).toBe("arrow");
    if (a.kind !== "arrow") return;
    expect(a.left).toBeGreaterThanOrEqual(ARROW_MARGIN - 1);
    expect(a.left).toBeLessThanOrEqual(W - ARROW_MARGIN + 1);
    expect(a.top).toBeGreaterThanOrEqual(ARROW_MARGIN - 1);
    expect(a.top).toBeLessThanOrEqual(H - ARROW_MARGIN + 1);
  });
  test("straight behind points down", () => {
    const a = plateLayout([fighter()], stub({ x: 0, y: 0, depth: -1 }), W, H)[0]!;
    expect(a.kind).toBe("arrow");
    if (a.kind === "arrow") { expect(a.top).toBeCloseTo(H - ARROW_MARGIN); expect(a.angleRad).toBeCloseTo(Math.PI / 2); }
  });
  test("far right lands on the right edge", () => {
    const a = plateLayout([fighter()], stub({ x: 5, y: 0, depth: 4 }), W, H)[0]!;
    expect(a.kind).toBe("arrow");
    if (a.kind === "arrow") expect(a.left).toBeCloseTo(W - ARROW_MARGIN);
  });
  test("local and dead fighters produce nothing; order is input order", () => {
    const outs = plateLayout([fighter({ id: "1", local: true }), fighter({ id: "3", alive: false }), fighter({ id: "5" }), fighter({ id: "4" })], stub({ x: 0, y: 0, depth: 3 }), W, H);
    expect(outs.map((o) => o.id)).toEqual(["5", "4"]);
  });
});

// Minimal DOM double: the repo has no jsdom/happy-dom, and Nameplates only needs this surface.
class FakeEl {
  children: FakeEl[] = []; attrs = new Map<string, string>(); style: Record<string, string> = {}; textContent = ""; parent: FakeEl | null = null;
  append(...n: FakeEl[]): void { for (const c of n) { c.parent = this; this.children.push(c); } }
  remove(): void { if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this); this.parent = null; }
  setAttribute(k: string, v: string): void { this.attrs.set(k, v); }
  find(k: string): FakeEl[] { return [...(this.attrs.has(k) ? [this] : []), ...this.children.flatMap((c) => c.find(k))]; }
}
const fakeDoc = { createElement: () => new FakeEl() } as unknown as Document;

describe("Nameplates DOM", () => {
  test("elements are pooled and removed when their id disappears", () => {
    const parent = new FakeEl();
    const np = new Nameplates(parent as unknown as HTMLElement, fakeDoc);
    const plate = (id: string) => ({ kind: "plate" as const, id, name: id, hpFrac: 0.4, left: 10, top: 20, kitId: "sv" });
    np.update([plate("a"), { kind: "arrow", id: "b", left: 5, top: 5, angleRad: 1, kitId: "ea" }]);
    expect(parent.find("data-plate")).toHaveLength(1);
    expect(parent.find("data-arrow")).toHaveLength(1);
    const first = parent.find("data-plate")[0];
    np.update([plate("a")]);
    expect(parent.find("data-arrow")).toHaveLength(0);
    expect(parent.find("data-plate")[0]).toBe(first);
    np.update([]);
    expect(parent.find("data-plate")).toHaveLength(0);
    np.dispose();
    expect(parent.children).toHaveLength(0);
  });
});
