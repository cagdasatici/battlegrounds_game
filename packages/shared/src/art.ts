/**
 * Asset manifest contract (spec section 23, task T25). Pure schema and checks; file hashing and reading live in
 * ops/scripts/assets-audit.ts. An entry without complete provenance fails the audit, and the audit runs before the
 * production build.
 */
import { z } from "zod";
import { requiredClipIds, RIG_VERSION } from "./rig.js";
import type { KitId } from "./protocol.js";

const nonEmpty = z.string().trim().min(1);
const vec3 = z.tuple([z.number(), z.number(), z.number()]);

export const AssetKindSchema = z.enum(["fighter", "map", "code", "environment"]);
export const ManifestEntrySchema = z.strictObject({
  id: nonEmpty,
  kind: AssetKindSchema,
  path: nonEmpty,
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  byteSize: z.number().int().positive(),
  license: nonEmpty,
  author: nonEmpty,
  /** sourceURL or commission reference; for generated assets, the repo path of the generator. */
  source: nonEmpty,
  creationMethod: z.enum(["procedural-code", "hand-authored-code", "commissioned", "third-party CC0 pack"]),
  /** Present for every skinned model; empty-string is not allowed. */
  rigVersion: nonEmpty.optional(),
  bounds: z.strictObject({ min: vec3, max: vec3 }).optional(),
  kit: z.enum(["sv", "td", "ea"]).optional(),
  /** Animation ids carried by a fighter file. */
  clips: z.array(nonEmpty).optional(),
  notes: z.string().optional(),
});
export type ManifestEntry = z.infer<typeof ManifestEntrySchema>;

export const ManifestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  generator: nonEmpty,
  assets: z.array(ManifestEntrySchema).min(1),
});
export type AssetManifest = z.infer<typeof ManifestSchema>;

export const PROVENANCE_COLUMNS = ["id", "path", "author", "license", "creationMethod", "source", "date", "notes"] as const;
export const KITS: readonly KitId[] = ["sv", "td", "ea"];

/** P0 playable asset cap (spec section 24): 15 MB. */
export const P0_ASSET_BYTES_MAX = 15 * 1024 * 1024;
/** Third party source markers that must never appear in provenance fields. */
const FORBIDDEN_SOURCE = /roblox|rbxcdn|wikia|fandom|crunchyroll|anime|spriters-resource|sketchfab|mixamo|ripped|extract/i;

export interface AuditIssue { code: string; detail: string }

/** Pure manifest checks: shape, provenance, rig version, required animation ids, unique ids and paths. */
export function checkManifest(raw: unknown, provenanceIds: ReadonlySet<string>): AuditIssue[] {
  const parsed = ManifestSchema.safeParse(raw);
  if (!parsed.success) return [{ code: "SCHEMA", detail: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") }];
  const out: AuditIssue[] = [];
  const ids = new Set<string>(), paths = new Set<string>();
  let total = 0;
  for (const a of parsed.data.assets) {
    if (ids.has(a.id)) out.push({ code: "DUP_ID", detail: a.id });
    if (paths.has(a.path)) out.push({ code: "DUP_PATH", detail: a.path });
    ids.add(a.id); paths.add(a.path);
    total += a.byteSize;
    if (!provenanceIds.has(a.id)) out.push({ code: "NO_PROVENANCE_ROW", detail: `${a.id} has no row in provenance.csv` });
    for (const f of [a.author, a.license, a.source]) if (FORBIDDEN_SOURCE.test(f)) out.push({ code: "FORBIDDEN_SOURCE", detail: `${a.id}: "${f}"` });
    if (a.kind === "fighter") {
      if (a.rigVersion !== RIG_VERSION) out.push({ code: "RIG_VERSION", detail: `${a.id}: ${a.rigVersion ?? "missing"} != ${RIG_VERSION}` });
      if (!a.bounds) out.push({ code: "NO_BOUNDS", detail: a.id });
      if (!a.kit) { out.push({ code: "NO_KIT", detail: a.id }); continue; }
      const have = new Set(a.clips ?? []);
      for (const need of requiredClipIds(a.kit)) if (!have.has(need)) out.push({ code: "MISSING_ANIMATION", detail: `${a.id} lacks clip ${need}` });
    }
  }
  for (const k of KITS) if (!parsed.data.assets.some((a) => a.kind === "fighter" && a.kit === k)) out.push({ code: "MISSING_FIGHTER", detail: `no fighter asset for kit ${k}` });
  if (total > P0_ASSET_BYTES_MAX) out.push({ code: "OVER_BUDGET", detail: `${total} bytes > ${P0_ASSET_BYTES_MAX}` });
  return out;
}

/** Splits one CSV line (RFC 4180 quoting). */
export function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (q) {
      if (ch === "\"" && line[i + 1] === "\"") { cur += "\""; i++; } else if (ch === "\"") q = false; else cur += ch;
    } else if (ch === "\"") q = true; else if (ch === ",") { out.push(cur); cur = ""; } else cur += ch;
  }
  out.push(cur);
  return out;
}
export const csvCell = (s: string): string => (/[",\n]/.test(s) ? `"${s.replace(/"/g, "\"\"")}"` : s);

/** Validates provenance.csv text: exact header, no empty required cell. Returns the ids it covers. */
export function checkProvenance(csv: string): { ids: Set<string>; issues: AuditIssue[] } {
  const lines = csv.split(/\r?\n/).filter((l) => l.length > 0);
  const issues: AuditIssue[] = [];
  const ids = new Set<string>();
  if (lines[0] !== PROVENANCE_COLUMNS.join(",")) { issues.push({ code: "CSV_HEADER", detail: `expected ${PROVENANCE_COLUMNS.join(",")}` }); return { ids, issues }; }
  for (const [n, line] of lines.slice(1).entries()) {
    const cells = parseCsvLine(line);
    if (cells.length !== PROVENANCE_COLUMNS.length) { issues.push({ code: "CSV_ROW", detail: `row ${n + 2} has ${cells.length} cells` }); continue; }
    PROVENANCE_COLUMNS.forEach((col, i) => { if (col !== "notes" && (cells[i] ?? "").trim() === "") issues.push({ code: "EMPTY_PROVENANCE", detail: `row ${n + 2} column ${col}` }); });
    ids.add(cells[0] ?? "");
  }
  return { ids, issues };
}
