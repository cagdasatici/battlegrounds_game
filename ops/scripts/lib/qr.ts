// Minimal QR Code encoder (ISO/IEC 18004): byte mode, ECC level L or M, versions 1 to 10, all 8 masks tried.
// No dependencies. Used only by the owner start script to print an invitation link in the terminal.

export type QrEcc = "L" | "M";
export interface QrOptions { ecc?: QrEcc; /** Force a mask 0..7 (tests). Default: lowest penalty. */ mask?: number }
export interface QrCode { version: number; size: number; mask: number; ecc: QrEcc; modules: boolean[][] }

// [eccPerBlock, g1Blocks, g1Data, g2Blocks, g2Data] for versions 1..10.
const BLOCKS: Record<QrEcc, number[][]> = {
  L: [[7, 1, 19, 0, 0], [10, 1, 34, 0, 0], [15, 1, 55, 0, 0], [20, 1, 80, 0, 0], [26, 1, 108, 0, 0], [18, 2, 68, 0, 0], [20, 2, 78, 0, 0], [24, 2, 97, 0, 0], [30, 2, 116, 0, 0], [18, 2, 68, 2, 69]],
  M: [[10, 1, 16, 0, 0], [16, 1, 28, 0, 0], [26, 1, 44, 0, 0], [18, 2, 32, 0, 0], [24, 2, 43, 0, 0], [16, 4, 27, 0, 0], [18, 4, 31, 0, 0], [22, 2, 38, 2, 39], [22, 3, 36, 2, 37], [26, 4, 43, 1, 44]],
};
const ALIGN: number[][] = [[], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];
export const MAX_VERSION = 10;

function dataCapacity(version: number, ecc: QrEcc): number {
  const b = BLOCKS[ecc][version - 1]!;
  return b[1]! * b[2]! + b[3]! * b[4]!;
}

/** Max bytes in byte mode for a version/ecc. */
export function byteCapacity(version: number, ecc: QrEcc): number {
  const countBits = version <= 9 ? 8 : 16;
  return Math.floor((dataCapacity(version, ecc) * 8 - 4 - countBits) / 8);
}

// GF(256) with primitive polynomial 0x11D.
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]!;
}
const gmul = (a: number, b: number): number => (a === 0 || b === 0 ? 0 : EXP[LOG[a]! + LOG[b]!]!);

export function rsGenerator(degree: number): number[] {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array<number>(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] = (next[j]! ^ gmul(poly[j]!, 1)) ;
      next[j + 1] = next[j + 1]! ^ gmul(poly[j]!, EXP[i]!);
    }
    poly = next;
  }
  return poly; // highest degree first, leading coefficient 1
}

export function rsRemainder(data: number[], degree: number): number[] {
  const gen = rsGenerator(degree);
  const rem = new Array<number>(degree).fill(0);
  for (const d of data) {
    const factor = d ^ rem[0]!;
    rem.shift();
    rem.push(0);
    for (let i = 0; i < degree; i++) rem[i] = rem[i]! ^ gmul(gen[i + 1]!, factor);
  }
  return rem;
}

function bchFormat(ecc: QrEcc, mask: number): number {
  const data = ((ecc === "L" ? 1 : 0) << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}
function bchVersion(version: number): number {
  let rem = version;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  return (version << 12) | rem;
}
export const formatBits = bchFormat;

function encodeBytes(bytes: Uint8Array, version: number, ecc: QrEcc): number[] {
  const bits: number[] = [];
  const put = (v: number, n: number): void => { for (let i = n - 1; i >= 0; i--) bits.push((v >>> i) & 1); };
  put(0b0100, 4);
  put(bytes.length, version <= 9 ? 8 : 16);
  for (const b of bytes) put(b, 8);
  const cap = dataCapacity(version, ecc) * 8;
  put(0, Math.min(4, cap - bits.length));
  while (bits.length % 8 !== 0) bits.push(0);
  const out: number[] = [];
  for (let i = 0; i < bits.length; i += 8) { let v = 0; for (let j = 0; j < 8; j++) v = (v << 1) | bits[i + j]!; out.push(v); }
  for (let pad = 0xec; out.length < cap / 8; pad ^= 0xec ^ 0x11) out.push(pad);
  return out;
}

function interleave(data: number[], version: number, ecc: QrEcc): number[] {
  const [eccLen, g1n, g1d, g2n, g2d] = BLOCKS[ecc][version - 1]! as [number, number, number, number, number];
  const blocks: number[][] = [];
  const eccs: number[][] = [];
  let pos = 0;
  for (let i = 0; i < g1n + g2n; i++) {
    const len = i < g1n ? g1d : g2d;
    const blk = data.slice(pos, pos + len);
    pos += len;
    blocks.push(blk);
    eccs.push(rsRemainder(blk, eccLen));
  }
  const out: number[] = [];
  const maxLen = Math.max(g1d, g2d);
  for (let i = 0; i < maxLen; i++) for (const b of blocks) if (i < b.length) out.push(b[i]!);
  for (let i = 0; i < eccLen; i++) for (const e of eccs) out.push(e[i]!);
  return out;
}

const MASKS: ((r: number, c: number) => boolean)[] = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (_r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

interface Grid { size: number; mod: boolean[][]; fn: boolean[][] }

function buildFunctionPatterns(version: number): Grid {
  const size = version * 4 + 17;
  const mod = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const fn = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const set = (r: number, c: number, v: boolean): void => { if (r >= 0 && r < size && c >= 0 && c < size) { mod[r]![c] = v; fn[r]![c] = true; } };
  for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  const finder = (r0: number, c0: number): void => {
    for (let dr = -1; dr <= 7; dr++) for (let dc = -1; dc <= 7; dc++) {
      const d = Math.max(Math.abs(dr - 3), Math.abs(dc - 3));
      set(r0 + dr, c0 + dc, d !== 2 && d !== 4);
    }
  };
  finder(0, 0); finder(0, size - 7); finder(size - 7, 0);
  const al = ALIGN[version - 1]!;
  for (const r of al) for (const c of al) {
    if ((r === 6 && c === 6) || (r === 6 && c === al[al.length - 1]) || (r === al[al.length - 1] && c === 6)) continue;
    for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) set(r + dr, c + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
  }
  // Reserve format areas (values written later) and the dark module.
  for (let i = 0; i < 9; i++) { if (i !== 6) { set(8, i, false); set(i, 8, false); } }
  for (let i = 0; i < 8; i++) { set(8, size - 1 - i, false); set(size - 1 - i, 8, false); }
  set(size - 8, 8, true);
  if (version >= 7) {
    const v = bchVersion(version);
    for (let i = 0; i < 18; i++) {
      const bit = ((v >>> i) & 1) === 1;
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      set(a, b, bit); set(b, a, bit);
    }
  }
  return { size, mod, fn };
}

function placeData(g: Grid, codewords: number[]): void {
  const { size, mod, fn } = g;
  let bitIdx = 0;
  const total = codewords.length * 8;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const c = right - j;
        const goingUp = (((right + 1) & 2) === 0);
        const r = goingUp ? size - 1 - vert : vert;
        if (fn[r]![c]) continue;
        if (bitIdx < total) { mod[r]![c] = ((codewords[bitIdx >>> 3]! >>> (7 - (bitIdx & 7))) & 1) === 1; bitIdx++; }
      }
    }
  }
}

function writeFormat(mod: boolean[][], size: number, ecc: QrEcc, mask: number): void {
  const f = bchFormat(ecc, mask);
  const bit = (i: number): boolean => ((f >>> i) & 1) === 1;
  for (let i = 0; i <= 5; i++) mod[i]![8] = bit(i);
  mod[7]![8] = bit(6); mod[8]![8] = bit(7); mod[8]![7] = bit(8);
  for (let i = 9; i < 15; i++) mod[8]![14 - i] = bit(i);
  for (let i = 0; i < 8; i++) mod[8]![size - 1 - i] = bit(i);
  for (let i = 8; i < 15; i++) mod[size - 15 + i]![8] = bit(i);
  mod[size - 8]![8] = true;
}

function penalty(m: boolean[][]): number {
  const n = m.length;
  let p = 0;
  const line = (get: (i: number) => boolean): void => {
    let run = 1;
    for (let i = 1; i < n; i++) {
      if (get(i) === get(i - 1)) { run++; if (run === 5) p += 3; else if (run > 5) p += 1; } else run = 1;
    }
    // finder-like 1:1:3:1:1 with 4 light on either side
    const pat = [true, false, true, true, true, false, true];
    for (let i = 0; i + 7 <= n; i++) {
      let ok = true;
      for (let k = 0; k < 7; k++) if (get(i + k) !== pat[k]) { ok = false; break; }
      if (!ok) continue;
      const lightBefore = [1, 2, 3, 4].every((k) => i - k < 0 || !get(i - k));
      const lightAfter = [7, 8, 9, 10].every((k) => i + k >= n || !get(i + k));
      if (lightBefore) p += 40;
      if (lightAfter) p += 40;
    }
  };
  for (let r = 0; r < n; r++) line((i) => m[r]![i]!);
  for (let c = 0; c < n; c++) line((i) => m[i]![c]!);
  for (let r = 0; r < n - 1; r++) for (let c = 0; c < n - 1; c++) {
    const v = m[r]![c]!;
    if (v === m[r]![c + 1] && v === m[r + 1]![c] && v === m[r + 1]![c + 1]) p += 3;
  }
  let dark = 0;
  for (const row of m) for (const v of row) if (v) dark++;
  p += (Math.ceil(Math.abs(dark * 20 - n * n * 10) / (n * n)) - 1) * 10;
  return p;
}

export function encodeQr(text: string | Uint8Array, opts: QrOptions = {}): QrCode {
  const ecc = opts.ecc ?? "M";
  const bytes = typeof text === "string" ? new TextEncoder().encode(text) : text;
  let version = 0;
  for (let v = 1; v <= MAX_VERSION; v++) if (bytes.length <= byteCapacity(v, ecc)) { version = v; break; }
  if (version === 0) throw new RangeError(`QR payload of ${bytes.length} bytes exceeds version ${MAX_VERSION} level ${ecc}`);
  const codewords = interleave(encodeBytes(bytes, version, ecc), version, ecc);
  const base = buildFunctionPatterns(version);
  placeData(base, codewords);
  let best: boolean[][] | null = null;
  let bestMask = 0;
  let bestScore = Infinity;
  const candidates = opts.mask !== undefined ? [opts.mask] : [0, 1, 2, 3, 4, 5, 6, 7];
  for (const mask of candidates) {
    const m = base.mod.map((row) => row.slice());
    for (let r = 0; r < base.size; r++) for (let c = 0; c < base.size; c++) if (!base.fn[r]![c] && MASKS[mask]!(r, c)) m[r]![c] = !m[r]![c];
    writeFormat(m, base.size, ecc, mask);
    const s = penalty(m);
    if (s < bestScore) { bestScore = s; best = m; bestMask = mask; }
  }
  return { version, size: base.size, mask: bestMask, ecc, modules: best! };
}

/** Render with Unicode half blocks (two module rows per line) and a 4-module quiet zone, in black on white so it scans on any terminal theme. */
export function renderHalfBlocks(qr: QrCode, quiet = 4): string {
  const n = qr.size + quiet * 2;
  const dark = (r: number, c: number): boolean => {
    const rr = r - quiet, cc = c - quiet;
    return rr >= 0 && cc >= 0 && rr < qr.size && cc < qr.size && qr.modules[rr]![cc]!;
  };
  const lines: string[] = [];
  for (let r = 0; r < n; r += 2) {
    let line = "";
    for (let c = 0; c < n; c++) {
      const top = dark(r, c), bot = r + 1 < n ? dark(r + 1, c) : false;
      line += top ? (bot ? "█" : "▀") : bot ? "▄" : " ";
    }
    lines.push(`\x1b[30;47m${line}\x1b[0m`);
  }
  return lines.join("\n");
}
