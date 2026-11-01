import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const newToken = (bytes = 32): string => randomBytes(bytes).toString("base64url");
export const newHexToken256 = (): string => randomBytes(32).toString("hex");
export const sha256 = (s: string): string => createHash("sha256").update(s).digest("hex");
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
