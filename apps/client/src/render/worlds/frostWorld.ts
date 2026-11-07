/**
 * WORLD02: Frostpeak visuals. Built from the collision list (packages/shared/src/config/worlds.ts): the flat snow slab is the middle of a larger plain,
 * ringed by a pine tree line just outside the boundary walls, then foothills and a ring of ridged snowy mountains 100 to 200 m away (visual backdrop).
 * Every obstacle collider gets a matching pine, snow-capped boulder or drift; ice patches (glossy, flush with the snow, decoration only), cracks,
 * ravens and cold haze fill the rest. Falling snow comes from the environment layer (render/environment/SnowFall.ts). Original procedural art only.
 * Presentation only: nothing here decides a position or a hit.
 */
import {
  BoxGeometry, BufferGeometry, ConeGeometry, DoubleSide, Euler, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, MeshPhongMaterial, MeshToonMaterial, Quaternion,
  CircleGeometry, Vector3, Group, type DataTexture,
} from "three";
import type { Collider } from "@eb/shared/config/arena";
import { FROST_ICE_PATCHES } from "@eb/shared/config/worlds";
import type { MapDefinition } from "@eb/shared/config/maps";
import { mixHex, mulberry32 } from "../../scene/EnvPalette.js";
import { Batch, xf, type ArenaBuild } from "../../scene/ArenaView.js";
import { fbm, valueNoise } from "../environment/noise.js";
import type { EnvTheme } from "../environment/theme.js";
import { Allocations, clamp01, cloudPuffs, grainTexture, heightfield, makeSkyParts, polarField, smoothstep } from "./common.js";
import { FROST_RING_R, FROST_RING_R0, frostHeight, snowLine } from "./frostShape.js";
import { birdGeometry, boulder, drift, pine } from "./props.js";

/** Snow colour on the plain and, with `h` and `ny` (the surface normal's y), on the foothills: forest below the snow line, bare rock on steep faces, white above. */
export function snowHex(x: number, z: number, h: number, ny: number): number {
  const broad = fbm(x * 0.05, z * 0.05, 3), mid = fbm(x * 0.18, z * 0.18, 5);
  let c = mixHex(0xe4eef7, 0xf9fcff, broad);
  c = mixHex(c, 0xc2d3e6, Math.max(0, 0.46 - mid) * 1.1); // blue shade in the hollows
  c = mixHex(c, 0xffffff, Math.max(0, mid - 0.64) * 1.2);
  if (h <= 0.2) return c;
  const line = snowLine(x, z);
  const forest = (1 - smoothstep(0.4 * line, 0.95 * line, h)) * smoothstep(1.5, 6, h) * (0.55 + 0.45 * valueNoise(x * 0.16, z * 0.16, 41)) * smoothstep(0.7, 0.9, ny);
  c = mixHex(c, mixHex(0x274642, 0x3d6a58, valueNoise(x * 0.3, z * 0.3, 43)), forest * 0.85);
  const steep = smoothstep(0.93, 0.68, ny) * smoothstep(3, 14, h);
  const rock = mixHex(0x434d5e, 0x8794a8, clamp01(valueNoise(x * 0.07, z * 0.07, 47) * 0.7 + h / 130));
  c = mixHex(c, rock, steep);
  c = mixHex(c, 0xfdfeff, smoothstep(line * 0.9, line * 1.15, h) * (1 - steep * 0.8)); // snow cap above the line
  return c;
}

/** Everything non-collided in the snow scene. */
export function buildFrostWorld(colliders: readonly Collider[], ramp: DataTexture, opts: { theme: EnvTheme; map: MapDefinition }): ArenaBuild {
  const { theme, map } = opts;
  const hx = map.bounds.maxX, hz = map.bounds.maxZ;
  const A = new Allocations(), group = new Group(), rnd = mulberry32(0xf2057);
  const toon = A.mat(new MeshToonMaterial({ vertexColors: true, gradientMap: ramp }));
  const addMesh = (name: string, g: BufferGeometry, mat: MeshToonMaterial | MeshBasicMaterial | MeshPhongMaterial, cast: boolean, receive: boolean): Mesh => {
    const m = new Mesh(A.geo(g), mat); m.name = name; m.castShadow = cast; m.receiveShadow = receive; group.add(m); return m;
  };

  // Ground: a square plain (flat; sparkle grain multiplies the colour), then the foothill and mountain ring.
  const snowTex = A.tex(grainTexture(0x77a1, { base: 240, ripple: 0.8, sparkle: 1 }));
  const terrain = A.mat(new MeshToonMaterial({ vertexColors: true, gradientMap: ramp, map: snowTex }));
  const R0 = FROST_RING_R0;
  addMesh("deco.terrain", heightfield({ x0: -R0, x1: R0, z0: -R0, z1: R0, cell: 2, height: frostHeight, color: (x, z, h) => snowHex(x, z, h, 1), uvMetres: 3 }), terrain, false, true);
  // The ring sits 4 cm above the plain where they overlap (no z-fighting), easing in so there is no visible step.
  const ringY = (x: number, z: number): number => frostHeight(x, z) + 0.04 * smoothstep(R0, R0 + 6, Math.hypot(x, z));
  addMesh("deco.mountains", polarField({ r0: R0, r1: FROST_RING_R, rings: 56, segments: 220, height: ringY, color: (x, z, h, ny) => snowHex(x, z, h, ny), uvMetres: 6 }), toon, false, true);

  // Hero peaks: sharper cones on the ridge line so the skyline has a few clear summits.
  const peaks = new Batch();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.3 + (rnd() - 0.5) * 0.25, r = 172 + rnd() * 30, h = 70 + rnd() * 34, rad = 40 + rnd() * 18;
    const g = new ConeGeometry(rad, h, 9, 4), p = g.getAttribute("position");
    for (let k = 0; k < p.count; k++) { const w = 1 + (rnd() - 0.5) * 0.18 * (p.getY(k) > h / 2 - 0.01 ? 0 : 1); p.setX(k, p.getX(k) * w); p.setZ(k, p.getZ(k) * w); }
    g.computeVertexNormals();
    const base = -6, cx = Math.cos(a) * r, cz = Math.sin(a) * r;
    peaks.add(g, xf(cx, base + h / 2, cz, 1, 1, 1, 0, rnd() * 3, 0), (x, y, z) => {
      const t = (y - base) / h, rock = mixHex(0x566172, 0x8794a8, valueNoise(x * 0.09, z * 0.09, 51));
      return mixHex(rock, 0xfbfdff, smoothstep(0.34 + 0.08 * valueNoise(x * 0.2, z * 0.2, 53), 0.52, t));
    });
  }
  addMesh("deco.peaks", peaks.build(), toon, false, false);

  // Obstacles from the collision list.
  const trees = new Batch(), rocks = new Batch();
  for (const c of colliders) {
    if (c.role !== "obstacle") continue;
    if (c.id.startsWith("pine.")) pine(trees, c.centre[0], 0, c.centre[2], 1.25, rnd);
    else if (c.id.startsWith("rock.") && c.shape === "cuboid") boulder(rocks, c.centre[0], 0, c.centre[2], c.halfExtents[0], c.halfExtents[1] * 2, c.halfExtents[2], rnd, { lit: 0xa9b3c1, mid: 0x76818f, wet: 0x4d5766, snow: true });
    else if (c.id.startsWith("drift.") && c.shape === "cuboid") drift(rocks, c.centre[0], c.centre[2], c.halfExtents[0], c.halfExtents[1] * 2, c.halfExtents[2], rnd);
  }

  // Tree line: two loose rows of pines just outside the boundary walls, so the walls read as the edge of a forest.
  const place = (x: number, z: number, s: number): void => pine(trees, x, 0, z, s, rnd);
  for (let t = -hx - 4; t <= hx + 4; t += 4.2) for (const side of [-1, 1]) {
    place(t + (rnd() - 0.5) * 2, side * (hz + 2.8 + rnd() * 2.4), 1.1 + rnd() * 0.6);
    if (rnd() < 0.55) place(t + 2 + (rnd() - 0.5) * 2, side * (hz + 8 + rnd() * 4), 1.3 + rnd() * 0.7);
  }
  for (let t = -hz; t <= hz; t += 4.2) for (const side of [-1, 1]) {
    place(side * (hx + 2.8 + rnd() * 2.4), t + (rnd() - 0.5) * 2, 1.1 + rnd() * 0.6);
    if (rnd() < 0.55) place(side * (hx + 8 + rnd() * 4), t + 2 + (rnd() - 0.5) * 2, 1.3 + rnd() * 0.7);
  }
  // Boulders and drifts half buried at the tree line.
  for (let i = 0; i < 14; i++) {
    const d = 1 + rnd() * 3, sign = rnd() < 0.5 ? -1 : 1, onZ = rnd() < 0.5;
    const ex = onZ ? (rnd() * 2 - 1) * hx : sign * (hx + d), ez = onZ ? sign * (hz + d) : (rnd() * 2 - 1) * hz;
    if (i % 2) boulder(rocks, ex, 0, ez, 1.4 + rnd() * 1.6, 1.6 + rnd() * 1.8, 1.2 + rnd() * 1.4, rnd, { lit: 0xa9b3c1, mid: 0x76818f, wet: 0x4d5766, snow: true });
    else drift(rocks, ex, ez, 2.5 + rnd() * 3, 0.8 + rnd() * 0.6, 1.4 + rnd() * 1.6, rnd);
  }

  // Foothill pines (bigger, further): only where the ground is gentle and below the snow line. Merged into `deco.cover`, which the low tier hides.
  const far = new Batch();
  for (let i = 0, placed = 0; placed < 150 && i < 4000; i++) {
    const a = rnd() * Math.PI * 2, r = 86 + rnd() * 62, x = Math.cos(a) * r, z = Math.sin(a) * r, h = frostHeight(x, z);
    if (h < 0.4 || h > snowLine(x, z) * 0.62) continue;
    const e = 2.5, ny = 2 * e / Math.hypot(frostHeight(x + e, z) - frostHeight(x - e, z), 2 * e, frostHeight(x, z + e) - frostHeight(x, z - e));
    if (ny < 0.82 || valueNoise(x * 0.09, z * 0.09, 61) < 0.38) continue;
    pine(far, x, h - 0.2, z, 2.1 + rnd() * 1.4, rnd, h > 5); placed++;
  }
  addMesh("deco.pines", trees.build(), toon, true, true);
  addMesh("deco.props", rocks.build(), toon, true, true);
  addMesh("deco.cover", far.build(), toon, false, false);

  // Ice patches: glossy discs flush with the snow with hairline cracks. Decoration only (no movement rule). The crater cut opens them too.
  const iceMat = A.mat(new MeshPhongMaterial({ vertexColors: true, shininess: 150, specular: 0xffffff, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  const ice = new Batch();
  for (const [px, pz, rx, rz] of FROST_ICE_PATCHES) {
    const g = new CircleGeometry(1, 30), p = g.getAttribute("position");
    for (let k = 1; k < p.count; k++) { const w = 0.82 + rnd() * 0.3; p.setXY(k, p.getX(k) * w, p.getY(k) * w); }
    ice.add(g, xf(px, 0.012, pz, rx, rz, 1, -Math.PI / 2), (x, _y, z) => mixHex(0xe3f4ff, 0x9acbe8, clamp01(Math.hypot((x - px) / rx, (z - pz) / rz))));
    for (let k = 0; k < 3; k++) {
      const ang = rnd() * Math.PI, len = (0.4 + rnd() * 0.5) * Math.min(rx, rz) * 1.2, ox = (rnd() - 0.5) * rx * 0.9, oz = (rnd() - 0.5) * rz * 0.9;
      ice.add(new BoxGeometry(len, 0.004, 0.05), xf(px + ox, 0.018, pz + oz, 1, 1, 1, 0, ang, 0), 0x6fa8cf);
    }
  }
  addMesh("deco.ice", ice.build(), iceMat, false, true);

  // Clouds: heavy grey-white stratus over the peaks.
  const clouds = addMesh("deco.clouds", cloudPuffs(14, 120, 205, 70, 125, { lit: 0xf2f6fb, shade: 0xa5b5ca }, 0xc10d9), toon, false, false);

  // Sky, cloud shell.
  const { sky, cloudShell } = makeSkyParts(theme, A);
  group.add(sky);

  // Ravens: a few dark V shapes circling high over the clearing (the scene already calls `setMotes` every frame).
  const birdG = A.geo(birdGeometry());
  const birdMat = A.mat(new MeshBasicMaterial({ color: 0x252d3a, side: DoubleSide }));
  const ravens = Array.from({ length: 5 }, (_, i) => ({ cx: (rnd() - 0.5) * 40, cz: (rnd() - 0.5) * 40, r: 30 + rnd() * 40, w: (0.08 + rnd() * 0.1) * (i % 2 ? 1 : -1), y: 26 + rnd() * 18, ph: rnd() * 6.28 }));
  const motes = new InstancedMesh(birdG, birdMat, ravens.length);
  motes.name = "deco.motes"; motes.frustumCulled = false;
  group.add(motes);
  const m4 = new Matrix4(), q = new Quaternion(), e = new Euler(), pv = new Vector3(), sv = new Vector3();
  const setMotes = (t: number): void => {
    ravens.forEach((g, i) => {
      const a = g.ph + t * g.w;
      pv.set(g.cx + Math.cos(a) * g.r, g.y + Math.sin(t * 0.5 + g.ph) * 1.5, g.cz + Math.sin(a) * g.r);
      q.setFromEuler(e.set(0, -a + (g.w > 0 ? 0 : Math.PI), 0));
      motes.setMatrixAt(i, m4.compose(pv, q, sv.set(1.3, 0.5 + 0.8 * Math.abs(Math.sin(t * 1.6 + g.ph * 3)), 1.3)));
    });
    motes.instanceMatrix.needsUpdate = true;
  };
  setMotes(0);

  return {
    group, sky, clouds, cloudShell, motes, setMotes, geometries: A.geometries, materials: A.materials, textures: A.textures, terrain,
    groundMaterials: [iceMat],
  };
}
