import { describe, expect, test } from "vitest";
import type { Scene } from "three";
import { TD_DEFS } from "../../packages/shared/src/config/kits/td.js";
import { EffectsPool, POOL_CAPACITY } from "../../apps/client/src/scene/EffectsPool.js";
import { FighterView } from "../../apps/client/src/scene/FighterView.js";
import { makeToonRamp } from "../../apps/client/src/scene/FighterModel.js";
import { LOW_QUALITY_CAP, TD_RECIPES, onHit, recipeFor, recipeParticles, scanPlayers } from "../../apps/client/src/fx/kits/td.js";
import type { CombatEvent } from "../../packages/shared/src/protocol.js";

const Scene = function (): Scene { const g = new FighterView("td", makeToonRamp()).group; g.clear(); return g as unknown as Scene; } as unknown as new () => Scene;
const pool = (): EffectsPool => { const p = new EffectsPool(); p.configure(new Scene(), "low"); return p; };

describe("FX4-td recipes", () => {
  test("every shipped td ability has a recipe and no extras", () => {
    expect(Object.keys(TD_RECIPES).sort()).toEqual(TD_DEFS.map((d) => d.id).sort());
    for (const d of TD_DEFS) expect(recipeFor(d.id)).toBeDefined();
    expect(recipeFor("sv.b1")).toBeUndefined();
  });
  test("each recipe fits the low-quality cap and the low pool", () => {
    for (const t of Object.values(TD_RECIPES)) {
      expect(recipeParticles(t)).toBeLessThanOrEqual(LOW_QUALITY_CAP);
      expect(LOW_QUALITY_CAP).toBeLessThanOrEqual(POOL_CAPACITY.low);
    }
  });
  test("windup fires once per action start, active once more, and everything expires", () => {
    const fx = pool(), seen = new Map<string, string>();
    const players = new Map<string, unknown>([["1", { x: 0, y: 0, z: 0, action: "Windup", moveId: "td.b1", actionStartTick: 5 }]]);
    scanPlayers(fx, players, seen);
    const afterWindup = fx.activeCount;
    expect(afterWindup).toBeGreaterThan(0);
    scanPlayers(fx, players, seen);
    expect(fx.activeCount).toBe(afterWindup);
    players.set("1", { x: 0, y: 0, z: 0, action: "Active", moveId: "td.b1", actionStartTick: 15 });
    scanPlayers(fx, players, seen);
    expect(fx.activeCount).toBeGreaterThan(afterWindup);
    fx.update(2);
    expect(fx.activeCount).toBe(0);
  });
  test("impact only on a td hit and ignores other kinds", () => {
    const fx = pool();
    const ev = (o: Partial<CombatEvent>): CombatEvent => ({ eventId: "e", tick: 1, kind: "hit", actorId: "1", targetId: "2", lifeId: 1, position: { x: 1, y: 1, z: 1 }, ...o });
    onHit(fx, ev({ moveId: "td.a2" }), () => undefined);
    const n = fx.activeCount;
    expect(n).toBe(TD_RECIPES["td.a2"]!.impact.count);
    onHit(fx, ev({ moveId: "sv.b1" }), () => undefined);
    onHit(fx, ev({ kind: "block", moveId: "td.a2" }), () => undefined);
    expect(fx.activeCount).toBe(n);
  });
  test("a vanished player drops its trigger state", () => {
    const fx = pool(), seen = new Map<string, string>();
    scanPlayers(fx, new Map([["1", { x: 0, y: 0, z: 0, action: "Windup", moveId: "td.b2" }]]), seen);
    expect(seen.size).toBe(1);
    scanPlayers(fx, new Map(), seen);
    expect(seen.size).toBe(0);
  });
});
