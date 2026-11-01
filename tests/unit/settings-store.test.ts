import { describe, expect, test } from "vitest";
import {
  MAX_SETTINGS_BYTES, SettingsStore, defaultSettings, exportSettings, parseSettings, parseSettingsText, profileKey,
  type KeyValueStorage,
} from "../../apps/client/src/app/SettingsStore.js";

class MemStore implements KeyValueStorage {
  m = new Map<string, string>();
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) { this.m.set(k, v); }
  removeItem(k: string) { this.m.delete(k); }
}
const clone = () => JSON.parse(JSON.stringify(defaultSettings())) as Record<string, unknown>;

describe("settings schema", () => {
  test("defaults validate and match the spec defaults", () => {
    const d = defaultSettings();
    expect(parseSettings(d)).toEqual(d);
    expect(d.quickUse).toBe(true);
    expect(d.flashLevel).toBe(0.3);
    expect(d.cameraDistance).toBe(6.5);
    expect(d.reducedMotion).toBe(false);
  });
  test("unknown keys at any level are rejected", () => {
    const a = clone(); a["invite"] = "secret"; expect(parseSettings(a)).toBeNull();
    const b = clone(); ((b["layouts"] as Record<string, Record<string, unknown>>)["wide"] as Record<string, unknown>)["extra"] = 1; expect(parseSettings(b)).toBeNull();
    const c = clone(); ((c["layouts"] as Record<string, Record<string, unknown>>)["wide"]!["controls"] as Record<string, unknown>)["bogus"] = { nx: 0, ny: 0, size: 1 };
    expect(parseSettings(c)).toBeNull();
    const d = clone(); ((d["layouts"] as Record<string, Record<string, unknown>>)["wide"]!["controls"] as Record<string, unknown>)["attack"] = { nx: 0.5, ny: 0.5, size: 1, z: 1 };
    expect(parseSettings(d)).toBeNull();
  });
  test.each([
    ["cameraDistance", 3.4], ["cameraDistance", 10.1], ["effectsVolume", 1.01], ["musicVolume", -0.1], ["flashLevel", 2],
    ["sensitivity", 0], ["cameraDistance", Number.NaN], ["cameraDistance", "6"], ["reducedMotion", 1], ["handedness", "both"],
    ["quality", "ultra"], ["v", 2],
  ])("rejects %s = %s", (k, v) => {
    const s = clone(); s[k] = v; expect(parseSettings(s)).toBeNull();
  });
  test("layout size 0.85..1.30 and opacity 0.35..0.90 bounds", () => {
    const mk = (size: number, opacity: number) => {
      const s = clone() as { layouts: { wide: { opacity: number; controls: Record<string, unknown> } } };
      s.layouts.wide.opacity = opacity; s.layouts.wide.controls["jump"] = { nx: 0.5, ny: 0.5, size };
      return parseSettings(s);
    };
    expect(mk(0.85, 0.35)).not.toBeNull();
    expect(mk(1.3, 0.9)).not.toBeNull();
    expect(mk(0.849, 0.5)).toBeNull();
    expect(mk(1.301, 0.5)).toBeNull();
    expect(mk(1, 0.34)).toBeNull();
    expect(mk(1, 0.91)).toBeNull();
  });
  test("normalized positions must lie in 0..1", () => {
    const s = clone() as { layouts: { compact: { controls: Record<string, unknown> } } };
    s.layouts.compact.controls["jump"] = { nx: 1.2, ny: 0.5, size: 1 };
    expect(parseSettings(s)).toBeNull();
  });
  test("prototype pollution keys are not accepted", () => {
    const r = parseSettingsText('{"__proto__":{"x":1},' + exportSettings(defaultSettings()).slice(1));
    expect(r.ok).toBe(false);
  });
});

describe("import and export text", () => {
  test("round trip", () => {
    const d = defaultSettings(); d.musicVolume = 0.2;
    const r = parseSettingsText(exportSettings(d));
    expect(r.ok && r.settings.musicVolume).toBe(0.2);
  });
  test("over 8 KB is rejected by bytes even when the characters are few", () => {
    expect(parseSettingsText(" ".repeat(MAX_SETTINGS_BYTES + 1))).toEqual({ ok: false, reason: "too_large" });
    expect(parseSettingsText("é".repeat(MAX_SETTINGS_BYTES / 2 + 1))).toEqual({ ok: false, reason: "too_large" });
  });
  test("non JSON and wrong shape", () => {
    expect(parseSettingsText("{nope")).toEqual({ ok: false, reason: "not_json" });
    expect(parseSettingsText("[]")).toEqual({ ok: false, reason: "invalid" });
    expect(parseSettingsText("null")).toEqual({ ok: false, reason: "invalid" });
  });
  test("a full 14 control layout export fits under 8 KB", () => {
    const d = defaultSettings();
    for (const cls of ["wide", "compact"] as const) {
      for (const id of ["joystick", "attack", "jump", "dash", "block", "facing", "skill1", "skill2", "skill3", "skill4", "awaken", "menu", "fighter", "scoreboard"] as const) {
        d.layouts[cls].controls[id] = { nx: 0.123456789012, ny: 0.987654321098, size: 1.234567890123 };
      }
    }
    expect(new TextEncoder().encode(exportSettings(d)).length).toBeLessThan(MAX_SETTINGS_BYTES);
  });
});

describe("SettingsStore", () => {
  test("persists per profile and reloads", () => {
    const ms = new MemStore();
    const a = new SettingsStore(ms, "Arel");
    expect(a.update({ musicVolume: 0.1, handedness: "left" })).toBe(true);
    expect(new SettingsStore(ms, "Arel").get().musicVolume).toBe(0.1);
    expect(new SettingsStore(ms, "Nora").get().musicVolume).toBe(defaultSettings().musicVolume);
    expect(ms.getItem(profileKey("Arel"))).toContain('"v":1');
  });
  test("corrupt, wrong-version or oversized stored data falls back to defaults and is removed", () => {
    for (const bad of ["{oops", JSON.stringify({ ...defaultSettings(), v: 0 }), "x".repeat(9000)]) {
      const ms = new MemStore(); ms.setItem(profileKey("Arel"), bad);
      expect(new SettingsStore(ms, "Arel").get()).toEqual(defaultSettings());
      expect(ms.getItem(profileKey("Arel"))).toBeNull();
    }
  });
  test("invalid set is refused and state is unchanged; no write happens", () => {
    const ms = new MemStore(); const s = new SettingsStore(ms, "Arel");
    expect(s.update({ cameraDistance: 99 })).toBe(false);
    expect(s.get().cameraDistance).toBe(6.5);
    expect(ms.getItem(profileKey("Arel"))).toBeNull();
  });
  test("throwing storage still works in memory", () => {
    const boom: KeyValueStorage = { getItem() { throw new Error("no"); }, setItem() { throw new Error("no"); }, removeItem() { throw new Error("no"); } };
    const s = new SettingsStore(boom, "Arel");
    expect(s.update({ quickUse: false })).toBe(true);
    expect(s.get().quickUse).toBe(false);
  });
  test("odd profile names map to a safe key", () => {
    expect(profileKey("../../x")).toBe(profileKey("default"));
  });
  test("subscribe notifies and unsubscribes; import validates; reset restores defaults", () => {
    const s = new SettingsStore(new MemStore(), "Arel");
    let n = 0; const off = s.subscribe(() => { n++; });
    s.update({ autoRun: true }); expect(n).toBe(1);
    off(); s.update({ autoRun: false }); expect(n).toBe(1);
    expect(s.import("{}").ok).toBe(false);
    const d = defaultSettings(); d.quality = "low";
    expect(s.import(exportSettings(d)).ok).toBe(true);
    expect(s.get().quality).toBe("low");
    s.reset(); expect(s.get()).toEqual(defaultSettings());
  });
  test("settings contain no invitation field", () => {
    expect(Object.keys(defaultSettings()).join(",")).not.toMatch(/invit|token|secret/i);
  });
});
