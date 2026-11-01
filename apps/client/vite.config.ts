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
      // Admin pages and their own chunks are never precached (WEB5).
      const assets = Object.keys(bundle).filter((n) => !n.endsWith(".map") && n !== "admin.html" && !n.startsWith("assets/admin-")).map((n) => "/" + n).sort();
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
  build: {
    target: "es2022", sourcemap: true,
    rollupOptions: {
      input: { main: join(import.meta.dirname, "index.html"), admin: join(import.meta.dirname, "admin.html") },
      output: {
        entryFileNames: (c) => (c.name === "admin" ? "assets/admin-[hash].js" : "assets/[name]-[hash].js"),
        assetFileNames: (a) => ((a.names ?? []).some((n) => n.startsWith("admin")) ? "assets/admin-[hash][extname]" : "assets/[name]-[hash][extname]"),
      },
    },
  },
  plugins: [offlineShell()],
});
