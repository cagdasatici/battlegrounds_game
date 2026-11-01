import { describe, expect, test } from "vitest";
import { buildAbilityRegistry, defineAbility, type AbilitySpec } from "../../packages/shared/src/abilities.js";
import { meterRequired100 } from "../../packages/shared/src/awakening.js";
import { CombatSystem } from "../../apps/server/src/sim/Combat.js";
import { AbilityRunner, MELEE_HANDLER, type AbilityHost } from "../../apps/server/src/sim/AbilityRunner.js";
import { AwakeningSystem } from "../../apps/server/src/sim/Awakening.js";
import { TickPipeline, type TickPipelineDeps } from "../../apps/server/src/sim/TickPipeline.js";
import { ArenaState } from "../../apps/server/src/state/ArenaSchema.js";
import { PlayerSchema } from "../../apps/server/src/state/PlayerSchema.js";

const T0 = 1000;
const base = (id: string): AbilitySpec => ({
  id, label: "Test", handler: "melee", startup: 4, active: 2, recovery: 6, cooldown: 0, damage100: [1000], range: 2, block: "B",
});

function fixture() {
  const cs = new CombatSystem();
  const host: AbilityHost = { combat: cs, pose: () => ({ x: 0, y: 1, z: 0, facingYaw: 0, grounded: true }), blocked: () => false };
  const specs = [base("sv.b1"), base("td.b1")];
  const registry = buildAbilityRegistry(specs.map((s) => defineAbility(s)), new Set(["melee"]));
  const runner = new AbilityRunner(registry, [MELEE_HANDLER], host);
  const aw = new AwakeningSystem(host);
  const state = new ArenaState();
  const player = new PlayerSchema();
  player.entityId = 1;
  state.players.set("1", player);
  const pipe = new TickPipeline({ state, combat: cs, abilities: runner, awakening: aw } as unknown as TickPipelineDeps);
  const publish = (): void => (pipe as unknown as { publishAction(id: number): void }).publishAction(1);
  return { cs, runner, aw, player, publish };
}

describe("R10 one owner for the fighter kit", () => {
  test("kit change at respawn: abilities, awakening threshold and replicated kit all switch together", () => {
    const r = fixture();
    const f1 = r.cs.add(1, 1, 0, "sv");
    f1.protectedUntilTick = 0;
    r.publish();
    expect(r.player.kitId).toBe("sv");
    expect(r.runner.kitOf(1)).toBe("sv");
    f1.meter100 = meterRequired100("sv");
    expect(r.aw.request(f1, T0)).toMatchObject({ kind: "started", moveId: "sv.activate" });

    // Respawn as td through the one owner (the fighter record); nothing else is told.
    const f2 = r.cs.add(1, 2, T0 + 100, "td");
    f2.protectedUntilTick = 0;
    r.publish();
    expect(r.player.kitId).toBe("td");
    expect(r.runner.kitOf(1)).toBe("td");
    expect(r.runner.skillDown(f2, T0 + 101, 1, 1)).toMatchObject({ kind: "started" });
    f2.action = "Idle";
    f2.meter100 = meterRequired100("sv"); // below the td threshold
    expect(r.aw.request(f2, T0 + 300)).toEqual({ kind: "rejected", reason: "METER" });
    f2.meter100 = meterRequired100("td");
    expect(r.aw.request(f2, T0 + 300).kind).toBe("started");
  });

  test("a removed fighter has no kit", () => {
    const r = fixture();
    r.cs.add(1, 1, 0, "sv");
    r.cs.remove(1, T0);
    expect(r.runner.kitOf(1)).toBeUndefined();
  });
});
