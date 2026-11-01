// Enforces spec section 18 import boundaries until a full linter is justified.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const root = new URL("../../", import.meta.url).pathname;
const rules = [
  { dir: "apps/client/src", forbid: [/apps\/server/, /@eb\/server/, /from ["']node:/, /evidence\/referenceCatalog/] },
  { dir: "apps/server/src", forbid: [/from ["']three["']/, /@eb\/client/, /apps\/client/, /@dimforge\/rapier3d-compat\/browser/] },
  { dir: "packages/shared/src", forbid: [/from ["']three["']/, /from ["']colyseus["']/, /from ["']node:/, /\bdocument\./, /\bwindow\./] },
];
const files = (d) =>
  readdirSync(d).flatMap((n) => {
    const p = join(d, n);
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx|mjs)$/.test(p) ? [p] : [];
  });
let bad = 0;
for (const { dir, forbid } of rules) {
  for (const f of files(join(root, dir))) {
    const src = readFileSync(f, "utf8");
    for (const re of forbid) if (re.test(src)) { console.error(`BOUNDARY ${f}: ${re}`); bad++; }
  }
}
if (bad) process.exit(1);
console.log("boundaries ok");
