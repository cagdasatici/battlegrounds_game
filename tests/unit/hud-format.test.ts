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
