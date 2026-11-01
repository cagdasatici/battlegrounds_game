import { expect } from "vitest";
import type { ContextRig } from "./contextRig.js";

/** Results of one move with one outcome, in tick order. */
export const by = (r: ContextRig, moveId: string, outcome: string) => r.resultsOf(moveId).filter((x) => x.r.outcome === outcome);
/** Hundredths of HP dealt by a move through hits and captures. */
export const wallTotal = (r: ContextRig, id: string) => r.resultsOf(id).reduce((s, x) => s + (x.r.outcome === "hit" || x.r.outcome === "captured" ? x.r.damage100 : 0), 0);
/** Holds Attack until the fourth M1 request commits (a wall attack, sv.x*, or a normal m1.4.*); returns its commit tick. */
export const toFourth = (r: ContextRig, h = {}) => {
  const t = r.holdUntil(10, (id) => id.endsWith(".wall") || id.startsWith("sv.x") || id.startsWith("m1.4"), h);
  expect(t).toBeGreaterThan(0);
  return t;
};
/** Puts fighter 1 in the awakened Vanguard form with the shared context bit open. */
export const awaken = (r: ContextRig) => { const f = r.cs.get(1)!; f.kitId = "sv"; f.form = "Awakened"; f.contextSpent = false; f.awakenedUsedMask = 0; };
