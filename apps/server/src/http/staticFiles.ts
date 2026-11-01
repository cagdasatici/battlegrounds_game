import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { HttpApp } from "./sessionRoutes.js";
import { securityHeaders } from "./securityHeaders.js";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json", ".map": "application/json", ".svg": "image/svg+xml", ".png": "image/png",
  ".jpg": "image/jpeg", ".webp": "image/webp", ".glb": "model/gltf-binary", ".wasm": "application/wasm",
  ".woff2": "font/woff2", ".mp3": "audio/mpeg", ".ogg": "audio/ogg", ".txt": "text/plain; charset=utf-8", ".webmanifest": "application/manifest+json",
};

/** Maps a request path to a file inside root, or null when it escapes root or is malformed. */
export function resolveStaticPath(root: string, urlPath: string): string | null {
  let decoded: string;
  try { decoded = decodeURIComponent(urlPath.split("?")[0] ?? "/"); } catch { return null; }
  if (decoded.includes("\0")) return null;
  const abs = resolve(root, "." + normalize("/" + decoded));
  return abs === root || abs.startsWith(root + sep) ? abs : null;
}

/**
 * Serves the Vite build from the same origin as the API. GET only; /healthz and /api/* are registered first and win.
 * Unknown extensionless paths fall back to index.html; unknown paths with an extension are 404.
 */
export function registerStaticRoutes(app: HttpApp, rootDir: string, publicOrigin = "http://localhost"): void {
  const root = resolve(rootDir);
  const secure = securityHeaders(publicOrigin);
  const serve = (req: IncomingMessage, res: ServerResponse): void => {
    const url = req.url ?? "/";
    if (url.startsWith("/api/") || url.startsWith("/matchmake")) { res.statusCode = 404; res.end(); return; }
    let file = resolveStaticPath(root, url);
    if (file === null) { res.statusCode = 400; res.end(); return; }
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
    if (!existsSync(file)) {
      if (extname(file) !== "") { res.statusCode = 404; res.end(); return; }
      file = join(root, "index.html");
    }
    const hashed = file.includes(`${sep}assets${sep}`);
    res.statusCode = 200;
    res.setHeader("Content-Type", TYPES[extname(file)] ?? "application/octet-stream");
    res.setHeader("Cache-Control", hashed ? "public, max-age=31536000, immutable" : "no-cache");
    if (file === join(root, "sw.js")) res.setHeader("Service-Worker-Allowed", "/");
    for (const [k, v] of Object.entries(secure)) res.setHeader(k, v);
    const stream = createReadStream(file);
    stream.on("error", () => { if (!res.headersSent) res.statusCode = 500; res.end(); });
    res.on("close", () => stream.destroy());
    stream.pipe(res);
  };
  app.get("/", serve);
  app.get("/{*splat}", serve);
}
