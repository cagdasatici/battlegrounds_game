// Validates bundled content: map artifact equals the registry, parses strictly and passes the build check.
// Usage: pnpm content:validate [--write]  (--write regenerates every assets/maps/<id>.json from config/arena.ts and config/worlds.ts)
import { readFileSync, writeFileSync } from "node:fs";
import { parseArenaMap, validateArenaMap } from "../../packages/shared/src/config/arena.js";
import { MAP_REGISTRY, buildMapCollision, validateMapRegistry } from "../../packages/shared/src/config/maps.js";
import { buildKitRegistry } from "../../apps/server/src/kits/index.js";
import { canonicalJson } from "../../packages/shared/src/math.js";

let fail = 0;
const summaries: string[] = [];
// WORLD01: every registry map has an artifact under assets/maps/<collisionMapId>.json that equals its code definition.
for (const issue of validateMapRegistry()) { console.error(`REGISTRY ${issue}`); fail++; }
for (const def of Object.values(MAP_REGISTRY)) {
  const path = new URL(`../../assets/maps/${def.collisionMapId}.json`, import.meta.url);
  const expected = buildMapCollision(def);
  if (process.argv.includes("--write")) writeFileSync(path, JSON.stringify(expected, null, 2) + "\n");
  const onDisk = parseArenaMap(JSON.parse(readFileSync(path, "utf8")));
  if (canonicalJson(onDisk) !== canonicalJson(expected)) { console.error(`MAP ${def.collisionMapId}.json differs from its code definition (run with --write)`); fail++; }
  for (const i of validateArenaMap(onDisk)) { console.error(`MAP ${def.collisionMapId} ${i.code}: ${i.detail}`); fail++; }
  summaries.push(`${onDisk.mapId} hash ${onDisk.contentHash}, ${onDisk.colliders.length} colliders, ${onDisk.spawnAnchors.length} spawns`);
}
let abilityCount = 0;
try { abilityCount = buildKitRegistry().defs.length; } catch (e) { console.error(`ABILITY ${(e as Error).message}`); fail++; }
if (fail) process.exit(1);
console.log(`content ok: ${summaries.join("; ")}, ${abilityCount} abilities`);
