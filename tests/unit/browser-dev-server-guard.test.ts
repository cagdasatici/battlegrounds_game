// FLAKE1: a browser spec's Vite dev server must not watch files or push HMR. Any edit under apps/client (another agent, git pull)
// otherwise sends a full-page reload to every open test page, which drops window.__eb and the room mid-run.
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const dir = path.resolve(import.meta.dirname, "../browser");
const specs = readdirSync(dir).filter((f) => f.endsWith(".spec.ts"));

describe("FLAKE1 browser dev servers do not reload pages on file changes", () => {
  it("finds the vite-based specs", () => { expect(specs.filter((f) => /\bcreateServer\(/.test(readFileSync(path.join(dir, f), "utf8"))).length).toBeGreaterThan(10); });
  for (const f of specs) {
    const src = readFileSync(path.join(dir, f), "utf8");
    if (!/(?:\bv|\bvite)\.createServer\(/.test(src)) continue;
    it(`${f} sets hmr:false and watch:null`, () => {
      expect(src).toMatch(/hmr: false/);
      expect(src).toMatch(/watch: null/);
    });
  }
});
