import { describe, expect, test } from "vitest";
import { SETTINGS_VERSION, SettingsStore, defaultSettings, parseSettings, parseSettingsText, type KeyValueStorage } from "../../apps/client/src/app/SettingsStore.js";

const v1 = (): Record<string, unknown> => {
  const d = JSON.parse(JSON.stringify(defaultSettings())) as Record<string, unknown>;
  delete d["damageNumbers"]; delete d["combatText"];
  d["v"] = 1; d["sensitivity"] = 1.5;
  return d;
};

describe("settings v1 to v2 migration", () => {
  test("version is 2 and defaults carry the new keys", () => {
    expect(SETTINGS_VERSION).toBe(2);
    expect(defaultSettings()).toMatchObject({ v: 2, damageNumbers: true, combatText: "all" });
  });
  test("a v1 save migrates, keeps its values and fills defaults", () => {
    expect(parseSettings(v1())).toMatchObject({ v: 2, sensitivity: 1.5, damageNumbers: true, combatText: "all" });
    expect(parseSettingsText(JSON.stringify(v1())).ok).toBe(true);
  });
  test("unknown keys, incomplete v2 and bad values are still rejected", () => {
    expect(parseSettings({ ...v1(), extra: 1 })).toBeNull();
    const d = v1(); d["v"] = 2;
    expect(parseSettings(d)).toBeNull();
    expect(parseSettings({ ...defaultSettings(), combatText: "some" })).toBeNull();
    expect(parseSettings({ ...defaultSettings(), damageNumbers: "yes" })).toBeNull();
    expect(parseSettings({ ...v1(), v: 3 })).toBeNull();
  });
  test("store loads a stored v1 save and writes v2 on the next set", () => {
    const m = new Map<string, string>([["eb.settings.v1.Arel", JSON.stringify(v1())]]);
    const st: KeyValueStorage = { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v); }, removeItem: (k) => { m.delete(k); } };
    const store = new SettingsStore(st, "Arel");
    expect(store.get()).toMatchObject({ v: 2, sensitivity: 1.5, combatText: "all" });
    expect(store.update({ combatText: "mine", damageNumbers: false })).toBe(true);
    expect(JSON.parse(m.get("eb.settings.v1.Arel")!)).toMatchObject({ v: 2, combatText: "mine", damageNumbers: false });
  });
});
