/**
 * WORLD01: Sunreach Coast visuals. Built from the collision list (packages/shared/src/config/worlds.ts): the flat sand slab is drawn as the
 * middle of a larger heightfield (sea bed and animated water on the south, east and west; rolling dunes behind the north edge), every
 * obstacle collider gets a matching palm, boulder or driftwood log, and decoration (shells, starfish, dune grass, flotsam, sea stacks,
 * hazy islands, gulls, clouds) fills the rest. Original procedural art only. Presentation only: nothing here decides a position or a hit.
 */
import {
  BufferGeometry, DoubleSide, Float32BufferAttribute, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, MeshToonMaterial, Quaternion, Vector3,
  Euler, DodecahedronGeometry, RingGeometry, type DataTexture, Group,
} from "three";
import type { Collider } from "@eb/shared/config/arena";
import type { MapDefinition } from "@eb/shared/config/maps";
import { mixHex, mulberry32 } from "../../scene/EnvPalette.js";
import { Batch, xf, type ArenaBuild } from "../../scene/ArenaView.js";
import { fbm, valueNoise } from "../environment/noise.js";
import type { EnvTheme } from "../environment/theme.js";
import { Allocations, cloudPuffs, grainTexture, heightfield, makeSkyParts, outsideRect, smoothstep } from "./common.js";
import { COAST_WATER_Y, coastHeight } from "./coastShape.js";
import { Water } from "./Water.js";
import { birdGeometry, boulder, log, palm, shell, starfish, tuft } from "./props.js";

/** Sand colour at a ground point: pale dry sand with warm patches and wind streaks, darker where wet, olive on the dunes. */
export function sandHex(x: number, z: number, h: number): number {
  const broad = fbm(x * 0.045, z * 0.045, 3), mid = fbm(x * 0.17, z * 0.17, 5);
  let c = mixHex(0xe9d4a0, 0xf4e6bd, broad);
  c = mixHex(c, 0xdcbf86, Math.max(0, 0.55 - mid) * 0.9);
  c = mixHex(c, 0xf8efd0, Math.max(0, mid - 0.62) * 1.4); // wind-bleached crests
  const streak = 0.5 + 0.5 * Math.sin((x * 0.21 + z * 0.08) + fbm(x * 0.1, z * 0.1, 9) * 6);
  c = mixHex(c, 0xd6b97f, streak * 0.12);
  const above = h - COAST_WATER_Y;
  if (above < 0.9) c = mixHex(c, above < 0 ? 0xcbd3a4 : 0xb59a68, 1 - smoothstep(0, 0.9, above) * (above < 0 ? 0 : 1)); // wet band, then submerged shallows
  if (h > 1.4) c = mixHex(c, 0x9a9a5a, smoothstep(0.55, 0.8, valueNoise(x * 0.23 + 5, z * 0.23, 12)) * smoothstep(1.4, 5, h) * 0.4); // dune scrub
  return c;
}

/** Everything non-collided in the beach scene. */
export function buildCoastWorld(colliders: readonly Collider[], ramp: DataTexture, opts: { theme: EnvTheme; map: MapDefinition }): ArenaBuild {
  const { theme, map } = opts;
  const hx = map.bounds.maxX, hz = map.bounds.maxZ, dims = { halfX: hx, halfZ: hz };
  const A = new Allocations(), group = new Group(), rnd = mulberry32(0xc0a57);
  const toon = A.mat(new MeshToonMaterial({ vertexColors: true, gradientMap: ramp }));
  const leafMat = A.mat(new MeshToonMaterial({ vertexColors: true, gradientMap: ramp, side: DoubleSide }));
  const addMesh = (name: string, g: BufferGeometry, mat: MeshToonMaterial | MeshBasicMaterial, cast: boolean, receive: boolean): Mesh => {
    const m = new Mesh(A.geo(g), mat); m.name = name; m.castShadow = cast; m.receiveShadow = receive; group.add(m); return m;
  };
  const heightAt = (x: number, z: number): number => coastHeight(x, z, dims);

  // Terrain: flat slab in the middle, sea bed and dunes around it. Sand grain multiplies the vertex colour.
  const sand = A.tex(grainTexture(0x5a4d, { base: 238, ripple: 1, sparkle: 0 }));
  const terrain = A.mat(new MeshToonMaterial({ vertexColors: true, gradientMap: ramp, map: sand }));
  addMesh("deco.terrain", heightfield({ x0: -(hx + 60), x1: hx + 60, z0: -(hz + 150), z1: hz + 20, cell: 2, height: heightAt, color: sandHex, uvMetres: 3 }), terrain, false, true);

  // Sea.
  const water = new Water(dims, { shallow: 0x3fe0cc, deep: 0x0a5fb4, sky: theme.sky.mid, foam: 0xffffff, glint: 0xfff2cf }, theme.sunDir);
  A.geo(water.mesh.geometry); A.mat(water.mesh.material);
  group.add(water.mesh);

  // Obstacles from the collision list.
  const props = new Batch(), trunks = new Batch(), leaves = new Batch();
  for (const c of colliders) {
    if (c.role !== "obstacle") continue;
    if (c.id.startsWith("palm.")) palm(trunks, leaves, c.centre[0], 0, c.centre[2], { height: 6.4, lean: 1.2 + rnd() * 1.4, leanYaw: rnd() * 6.28, fronds: 10, seed: rnd });
    else if (c.id.startsWith("rock.") && c.shape === "cuboid") boulder(props, c.centre[0], 0, c.centre[2], c.halfExtents[0], c.halfExtents[1] * 2, c.halfExtents[2], rnd, { lit: 0xb6ad9b, mid: 0x8f867b, wet: 0x5c5853, moss: 0x6f8559 });
    else if (c.id.startsWith("log.") && c.shape === "cuboid") {
      const alongX = c.halfExtents[0] >= c.halfExtents[2];
      log(props, c.centre[0], 0, c.centre[2], (alongX ? c.halfExtents[0] : c.halfExtents[2]) * 0.96, 0.33, alongX, rnd);
    }
  }

  // Backdrop: more palms on the dunes behind the beach, sea stacks, flotsam, dune grass.
  for (let i = 0; i < 16; i++) {
    const x = (rnd() * 2 - 1) * (hx + 40), z = -hz - 4 - rnd() * 34, h = heightAt(x, z);
    if (h < 0.5) continue;
    palm(trunks, leaves, x, h - 0.1, z, { height: 5.2 + rnd() * 3, lean: 0.8 + rnd() * 2.2, leanYaw: rnd() * 6.28, fronds: 9, seed: rnd });
  }
  const stacks: ReadonlyArray<readonly [number, number, number, number]> = [[hx + 14, 10, 4.5, 7], [hx + 30, -14, 3.2, 5], [-hx - 16, 6, 5.5, 8], [-hx - 34, -20, 3.4, 5.5], [-12, hz + 18, 4, 6], [24, hz + 34, 5.5, 8.5], [-40, hz + 40, 3, 4.5]];
  const rings = new Batch();
  for (const [x, z, r, h] of stacks) {
    boulder(props, x, heightAt(x, z) - 0.3, z, r, h, r * 0.85, rnd, { lit: 0xbdb3a1, mid: 0x8b8379, wet: 0x4f5a58, moss: 0x5d7a52 });
    // Foam where the swell breaks around the stack (a flat ring on the water; it does not move, the water shader's own foam does).
    rings.add(new RingGeometry(r * 0.9, r * 1.55, 18, 1), xf(x, COAST_WATER_Y + 0.05, z, 1, 1, 0.85, -Math.PI / 2), 0xffffff);
  }
  addMesh("deco.foamRings", rings.build(), A.mat(new MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.55, depthWrite: false, fog: true })), false, false).renderOrder = 3;
  for (let i = 0; i < 10; i++) {
    const side = i % 3, d = 1.2 + rnd() * 1.0, t = rnd() * 2 - 1;
    const x = side === 0 ? (t < 0 ? -hx - d : hx + d) : t * hx, z = side === 0 ? t * hz * 0.8 : hz + d;
    log(props, x, heightAt(x, z), z, 1.2 + rnd() * 1.4, 0.22 + rnd() * 0.1, rnd() < 0.5, rnd);
  }
  const grass = new Batch();
  for (let i = 0, placed = 0; placed < 260 && i < 4000; i++) {
    const x = (rnd() * 2 - 1) * (hx + 54), z = -hz + 6 - rnd() * 100, h = heightAt(x, z);
    if (h < 1.2 || outsideRect(x, z, hx, hz) < 3) continue;
    tuft(grass, x, h, z, 0.5 + rnd() * 0.5, rnd, 0x8a9650, 0xdcd68a); placed++;
  }

  // Shells and starfish: along the waterline and scattered across the sand, clear of the obstacles.
  const free = (x: number, z: number): boolean => !colliders.some((c) => c.role === "obstacle" && c.shape === "cuboid" && Math.abs(x - c.centre[0]) < c.halfExtents[0] + 0.8 && Math.abs(z - c.centre[2]) < c.halfExtents[2] + 0.8)
    && !colliders.some((c) => c.role === "obstacle" && c.shape === "cylinder" && Math.hypot(x - c.centre[0], z - c.centre[2]) < c.radius + 0.8);
  const tones = [0xf5e6d3, 0xf0b9a8, 0xe9daf2, 0xffe3ad, 0xd9c2a0];
  for (let i = 0, placed = 0; placed < 150 && i < 2000; i++) {
    const wet = placed % 3 === 0;
    const x = wet ? (rnd() < 0.5 ? -1 : 1) * (hx + 0.4 + rnd() * 2.0) * (rnd() < 0.25 ? rnd() : 1) : (rnd() * 2 - 1) * (hx - 2), z = wet ? hz + 0.4 + rnd() * 2 : (rnd() * 2 - 1) * (hz - 2);
    if (wet ? heightAt(x, z) < COAST_WATER_Y + 0.05 : !free(x, z)) continue;
    const y = heightAt(x, z);
    if (placed % 11 === 0) starfish(props, x, y, z, 0.32 + rnd() * 0.12, rnd() * 6.28);
    else shell(props, x, y, z, 0.07 + rnd() * 0.08, tones[placed % tones.length]!, placed, rnd() * 6.28);
    placed++;
  }
  addMesh("deco.props", props.build(), toon, true, true);
  addMesh("deco.palms", trunks.build(), toon, true, true);
  addMesh("deco.fronds", leaves.build(), leafMat, false, true);
  addMesh("deco.cover", grass.build(), toon, false, true);

  // Clouds: a few bright cumulus puffs high over the sea.
  const clouds = addMesh("deco.clouds", cloudPuffs(16, 110, 200, 55, 105, { lit: 0xffffff, shade: 0xc9dff2 }, 0xc10d5), toon, false, false);

  // Sky, cloud shell and the hazy islands on the horizon (parented to the sky so they never parallax).
  const { sky, cloudShell } = makeSkyParts(theme, A);
  group.add(sky);
  const horizon = new Batch();
  for (const [ang, r, w, h] of [[0.2, 205, 26, 9], [0.85, 215, 34, 12], [1.7, 210, 22, 7], [3.9, 212, 30, 10], [4.7, 207, 24, 8], [5.5, 214, 36, 11]] as const) {
    const x = Math.cos(ang) * r, z = Math.sin(ang) * r;
    if (z < -60 && Math.abs(x) < 120) continue; // the dune land already fills the north
    const tone = mixHex(0x9db8cc, theme.sky.horizon, 0.45);
    horizon.add(new DodecahedronGeometry(1, 0), xf(x, -10.5, z, w, h * 0.6, w * 0.7, 0, ang, 0), tone);
    horizon.add(new DodecahedronGeometry(1, 0), xf(x + w * 0.4, -10.5, z + w * 0.1, w * 0.6, h * 0.42, w * 0.45, 0, ang + 1, 0), mixHex(tone, 0xffffff, 0.15));
  }
  const backdrop = addMesh("deco.horizon", horizon.build(), A.mat(new MeshBasicMaterial({ vertexColors: true, fog: false, side: DoubleSide })), false, false);
  sky.add(backdrop);

  // Gulls: instanced V shapes circling over the sea. `setMotes` is the per-frame hook the scene already calls.
  const gullG = A.geo(birdGeometry());
  const gullMat = A.mat(new MeshBasicMaterial({ color: 0xf6f6f2, side: DoubleSide }));
  const gulls: ReadonlyArray<{ cx: number; cz: number; r: number; w: number; y: number; ph: number }> = Array.from({ length: 7 }, (_, i) => ({
    cx: (i % 2 ? -1 : 1) * (20 + rnd() * 30), cz: hz + 10 + rnd() * 30, r: 18 + rnd() * 40, w: (0.12 + rnd() * 0.12) * (i % 2 ? 1 : -1), y: 14 + rnd() * 14, ph: rnd() * 6.28,
  }));
  const motes = new InstancedMesh(gullG, gullMat, gulls.length);
  motes.name = "deco.motes"; motes.frustumCulled = false;
  group.add(motes);
  const m4 = new Matrix4(), q = new Quaternion(), e = new Euler(), pv = new Vector3(), sv = new Vector3();
  const setMotes = (t: number): void => {
    gulls.forEach((g, i) => {
      const a = g.ph + t * g.w;
      pv.set(g.cx + Math.cos(a) * g.r, g.y + Math.sin(t * 0.7 + g.ph) * 1.2, g.cz + Math.sin(a) * g.r);
      q.setFromEuler(e.set(0, -a + (g.w > 0 ? 0 : Math.PI), 0));
      const flap = 0.6 + 0.9 * Math.abs(Math.sin(t * 2.4 + g.ph * 3));
      motes.setMatrixAt(i, m4.compose(pv, q, sv.set(1.1, flap, 1.1)));
    });
    motes.instanceMatrix.needsUpdate = true;
  };
  setMotes(0);

  return {
    group, sky, clouds, cloudShell, motes, setMotes, geometries: A.geometries, materials: A.materials, textures: A.textures, terrain,
    animate: (dt) => { water.update(dt); },
  };
}

