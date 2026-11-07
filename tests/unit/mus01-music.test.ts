import { describe, expect, test } from "vitest";
import { BEAST_TRACKS, NORMAL_TRACKS, composeTrack, nextTrackIndex, renderTrack, trackRenderer, trackSeconds } from "../../apps/client/src/audio/music.js";

describe("MUS01 music", () => {
  test("rotation never repeats the previous track and reaches every track", () => {
    for (const n of [NORMAL_TRACKS.length, BEAST_TRACKS.length]) {
      const seen = new Set<number>();
      let prev = -1;
      for (let i = 0; i < 400; i++) { const u = ((i * 0.6180339) % 1); const k = nextTrackIndex(n, prev, u); expect(k).not.toBe(prev); expect(k).toBeGreaterThanOrEqual(0); expect(k).toBeLessThan(n); seen.add(k); prev = k; }
      expect(seen.size).toBe(n);
    }
    expect(nextTrackIndex(1, 0, 0.5)).toBe(0);
  });
  test("5+ normal and 3 beast tracks, unique ids, 20-60 s each", () => {
    expect(NORMAL_TRACKS.length).toBeGreaterThanOrEqual(5); expect(BEAST_TRACKS.length).toBeGreaterThanOrEqual(3);
    const ids = [...NORMAL_TRACKS, ...BEAST_TRACKS].map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of [...NORMAL_TRACKS, ...BEAST_TRACKS]) { expect(trackSeconds(t)).toBeGreaterThan(20); expect(trackSeconds(t)).toBeLessThan(60); }
  });
  test("every track renders deterministic, audible, bounded audio with silent edges", () => {
    for (const t of [...NORMAL_TRACKS, ...BEAST_TRACKS]) {
      const rate = 8000, a = new Float32Array(Math.ceil(rate * trackSeconds(t))), b = new Float32Array(a.length);
      renderTrack(t, rate, a); renderTrack(t, rate, b);
      expect(a).toEqual(b);
      let peak = 0, energy = 0;
      for (const x of a) { peak = Math.max(peak, Math.abs(x)); energy += x * x; }
      expect(peak).toBeLessThanOrEqual(1); expect(peak).toBeGreaterThan(0.02);
      expect(Math.sqrt(energy / a.length)).toBeGreaterThan(0.005);
      expect(a[0]).toBe(0); expect(Math.abs(a[a.length - 1]!)).toBeLessThan(0.01);
    }
  });
  test("tracks differ: tempo, notes and the beast set is drum-led with toms", () => {
    expect(new Set(NORMAL_TRACKS.map((t) => t.bpm)).size).toBe(NORMAL_TRACKS.length);
    for (const t of BEAST_TRACKS) expect(composeTrack(t).some((n) => n.kind === "tom")).toBe(true);
  });
});

test("the sliced renderer produces exactly the one-shot render", () => {
  const t = NORMAL_TRACKS[1]!, rate = 4000, n = Math.ceil(rate * trackSeconds(t));
  const a = new Float32Array(n), b = new Float32Array(n);
  renderTrack(t, rate, a);
  let clock = 0; const r = trackRenderer(t, rate, b, () => (clock += 1));
  let steps = 0; while (!r.step(3)) steps++;
  expect(steps).toBeGreaterThan(5); expect(b).toEqual(a);
});
