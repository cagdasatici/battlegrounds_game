import { describe, expect, test } from "vitest";
import { RoundResults, objectiveText, rematchSecondsLeft, standingsRows } from "../../apps/client/src/ui/RoundResults.js";

// Minimal DOM double (same approach as hud-format.test.ts): the repo has no jsdom.
class El {
  listeners: Record<string, (() => void)[]> = {};
  addEventListener(t: string, f: () => void): void { (this.listeners[t] ??= []).push(f); }
  children: El[] = []; style: Record<string, string> = {}; dataset: Record<string, string> = {}; textContent = ""; removed = false;
  constructor(readonly tag = "div") {}
  setAttribute(): void { /* unused */ }
  append(...c: El[]): void { this.children.push(...c); }
  replaceChildren(...c: El[]): void { this.children = c; }
  remove(): void { this.removed = true; }
}
const doc = { createElement: (t: string) => new El(t) } as unknown as Document;
const standings = [
  { entityId: 1, displayName: "Arel", kills: 5, deaths: 2, assists: 1 },
  { entityId: 2, displayName: "Bot 1", kills: 2, deaths: 5, assists: 0 },
];
const view = { phase: "roundOver", roundTarget: 5, roundEndsAtTick: 1600, standings };
const text = (e: El): string => e.textContent + e.children.map(text).join("|");
const find = (e: El, k: string): El | undefined => (e.dataset["round"] === k ? e : e.children.map((c) => find(c, k)).find(Boolean));

describe("GR08 results card from replicated state", () => {
  test("rematch seconds count down from 10 and never go negative", () => {
    expect(rematchSecondsLeft(1600, 1000)).toBe(10);
    expect(rematchSecondsLeft(1600, 1540)).toBe(1);
    expect(rematchSecondsLeft(1600, 1700)).toBe(0);
  });
  test("standings rows keep the frozen server order", () => {
    expect(standingsRows(standings)).toEqual(["1. Arel  5 KOs  2 deaths  1 assists", "2. Bot 1  2 KOs  5 deaths  0 assists"]);
  });
  test("draws on first render (join mid-results), counts down from the deadline, hides when the phase leaves roundOver", () => {
    const parent = new El();
    const card = new RoundResults(parent as unknown as HTMLElement, doc);
    const root = parent.children[0]!;
    expect(root.style["cssText"]).toContain("display:none");
    card.render(view, 1300);
    expect(root.style["display"]).toBe("block");
    expect(text(root)).toContain("Arel wins: first to 5 KOs");
    expect(text(root)).toContain("Next round in 5");
    card.render(view, 1599);
    expect(text(root)).toContain("Next round in 1");
    card.render({ ...view, phase: "playing", roundEndsAtTick: 0, standings: [] }, 1601);
    expect(card.visible).toBe(false);
    expect(root.style["display"]).toBe("none");
  });
  test("a modal suppresses the card without losing it; actions use the supplied paths", () => {
    const parent = new El(); let changed = 0, left = 0;
    const card = new RoundResults(parent as unknown as HTMLElement, doc, () => { changed++; }, () => { left++; });
    const root = parent.children[0]!;
    card.render(view, 1000, true);
    expect(root.style["display"]).toBe("none");
    expect(card.visible).toBe(true);
    card.render(view, 1000, false);
    expect(root.style["display"]).toBe("block");
    find(root, "change")!.listeners["click"]![0]!();
    find(root, "leave")!.listeners["click"]![0]!();
    expect([changed, left]).toEqual([1, 1]);
    card.dispose();
    expect(root.removed).toBe(true);
  });
  test("objective strip: only for active optional rounds", () => {
    const leader = { displayName: "Bot 1", kills: 3 };
    expect(objectiveText(5, "playing", { kills: 2 }, leader)).toBe("First to 5 \u00b7 You 2 \u00b7 Leader Bot 1 3");
    expect(objectiveText(0, "playing", { kills: 2 }, leader)).toBeNull();
    expect(objectiveText(10, "roundOver", { kills: 10 }, leader)).toBeNull();
    expect(objectiveText(5, "playing", undefined, undefined)).toBe("First to 5 \u00b7 You 0 \u00b7 Leader -");
  });
});
