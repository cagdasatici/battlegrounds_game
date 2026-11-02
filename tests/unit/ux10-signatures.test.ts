import { describe, expect, test } from "vitest";
import type { Scene } from "three";
import { EA_DEFS, SV_DEFS, TD_DEFS } from "../../packages/shared/src/config/kits/index.js";
import { EffectsPool } from "../../apps/client/src/scene/EffectsPool.js";
import { GLOW_BUDGET } from "../../apps/client/src/scene/GlowLayer.js";
import { ProjectileViews } from "../../apps/client/src/scene/ProjectileViews.js";
import { FighterView } from "../../apps/client/src/scene/FighterView.js";
import { makeToonRamp } from "../../apps/client/src/scene/FighterModel.js";
import { SIGNATURES, playFinisherImpact, playSignatureActive, playSignatureImpact, playSignatureWindup, scanFinisher, signatureOf, windupSeconds } from "../../apps/client/src/fx/Signatures.js";
import { scanPlayers as svScan, onHit as svHit } from "../../apps/client/src/fx/kits/sv.js";
import { scanPlayers as eaScan } from "../../apps/client/src/fx/kits/ea.js";
import type { CombatEvent } from "../../packages/shared/src/protocol.js";

const Scene = function (): Scene { const g = new FighterView("sv", makeToonRamp()).group; g.clear(); return g as unknown as Scene; } as unknown as new () => Scene;
const TIERS = ["low", "medium", "high"] as const;
const pool = (tier: (typeof TIERS)[number]): EffectsPool => { const p = new EffectsPool(); p.configure(new Scene(), tier); return p; };
const drain = (fx: EffectsPool, sec = 4): void => { for (let i = 0; i < sec / 0.05; i++) fx.update(0.05); };
const AT = { x: 0, y: 0.9, z: 0 };
const BASE_AND_AWAKENED = [...SV_DEFS, ...TD_DEFS, ...EA_DEFS].map((d) => d.id).filter((id) => /\.[ba][1-4]$/.test(id));

describe("UX10b ability signatures", () => {
  test("every base and awakened ability of all three fighters has a signature, and no two share all three styles", () => {
    expect(BASE_AND_AWAKENED).toHaveLength(24);
    for (const id of BASE_AND_AWAKENED) expect(SIGNATURES[id], id).toBeDefined();
    const combos = BASE_AND_AWAKENED.map((id) => { const s = SIGNATURES[id]!; return `${id.slice(0, 2)}:${s.windup}/${s.active}/${s.impact}`; });
    expect(new Set(combos).size).toBe(combos.length);
    // Each fighter draws on a broad vocabulary, not one repeated look.
    for (const k of ["sv", "td", "ea"]) {
      const mine = BASE_AND_AWAKENED.filter((id) => id.startsWith(k)).map((id) => SIGNATURES[id]!);
      expect(new Set(mine.map((m) => m.active)).size).toBeGreaterThanOrEqual(5);
      expect(new Set(mine.map((m) => m.windup)).size).toBeGreaterThanOrEqual(4);
    }
  });
  test("unlisted kit moves fall back to an element flavoured signature; universal moves have none", () => {
    expect(signatureOf("sv.x1")).toBeDefined();
    expect(signatureOf("m1.4")).toBeUndefined();
    expect(signatureOf(undefined)).toBeUndefined();
  });
  test("windup length follows the ability's startup ticks, clamped", () => {
    expect(windupSeconds("sv.b1")).toBeCloseTo(24 / 60, 5);
    expect(windupSeconds("sv.a2")).toBeLessThanOrEqual(1.4);
    expect(windupSeconds("sv.a1")).toBeGreaterThanOrEqual(0.3);
  });
  test("each ability draws windup, active and impact on every tier, and the cost never decreases with the tier", () => {
    for (const id of BASE_AND_AWAKENED) {
      const counts = TIERS.map((t) => {
        const fx = pool(t);
        playSignatureWindup(fx, id, AT, 0, 0, "a");
        const w = fx.glow.activeCount;
        playSignatureActive(fx, id, AT, 0, 0);
        const a = fx.glow.activeCount - w;
        playSignatureImpact(fx, id, { x: 0, y: 1.2, z: -2 }, 0, 1);
        const i = fx.glow.activeCount - w - a;
        fx.dispose();
        return { w, a, i };
      });
      for (const c of counts) { expect(c.w, `${id} windup`).toBeGreaterThan(0); expect(c.a, `${id} active`).toBeGreaterThan(0); expect(c.i, `${id} impact`).toBeGreaterThan(0); }
      expect(counts[0]!.w + counts[0]!.a + counts[0]!.i, id).toBeLessThanOrEqual(counts[2]!.w + counts[2]!.a + counts[2]!.i);
    }
  });
  test("a single ability never exceeds the tier's slot budget (no per-hit allocation, slots are reused)", () => {
    for (const t of TIERS) {
      const fx = pool(t);
      for (let n = 0; n < 6; n++) for (const id of BASE_AND_AWAKENED) { playSignatureWindup(fx, id, AT, 0, 0, "a"); playSignatureActive(fx, id, AT, 0, 0); playSignatureImpact(fx, id, AT, 0, 2); }
      const s = fx.glow.stats(), b = GLOW_BUDGET[t];
      expect(s.flashes).toBeLessThanOrEqual(b.flashes); expect(s.rings).toBeLessThanOrEqual(b.rings); expect(s.streaks).toBeLessThanOrEqual(b.streaks);
      fx.dispose();
    }
  });
  test("everything expires on its own", () => {
    const fx = pool("high");
    for (const id of BASE_AND_AWAKENED) { playSignatureWindup(fx, id, AT, 0, 0, "a"); playSignatureActive(fx, id, AT, 0, 0); playSignatureImpact(fx, id, AT, 0, 2); }
    expect(fx.glow.activeCount).toBeGreaterThan(0);
    drain(fx);
    expect(fx.glow.activeCount).toBe(0);
    expect(fx.glow.stats().lights).toBe(0);
    fx.dispose();
  });
});

describe("UX10b cleanup on interrupt, hand-off, death and room leave", () => {
  const player = (action: string, moveId: string, start: number): Map<string, unknown> => new Map([["1", { x: 0, y: 90, z: 0, facingYaw: 0, action, moveId, actionStartTick: start }]]);
  test("an interrupted windup (action leaves Windup) ends the caster's charge glow at once", () => {
    const fx = pool("high"), seen = new Map<string, string>();
    svScan(fx, player("Windup", "sv.b1", 5), seen);
    const charging = fx.glow.activeCount;
    expect(charging).toBeGreaterThan(0);
    svScan(fx, player("Idle", "", 0), seen); // stunned, died or cancelled
    expect(fx.glow.activeCount).toBe(0);
    fx.dispose();
  });
  test("windup hands over to Active: the charge glow is dropped, the active effect starts", () => {
    const fx = pool("high"), seen = new Map<string, string>();
    svScan(fx, player("Windup", "sv.b4", 5), seen);
    svScan(fx, player("Active", "sv.b4", 29), seen);
    const s = fx.glow.stats();
    expect(s.streaks).toBeGreaterThan(0);
    fx.glow.clearAll();
    expect(fx.glow.activeCount).toBe(0);
    fx.dispose();
  });
  test("a caster who leaves the room mid-windup loses the glow", () => {
    const fx = pool("high"), seen = new Map<string, string>();
    svScan(fx, player("Windup", "sv.a2", 5), seen);
    expect(fx.glow.activeCount).toBeGreaterThan(0);
    svScan(fx, new Map(), seen);
    expect(fx.glow.activeCount).toBe(0);
    fx.dispose();
  });
  test("one scan fires one windup; repeating it does not respawn", () => {
    const fx = pool("high"), seen = new Map<string, string>();
    svScan(fx, player("Windup", "sv.b3", 5), seen);
    const n = fx.glow.activeCount;
    svScan(fx, player("Windup", "sv.b3", 5), seen);
    expect(fx.glow.activeCount).toBe(n);
    eaScan(fx, player("Windup", "ea.b3", 7), new Map());
    fx.dispose();
  });
  test("scene teardown (dispose) clears every glow and later spawns are ignored", () => {
    const fx = pool("medium");
    playSignatureActive(fx, "td.a2", AT, 0, 0);
    fx.dispose();
    expect(fx.glow.activeCount).toBe(0);
    expect(fx.glow.streak({ x: 0, y: 0, z: 0, vx: 0, vy: 1, vz: 0, color: 1, length: 1, width: 1, life: 1 })).toBe(false);
  });
  test("a kit hit draws the ability's element burst on top of the recipe impact", () => {
    const fx = pool("high");
    const e: CombatEvent = { eventId: "e", tick: 1, kind: "hit", actorId: "1", targetId: "2", lifeId: 1, moveId: "sv.b1", damage100: 2000, hitClass: "heavy", position: { x: 1, y: 1, z: 1 } };
    svHit(fx, e, () => undefined);
    expect(fx.glow.stats().streaks).toBeGreaterThan(5);
    fx.dispose();
  });
});

describe("UX10b M1 finisher", () => {
  test("finisher impact is tinted by the attacker's element", () => {
    const stone = pool("high"), water = pool("high");
    playFinisherImpact(stone, "sv", AT, 0, { x: 0, z: 1 }, 1);
    playFinisherImpact(water, "td", AT, 0, { x: 0, z: 1 }, 1);
    expect(stone.glow.stats().streaks).toBeGreaterThan(8); expect(water.glow.stats().streaks).toBeGreaterThan(8);
    stone.dispose(); water.dispose();
  });
  test("swing glow fires once per replicated action start and charge glow dies when the swing begins or is interrupted", () => {
    const fx = pool("high"), seen = new Map<string, string>();
    const at = (action: string, start: number): Map<string, unknown> => new Map([["1", { x: 0, y: 90, z: 0, facingYaw: 0, action, moveId: "m1.4", actionStartTick: start, kitId: "ea" }]]);
    scanFinisher(fx, at("Windup", 3), seen);
    expect(fx.glow.stats().flashes).toBe(1);
    scanFinisher(fx, at("Windup", 3), seen);
    expect(fx.glow.stats().flashes).toBe(1);
    scanFinisher(fx, at("Idle", 0), seen);
    expect(fx.glow.stats().flashes).toBe(0);
    scanFinisher(fx, at("Active", 9), seen);
    const n = fx.glow.activeCount;
    expect(n).toBeGreaterThan(0);
    scanFinisher(fx, at("Active", 9), seen);
    expect(fx.glow.activeCount).toBe(n);
    fx.dispose();
  });
});

describe("UX10b projectile glow", () => {
  const rec = (x: number): [string, never] => ["1", { entityId: 1, ownerId: 1, spawnTick: 1, x, y: 100, z: 0, vx: 1800, vy: 0, vz: 0, chargeClass: "full", reflectionCount: 0, remainingTicks: 30 } as never];
  test("launch burst once, then a trail as it travels, and everything expires", () => {
    const fx = pool("high"), views = new ProjectileViews(new Scene(), fx);
    views.sync([rec(0)], 10, 10);
    const launch = fx.glow.activeCount;
    expect(launch).toBeGreaterThan(5);
    expect(fx.glow.stats().lights).toBe(1);
    views.sync([rec(0)], 10, 10);
    expect(fx.glow.activeCount).toBe(launch); // same place: no new trail, no second launch burst
    for (let i = 1; i <= 6; i++) views.sync([rec(i * 100)], 10 + i, 16 + i * 2); // the buffer renders 6 ticks behind, so advance the clock faster than the ticks
    expect(fx.glow.activeCount).toBeGreaterThan(launch);
    views.sync([], 20, 20); // projectile gone
    views.dispose();
    drain(fx);
    expect(fx.glow.activeCount).toBe(0);
    fx.dispose();
  });
  test("works without an effects pool (old callers)", () => {
    const views = new ProjectileViews(new Scene());
    views.sync([rec(0)], 1, 1);
    expect(views.snapshot()).toHaveLength(1);
    views.dispose();
  });
});
