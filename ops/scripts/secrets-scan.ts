// Usage: pnpm security:scan   Scans the client build output and tracked source for secret-looking values (spec 24, "Secrets").
// Flags PEM private keys, bearer/authorization values, invite URL fragments with a 64 hex token, and assignments of
// 32+ char hex or base64url values to names containing secret, token, key, password or cookie.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";

export const PATTERNS: Array<[string, RegExp]> = [
  ["private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["bearer value", /\bBearer\s+[A-Za-z0-9._~+/-]{20,}/],
  ["invite fragment", /#invite=[0-9a-f]{32,}/i],
  ["secret assignment", /\b(?:secret|token|api[_-]?key|password|cookie)\w*["']?\s*[:=]\s*["'][A-Za-z0-9_-]{32,}["']/i],
];

export function scanText(text: string): string[] {
  return PATTERNS.filter(([, re]) => re.test(text)).map(([name]) => name);
}

const TEXT = new Set([".ts", ".js", ".mjs", ".json", ".html", ".css", ".md", ".txt", ".map"]);
function walk(dir: string, skip: Set<string>): string[] {
  return readdirSync(dir).flatMap((n) => {
    if (skip.has(n)) return [];
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p, skip) : TEXT.has(extname(p)) ? [p] : [];
  });
}

if (process.argv[1]?.endsWith("secrets-scan.ts")) {
  const root = new URL("../../", import.meta.url).pathname;
  const skip = new Set(["node_modules", ".git", "data", "test-results", "playwright-report", "tests", "docs"]);
  let bad = 0;
  for (const dir of ["apps", "packages", "ops"]) {
    for (const f of walk(join(root, dir), skip)) {
      const hits = scanText(readFileSync(f, "utf8"));
      if (hits.length) { console.error(`SECRET? ${f}: ${hits.join(", ")}`); bad++; }
    }
  }
  console.error(bad ? `${bad} file(s) flagged` : "secrets scan clean");
  process.exit(bad ? 1 : 0);
}
