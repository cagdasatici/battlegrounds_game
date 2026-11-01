// WEB5: /admin serves admin.html with no-store; other paths keep their caching.
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { registerStaticRoutes } from "../../apps/server/src/http/staticFiles.js";
import type { HttpApp } from "../../apps/server/src/http/sessionRoutes.js";

it("serves admin.html at /admin and /admin/ with no-store; the game shell stays no-cache", async () => {
  const dir = mkdtempSync(join(tmpdir(), "eb-static-"));
  writeFileSync(join(dir, "index.html"), "GAME"); writeFileSync(join(dir, "admin.html"), "ADMIN");
  mkdirSync(join(dir, "assets"));
  const handlers: ((req: unknown, res: unknown) => void)[] = [];
  registerStaticRoutes({ get: (_p: string, h: (req: unknown, res: unknown) => void) => handlers.push(h) } as unknown as HttpApp, dir);
  const serve = (url: string): Promise<{ headers: Record<string, string>; body: string }> => new Promise((resolve) => {
    const headers: Record<string, string> = {}; const chunks: Buffer[] = [];
    const res = {
      statusCode: 0, headersSent: false,
      setHeader: (k: string, v: string) => { headers[k] = v; },
      write: (c: Buffer) => { chunks.push(c); return true; },
      end: (c?: Buffer) => { if (c) chunks.push(c); resolve({ headers, body: Buffer.concat(chunks).toString() }); },
      on: () => res, once: () => res, emit: () => true, removeListener: () => res,
    };
    handlers[0]!({ url }, res);
  });
  for (const u of ["/admin", "/admin/", "/admin.html", "/admin?x=1"]) {
    const r = await serve(u);
    expect(r.body, u).toBe("ADMIN");
    expect(r.headers["Cache-Control"], u).toBe("no-store");
  }
  const game = await serve("/");
  expect(game.body).toBe("GAME");
  expect(game.headers["Cache-Control"]).toBe("no-cache");
});
