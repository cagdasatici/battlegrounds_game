import { describe, expect, test } from "vitest";
import {
  RejectionNotice, freezeKo, cooldownFraction, cooldownLabel, formTimerText, meterLabel, rejectionText, respawnSecondsLeft, scoreboardRows, stillpointText,
} from "../../apps/client/src/ui/HudFormat.js";
import { EA_DEFS, SV_DEFS, TD_DEFS } from "../../packages/shared/src/config/kits/index.js";
import { COMBAT } from "../../packages/shared/src/config/combat.js";
import { dashStatus, skillAvailability, type SkillAvailabilityState } from "../../apps/client/src/ui/HudFormat.js";
import { computeLayout } from "../../apps/client/src/input/ControlLayout.js";
import { Hud, hudModel } from "../../apps/client/src/ui/Hud.js";

describe("cooldownLabel (one decimal under 10 s, ceiling seconds above)", () => {
  test("ready, tenths, boundary and ceiling", () => {
    expect(cooldownLabel(0, 500)).toBe("");
    expect(cooldownLabel(500, 500)).toBe("");
    expect(cooldownLabel(501, 500)).toBe("0.1");
    expect(cooldownLabel(500 + 192, 500)).toBe("3.2");
    expect(cooldownLabel(500 + 599, 500)).toBe("9.9");
    expect(cooldownLabel(500 + 600, 500)).toBe("10");
    expect(cooldownLabel(500 + 601, 500)).toBe("11");
    expect(cooldownLabel(500 + 1800, 500)).toBe("30");
  });
});

describe("rejection text (spec section 9)", () => {
  test("reason mapping", () => {
    expect(rejectionText("STATE")).toBe("Recovering");
    expect(rejectionText("COOLDOWN")).toBe("Cooling down");
    expect(rejectionText("METER")).toBe("Need full meter");
    expect(rejectionText("FORM")).toBe("Already used this awakening");
    expect(rejectionText("INVALID")).toBe("Cannot use now");
    expect(rejectionText(undefined)).toBe("Cannot use now");
  });
  test("shown 0.7 s and rate limited to one message per window", () => {
    const n = new RejectionNotice();
    expect(n.current(0)).toBeNull();
    n.push("COOLDOWN", 1000);
    n.push("METER", 1300); // ignored while one is showing
    expect(n.current(1699)).toBe("Cooling down");
    expect(n.current(1700)).toBeNull();
    n.push("METER", 1700);
    expect(n.current(1800)).toBe("Need full meter");
  });
});

describe("respawn countdown and scoreboard", () => {
  test("3 second countdown from the KO tick", () => {
    expect(respawnSecondsLeft(100, 100)).toBe(3);
    expect(respawnSecondsLeft(100, 160)).toBe(2);
    expect(respawnSecondsLeft(100, 279)).toBe(1);
    expect(respawnSecondsLeft(100, 280)).toBe(0);
    expect(respawnSecondsLeft(100, 900)).toBe(0);
  });
  test("rows sorted by knockouts, then fewer deaths, then name; local marked", () => {
    const rows = scoreboardRows([
      { entityId: 1, displayName: "Zed", kills: 1, deaths: 0, assists: 0, local: false },
      { entityId: 2, displayName: "Arel", kills: 2, deaths: 3, assists: 1, local: true },
      { entityId: 3, displayName: "Nora", kills: 2, deaths: 1, assists: 0, local: false },
    ]);
    expect(rows.map((r) => r.name)).toEqual(["Nora", "Arel", "Zed"]);
    expect(rows[1]).toMatchObject({ kills: 2, deaths: 3, assists: 1, self: true });
  });
});

describe("meter, form and Stillpoint labels", () => {
  test("meter percent is threshold normalized; Ready at full", () => {
    expect(meterLabel("sv", 10000)).toEqual({ fraction: 0.5, text: "50%" });
    expect(meterLabel("td", 17500)).toEqual({ fraction: 0.5, text: "50%" });
    expect(meterLabel("sv", 20000)).toEqual({ fraction: 1, text: "Ready" });
    expect(meterLabel("td", 99999)).toEqual({ fraction: 1, text: "Ready" });
  });
  test("form timer only while awakened, Stillpoint only with remaining ticks", () => {
    expect(formTimerText("Base", 900, 100)).toBe("");
    expect(formTimerText("Awakened", 100 + 300, 100)).toBe("Awakened 5.0");
    expect(formTimerText("Awakened", 90, 100)).toBe("");
    expect(stillpointText(0)).toBe("");
    expect(stillpointText(150)).toBe("Stillpoint 2.5");
  });
});

describe("hudModel extras", () => {
  test("skill boxes carry cooldown text; awaken shows Ready", () => {
    const L = computeLayout({ x0: 0, y0: 0, W: 1024, H: 768 });
    const st = { name: "Arel", hp: 100, maxHp: 100, meter: 1, meterText: "Ready", facingLock: false, portrait: false, cooldowns: ["", "3.2", "", ""] };
    const m = hudModel(L, st);
    expect(m.boxes.find((b) => b.id === "skill2")!.label).toBe("2 3.2");
    expect(m.boxes.find((b) => b.id === "skill1")!.label).toBe("1");
    expect(m.boxes.find((b) => b.id === "awaken")!.label).toBe("Awaken Ready");
    expect(m.awakenReady).toBe(true);
  });
});

import { BlockNotice, equippedSkillNames, shortSkillLabel, skillStatus, BLOCK_FEEDBACK_MS } from "../../apps/client/src/ui/HudFormat.js";
import { MIN_GAP_PX, placeSparringRect, rectGap, validateLayout } from "../../apps/client/src/input/ControlLayout.js";

describe("QU01 skill buttons and block feedback", () => {
  test("short labels, readiness text and equipped names", () => {
    expect(shortSkillLabel("Fault Strike")).toBe("Fault Strike");
    expect(shortSkillLabel("Undertow Spiral")).toBe("Undertow Spiral");
    expect(shortSkillLabel("")).toBe("");
    expect(skillStatus("")).toEqual({ ready: true, text: "Ready" });
    expect(skillStatus("3.2")).toEqual({ ready: false, text: "3.2" });
    expect(equippedSkillNames("sv", "Base")).toHaveLength(4);
    expect(equippedSkillNames("sv", "Base").every((n) => n !== "")).toBe(true);
    expect(equippedSkillNames("zz", "Base")).toEqual(["", "", "", ""]);
  });
  test("hudModel shows name plus status, and Blocked on the Guard button only when confirmed", () => {
    const L = computeLayout({ x0: 0, y0: 0, W: 1024, H: 768 });
    const st = { name: "A", hp: 100, maxHp: 100, meter: 0, facingLock: false, portrait: false, skills: ["Fault Strike", "Rock", "Wall", "Quake"], cooldowns: ["", "3.2", "", ""] };
    const m = hudModel(L, st);
    const s1 = m.boxes.find((b) => b.id === "skill1")!, s2 = m.boxes.find((b) => b.id === "skill2")!;
    expect([s1.label, s1.sub, s1.ready]).toEqual(["1 Fault Strike", "Ready", true]);
    expect([s2.label, s2.sub, s2.ready]).toEqual(["2 Rock", "3.2", false]);
    expect(m.boxes.find((b) => b.id === "block")!.label).toBe("Guard");
    expect(hudModel(L, { ...st, blocked: true }).boxes.find((b) => b.id === "block")!.label).toBe("Blocked!");
  });
  test("BlockNotice is inactive until a block is confirmed, then expires", () => {
    const n = new BlockNotice();
    expect(n.active(0)).toBe(false);
    n.confirm(1000);
    expect(n.active(1000 + BLOCK_FEEDBACK_MS - 1)).toBe(true);
    expect(n.active(1000 + BLOCK_FEEDBACK_MS)).toBe(false);
  });
});

describe("QU01 sparring button rectangle", () => {
  test("zero intersection and >= 8 px from every control at both iPad viewports", () => {
    for (const [W, H] of [[1024, 768], [1180, 820]] as const) {
      const L = computeLayout({ x0: 0, y0: 0, W, H });
      expect(validateLayout(L)).toEqual([]);
      const r = placeSparringRect(L)!;
      expect(r, `${W}x${H}`).not.toBeNull();
      expect(r.left >= 0 && r.top >= 0 && r.left + r.width <= W && r.top + r.height <= H).toBe(true);
      for (const c of Object.values(L.controls)) {
        const w = c.interactive ? c.hw : c.vw, h = c.interactive ? c.hh : c.vh;
        expect(rectGap(r, { left: c.cx - w / 2, top: c.cy - h / 2, width: w, height: h }), `${W}x${H} ${c.id}`).toBeGreaterThanOrEqual(MIN_GAP_PX);
      }
    }
  });
  test("returns null instead of overlapping when nothing fits", () => {
    expect(placeSparringRect(computeLayout({ x0: 0, y0: 0, W: 1024, H: 768 }), 5000)).toBeNull();
  });
});

describe("cooldownFraction (UX13)", () => {
  test("half, past end, no cooldown, before cast", () => {
    expect(cooldownFraction(120, 60, 120)).toBe(0.5);
    expect(cooldownFraction(100, 200, 120)).toBe(0);
    expect(cooldownFraction(500, 100, 0)).toBe(0);
    expect(cooldownFraction(1000, 100, 120)).toBe(1);
  });
});

// Minimal DOM double: the repo has no jsdom/happy-dom; Hud only needs this surface.
class FakeEl {
  children: FakeEl[] = []; style: Record<string, string> = {}; dataset: Record<string, string> = {}; textContent = ""; className = "";
  private cls = new Set<string>();
  classList = { add: (c: string) => void this.cls.add(c), remove: (c: string) => void this.cls.delete(c), contains: (c: string) => this.cls.has(c) };
  appendChild(c: FakeEl): FakeEl { this.children.push(c); return c; }
  append(...c: FakeEl[]): void { this.children.push(...c); }
  replaceChildren(...c: FakeEl[]): void { this.children = c; }
  private attrs = new Map<string, string>();
  setAttribute(k: string, v: string): void { this.attrs.set(k, v); }
  getAttribute(k: string): string | null { return this.attrs.get(k) ?? null; }
  addEventListener(): void { /* not needed */ }
  removeEventListener(): void { /* not needed */ }
  remove(): void { /* not needed */ }
}
const fakeDoc = { createElement: () => new FakeEl() } as unknown as Document;

describe("Hud cooldown ring and ready pulse (UX13)", () => {
  const layout = computeLayout({ x0: 0, y0: 0, W: 1180, H: 820 });
  const base = { name: "n", hp: 100, maxHp: 100, meter: 0, facingLock: false, portrait: false, skills: ["a", "b", "c", "d"], cooldowns: ["1.0", "", "", ""] };
  const ctl = (root: FakeEl, id: string): FakeEl => {
    const found = (function walk(e: FakeEl): FakeEl | undefined { return e.dataset["control"] === id ? e : e.children.map(walk).find(Boolean); })(root);
    if (!found) throw new Error(id);
    return found;
  };
  test("conic ring only on cooling slots", () => {
    const parent = new FakeEl();
    const hud = new Hud(parent as unknown as HTMLElement, fakeDoc);
    hud.render(layout, { ...base, cooldownFracs: [0.5, 0, 0, 0] });
    const root = parent.children[0]!;
    expect(ctl(root, "skill1").style["backgroundImage"]).toContain("conic-gradient");
    expect(ctl(root, "skill2").style["backgroundImage"] ?? "").toBe("");
    hud.dispose();
  });
  test("pulse when a slot becomes ready; none with reducedMotion", () => {
    const parent = new FakeEl();
    const hud = new Hud(parent as unknown as HTMLElement, fakeDoc);
    hud.render(layout, { ...base, cooldownFracs: [0.1, 0, 0, 0.2] });
    hud.render(layout, { ...base, cooldownFracs: [0, 0, 0, 0.1], reducedMotion: true });
    const root = parent.children[0]!;
    expect(ctl(root, "skill1").classList.contains("eb-ready-pulse")).toBe(false);
    hud.render(layout, { ...base, cooldownFracs: [0, 0, 0, 0] });
    expect(ctl(root, "skill4").classList.contains("eb-ready-pulse")).toBe(true);
    expect(ctl(root, "skill1").classList.contains("eb-ready-pulse")).toBe(false);
    hud.dispose();
  });
});

// UX14: KO card and tabular scoreboard. Tag-aware DOM double that records click listeners.
class TagEl extends FakeEl {
  constructor(readonly tag: string) { super(); }
  listeners: Record<string, Array<(e: unknown) => void>> = {};
  override addEventListener(t: string, f: (e: unknown) => void): void { (this.listeners[t] ??= []).push(f); }
  override removeEventListener(t: string, f: (e: unknown) => void): void { this.listeners[t] = (this.listeners[t] ?? []).filter((x) => x !== f); }
}
const tagDoc = { createElement: (t: string) => new TagEl(t) } as unknown as Document;
const walkAll = (e: FakeEl, out: TagEl[] = []): TagEl[] => { out.push(e as TagEl); for (const c of e.children) walkAll(c, out); return out; };
const textOf = (e: FakeEl): string => e.textContent + e.children.map(textOf).join("");

describe("Hud KO card and scoreboard (UX14)", () => {
  const layout = computeLayout({ x0: 0, y0: 0, W: 1180, H: 820 });
  const base = { name: "n", hp: 100, maxHp: 100, meter: 0, facingLock: false, portrait: false };
  const mount = (onFighter: () => void = () => undefined) => {
    const parent = new TagEl("div");
    const hud = new Hud(parent as unknown as HTMLElement, tagDoc, undefined, undefined, undefined, undefined, onFighter);
    return { hud, all: () => walkAll(parent.children[0]!) };
  };
  const ko = (byHpFrac: number | null) => ({ by: "Rex", byKit: "Ember", byHpFrac, seconds: 2, frac: 0.5 });
  test("killer HP caption and fighter button", () => {
    const { hud, all } = mount();
    hud.render(layout, { ...base, respawn: ko(0.34) });
    expect(textOf(all()[0]!)).toContain("34 HP left");
    expect(all().some((e) => e.dataset["koKit"] === "1")).toBe(true);
    hud.dispose();
  });
  test("no killer bar when byHpFrac is null", () => {
    const { hud, all } = mount();
    hud.render(layout, { ...base, respawn: ko(null) });
    expect(textOf(all()[0]!)).not.toContain("HP left");
    expect(all().some((e) => e.dataset["koBar"] === "1")).toBe(false);
    hud.dispose();
  });
  test("scoreboard is a table with header plus N rows; local row is self", () => {
    const { hud, all } = mount();
    hud.render(layout, { ...base, scoreboard: [
      { name: "A", kills: 2, deaths: 0, assists: 0, self: false }, { name: "B", kills: 1, deaths: 1, assists: 1, self: true }] });
    const trs = all().filter((e) => e.tag === "tr");
    expect(all().some((e) => e.tag === "table")).toBe(true);
    expect(trs.length).toBe(3);
    expect(trs[2]!.className).toContain("self");
    expect(trs[1]!.className).not.toContain("self");
    hud.dispose();
  });
  test("clicking Change fighter invokes callback", () => {
    let n = 0;
    const { hud, all } = mount(() => { n++; });
    hud.render(layout, { ...base, respawn: ko(0.5) });
    const card = all().find((e) => e.dataset["hud"] === "respawn")!;
    const btn = all().find((e) => e.dataset["koKit"] === "1")!;
    for (const f of card.listeners["click"] ?? []) f({ target: { closest: () => btn } });
    expect(n).toBe(1);
    hud.dispose();
  });
});

describe("GR07 honest action status", () => {
  const td2 = TD_DEFS.find((d) => d.id === "td.a2")!;
  const ea3 = EA_DEFS.find((d) => d.id === "ea.b3")!;
  const sv1 = SV_DEFS.find((d) => d.id === "sv.b1")!;
  const idle: SkillAvailabilityState = { usedMask: 0, cooldownEndTick: 0, activeMove: "", chargeStartTick: 0 };

  test("Used persists through a miss and cooldown expiry, and clears only when the mask resets", () => {
    expect(td2.oncePerForm).toBe(true);
    const bit = 1 << (td2.slot! - 1);
    expect(skillAvailability(td2, { ...idle, usedMask: bit, activeMove: "td.a2" }, 100).kind).toBe("used");
    expect(skillAvailability(td2, { ...idle, usedMask: bit, cooldownEndTick: 900 }, 100).kind).toBe("used");
    expect(skillAvailability(td2, { ...idle, usedMask: bit }, 99999)).toEqual({ kind: "used", text: "Used", fraction: 1 });
    expect(skillAvailability(td2, idle, 100).kind).toBe("ready");
    expect(skillAvailability(td2, { ...idle, usedMask: bit ^ 0xf }, 100).kind).toBe("ready"); // other slots' bits do not matter
  });

  test("a non-oncePerForm move ignores the mask", () => {
    expect(skillAvailability(sv1, { ...idle, usedMask: 0xf }, 10).kind).toBe("ready");
  });

  test("charge percentage: 179 ticks shows 99, 180 shows 100, authoritative start only", () => {
    const st = { ...idle, activeMove: "ea.b3", chargeStartTick: 1000 };
    expect(skillAvailability(ea3, st, 1179)).toMatchObject({ kind: "charging", text: "Charge 99%" });
    expect(skillAvailability(ea3, st, 1180)).toMatchObject({ kind: "charging", text: "Charge 100%" });
    expect(skillAvailability(ea3, st, 5000).text).toBe("Charge 100%");
    expect(skillAvailability(ea3, st, 900).text).toBe("Charge 0%");
    // Another active move or no authoritative start tick is never charging.
    expect(skillAvailability(ea3, { ...st, activeMove: "ea.b1" }, 1100).kind).toBe("ready");
    expect(skillAvailability(ea3, { ...st, chargeStartTick: 0 }, 1100).kind).toBe("ready");
    // Cancellation (server clears chargeStartTick) falls back to the cooldown.
    expect(skillAvailability(ea3, { ...idle, activeMove: "ea.b3", cooldownEndTick: 1300 }, 1200).kind).toBe("cooldown");
  });

  test("cooldown wins over Ready and keeps the existing label", () => {
    const a = skillAvailability(sv1, { ...idle, cooldownEndTick: 500 + 192 }, 500);
    expect(a.kind).toBe("cooldown");
    expect(a.text).toBe("3.2");
    expect(a.fraction).toBeGreaterThan(0);
  });

  test("Dash becomes Escape while Ragdolled: Wait before tick 12, then cooldown or Ready", () => {
    const m = COMBAT.evasive.minRagdollAge;
    expect(m).toBe(12);
    expect(dashStatus("Idle", 0, 0, 100)).toBeNull();
    expect(dashStatus("Ragdolled", 100, 0, 111)).toEqual({ label: "Escape", text: "Wait" });
    expect(dashStatus("Ragdolled", 100, 0, 112)).toEqual({ label: "Escape", text: "Ready" });
    expect(dashStatus("Ragdolled", 100, 112 + COMBAT.evasive.cooldown, 112)).toEqual({ label: "Escape", text: "30" });
    expect(dashStatus("Ragdolled", 100, 200, 200)).toEqual({ label: "Escape", text: "Ready" }); // boundary: end tick reached
  });

  test("Vanguard Awakened without a timer reads choose one finisher; timed forms keep a countdown", () => {
    expect(formTimerText("Awakened", 0, 100, "sv")).toBe("Awakened \u00b7 choose one finisher");
    expect(formTimerText("Awakened", 0, 100, "td")).toBe("");
    expect(formTimerText("Awakened", 100 + 300, 100, "td")).toBe("Awakened 5.0");
    expect(formTimerText("Base", 0, 100, "sv")).toBe("");
  });

  test("HUD model shows Used / Charge / Escape text and the release hint", () => {
    const L = computeLayout({ x0: 0, y0: 0, W: 1024, H: 768 }, 1, "right");
    const base = { name: "n", hp: 100, maxHp: 100, meter: 0, facingLock: false, portrait: false, skills: ["a", "b", "c", "d"] };
    const m = hudModel(L, { ...base,
      skillStates: [{ kind: "used", text: "Used", fraction: 1 }, { kind: "charging", text: "Charge 50%", fraction: 0.5 }, { kind: "ready", text: "Ready", fraction: 0 }, { kind: "cooldown", text: "2.0", fraction: 0.3 }],
      dash: { label: "Escape", text: "Wait" } });
    const box = (id: string) => m.boxes.find((b) => b.id === id)!;
    expect(box("skill1")).toMatchObject({ sub: "Used", ready: false });
    expect(box("skill2")).toMatchObject({ sub: "Charge 50%", hint: "Release to fire" });
    expect(box("skill3").ready).toBe(true);
    expect(box("dash")).toMatchObject({ label: "Escape", sub: "Wait" });
    expect(hudModel(L, base).boxes.find((b) => b.id === "dash")!.label).toBe("Dash");
  });
});

describe("GR11 KO card facts and skill button structure", () => {
  const label = (k: string): string => ({ ea: "Ember" }[k as "ea"] ?? k);
  test("freezeKo keeps the HP seen at the KO event; later actor heals cannot change the record", () => {
    const actor = { displayName: "Rex", kitId: "ea", hp100: 4000 };
    const rec = freezeKo(100, "7", actor, label);
    actor.hp100 = 10000; // the actor heals after the KO event
    expect(rec).toEqual({ tick: 100, by: "Rex", byKit: "Ember", byHpFrac: 0.4, fell: false });
  });
  test("unknown actor is a rival without an invented HP; uncredited fall has no killer", () => {
    expect(freezeKo(5, "9", undefined, label)).toMatchObject({ by: "a rival", byKit: "", byHpFrac: null, fell: false });
    expect(freezeKo(5, undefined, undefined, label)).toMatchObject({ fell: true, byHpFrac: null });
  });
  test("Hud KO card text: fall omits the by line, unknown rival omits the kit", () => {
    const layout = computeLayout({ x0: 0, y0: 0, W: 1180, H: 820 });
    const base = { name: "n", hp: 100, maxHp: 100, meter: 0, facingLock: false, portrait: false };
    const parent = new TagEl("div");
    const hud = new Hud(parent as unknown as HTMLElement, tagDoc);
    const text = (): string => textOf(parent.children[0]!);
    hud.render(layout, { ...base, respawn: { by: "", byKit: "", byHpFrac: null, seconds: 2, frac: 0.5, fell: true } });
    expect(text()).toContain("Fell from the arena");
    expect(text()).not.toContain("by ");
    hud.render(layout, { ...base, respawn: { by: "a rival", byKit: "", byHpFrac: null, seconds: 2, frac: 0.5 } });
    expect(text()).toContain("by a rival");
    expect(text()).not.toContain("·");
    hud.dispose();
  });
  test("skill button DOM is rebuilt only when the equipped move changes; state updates in place", () => {
    const layout = computeLayout({ x0: 0, y0: 0, W: 1180, H: 820 });
    const st = { name: "n", hp: 100, maxHp: 100, meter: 0, facingLock: false, portrait: false, skills: ["Fault Strike", "b", "c", "d"], cooldowns: ["", "", "", ""] };
    const parent = new TagEl("div");
    const hud = new Hud(parent as unknown as HTMLElement, tagDoc);
    const find = (): TagEl => walkAll(parent.children[0]!).find((e) => e.dataset["control"] === "skill1")!;
    hud.render(layout, st);
    const kids = find().children;
    hud.render(layout, { ...st, cooldowns: ["4.0", "", "", ""] });
    expect(find().children).toBe(kids); // same child array: no rebuild
    expect(textOf(find())).toContain("4.0");
    hud.render(layout, { ...st, skills: ["Other Move", "b", "c", "d"] });
    expect(find().children).not.toBe(kids);
    expect(find().getAttribute("aria-label")).toContain("Other Move");
    hud.dispose();
  });
});
