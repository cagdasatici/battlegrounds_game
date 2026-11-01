// Fallback for the ESLint no-restricted-globals rule (see docs/decisions/0002-eslint-unsupported-on-ts7.md).
// Forbids setTimeout/setInterval in sim, kits and rooms (AGENTS.md: no setTimeout damage handlers).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const root = new URL("../../", import.meta.url).pathname;
const dirs = ["apps/server/src/sim", "apps/server/src/kits", "apps/server/src/rooms"];
const files = (d) =>
  readdirSync(d).flatMap((n) => {
    const p = join(d, n);
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx|mjs)$/.test(p) ? [p] : [];
  });
let bad = 0;
for (const dir of dirs) {
  for (const f of files(join(root, dir))) {
    readFileSync(f, "utf8").split("\n").forEach((line, i) => {
      if (/\b(setTimeout|setInterval)\b/.test(line)) { console.error(`TIMER ${f}:${i + 1}: ${line.trim()}`); bad++; }
    });
  }
}
if (bad) process.exit(1);
console.log("timers ok");
