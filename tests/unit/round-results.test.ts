import { describe, expect, test } from "vitest";
import { RoundResults, rematchSecondsLeft, standingsRows } from "../../apps/client/src/ui/RoundResults.js";
import type { RoundOverMessage } from "../../packages/shared/src/protocol.js";

// Minimal DOM double (same approach as hud-format.test.ts): the repo has no jsdom.
class El {
  children: El[] = []; style: Record<string, string> = {}; dataset: Record<string, string> = {}; textContent = ""; removed = false;
  constructor(readonly tag = "div") {}
  setAttribute(): void { /* unused */ }
  append(...c: El[]): void { this.children.push(...c); }
  replaceChildren(...c: El[]): void { this.children = c; }
  remove(): void { this.removed = true; }
}
const doc = { createElement: (t: string) => new El(t) } as unknown as Document;
const msg: RoundOverMessage = {
  tick: 1000, roundTarget: 5, resumesAtTick: 1600,
  standings: [
    { entityId: 1, displayName: "Arel", kills: 5, deaths: 2, assists: 1 },
    { entityId: 2, displayName: "Bot 1", kills: 2, deaths: 5, assists: 0 },
  ],
};

describe("MODE01 results card", () => {
  test("rematch seconds count down from 10 and never go negative", () => {
    expect(rematchSecondsLeft(1600, 1000)).toBe(10);
    expect(rematchSecondsLeft(1600, 1001)).toBe(10);
    expect(rematchSecondsLeft(1600, 1540)).toBe(1);
    expect(rematchSecondsLeft(1600, 1600)).toBe(0);
    expect(rematchSecondsLeft(1600, 1700)).toBe(0);
  });
  test("standings rows keep the server order", () => {
    expect(standingsRows(msg)).toEqual(["1. Arel  5 KOs  2 deaths  1 assists", "2. Bot 1  2 KOs  5 deaths  0 assists"]);
  });
  test("shows, counts down, survives a message that beats the phase patch, hides after the phase leaves roundOver", () => {
    const parent = new El();
    const card = new RoundResults(parent as unknown as HTMLElement, doc);
    const root = parent.children[0]!;
    expect(root.style["cssText"]).toContain("display:none");
    card.show(msg, 1000);
    expect(root.style["display"]).toBe("block");
    const text = (e: El): string => e.textContent + e.children.map(text).join("|");
    expect(text(root)).toContain("Arel wins: first to 5 KOs");
    expect(text(root)).toContain("Rematch in 10");
    card.update("playing", 1001); // phase patch not here yet: stays visible
    expect(card.visible).toBe(true);
    card.update("roundOver", 1300);
    expect(text(root)).toContain("Rematch in 5");
    card.update("playing", 1601); // server resumed
    expect(card.visible).toBe(false);
    expect(root.style["display"]).toBe("none");
  });
  test("a stale card still hides well after the deadline, and dispose removes the node", () => {
    const parent = new El();
    const card = new RoundResults(parent as unknown as HTMLElement, doc);
    card.show(msg, 1000);
    card.update("playing", 1600 + 61);
    expect(card.visible).toBe(false);
    card.show(msg, 1000);
    card.dispose();
    expect(parent.children[0]!.removed).toBe(true);
    expect(card.visible).toBe(false);
  });
});
