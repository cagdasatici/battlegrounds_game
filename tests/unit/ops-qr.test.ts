import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { byteCapacity, encodeQr, formatBits, renderHalfBlocks, rsRemainder, type QrCode, type QrEcc } from "../../ops/scripts/lib/qr.js";

interface Ref { text: string; ecc: QrEcc; version: number; mask: number; rows: string[] }
const refs = (JSON.parse(readFileSync(new URL("../fixtures/qr-reference.json", import.meta.url), "utf8")) as { cases: Ref[] }).cases;
const rowsOf = (q: QrCode): string[] => q.modules.map((r) => r.map((b) => (b ? "1" : "0")).join(""));

describe("QR encoder against segno reference matrices", () => {
  for (const r of refs) {
    test(`v${r.version} ${r.ecc} ${r.text.length} bytes, mask ${r.mask}`, () => {
      const q = encodeQr(r.text, { ecc: r.ecc, mask: r.mask });
      expect(q.version).toBe(r.version);
      expect(rowsOf(q)).toEqual(r.rows);
    });
  }
});

describe("known constants", () => {
  test("format information for M/mask0 and L/mask0 (ISO 18004 table)", () => {
    expect(formatBits("M", 0)).toBe(0b101010000010010);
    expect(formatBits("L", 0)).toBe(0b111011111000100);
    expect(formatBits("M", 5)).toBe(0b100000011001110);
  });
  test("Reed-Solomon ECC of the classic HELLO WORLD 1-M data", () => {
    const data = [0x20, 0x5b, 0x0b, 0x78, 0xd1, 0x72, 0xdc, 0x4d, 0x43, 0x40, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11];
    expect(rsRemainder(data, 10)).toEqual([0xc4, 0x23, 0x27, 0x77, 0xeb, 0xd7, 0xe7, 0xe2, 0x5d, 0x17]);
  });
  test("byte capacities match the standard tables", () => {
    expect(byteCapacity(1, "L")).toBe(17);
    expect(byteCapacity(1, "M")).toBe(14);
    expect(byteCapacity(9, "L")).toBe(230);
    expect(byteCapacity(10, "M")).toBe(213);
    expect(byteCapacity(10, "L")).toBe(271);
  });
});

describe("structure", () => {
  const cases: [string, QrEcc][] = [["hello world", "M"], ["x".repeat(100), "L"], ["https://studio.tailnet-name.ts.net/#invite=" + "Ab3_-".repeat(13), "M"], ["q".repeat(250), "L"]];
  for (const [text, ecc] of cases) {
    const q = encodeQr(text, { ecc });
    const m = q.modules;
    const n = q.size;
    test(`v${q.version} ${ecc}: size, finders, timing, dark module, format copies`, () => {
      expect(n).toBe(q.version * 4 + 17);
      for (const [r0, c0] of [[0, 0], [0, n - 7], [n - 7, 0]] as const) {
        for (let r = 0; r < 7; r++) for (let c = 0; c < 7; c++) {
          const ring = Math.max(Math.abs(r - 3), Math.abs(c - 3));
          expect(m[r0 + r]![c0 + c]).toBe(ring !== 2);
        }
      }
      for (let i = 8; i < n - 8; i++) { expect(m[6]![i]).toBe(i % 2 === 0); expect(m[i]![6]).toBe(i % 2 === 0); }
      expect(m[n - 8]![8]).toBe(true);
      const f = formatBits(ecc, q.mask);
      const bit = (i: number): boolean => ((f >>> i) & 1) === 1;
      for (let i = 0; i < 8; i++) expect(m[8]![n - 1 - i]).toBe(bit(i));
      for (let i = 8; i < 15; i++) expect(m[n - 15 + i]![8]).toBe(bit(i));
      for (let i = 0; i <= 5; i++) expect(m[i]![8]).toBe(bit(i));
      expect(m[7]![8]).toBe(bit(6)); expect(m[8]![8]).toBe(bit(7)); expect(m[8]![7]).toBe(bit(8));
      for (let i = 9; i < 15; i++) expect(m[8]![14 - i]).toBe(bit(i));
    });
  }
  test("version 7+ carries version information in both corners", () => {
    const q = encodeQr("t".repeat(154), { ecc: "L" });
    expect(q.version).toBe(7);
    // BCH(18,6) for version 7 is 0x07C94.
    let v = 0;
    for (let i = 0; i < 18; i++) if (q.modules[Math.floor(i / 3)]![q.size - 11 + (i % 3)]) v |= 1 << i;
    expect(v).toBe(0x07c94);
  });
  test("version grows with payload and overflow throws", () => {
    expect(encodeQr("a".repeat(14), { ecc: "M" }).version).toBe(1);
    expect(encodeQr("a".repeat(15), { ecc: "M" }).version).toBe(2);
    expect(encodeQr("a".repeat(213), { ecc: "M" }).version).toBe(10);
    expect(() => encodeQr("a".repeat(214), { ecc: "M" })).toThrow(RangeError);
  });
  test("auto mask picks a valid mask and is deterministic", () => {
    const a = encodeQr("https://example.com/#invite=abc");
    const b = encodeQr("https://example.com/#invite=abc");
    expect(a.mask).toBe(b.mask);
    expect(a.mask).toBeGreaterThanOrEqual(0);
    expect(a.mask).toBeLessThan(8);
  });
});

describe("rendering", () => {
  test("half blocks: two module rows per line plus quiet zone", () => {
    const q = encodeQr("hi", { ecc: "L" });
    const text = renderHalfBlocks(q, 4);
    const lines = text.split("\n");
    expect(lines.length).toBe(Math.ceil((q.size + 8) / 2));
    // eslint-disable-next-line no-control-regex
    const plain = lines.map((l) => l.replace(/\x1b\[[0-9;]*m/g, ""));
    for (const l of plain) expect([...l].length).toBe(q.size + 8);
    expect(/^ +$/.test(plain[0]!)).toBe(true);
    expect(plain.join("")).toMatch(/[█▀▄]/);
  });
});
