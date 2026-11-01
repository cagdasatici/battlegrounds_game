/** Pure arithmetic shared by client and server. */
export const forwardOf = (yaw: number): [number, number] => [-Math.sin(yaw), -Math.cos(yaw)];

export const DEG = Math.PI / 180;

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Rotates `from` toward `to` along the shortest arc by at most `maxStep` radians. Result is not re-wrapped. */
export function rotateToward(from: number, to: number, maxStep: number): number {
  const d = Math.atan2(Math.sin(to - from), Math.cos(to - from));
  if (Math.abs(d) <= maxStep) return from + d;
  return from + Math.sign(d) * maxStep;
}

/** Integer hundredths of HP. */
export const hp100 = (hp: number): number => Math.round(hp * 100);

/** Canonical JSON (sorted keys) for hashing. */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  if (v !== null && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(v);
}

/** 64-bit FNV-1a as 16 hex chars. Compatibility fingerprint, not a security hash. */
export function fnv1a64(s: string): string {
  let h = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (let i = 0; i < s.length; i++) {
    h ^= BigInt(s.charCodeAt(i));
    h = (h * prime) & mask;
  }
  return h.toString(16).padStart(16, "0");
}

export function contentHashOf(...parts: unknown[]): string {
  return fnv1a64(canonicalJson(parts));
}
