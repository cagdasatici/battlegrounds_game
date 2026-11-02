import { expect, test, vi } from "vitest";
import { buildIslandsMap, surfaceBelow } from "../../packages/shared/src/config/arena.js";
import { EffectsPool } from "../../apps/client/src/scene/EffectsPool.js";
import { playActive, playWindup } from "../../apps/client/src/fx/kits/common.js";
import { SV_RECIPES } from "../../apps/client/src/fx/kits/sv.js";

const flurry = { ...SV_RECIPES["sv.b2"]!, active: { ...SV_RECIPES["sv.b2"]!.active, count: 6 } }; // generic styles (sv.b2 has a custom sustained cue since QV06)
const at = { x: 0, y: 0.9, z: 0 };
test.each([[0, 0, -1], [Math.PI / 2, -1, 0], [Math.PI, 0, 1], [-Math.PI / 2, 1, 0]] as const)(
  "fan, streams and hand glow face the attack lane at yaw %s", (yaw, dx, dz) => {
    const pool = new EffectsPool();
    const spawn = vi.spyOn(pool, "spawn");
    for (const style of ["fan", "ribbon", "arc"] as const) {
      spawn.mockClear();
      playActive(pool, { ...flurry, active: { ...flurry.active, style } }, at, yaw);
      expect(spawn.mock.calls.length).toBe(flurry.active.count);
      for (const [p] of spawn.mock.calls) expect(p.vx * dx + p.vz * dz).toBeGreaterThan(0);
    }
    spawn.mockClear();
    playWindup(pool, flurry, at, yaw);
    const glow = spawn.mock.calls.at(-1)![0];
    expect(glow.x * dx + glow.z * dz).toBeCloseTo(0.5);
  });

test("ring and fracture samples use pillar and island heights and skip the void", () => {
  const map = buildIslandsMap();
  const surface = (x: number, z: number, y: number) => surfaceBelow(map.colliders, x, z, y);
  for (const play of [playWindup, playActive]) {
    const pool = new EffectsPool();
    const spawn = vi.spyOn(pool, "spawn");
    const { playActive: _custom, ...recipe } = SV_RECIPES["sv.b4"]!; // generic fracture style (sv kit moves have custom Active cues since QV03/QV06)
    const offset = play === playWindup ? 0.05 : 0.08;
    play(pool, recipe, { x: -10.55, y: 2.9, z: -10 }, 0, surface);
    const heights = new Set(spawn.mock.calls.map(([p]) => p.y));
    expect(heights).toEqual(new Set([offset, 2 + offset]));
    spawn.mockClear();
    play(pool, recipe, { x: 80, y: 9, z: 80 }, 0, surface);
    expect(spawn).not.toHaveBeenCalled();
  }
});
