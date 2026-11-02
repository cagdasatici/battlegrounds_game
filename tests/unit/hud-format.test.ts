import { describe, expect, test } from "vitest";
import {
  RejectionNotice, cooldownLabel, formTimerText, meterLabel, rejectionText, respawnSecondsLeft, scoreboardRows, stillpointText,
} from "../../apps/client/src/ui/HudFormat.js";
import { computeLayout } from "../../apps/client/src/input/ControlLayout.js";
import { hudModel } from "../../apps/client/src/ui/Hud.js";

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
    expect(rejectionText("FORM")).toBe("Cannot use now");
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
