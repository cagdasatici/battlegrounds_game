import path from "node:path";
import { mkdirSync } from "node:fs";
/** Evidence goes to docs/test-results only when EB_EVIDENCE=1 (slice reports); otherwise to gitignored test-results/. */
export function evidenceDir(root: string): string {
  const dir = process.env.EB_EVIDENCE === "1" ? path.join(root, "docs/test-results") : path.join(root, "test-results/evidence");
  mkdirSync(dir, { recursive: true });
  return dir;
}
