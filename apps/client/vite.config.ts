import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { defineConfig, type Plugin } from "vite";

/** WEB1: emits asset-manifest.json (precache list) and stamps the build id into sw.js so each build gets a new worker and cache. */
function offlineShell(): Plugin {
  let outDir = "dist";
  let buildId = "dev";
  return {
    name: "eb-offline-shell",
    apply: "build",
    configResolved(c) { outDir = join(c.root, c.build.outDir); },
    generateBundle(_o, bundle) {
      const assets = Object.keys(bundle).filter((n) => !n.endsWith(".map")).map((n) => "/" + n).sort();
      buildId = createHash("sha256").update(assets.join("\n")).digest("hex").slice(0, 12);
      this.emitFile({ type: "asset", fileName: "asset-manifest.json", source: JSON.stringify({ buildId, assets }) + "\n" });
    },
    closeBundle() {
      const f = join(outDir, "sw.js");
      writeFileSync(f, readFileSync(f, "utf8").replaceAll("__BUILD_ID__", buildId));
    },
  };
}

export default defineConfig({
  build: { target: "es2022", sourcemap: true },
  plugins: [offlineShell()],
});
