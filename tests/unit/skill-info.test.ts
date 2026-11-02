import { expect, test } from "vitest";
import { ALL_ABILITY_DEFS } from "../../packages/shared/src/config/kits/index.js";
import { SKILL_INFO, castDescription, skillDefinitions, skillRoles } from "../../apps/client/src/ui/SkillInfo.js";
test("every shipped slotted ability has a useful original description and a distinct role; kit/form lookup keeps all four slots", () => {
  const defs = ALL_ABILITY_DEFS.filter(d => d.slot !== null);
  expect(Object.keys(SKILL_INFO).sort()).toEqual(defs.map(d => d.id).sort());
  for (const d of defs) { expect(SKILL_INFO[d.id]?.description.length).toBeGreaterThan(60); expect(SKILL_INFO[d.id]?.role).toBeTruthy(); }
  for (const k of ["sv", "td", "ea"]) for (const form of ["Base", "Awakened"]) {
    expect(skillDefinitions(k, form).map(d => d.slot)).toEqual([1,2,3,4]); expect(skillRoles(k, form)).toHaveLength(4);
  }
  expect(skillDefinitions("missing", "Base")).toEqual([]);
  expect(castDescription("ea.b3", "Windup")).toBe("Ember Orb · Preparing");
  expect(castDescription("internal.unknown", "Active")).toBe("");
});
