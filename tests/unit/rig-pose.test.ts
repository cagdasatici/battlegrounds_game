import { describe, expect, it } from "vitest";
import { BONES, buildKitClips, type BoneName, type ClipData, type Vec3 } from "../../packages/shared/src/rig.js";
import type { KitId } from "../../packages/shared/src/protocol.js";

type Q = [number, number, number, number];
const qmul = (a: Q, b: Q): Q => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
function rot(q: Q, v: Vec3): Vec3 {
  const p = qmul(qmul(q, [v[0], v[1], v[2], 0]), [-q[0], -q[1], -q[2], q[3]]);
  return [p[0], p[1], p[2]];
}

/** Forward kinematics of one keyframe: world position of every bone in fighter space. */
function fk(clip: ClipData, k: number): Record<BoneName, Vec3> {
  const out = {} as Record<BoneName, Vec3>;
  const world = new Map<BoneName, { p: Vec3; q: Q }>();
  for (const b of BONES) {
    const rotTrack = clip.tracks.find((t) => t.bone === b.name && t.path === "rotation")!;
    const q = rotTrack.values.slice(k * 4, k * 4 + 4) as Q;
    let local: Vec3 = b.rest;
    if (b.name === "hips") local = clip.tracks.find((t) => t.bone === "hips" && t.path === "translation")!.values.slice(k * 3, k * 3 + 3) as unknown as Vec3;
    const par = b.parent ? world.get(b.parent)! : { p: [0, 0, 0] as Vec3, q: [0, 0, 0, 1] as Q };
    const r = rot(par.q, local);
    const p: Vec3 = [par.p[0] + r[0], par.p[1] + r[1], par.p[2] + r[2]];
    world.set(b.name, { p, q: qmul(par.q, q) });
    out[b.name] = p;
  }
  return out;
}

const len = (v: Vec3) => Math.hypot(v[0], v[1], v[2]);
/** Position reached by continuing the a->b line for `dist` metres beyond b. */
const extend = (a: Vec3, b: Vec3, dist: number): Vec3 => {
  const d: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], l = len(d);
  return [b[0] + (d[0] / l) * dist, b[1] + (d[1] / l) * dist, b[2] + (d[2] / l) * dist];
};

const KITS = ["sv", "td", "ea"] as KitId[];
describe("rig pose directions (fighters face -Z)", () => {
  for (const kit of KITS) {
    const clips = buildKitClips(kit);
    it(`${kit}: knees and elbows never bend backwards`, () => {
      for (const c of clips) {
        for (let k = 0; k < c.tracks[0]!.times.length; k++) {
          const w = fk(c, k);
          for (const s of ["L", "R"] as const) {
            const shin = extend(w[`hip${s}` as BoneName], w[`knee${s}` as BoneName], 0.38);
            expect(w[`ankle${s}` as BoneName][2], `${c.id} key ${k} knee${s}`).toBeGreaterThanOrEqual(shin[2] - 0.02);
            const fore = extend(w[`shoulder${s}` as BoneName], w[`elbow${s}` as BoneName], 0.26);
            // Only meaningful while the upper arm hangs; with the arm raised sideways the elbow hinge is no longer the Z axis.
            if (w[`shoulder${s}` as BoneName][1] - w[`elbow${s}` as BoneName][1] > 0.2) expect(w[`hand${s}` as BoneName][2], `${c.id} key ${k} elbow${s}`).toBeLessThanOrEqual(fore[2] + 0.03);
          }
        }
      }
    });
    it(`${kit}: m1 punches land in front`, () => {
      // m1.4 is a kick (MOVE_ARCHETYPE), so its striking limb is a foot, not a hand.
      for (const id of ["m1.1", "m1.2", "m1.3", "m1.4"]) {
        const c = clips.find((x) => x.id === id)!;
        let best = Infinity;
        for (let k = 0; k < c.tracks[0]!.times.length; k++) {
          const w = fk(c, k);
          best = Math.min(best, (id === "m1.4" ? Math.min(w.ankleL[2], w.ankleR[2]) : Math.min(w.handL[2], w.handR[2])) - w.chest[2]);
        }
        // Kicks reach less far in the authored poses (sv/ea only about 0.01 to 0.11 m); the 0.25 m bar is for hands.
        expect(best, id).toBeLessThan(id === "m1.4" ? 0 : -0.25);
      }
    });
    it(`${kit}: dashFront leans forward`, () => {
      const c = clips.find((x) => x.id === "dashFront")!;
      let best = Infinity;
      for (let k = 0; k < c.tracks[0]!.times.length; k++) { const w = fk(c, k); best = Math.min(best, w.head[2] - w.hips[2]); }
      expect(best).toBeLessThan(0);
    });
  }
});
