import { describe, expect, test } from "vitest";
import type { CombatEvent } from "../../packages/shared/src/protocol.js";
import { EA_DEFS, SV_DEFS, TD_DEFS } from "../../packages/shared/src/config/kits/index.js";
import {
  abilityLabel, accentCss, separateTags, allAbilityIds, formatNumber, kitOfMove, passesFilter, textsFor, type TextSettings,
} from "../../apps/client/src/fx/CombatTextFormat.js";

const S: TextSettings = { damageNumbers: true, combatText: "all", reducedMotion: false };
const ev = (p: Partial<CombatEvent>): CombatEvent => ({ eventId: "e", tick: 1, kind: "hit", actorId: "1", targetId: "2", lifeId: 1, ...p });
const name = (id: string) => `P${id}`;

describe("damage formatting", () => {
  test("whole numbers have no decimal, fractions get one", () => {
    expect(formatNumber(300)).toBe("3");
    expect(formatNumber(1000)).toBe("10");
    expect(formatNumber(350)).toBe("3.5");
    expect(formatNumber(125)).toBe("1.3");
  });
  test("hit text is red; heavy is 1.4x and bold", () => {
    const [l] = textsFor(ev({ damage100: 300, hitClass: "light" }), S, "1", name);
    expect(l).toMatchObject({ text: "-3", color: "#ff4d4d", bold: false, scale: 1, lifeMs: 900, anchorId: "2" });
    const [h] = textsFor(ev({ damage100: 1200, hitClass: "heavy" }), S, "1", name);
    expect(h).toMatchObject({ text: "-12", bold: true, scale: 1.4 });
  });
  test("heal, block, counter words", () => {
    expect(textsFor(ev({ kind: "heal", targetId: "2", damage100: 500 }), S, "1", name)[0]).toMatchObject({ text: "+5", color: "#4dff88", anchorId: "2" });
    expect(textsFor(ev({ kind: "block" }), S, "1", name)[0]).toMatchObject({ text: "BLOCK", color: "#9fd8ff", lifeMs: 700, anchorId: "2" });
    expect(textsFor(ev({ kind: "capture" }), S, "1", name)[0]).toMatchObject({ kind: "capture", text: "CAUGHT", anchorId: "2" });
    expect(textsFor(ev({ kind: "release" }), S, "1", name)[0]).toMatchObject({ kind: "release", text: "FREE", anchorId: "2" });
    expect(textsFor(ev({ kind: "capture", targetId: undefined }), S, "1", name)).toEqual([]);
    expect(textsFor(ev({ kind: "counter", actorId: "2", targetId: "1" }), S, "1", name)[0]).toMatchObject({ text: "COUNTER!", color: "#ffcc33", bold: true, anchorId: "2", lifeMs: 1000 });
  });
  test("damageNumbers off hides numbers but keeps words", () => {
    const s = { ...S, damageNumbers: false };
    expect(textsFor(ev({ damage100: 300 }), s, "1", name)).toEqual([]);
    expect(textsFor(ev({ kind: "block" }), s, "1", name)).toHaveLength(1);
  });
  test("reduced motion removes rise", () => {
    expect(textsFor(ev({ damage100: 300 }), { ...S, reducedMotion: true }, "1", name)[0]!.rise).toBe(false);
    expect(textsFor(ev({ damage100: 300 }), S, "1", name)[0]!.rise).toBe(true);
  });
});

describe("labels", () => {
  test("every shipped ability id has a non-empty label", () => {
    const defs = [...SV_DEFS, ...TD_DEFS, ...EA_DEFS];
    expect(allAbilityIds().sort()).toEqual(defs.map((d) => d.id).sort());
    for (const d of defs) expect(abilityLabel(d.id), d.id).toBe(d.label);
    for (const id of allAbilityIds()) expect(abilityLabel(id)!.length).toBeGreaterThan(0);
  });
  test("non-ability ids have no label and make no cast text", () => {
    expect(abilityLabel("m1.4.finisher")).toBeUndefined();
    expect(textsFor(ev({ kind: "cast", moveId: "dash.forward" }), S, "1", name)).toEqual([]);
  });
  test("cast pill uses kit accent; own casts also show bottom-centre", () => {
    const mine = textsFor(ev({ kind: "cast", actorId: "1", moveId: "sv.b1" }), S, "1", name);
    expect(mine.map((t) => t.kind)).toEqual(["cast", "castSelf"]);
    expect(mine[0]).toMatchObject({ text: "Fault Strike", pill: true, color: accentCss("sv"), lifeMs: 1200, anchorId: "1" });
    expect(textsFor(ev({ kind: "cast", actorId: "2", moveId: "sv.b1" }), S, "1", name).map((t) => t.kind)).toEqual(["cast"]);
    expect(kitOfMove("ea.b1")).toBe("ea");
  });
  test("KO feed line", () => {
    const [k] = textsFor(ev({ kind: "ko", actorId: "1", targetId: "2", moveId: "sv.b1" }), S, "1", name);
    expect(k).toMatchObject({ kind: "ko", text: "P1 KO'd P2 · Fault Strike", lifeMs: 4000 });
    expect(textsFor(ev({ kind: "ko", actorId: "1", targetId: "2" }), S, "1", name)[0]!.text).toBe("P1 KO'd P2");
  });
});

describe("mine filter", () => {
  test("mine keeps only events with the local player as actor or target", () => {
    expect(passesFilter(ev({}), "mine", "1")).toBe(true);
    expect(passesFilter(ev({}), "mine", "2")).toBe(true);
    expect(passesFilter(ev({}), "mine", "3")).toBe(false);
    expect(passesFilter(ev({}), "mine", undefined)).toBe(false);
    expect(passesFilter(ev({}), "all", "3")).toBe(true);
    expect(passesFilter(ev({}), "off", "1")).toBe(false);
    expect(textsFor(ev({ damage100: 300 }), { ...S, combatText: "mine" }, "3", name)).toEqual([]);
  });
});

describe("QI01 simultaneous tag de-overlap", () => {
  const box = (x: number, y: number) => ({ x, y, w: 110, h: 28 });
  const overlaps = (a: { x: number; y: number; w: number; h: number }, b: typeof a) => Math.abs(a.x - b.x) < (a.w + b.w) / 2 && a.y > b.y - b.h && b.y > a.y - a.h;
  test("three tags on top of each other end up with no overlap", () => {
    const bs = [box(500, 300), box(510, 302), box(520, 298)];
    const d = separateTags(bs);
    const moved = bs.map((b, i) => ({ ...b, y: b.y + d[i]! }));
    for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) expect(overlaps(moved[i]!, moved[j]!)).toBe(false);
  });
  test("tags that do not overlap are left alone", () => {
    expect(separateTags([box(100, 300), box(600, 300), box(100, 100)])).toEqual([0, 0, 0]);
  });
});
