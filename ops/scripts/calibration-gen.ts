// Generates docs/control-calibration.json from the section 7 formulas (D values). Run: pnpm --filter @eb/server exec tsx ../../ops/scripts/calibration-gen.ts
import { writeFileSync } from "node:fs";
import { computeLayout } from "../../apps/client/src/input/ControlLayout.js";

const viewports = [{ W: 1024, H: 768 }, { W: 1180, H: 820 }];
const out = {
  version: 1,
  note: "Section 7 positions are D (local design values). No original coordinate has been measured; observed stays null until docs/reference-observations.md has a completed row.",
  fidelityLabel: "not earned: no fidelity claim about controls until every observation row is complete",
  tags: { position: "D", touchMapping: "C", originalDefaultLayout: "U" },
  evidence: { touchMapping: ["R01", "R02"], layoutVocabulary: ["R01", "R02", "R10"] },
  viewports: viewports.map(({ W, H }) => {
    const l = computeLayout({ x0: 0, y0: 0, W, H });
    const controls: Record<string, unknown> = {};
    for (const c of Object.values(l.controls)) {
      controls[c.id] = {
        tag: "D", nx: +(c.cx / W).toFixed(6), ny: +(c.cy / H).toFixed(6),
        visualW: +c.vw.toFixed(3), visualH: +c.vh.toFixed(3), observed: null, status: "NOT RUN",
      };
    }
    return { W, H, s: l.s, controls };
  }),
};
writeFileSync(new URL("../../docs/control-calibration.json", import.meta.url), JSON.stringify(out, null, 2) + "\n");
