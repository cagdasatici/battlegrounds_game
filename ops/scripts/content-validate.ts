// Validates bundled content: map artifact equals the registry, parses strictly and passes the build check.
// Usage: pnpm content:validate [--write]  (--write regenerates assets/maps/islands.v1.json from config/arena.ts)
import { readFileSync, writeFileSync } from "node:fs";
import { buildIslandsMap, parseArenaMap, validateArenaMap } from "../../packages/shared/src/config/arena.js";
import { buildKitRegistry } from "../../apps/server/src/kits/index.js";
import { canonicalJson } from "../../packages/shared/src/math.js";

const path = new URL("../../assets/maps/islands.v1.json", import.meta.url);
const expected = buildIslandsMap();
if (process.argv.includes("--write")) writeFileSync(path, JSON.stringify(expected, null, 2) + "\n");
let fail = 0;
const onDisk = parseArenaMap(JSON.parse(readFileSync(path, "utf8")));
if (canonicalJson(onDisk) !== canonicalJson(expected)) { console.error("MAP islands.v1.json differs from config/arena.ts (run with --write)"); fail++; }
for (const i of validateArenaMap(onDisk)) { console.error(`MAP ${i.code}: ${i.detail}`); fail++; }
let abilityCount = 0;
try { abilityCount = buildKitRegistry().defs.length; } catch (e) { console.error(`ABILITY ${(e as Error).message}`); fail++; }
if (fail) process.exit(1);
console.log(`content ok: ${onDisk.mapId} hash ${onDisk.contentHash}, ${onDisk.colliders.length} colliders, ${onDisk.spawnAnchors.length} spawns, ${abilityCount} abilities`);
