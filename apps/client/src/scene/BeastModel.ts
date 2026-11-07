import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import {
  BackSide, BoxGeometry, BufferGeometry, CatmullRomCurve3, Color, ConeGeometry, CylinderGeometry, DodecahedronGeometry, Float32BufferAttribute,
  Box3, Group, IcosahedronGeometry, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial, Object3D, Quaternion, SphereGeometry,
  TubeGeometry, Vector3,
} from "three";

/**
 * The beast character: an original hulking brute built procedurally (no borrowed artwork). Faceted organic forms with
 * vertex-coloured fur, bone horns and tusks, stone shoulder plates, ember cracks, spined back, and a real joint
 * skeleton (hips, torso, shoulders, elbows, knees, jaw) animated by `pose`. Units are metres at normal fighter scale
 * (about 2.3 m tall, hunched); callers scale it. Faces -Z. Shared by the wild beast and the human Beast Awaken form.
 */
export interface BeastPoseInput {
  /** Seconds of presentation time. */
  clock: number;
  walking: boolean;
  /** Fighter action name and the move id, as replicated. */
  action: string;
  moveId: string;
  /** 0..1 progress through the current action (windup progress while winding up). */
  prog: number;
  /** 0..1 collapse progress when defeated; 0 otherwise. */
  defeat: number;
}

/** Rest height of the finished model (m, at fighter scale): the caller's 5.5x scale then makes a 5.5x taller body than a 1.8 m fighter. */
export const BEAST_MODEL_HEIGHT = 2.1;

export interface BeastModel {
  group: Group;
  pose(p: BeastPoseInput): void;
  dispose(): void;
}

// ---------- helpers ----------
const hash = (n: number): number => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
const noise3 = (x: number, y: number, z: number, seed: number): number =>
  Math.sin(x * 2.3 + seed) * Math.sin(y * 2.9 + seed * 1.7) * Math.sin(z * 2.1 + seed * 0.6) * 0.6
  + Math.sin(x * 5.1 + y * 4.3 + seed) * 0.4 * Math.sin(z * 4.7 + seed * 2.3);

/** Pushes every vertex along its direction from the origin by a position-based noise (coincident vertices stay together). */
function rough(geo: BufferGeometry, amp: number, seed: number): BufferGeometry {
  const p = geo.attributes["position"]!;
  const v = new Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const len = v.length();
    if (len < 1e-6) continue;
    const k = 1 + amp * noise3(v.x / len, v.y / len, v.z / len, seed);
    p.setXYZ(i, v.x * k, v.y * k, v.z * k);
  }
  return geo;
}

type ColorFn = (x: number, y: number, z: number) => Color;
function colorize(geo: BufferGeometry, fn: ColorFn): BufferGeometry {
  const p = geo.attributes["position"]!;
  const c = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) { const col = fn(p.getX(i), p.getY(i), p.getZ(i)); c[i * 3] = col.r; c[i * 3 + 1] = col.g; c[i * 3 + 2] = col.b; }
  geo.setAttribute("color", new Float32BufferAttribute(c, 3));
  return geo;
}
const lerpC = (a: Color, b: Color, t: number): Color => a.clone().lerp(b, Math.max(0, Math.min(1, t)));

/** Tapered tube along a curve (horns, tusks, claws): radius r at the root shrinking to ~0 at the tip. */
function taperedTube(points: Vector3[], r: number, segs = 14, radial = 7): BufferGeometry {
  const curve = new CatmullRomCurve3(points);
  const g = new TubeGeometry(curve, segs, r, radial, false);
  const p = g.attributes["position"]!;
  const v = new Vector3();
  for (let i = 0; i < p.count; i++) {
    const seg = Math.floor(i / (radial + 1));
    const u = seg / segs;
    const c = curve.getPointAt(Math.min(1, u));
    v.fromBufferAttribute(p, i).sub(c).multiplyScalar(Math.max(0.04, 1 - u * 0.96)).add(c);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

export const PALETTE = {
  furDark: new Color(0x3f2326), fur: new Color(0x7d3d33), furLight: new Color(0xae6340), belly: new Color(0xc9976a),
  skin: new Color(0x4b2a2a), limb: new Color(0x4d3f52), limbDark: new Color(0x2a2230), limbLight: new Color(0x6d5a72), stone: new Color(0x6b7482), stoneDark: new Color(0x3f4651), moss: new Color(0x5c7a3a),
  bone: new Color(0xeadfc3), boneDark: new Color(0xb9a98a), ember: 0xff7a1a, emberHot: 0xffd04a, eye: 0xfff25a, mouth: 0x2a0808,
} as const;

// ---------- builder ----------
export function buildBeastModel(): BeastModel {
  const geos: BufferGeometry[] = [];
  const mats: Array<{ dispose(): void }> = [];
  const keep = <G extends BufferGeometry>(g: G): G => { geos.push(g); return g; };
  const std = (o: ConstructorParameters<typeof MeshStandardMaterial>[0]): MeshStandardMaterial => { const m = new MeshStandardMaterial(o); mats.push(m); return m; };
  const basic = (o: ConstructorParameters<typeof MeshBasicMaterial>[0]): MeshBasicMaterial => { const m = new MeshBasicMaterial(o); mats.push(m); return m; };

  const furMat = std({ vertexColors: true, roughness: 0.95, metalness: 0, flatShading: true });
  const stoneMat = std({ vertexColors: true, roughness: 0.8, metalness: 0.05, flatShading: true });
  const boneMat = std({ vertexColors: true, roughness: 0.55, metalness: 0, flatShading: true });
  const emberMat = basic({ color: PALETTE.ember });
  const emberHotMat = basic({ color: PALETTE.emberHot });
  const eyeMat = basic({ color: PALETTE.eye });
  const mouthMat = basic({ color: PALETTE.mouth });
  const outlineMat = basic({ color: 0x140808, side: BackSide });
  const haloMat = basic({ color: 0xffd23a, transparent: true, opacity: 0.16, depthWrite: false });

  const group = new Group();
  group.name = "beast.model";

  /** Adds a mesh with an optional inverted-hull outline (scaled copy of the same geometry). */
  const put = (parent: Object3D, geo: BufferGeometry, mat: MeshBasicMaterial | MeshStandardMaterial, x = 0, y = 0, z = 0, outline = 1.045): Mesh => {
    const m = new Mesh(keep(geo), mat);
    m.position.set(x, y, z);
    parent.add(m);
    if (outline > 0) { const o = new Mesh(geo, outlineMat); o.scale.setScalar(outline); m.add(o); }
    return m;
  };
  const furColor = (top: Color, bottom: Color, seed: number, minY: number, maxY: number): ColorFn => (x, y, z) =>
    lerpC(bottom, top, (y - minY) / (maxY - minY)).multiplyScalar(0.88 + 0.24 * hash(Math.round(x * 31 + z * 17 + y * 13) + seed));

  /** Organic blob: rough icosphere, non-uniformly scaled, vertex-coloured fur. */
  const blob = (parent: Object3D, r: number, sx: number, sy: number, sz: number, x: number, y: number, z: number, seed: number, topC: Color = PALETTE.fur, botC: Color = PALETTE.furDark, amp = 0.09, mat: MeshStandardMaterial = furMat): Mesh => {
    const g = rough(new IcosahedronGeometry(r, 2), amp, seed);
    g.scale(sx, sy, sz);
    colorize(g, furColor(topC, botC, seed, -r * sy, r * sy));
    return put(parent, g, mat, x, y, z);
  };
  /** Limb segment hanging down from its pivot: tapered with a muscle bulge, coloured top to bottom. */
  const limb = (parent: Object3D, r0: number, r1: number, len: number, bulge: number, topC: Color, botC: Color, seed: number, flat = 1): Mesh => {
    const g = new CylinderGeometry(r0, r1, len, 9, 5);
    const p = g.attributes["position"]!;
    for (let i = 0; i < p.count; i++) {
      const t = (p.getY(i) + len / 2) / len; // 1 at the top
      const k = 1 + bulge * Math.sin((1 - t) * Math.PI) + 0.05 * noise3(p.getX(i) * 3, p.getY(i) * 3, p.getZ(i) * 3, seed);
      p.setX(i, p.getX(i) * k); p.setZ(i, p.getZ(i) * k * flat);
    }
    g.translate(0, -len / 2, 0);
    colorize(g, (x, y, z) => lerpC(botC, topC, (y + len) / len).multiplyScalar(0.9 + 0.2 * hash(Math.round(x * 40 + z * 23 + y * 11) + seed)));
    return put(parent, g, furMat, 0, 0, 0, 1.06);
  };
  const stonePlate = (parent: Object3D, size: number, x: number, y: number, z: number, rx: number, ry: number, rz: number, sx = 1, sy = 0.6, sz = 1, seed = 1): Mesh => {
    const g = rough(new DodecahedronGeometry(size, 0), 0.18, seed);
    g.scale(sx, sy, sz);
    colorize(g, (px, py, pz) => lerpC(PALETTE.stoneDark, PALETTE.stone, (py / size + 1) / 2).lerp(PALETTE.moss, Math.max(0, py / size - 0.35) * 0.9).multiplyScalar(0.9 + 0.2 * hash(Math.round(px * 50 + pz * 30) + seed)));
    const m = put(parent, g, stoneMat, x, y, z, 1.06);
    m.rotation.set(rx, ry, rz);
    return m;
  };
  const bone = (parent: Object3D, geo: BufferGeometry, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): Mesh => {
    colorize(geo, (px, py) => lerpC(PALETTE.boneDark, PALETTE.bone, 0.5 + 0.5 * Math.sin(py * 6)));
    const m = put(parent, geo, boneMat, x, y, z, 1.08);
    m.rotation.set(rx, ry, rz);
    return m;
  };
  const glow = (parent: Object3D, pts: Vector3[], r: number, hot = false): Mesh => {
    const m = new Mesh(keep(new TubeGeometry(new CatmullRomCurve3(pts), pts.length * 3, r, 5, false)), hot ? emberHotMat : emberMat);
    parent.add(m);
    return m;
  };
  /** Fur tufts: instanced cones scattered over an ellipsoid, leaning outward, optionally only on the upper/outer side. */
  const tufts = (parent: Object3D, cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, count: number, size: number, seed: number, filter: (nx: number, ny: number, nz: number) => boolean = () => true, light = false): InstancedMesh => {
    const g = keep(new ConeGeometry(size * 0.55, size * 0.7, 5, 1));
    g.translate(0, size / 2, 0);
    const inst = new InstancedMesh(g, furMat, count);
    colorize(g, (_x, y) => lerpC(light ? PALETTE.fur : PALETTE.furDark, light ? PALETTE.belly : PALETTE.furLight, y / size));
    const m4 = new Matrix4(), q = new Quaternion(), up = new Vector3(0, 1, 0), n = new Vector3(), s = new Vector3(), pos = new Vector3();
    let placed = 0, tries = 0;
    while (placed < count && tries < count * 20) {
      tries++;
      const a = hash(seed + tries * 3.1) * Math.PI * 2, b = Math.acos(2 * hash(seed + tries * 5.7) - 1);
      n.set(Math.sin(b) * Math.cos(a), Math.cos(b), Math.sin(b) * Math.sin(a));
      if (!filter(n.x, n.y, n.z)) continue;
      pos.set(cx + n.x * rx, cy + n.y * ry, cz + n.z * rz);
      const lean = n.clone().add(new Vector3(0, 0.1, 0)).normalize();
      q.setFromUnitVectors(up, lean);
      const k = 0.7 + 0.7 * hash(seed + tries * 9.3);
      s.set(k, k * (0.9 + 0.5 * hash(seed + tries)), k);
      m4.compose(pos, q, s);
      inst.setMatrixAt(placed++, m4);
    }
    inst.count = placed;
    inst.instanceMatrix.needsUpdate = true;
    parent.add(inst);
    return inst;
  };

  // ---- skeleton ----
  const hips = new Group(); hips.position.y = 1.5; group.add(hips);
  const torso = new Group(); torso.position.y = 0.1; hips.add(torso);
  const neck = new Group(); neck.position.set(0, 1.12, -0.52); neck.scale.setScalar(1.45); torso.add(neck);
  const jaw = new Group(); jaw.position.set(0, -0.12, -0.08); neck.add(jaw);
  const shoulderL = new Group(), shoulderR = new Group();
  shoulderL.position.set(-1.12, 0.84, 0.0); shoulderR.position.set(1.12, 0.84, 0.0);
  torso.add(shoulderL, shoulderR);
  const elbowL = new Group(), elbowR = new Group();
  elbowL.position.y = -0.9; elbowR.position.y = -0.9;
  shoulderL.add(elbowL); shoulderR.add(elbowR);
  const hipL = new Group(), hipR = new Group();
  hipL.position.set(-0.42, -0.1, 0.02); hipR.position.set(0.42, -0.1, 0.02);
  hips.add(hipL, hipR);
  const kneeL = new Group(), kneeR = new Group();
  kneeL.position.y = -0.74; kneeR.position.y = -0.74;
  hipL.add(kneeL); hipR.add(kneeR);

  // ---- torso: barrel chest, heavy back hump, belly, loincloth of fur ----
  blob(hips, 0.5, 1.0, 0.7, 0.85, 0, 0.0, 0.02, 11, PALETTE.fur, PALETTE.furDark);                  // pelvis
  blob(torso, 0.74, 1.4, 1.0, 0.88, 0, 0.6, 0.0, 21, PALETTE.furLight, PALETTE.fur);                  // chest
  blob(torso, 0.42, 1.25, 0.8, 0.5, 0, 0.35, -0.5, 22, PALETTE.belly, PALETTE.furLight, 0.05);          // pale chest and belly
  blob(torso, 0.6, 1.35, 0.8, 0.85, 0, 1.12, 0.12, 23, PALETTE.fur, PALETTE.furDark);                  // hump (trapezius)
  tufts(torso, 0, 0.7, 0.05, 1.0, 0.85, 0.75, 34, 0.3, 3, (_x, y, z) => y > 0.1 && z > -0.2);    // back and shoulder fur
  tufts(hips, 0, -0.1, 0.02, 0.6, 0.4, 0.55, 12, 0.3, 5, (_x, y) => y < 0.1);                       // hip skirt
  // stone belt with a bone tusk buckle and hanging fur skirt
  const beltG = rough(new CylinderGeometry(0.62, 0.66, 0.2, 14, 1), 0.06, 77); colorize(beltG, (x, y, z) => lerpC(PALETTE.stoneDark, PALETTE.stone, 0.5 + 0.5 * Math.sin(Math.atan2(z, x) * 5)));
  put(hips, beltG, stoneMat, 0, 0.22, 0.02, 1.07).scale.set(1.5, 1, 1.05);
  bone(hips, taperedTube([new Vector3(0, 0, 0), new Vector3(0, -0.15, -0.1), new Vector3(0, -0.34, -0.06)], 0.07, 8, 6), 0, 0.3, -0.72);
  // spined ridge down the back
  for (let i = 0; i < 6; i++) {
    const t = i / 5;
    bone(torso, new ConeGeometry(0.1 - 0.04 * t, 0.46 - 0.22 * t, 6), 0, 1.62 - 0.34 * i, 0.5 + 0.1 * Math.sin(t * 2.4), -0.6 - 0.35 * t, 0, 0);
  }
  // ember cracks across the chest and flank
  glow(torso, [new Vector3(-0.1, 0.95, -0.72), new Vector3(0.12, 0.7, -0.84), new Vector3(-0.05, 0.45, -0.88), new Vector3(0.18, 0.2, -0.82)], 0.04);
  glow(torso, [new Vector3(0.45, 0.8, -0.66), new Vector3(0.62, 0.55, -0.7), new Vector3(0.52, 0.28, -0.74)], 0.02, true);
  glow(torso, [new Vector3(-0.5, 0.75, -0.66), new Vector3(-0.66, 0.5, -0.68), new Vector3(-0.55, 0.22, -0.74)], 0.02);
  // heart-core glow
  const core = new Mesh(keep(new SphereGeometry(0.07, 6, 5)), emberHotMat); core.position.set(0.02, 0.68, -0.9); core.scale.set(1, 1.4, 0.4); torso.add(core);

  // ---- head: low-slung brute skull, horns, tusks, glowing eyes, mane ----
  blob(neck, 0.42, 1.2, 0.95, 1.1, 0, 0.1, -0.06, 31, PALETTE.furLight, PALETTE.fur, 0.08);               // skull
  blob(neck, 0.27, 1.15, 0.62, 1.3, 0, -0.06, -0.52, 33, PALETTE.furLight, PALETTE.fur, 0.07);          // blunt muzzle
  blob(neck, 0.08, 1.3, 0.8, 0.9, 0, 0.06, -0.78, 35, PALETTE.furDark, PALETTE.furDark, 0.05);           // nose pad
  blob(neck, 0.13, 0.8, 0.7, 1.7, 0, 0.2, -0.52, 36, PALETTE.belly, PALETTE.furLight, 0.06);             // nose ridge
  for (const cs of [-1, 1]) {
    blob(neck, 0.15, 1, 0.9, 1, cs * 0.31, -0.02, -0.26, 37 + cs, PALETTE.fur, PALETTE.furDark, 0.08);   // cheeks
    blob(neck, 0.11, 1.2, 0.9, 0.8, cs * 0.17, 0.22, -0.4, 38 + cs, PALETTE.furDark, PALETTE.furDark, 0.05); // eye sockets
    const brow = blob(neck, 0.2, 1.5, 0.45, 0.9, cs * 0.17, 0.35, -0.38, 32 + cs, PALETTE.furDark, PALETTE.furDark, 0.07); // angry brow
    brow.rotation.z = cs * 0.38;
  }
  // lower jaw (hinged) with teeth and inner mouth
  const jawGeo = rough(new IcosahedronGeometry(0.22, 1), 0.08, 34);
  jawGeo.scale(1.35, 0.5, 1.15);
  colorize(jawGeo, furColor(PALETTE.skin, PALETTE.furDark, 34, -0.1, 0.1));
  put(jaw, jawGeo, furMat, 0, -0.06, -0.34, 1.05);
  const mouth = new Mesh(keep(new SphereGeometry(0.16, 8, 6)), mouthMat); mouth.scale.set(1.15, 0.35, 1.1); mouth.position.set(0, 0.0, -0.3); jaw.add(mouth);
  for (const s of [-1, 1]) {
    for (let i = 0; i < 4; i++) bone(jaw, new ConeGeometry(0.03 + (i === 0 ? 0.015 : 0), 0.1 + (i === 0 ? 0.1 : 0), 5), s * (0.1 + i * 0.065), 0.05, -0.52 + i * 0.07, Math.PI, 0, 0);
    for (let i = 0; i < 3; i++) bone(neck, new ConeGeometry(0.026, 0.1, 5), s * (0.09 + i * 0.07), -0.16, -0.66 + i * 0.07, 0, 0, 0);  // upper teeth
    // tusks curl up from the lower jaw
    const tusk = taperedTube([new Vector3(0, 0, 0), new Vector3(s * 0.07, -0.06, -0.1), new Vector3(s * 0.12, 0.1, -0.18), new Vector3(s * 0.1, 0.38, -0.26)], 0.065, 10, 6);
    bone(jaw, tusk, s * 0.2, -0.04, -0.4);
    // horns sweep back and up
    const horn = taperedTube([new Vector3(0, 0, 0), new Vector3(s * 0.22, 0.12, 0.05), new Vector3(s * 0.4, 0.38, 0.0), new Vector3(s * 0.38, 0.72, -0.18)], 0.1, 14, 7);
    bone(neck, horn, s * 0.26, 0.34, -0.08);
    // glowing eyes under the brow
    const eye = new Mesh(keep(new SphereGeometry(0.075, 8, 6)), eyeMat); eye.scale.set(1.7, 0.5, 0.6); eye.position.set(s * 0.17, 0.2, -0.5); eye.rotation.z = s * 0.5; neck.add(eye);
    const halo = new Mesh(keep(new SphereGeometry(0.12, 8, 6)), haloMat); halo.scale.set(1.6, 0.9, 0.7); halo.position.copy(eye.position); halo.rotation.copy(eye.rotation); neck.add(halo);
    // small ears
    blob(neck, 0.08, 1, 1.4, 0.5, s * 0.4, 0.14, -0.02, 40 + s, PALETTE.fur, PALETTE.furDark, 0.1);
    // nostrils
    const nostril = new Mesh(keep(new SphereGeometry(0.02, 5, 4)), mouthMat); nostril.position.set(s * 0.06, 0.0, -0.66); neck.add(nostril);
  }
  tufts(neck, 0, -0.05, 0.1, 0.5, 0.42, 0.55, 40, 0.3, 7, (_x, y, z) => z > -0.15 && y > -0.45, true);   // lion-like mane around the head
  tufts(torso, 0, 1.0, 0.0, 1.0, 0.45, 0.7, 26, 0.3, 9, (_x, y, z) => y > 0.2 && z > -0.5, true);          // mane over the shoulders

  // ---- arms: big shoulder, thick upper arm, bulging forearm, stone gauntlet, huge fists ----
  for (const [sh, el, s] of [[shoulderL, elbowL, -1], [shoulderR, elbowR, 1]] as const) {
    blob(sh, 0.44, 1.05, 0.95, 1.0, 0, 0.02, 0, 50 + s, PALETTE.fur, PALETTE.furDark);                  // deltoid
    stonePlate(sh, 0.3, s * 0.16, 0.34, 0.02, 0.1, s * 0.4, -s * 0.3, 1.5, 0.55, 1.2, 8 + s);            // pauldron
    stonePlate(sh, 0.16, s * 0.34, 0.26, -0.18, 0.4, 0.2, -s * 0.4, 1, 0.9, 1, 12 + s);
    for (let i = 0; i < 3; i++) bone(sh, new ConeGeometry(0.06, 0.26, 5), s * (0.3 + i * 0.07), 0.58 - i * 0.04, 0.0 + i * 0.1, 0, 0, -s * 0.55);
    limb(sh, 0.34, 0.27, 0.9, 0.16, PALETTE.limbLight, PALETTE.limb, 60 + s);
    blob(sh, 0.3, 1.0, 1.35, 1.0, s * 0.02, -0.42, -0.08, 65 + s, PALETTE.limbLight, PALETTE.limb, 0.1); // bicep                               // upper arm
    blob(el, 0.27, 1, 1, 1, 0, 0, 0, 70 + s, PALETTE.limbLight, PALETTE.limb, 0.1);                          // elbow
    const fore = limb(el, 0.27, 0.38, 0.9, 0.2, PALETTE.limb, PALETTE.limbDark, 80 + s);                  // forearm, heavier at the wrist
    void fore;
    stonePlate(el, 0.22, 0, -0.5, 0, 0.2, s, 0, 1.3, 0.75, 1.3, 14 + s);                                 // gauntlet band
    blob(el, 0.38, 1.1, 1.0, 1.15, 0, -1.1, -0.02, 90 + s, PALETTE.limbLight, PALETTE.limb, 0.12);         // fist
    for (let i = 0; i < 4; i++) {
      blob(el, 0.1, 1, 1, 1, (i - 1.5) * 0.15, -1.25, -0.22, 100 + i + s * 7, PALETTE.stone, PALETTE.stoneDark, 0.1, stoneMat);   // knuckles
      bone(el, new ConeGeometry(0.045, 0.2, 5), (i - 1.5) * 0.15, -1.42, -0.26, 0.35, 0, 0);                       // claws
    }
    for (let i = 0; i < 3; i++) bone(el, new ConeGeometry(0.07, 0.3, 6), s * 0.3, -0.35 - i * 0.2, 0.0, 0, 0, -s * 1.3);   // forearm spikes
    tufts(sh, 0, -0.1, 0, 0.3, 0.32, 0.3, 8, 0.24, 20 + s);
    glow(el, [new Vector3(s * 0.05, -0.2, -0.3), new Vector3(s * 0.12, -0.45, -0.31), new Vector3(s * 0.05, -0.7, -0.33)], 0.018, true);
  }

  // ---- legs: thick thighs, kneecaps of stone, big clawed feet ----
  for (const [hp, kn, s] of [[hipL, kneeL, -1], [hipR, kneeR, 1]] as const) {
    blob(hp, 0.36, 1.0, 1.3, 1.0, 0, -0.3, 0, 125 + s, PALETTE.limbLight, PALETTE.limb, 0.08);
    limb(hp, 0.38, 0.28, 0.76, 0.16, PALETTE.limbLight, PALETTE.limb, 120 + s);
    blob(kn, 0.28, 1, 1, 1, 0, 0, 0, 130 + s, PALETTE.limbLight, PALETTE.limb, 0.1);
    stonePlate(kn, 0.17, 0, 0.03, -0.18, 0.2, 0, 0, 1.2, 0.8, 0.8, 16 + s);                               // kneecap
    limb(kn, 0.27, 0.25, 0.76, 0.16, PALETTE.limb, PALETTE.limbDark, 140 + s);
    blob(kn, 0.3, 1.25, 0.55, 1.6, 0, -0.8, -0.16, 150 + s, PALETTE.limb, PALETTE.limbDark, 0.1);        // foot
    for (let i = 0; i < 3; i++) bone(kn, new ConeGeometry(0.05, 0.22, 5), (i - 1) * 0.16, -0.82, -0.56, -Math.PI / 2 + 0.2, 0, 0);
    tufts(hp, 0, -0.25, 0, 0.3, 0.35, 0.3, 10, 0.2, 30 + s);
  }

  // ---- animation ----
  const rad = (d: number): number => (d * Math.PI) / 180;
  const damp = (cur: number, want: number, k: number): number => cur + (want - cur) * k;
  const state = { sRx: 0, sLx: 0, lean: 0, twist: 0 };

  function pose(p: BeastPoseInput): void {
    const t = p.clock;
    const breathe = Math.sin(t * 1.7);
    let armLx = 0, armRx = 0, armLz = 0.12, armRz = -0.12, elbL = -0.25, elbR = -0.25, lean = 0.12, twist = 0, headX = 0, headY = 0, jawOpen = 0.05;
    let hipDrop = 0, legL = 0, legR = 0, kneeBendL = 0.1, kneeBendR = 0.1, rootRx = 0;
    const walk = p.walking && p.action === "Idle" ? Math.sin(t * 4.2) : 0, walk2 = p.walking && p.action === "Idle" ? Math.cos(t * 4.2) : 0;
    if (p.defeat > 0) {
      const d = Math.min(1, p.defeat);
      rootRx = -1.45 * (1 - (1 - Math.min(1, d * 2)) ** 2); armLx = armRx = 0.6; headX = 0.5; jawOpen = 0.5; lean = 0.1; kneeBendL = kneeBendR = 0.4;
    } else if (p.action === "Windup" && p.moveId === "beast.slam" || p.action === "Windup" && p.moveId.endsWith(".slam")) {
      const k = p.prog; armLx = armRx = -2.9 * k; elbL = elbR = -0.3 - 0.4 * k; lean = 0.12 - 0.5 * k; headX = -0.25 * k; jawOpen = 0.7 * k; kneeBendL = kneeBendR = 0.1 + 0.35 * k; hipDrop = -0.08 * k;
    } else if (p.action === "Windup") {
      const k = p.prog; armRx = -2.5 * k; armRz = -0.5 * k; armLx = 0.4 * k; elbR = -0.6 * k; twist = 0.7 * k; lean = 0.12 - 0.25 * k; headY = 0.25 * k; jawOpen = 0.5 * k; kneeBendL = kneeBendR = 0.1 + 0.25 * k;
    } else if (p.action === "Active") {
      if (p.moveId.endsWith("slam")) { armLx = armRx = 1.0; elbL = elbR = -0.2; lean = 0.55; headX = 0.35; jawOpen = 0.9; kneeBendL = kneeBendR = 0.55; hipDrop = -0.18; }
      else { armRx = 1.2; armRz = 0.4; armLx = -0.3; elbR = -0.1; twist = -0.8; lean = 0.3; jawOpen = 0.8; kneeBendL = 0.4; kneeBendR = 0.25; }
    } else if (p.action === "Recovery") {
      armLx = armRx = 0.3; lean = 0.3; jawOpen = 0.2; headX = 0.15;
    } else if (p.action === "Stunned") {
      headX = 0.5 + 0.12 * Math.sin(t * 11); headY = 0.2 * Math.sin(t * 7); lean = 0.45 + 0.04 * Math.sin(t * 9); armLx = armRx = 0.55; jawOpen = 0.45; kneeBendL = kneeBendR = 0.3;
    } else {
      // idle / walk: a heavy knuckle-walker
      armLx = -walk * 0.55 + 0.1 * breathe; armRx = walk * 0.55 + 0.1 * breathe;
      legL = walk * 0.5; legR = -walk * 0.5;
      kneeBendL = 0.1 + Math.max(0, -walk2) * 0.45; kneeBendR = 0.1 + Math.max(0, walk2) * 0.45;
      twist = walk * 0.14; lean = 0.14 + 0.02 * breathe; headY = Math.sin(t * 0.8) * 0.18; headX = 0.04 * breathe;
      hipDrop = -Math.abs(walk) * 0.06 + 0.012 * breathe;
      jawOpen = 0.42 + 0.08 * (breathe + 1) / 2;
    }
    state.sRx = damp(state.sRx, armRx, 0.5); state.sLx = damp(state.sLx, armLx, 0.5); state.lean = damp(state.lean, lean, 0.35); state.twist = damp(state.twist, twist, 0.35);
    shoulderL.rotation.set(state.sLx, 0, armLz); shoulderR.rotation.set(state.sRx, 0, armRz);
    elbowL.rotation.x = elbL; elbowR.rotation.x = elbR;
    torso.rotation.set(state.lean, state.twist, 0);
    torso.scale.set(1, 1 + 0.012 * breathe, 1 + 0.012 * breathe);
    neck.rotation.set(headX - state.lean * 0.7, headY - state.twist * 0.5, 0);
    jaw.rotation.x = jawOpen;
    hips.position.y = 1.5 + hipDrop;
    hipL.rotation.x = legL - 0.0; hipR.rotation.x = legR;
    kneeL.rotation.x = kneeBendL; kneeR.rotation.x = kneeBendR;
    group.rotation.x = rootRx;
    core.scale.setScalar(1 + 0.15 * Math.sin(t * 3));
  }

  // Draw-call budget: bake every joint's static meshes (and their outlines) into one mesh per material. The ember core is
  // animated, so it stays separate; instanced fur tufts are already one draw call each.
  core.userData["keep"] = true;
  const joints: Object3D[] = [hips, torso, neck, jaw, shoulderL, shoulderR, elbowL, elbowR, hipL, hipR, kneeL, kneeR];
  const mergedGeos: BufferGeometry[] = [];
  const prep = (g: BufferGeometry, withColor: boolean): BufferGeometry => {
    const n = g.index ? g.toNonIndexed() : g.clone();
    n.deleteAttribute("uv");
    if (!n.getAttribute("normal")) n.computeVertexNormals();
    if (withColor && !n.getAttribute("color")) {
      const c = new Float32Array(n.attributes["position"]!.count * 3).fill(1);
      n.setAttribute("color", new Float32BufferAttribute(c, 3));
    }
    return n;
  };
  for (const joint of joints) {
    const groups = new Map<object, BufferGeometry[]>();
    for (const child of [...joint.children]) {
      if (!(child instanceof Mesh) || (child as InstancedMesh).isInstancedMesh || child.userData["keep"]) continue;
      const mat = child.material as MeshStandardMaterial | MeshBasicMaterial;
      child.updateMatrix();
      const withColor = (mat as MeshStandardMaterial).vertexColors === true;
      const body = prep(child.geometry, withColor); body.applyMatrix4(child.matrix);
      (groups.get(mat) ?? groups.set(mat, []).get(mat)!).push(body);
      for (const o of [...child.children]) {
        if (!(o instanceof Mesh)) continue;
        o.updateMatrix();
        const hull = prep(o.geometry, false); hull.applyMatrix4(o.matrix); hull.applyMatrix4(child.matrix);
        (groups.get(outlineMat) ?? groups.set(outlineMat, []).get(outlineMat)!).push(hull);
      }
      joint.remove(child);
    }
    for (const [mat, list] of groups) {
      const merged = mergeGeometries(list, false);
      for (const g of list) g.dispose();
      if (!merged) continue;
      mergedGeos.push(merged);
      const mesh = new Mesh(merged, mat as MeshStandardMaterial);
      mesh.name = "beast.part";
      joint.add(mesh);
    }
  }
  for (const g of geos.splice(0)) if (g !== core.geometry) g.dispose();
  geos.push(core.geometry, ...mergedGeos);

  // Normalise: whatever the proportions above add up to, the rest pose is BEAST_MODEL_HEIGHT tall.
  group.updateMatrixWorld(true);
  const h = new Box3().setFromObject(group).getSize(new Vector3()).y;
  group.scale.setScalar(BEAST_MODEL_HEIGHT / h);
  return {
    group, pose,
    dispose(): void { for (const g of geos) g.dispose(); for (const m of mats) m.dispose(); },
  };
}
