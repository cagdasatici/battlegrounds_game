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
          for (const side of ["L", "R"] as const) {
            // Hinge direction is local to the limb, not world Z (raised/crouched legs rotate the hinge plane).
            for (const joint of ["knee", "elbow"] as const) {
              const track = c.tracks.find(t => t.bone === `${joint}${side}` && t.path === "rotation")!;
              const x = track.values[k * 4]!, y = track.values[k * 4 + 1]!, z = track.values[k * 4 + 2]!;
              expect(y).toBeCloseTo(0); expect(z).toBeCloseTo(0);
              if (joint === "knee") expect(x, `${c.id} key ${k} knee${side}`).toBeLessThanOrEqual(.001);
              else expect(x, `${c.id} key ${k} elbow${side}`).toBeGreaterThanOrEqual(-.001);
            }
          }
        }
      }
    });
    it(`${kit}: m1 punches land in front`, () => {
      // m1.4 is a kick (MOVE_ARCHETYPE), so its striking limb is a foot, not a hand.
      for (const id of ["m1.1", "m1.2", "m1.3", "m1.4"]) {
        const c = clips.find((x) => x.id === id)!;
        const k = c.tracks[0]!.times.findIndex(t => Math.abs(t - c.phases!.activeStart) < .001);
        const w = fk(c, k);
        const striking = id === "m1.4" ? w.ankleR : id === "m1.2" ? w.handL : w.handR;
        expect(striking[2] - w.chest[2], `${id}: designated striking limb`).toBeLessThan(-.2);
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

// QF01: Stone Vanguard planted guard and Fault Strike anticipation.
describe("QF01 Stone Vanguard animation", () => {
  const sv = buildKitClips("sv"), td = buildKitClips("td");
  const reach = (c: ClipData, k: number): number => { const w = fk(c, k); return w.chest[2] - Math.min(w.handL[2], w.handR[2]); };
  it("guards lower and wider than the Duelist", () => {
    const g = sv.find((c) => c.id === "guard")!, t = td.find((c) => c.id === "guard")!;
    const hipsY = (c: ClipData): number => c.tracks.find((x) => x.bone === "hips" && x.path === "translation")!.values[1]!;
    expect(hipsY(g)).toBeLessThan(hipsY(t) - 0.03);
    const spread = (c: ClipData): number => { const w = fk(c, 0); return Math.abs(w.ankleL[0] - w.ankleR[0]); };
    expect(spread(g)).toBeGreaterThan(spread(t) + 0.1);
  });
  it("sv.b1 shifts weight before the windup and does not strike before the active key", () => {
    const c = sv.find((x) => x.id === "sv.b1")!, times = c.tracks[0]!.times;
    expect(times.length).toBeGreaterThanOrEqual(6);
    // key 0 rest, key 1 weight shift, key 2 windup, key 3 active (timing unchanged: 0.3 s and 0.42 s times the kit tempo).
    expect(times[1]!).toBeLessThan(times[2]!);
    expect(times[2]!).toBeCloseTo(0.3 * 1.15, 5);
    expect(times[3]!).toBeCloseTo(0.42 * 1.15, 5);
    const hipsX = (k: number): number => c.tracks.find((x) => x.bone === "hips" && x.path === "translation")!.values[k * 3]!;
    expect(hipsX(1) - hipsX(0)).toBeGreaterThan(0.03);
    expect(reach(c, 1)).toBeLessThan(reach(c, 0) + 0.05);
    expect(reach(c, 3)).toBeGreaterThan(reach(c, 1) + 0.1);
  });
  it("does not add a shift key to other moves or kits", () => {
    expect(sv.find((x) => x.id === "sv.b2")!.tracks[0]!.times[1]!).toBeCloseTo(0.3 * 1.15, 5);
    expect(td.find((x) => x.id === "td.b1")!.tracks[0]!.times[1]!).toBeCloseTo(0.3 * 0.95, 5);
  });
});

// QF02: Tide Duelist cross-body stance and Undertow Spiral shoulder lead.
describe("QF02 Tide Duelist animation", () => {
  const td = buildKitClips("td"), ea = buildKitClips("ea");
  it("twists the torso across the hips at rest and in guard more than the Ember kit", () => {
    // Shoulder line yaw: depth difference between the shoulders.
    const twist = (c: ClipData): number => { const w = fk(c, 0); return Math.abs(w.shoulderL[2] - w.shoulderR[2]); };
    for (const id of ["idle", "guard"]) expect(twist(td.find((c) => c.id === id)!), id).toBeGreaterThan(twist(ea.find((c) => c.id === id)!) + 0.03);
  });
  it("td.b2 leads with the shoulder before the windup and does not strike before the active key", () => {
    const c = td.find((x) => x.id === "td.b2")!, times = c.tracks[0]!.times;
    expect(times.length).toBeGreaterThanOrEqual(6);
    expect(times[1]!).toBeCloseTo(0.12 * 0.95, 5);
    expect(times[2]!).toBeCloseTo(0.3 * 0.95, 5);
    expect(times[3]!).toBeCloseTo(0.42 * 0.95, 5);
    const w0 = fk(c, 0), w1 = fk(c, 1);
    // Right shoulder (hand) moves forward of the chest versus rest at the lead key, but the chest is not yet at full coil.
    expect(Math.min(w1.handR[2], w1.handL[2]) - w1.chest[2]).toBeLessThan(Math.min(w0.handR[2], w0.handL[2]) - w0.chest[2] - 0.02);
    expect(Math.abs(c.tracks[0]!.times[1]! - c.tracks[0]!.times[0]!)).toBeGreaterThan(0.05);
  });
  it("adds no lead key to other Duelist moves or other kits' td.b2", () => {
    expect(td.find((x) => x.id === "td.b1")!.tracks[0]!.times[1]!).toBeCloseTo(0.3 * 0.95, 5);
  });
});

// QF03: Ember Artificer compact stance, forearm guard and Furnace Ray vent-open key.
describe("QF03 Ember Artificer animation", () => {
  const ea = buildKitClips("ea"), sv = buildKitClips("sv");
  it("guards with the insulated left forearm raised in front of the chest", () => {
    const w = fk(ea.find((c) => c.id === "guard")!, 0);
    expect(Math.abs(w.handL[2] - w.chest[2])).toBeLessThan(0.45); // held close to the chest
    expect(w.handL[1]).toBeGreaterThan(w.hips[1] + 0.1); // above the hips
    expect(Math.hypot(w.handL[0] - w.chest[0], w.handL[1] - w.chest[1], w.handL[2] - w.chest[2])).toBeLessThan(0.5); // guard hand stays near the chest
  });
  it("ea.a3 opens the vents with a chest rock-back key before the windup and does not strike early", () => {
    const c = ea.find((x) => x.id === "ea.a3")!, times = c.tracks[0]!.times;
    expect(times[1]!).toBeCloseTo(0.12, 5);
    expect(times[2]!).toBeCloseTo(0.3, 5);
    expect(times[3]!).toBeCloseTo(0.42, 5);
    const w0 = fk(c, 0), w1 = fk(c, 1);
    // Beam direction is whichever way the hand travels at the active key; the vent key must reach well short of it.
    const rel = (k: number): number => { const w = fk(c, k); return w.handL[2] - w.chest[2]; };
    const dir = Math.sign(rel(3) - rel(0));
    expect(dir * (rel(1) - rel(0))).toBeLessThan(dir * (rel(3) - rel(0)) * 0.5);
    // The torso visibly moves at the vent key (pack tilt) without any strike.
    expect(Math.abs(w1.head[2] - w0.head[2])).toBeGreaterThan(0.05);
  });
  it("adds no vent key to other Artificer moves", () => {
    expect(ea.find((x) => x.id === "ea.a1")!.tracks[0]!.times[1]!).toBeCloseTo(0.3, 5);
  });
});

// UX08 audit: preserve natural knee-up tuck and planted landing while correcting shoulders/kicks.
for (const kit of KITS) {
  it(`${kit}: jump tucks knees forward and landing keeps feet below knees`, () => {
    const clips = buildKitClips(kit), jump = fk(clips.find(c => c.id === "jump")!, 0), land = fk(clips.find(c => c.id === "land")!, 0);
    for (const side of ["L", "R"] as const) {
      expect(jump[`hip${side}`][2] - jump[`knee${side}`][2]).toBeGreaterThan(.2);
      expect(land[`knee${side}`][1] - land[`ankle${side}`][1]).toBeGreaterThan(.2);
    }
  });
}
