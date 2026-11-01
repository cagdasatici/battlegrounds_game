// Asset audit (task T25): manifest schema and provenance, file hashes and sizes, required animation ids per fighter,
// glTF structure and bounds, regeneration equality, no unmanifested files under assets/, no embedded textures.
// Usage: pnpm assets:audit. Runs before the production build; any issue exits 1.
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { checkManifest, checkProvenance, ManifestSchema, type AuditIssue } from "../../packages/shared/src/art.js";
import { requiredClipIds } from "../../packages/shared/src/rig.js";
import { buildFighterGltf } from "./art-gltf.js";

const root = new URL("../../", import.meta.url).pathname;
const issues: AuditIssue[] = [];
const add = (code: string, detail: string): void => { issues.push({ code, detail }); };
const sha = (b: Buffer): string => createHash("sha256").update(b).digest("hex");

const manifestPath = join(root, "assets/manifest.json"), provPath = join(root, "assets/provenance.csv");
if (!existsSync(manifestPath)) add("NO_MANIFEST", "assets/manifest.json missing (run pnpm assets:build)");
if (!existsSync(provPath)) add("NO_PROVENANCE", "assets/provenance.csv missing (run pnpm assets:build)");
let fighters = 0, clipCount = 0, total = 0, entries = 0;
interface Gltf {
  asset?: { version?: string }; animations?: { name: string }[]; images?: unknown[]; textures?: unknown[];
  skins?: { joints: number[] }[]; meshes?: { primitives: { attributes: Record<string, number> }[] }[];
}
if (issues.length === 0) {
  const manifest: unknown = JSON.parse(readFileSync(manifestPath, "utf8"));
  const prov = checkProvenance(readFileSync(provPath, "utf8"));
  issues.push(...prov.issues, ...checkManifest(manifest, prov.ids));
  const parsed = ManifestSchema.safeParse(manifest);
  if (parsed.success) {
    entries = parsed.data.assets.length;
    const listed = new Set(parsed.data.assets.map((a) => a.path));
    for (const a of parsed.data.assets) {
      const p = join(root, a.path);
      if (!existsSync(p)) { add("MISSING_FILE", a.path); continue; }
      const buf = readFileSync(p);
      if (buf.length !== a.byteSize) add("SIZE", `${a.path}: ${buf.length} != ${a.byteSize}`);
      if (sha(buf) !== a.sha256) add("SHA256", `${a.path}: file changed since manifest (run pnpm assets:build)`);
      total += buf.length;
      if (a.kind !== "fighter" || !a.kit) continue;
      fighters++;
      const gltf = JSON.parse(buf.toString("utf8")) as Gltf;
      if (gltf.asset?.version !== "2.0") add("GLTF_VERSION", a.path);
      const names = new Set((gltf.animations ?? []).map((x) => x.name));
      clipCount += names.size;
      for (const need of requiredClipIds(a.kit)) if (!names.has(need)) add("MISSING_ANIMATION", `${a.path} lacks ${need}`);
      if ((gltf.images?.length ?? 0) > 0 || (gltf.textures?.length ?? 0) > 0) add("TEXTURE", `${a.path} embeds textures; fighters are vertex coloured`);
      if (!gltf.skins?.[0] || gltf.skins[0].joints.length < 17) add("RIG", `${a.path} skin has too few joints`);
      for (const prim of gltf.meshes?.[0]?.primitives ?? []) for (const k of ["POSITION", "NORMAL", "JOINTS_0", "WEIGHTS_0"]) if (prim.attributes[k] === undefined) add("GLTF_ATTR", `${a.path} primitive lacks ${k}`);
      const regenerated = buildFighterGltf(a.kit);
      if (regenerated.json !== buf.toString("utf8")) add("STALE_GENERATION", `${a.path} differs from rig/design source (run pnpm assets:build)`);
      const bmin = a.bounds?.min, bmax = a.bounds?.max;
      if (bmin && bmax && (bmin.some((v, i) => Math.abs(v - regenerated.bounds.min[i]!) > 1e-4) || bmax.some((v, i) => Math.abs(v - regenerated.bounds.max[i]!) > 1e-4))) add("BOUNDS", a.path);
      if (a.bounds && a.bounds.max[1] - a.bounds.min[1] > 2.4) add("BOUNDS_SCALE", `${a.path} taller than the 1.8 m capsule allows`);
    }
    const walk = (d: string): string[] => readdirSync(d).flatMap((n) => { const q = join(d, n); return statSync(q).isDirectory() ? walk(q) : [q]; });
    for (const f of walk(join(root, "assets"))) {
      const rel = relative(root, f);
      if (rel === "assets/manifest.json" || rel === "assets/provenance.csv") continue;
      if (!listed.has(rel)) add("UNMANIFESTED_FILE", rel);
    }
  }
}
if (issues.length) {
  for (const i of issues) console.error(`ASSET ${i.code}: ${i.detail}`);
  process.exit(1);
}
console.log(`assets ok: ${entries} manifest entries, ${fighters} fighters with ${clipCount} clips, ${total} bytes, provenance complete`);
