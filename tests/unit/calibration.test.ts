import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { computeLayout } from "../../apps/client/src/input/ControlLayout.js";

const root = join(import.meta.dirname, "../..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const cal = JSON.parse(read("docs/control-calibration.json"));
const rows = read("docs/reference-observations.md").split("\n").filter((l) => /^\| O\d+ /.test(l)).map((l) => l.split("|").slice(1, -1).map((c) => c.trim()));

export const TAGS = ["V", "C", "X", "D", "U"];
export const EXACT = /exact\s+replica/i;
export const CLOSE = /closely\s+matched\s+controls/i;
/** Returns label rule violations in a text. `allowClose` is true only once every observation is DONE. */
export function labelViolations(text: string, allowClose: boolean): string[] {
  const v: string[] = [];
  if (EXACT.test(text)) v.push("exact replica");
  if (!allowClose && CLOSE.test(text)) v.push("closely matched controls");
  return v;
}

describe("calibration json", () => {
  test("matches computeLayout within 0.5 px and tags every control", () => {
    for (const vp of cal.viewports) {
      const l = computeLayout({ x0: 0, y0: 0, W: vp.W, H: vp.H });
      for (const c of Object.values(l.controls)) {
        const e = vp.controls[c.id];
        expect(e, c.id).toBeDefined();
        expect(TAGS).toContain(e.tag);
        expect(Math.abs(e.nx * vp.W - c.cx)).toBeLessThan(0.5);
        expect(Math.abs(e.ny * vp.H - c.cy)).toBeLessThan(0.5);
        if (e.observed === null) expect(e.status).toBe("NOT RUN");
      }
    }
    for (const t of Object.values(cal.tags)) expect(TAGS).toContain(t);
  });
});

describe("observation ledger", () => {
  test("rows are NOT RUN or complete with device, date, trials, median, range, fps", () => {
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(TAGS).toContain(r[2]);
      expect(["NOT RUN", "DONE"]).toContain(r[4]);
      if (r[4] === "DONE") for (const i of [5, 6, 7, 8, 9, 10]) expect(r[i], `${r[0]} col ${i}`).not.toBe("");
      else for (const i of [5, 6, 7, 8, 9, 10]) expect(r[i], `${r[0]} NOT RUN has a number`).toBe("");
    }
  });
});

function files(dir: string, ext: RegExp): string[] {
  return readdirSync(join(root, dir)).flatMap((n) => {
    const p = join(dir, n);
    return statSync(join(root, p)).isDirectory() ? files(p, ext) : ext.test(n) ? [p] : [];
  });
}

describe("fidelity label rules", () => {
  const allDone = rows.length > 0 && rows.every((r) => r[4] === "DONE");
  test("scanned files obey the label rules", () => {
    const scanned = ["README.md", "docs/control-calibration.json", "docs/reference-observations.md", ...files("apps/client/src", /\.(ts|html)$/), "apps/client/index.html"];
    for (const f of scanned) {
      let t = "";
      try { t = read(f); } catch { continue; }
      expect(labelViolations(t, allDone), f).toEqual([]);
    }
  });
  test("the matcher catches planted bad strings", () => {
    expect(labelViolations("An Exact Replica of it", true)).toEqual(["exact replica"]);
    expect(labelViolations("closely matched controls", false)).toEqual(["closely matched controls"]);
    expect(labelViolations("closely matched controls", true)).toEqual([]);
  });
});
