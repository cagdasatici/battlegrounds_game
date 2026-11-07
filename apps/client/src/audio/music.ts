/**
 * MUS01: original, procedurally composed background music. No samples or recordings: every track is a small spec (tempo,
 * key, mode, chord loop, instrument style) rendered to a mono buffer in the browser. Two playlists rotate without playing
 * the same track twice in a row: the normal set, and a heavier set while the local player is in Beast form.
 * Pure module (no DOM, no WebAudio); AudioBus owns playback. All values are local design choices.
 */

export type MusicMode = "normal" | "beast";

export interface TrackSpec {
  id: string;
  /** Beats per minute. */
  bpm: number;
  /** Tonic frequency in Hz (lead register; bass sits two octaves below). */
  root: number;
  /** Mode as semitone offsets of seven scale degrees. */
  scale: readonly number[];
  /** One chord (scale degree, 0-based) per bar; the loop repeats to fill `bars`. */
  chords: readonly number[];
  bars: number;
  lead: "bell" | "pluck" | "soft" | "horn";
  /** 0..1: 0 = no drums, 1 = full kit (kick, snare, hats). */
  drums: number;
  /** Bass pattern: half notes, eighths or a driving gallop. */
  bass: "half" | "eighth" | "gallop";
  /** Probability that an eighth-note lead slot plays. */
  density: number;
  seed: number;
  /** Beast tracks: soft clipping on the bass, tom hits on every beat. */
  heavy?: boolean;
}

const MAJOR = [0, 2, 4, 5, 7, 9, 11], MINOR = [0, 2, 3, 5, 7, 8, 10], DORIAN = [0, 2, 3, 5, 7, 9, 10];
const LYDIAN = [0, 2, 4, 6, 7, 9, 11], MIXO = [0, 2, 4, 5, 7, 9, 10], PHRYGIAN = [0, 1, 3, 5, 7, 8, 10], HARM_MINOR = [0, 2, 3, 5, 7, 8, 11];

/** The rotation outside Beast form: calm to lively, 30 to 50 seconds each. */
export const NORMAL_TRACKS: readonly TrackSpec[] = [
  { id: "meadow-drift", bpm: 88, root: 220, scale: MAJOR, chords: [0, 5, 3, 4], bars: 16, lead: "bell", drums: 0.25, bass: "half", density: 0.5, seed: 11 },
  { id: "tidal-steps", bpm: 102, root: 196, scale: DORIAN, chords: [0, 3, 0, 6], bars: 20, lead: "pluck", drums: 0.6, bass: "eighth", density: 0.62, seed: 23 },
  { id: "ember-road", bpm: 116, root: 174.61, scale: MINOR, chords: [0, 5, 2, 6], bars: 24, lead: "pluck", drums: 0.8, bass: "eighth", density: 0.7, seed: 37 },
  { id: "cloud-isles", bpm: 80, root: 261.63, scale: LYDIAN, chords: [0, 1, 0, 4], bars: 14, lead: "soft", drums: 0.15, bass: "half", density: 0.42, seed: 41 },
  { id: "stone-circle", bpm: 124, root: 233.08, scale: MIXO, chords: [0, 6, 3, 0], bars: 24, lead: "pluck", drums: 0.9, bass: "gallop", density: 0.66, seed: 53 },
  { id: "frost-lantern", bpm: 96, root: 207.65, scale: MINOR, chords: [0, 3, 4, 0], bars: 18, lead: "bell", drums: 0.4, bass: "half", density: 0.55, seed: 67 },
];

/** The rotation while the local player is a beast: low, fast, drum-led. */
export const BEAST_TRACKS: readonly TrackSpec[] = [
  { id: "beast-rampage", bpm: 140, root: 146.83, scale: PHRYGIAN, chords: [0, 1, 0, 6], bars: 24, lead: "horn", drums: 1, bass: "gallop", density: 0.45, seed: 101, heavy: true },
  { id: "beast-quake", bpm: 128, root: 130.81, scale: HARM_MINOR, chords: [0, 5, 4, 0], bars: 20, lead: "horn", drums: 1, bass: "eighth", density: 0.38, seed: 113, heavy: true },
  { id: "beast-howl", bpm: 150, root: 155.56, scale: MINOR, chords: [0, 6, 5, 4], bars: 28, lead: "horn", drums: 1, bass: "gallop", density: 0.5, seed: 127, heavy: true },
];

export const playlistFor = (mode: MusicMode): readonly TrackSpec[] => (mode === "beast" ? BEAST_TRACKS : NORMAL_TRACKS);

/** Track length in seconds (whole bars of 4/4 plus a short tail). */
export const trackSeconds = (t: TrackSpec): number => (t.bars * 4 * 60) / t.bpm + 1.5;

/**
 * Next index in a rotation of `count` tracks after `prev` (-1 = nothing played yet). Uniform `u` in [0,1); never repeats
 * the previous track when there is more than one.
 */
export function nextTrackIndex(count: number, prev: number, u: number): number {
  if (count <= 1) return 0;
  const k = Math.min(count - 2, Math.floor(Math.max(0, Math.min(0.999999, u)) * (count - 1)));
  if (prev < 0 || prev >= count) return Math.min(count - 1, Math.floor(Math.max(0, Math.min(0.999999, u)) * count));
  return k >= prev ? k + 1 : k;
}

function rng(seed: number): () => number {
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 0x100000000; };
}

const TAU = Math.PI * 2;
const semis = (f: number, n: number): number => f * Math.pow(2, n / 12);
/** Frequency of scale degree `d` (any integer; wraps octaves) above `root`. */
function degreeHz(t: TrackSpec, d: number): number {
  const o = Math.floor(d / 7), i = ((d % 7) + 7) % 7;
  return semis(t.root, t.scale[i]! + 12 * o);
}

interface Note { start: number; dur: number; hz: number; amp: number; kind: "lead" | "bass" | "pad" | "kick" | "snare" | "hat" | "tom" }

/** The score: every note of the track with start time and length in seconds. Deterministic per spec. */
export function composeTrack(t: TrackSpec): Note[] {
  const r = rng(t.seed), beat = 60 / t.bpm, bar = beat * 4, notes: Note[] = [];
  let prevDeg = 7; // lead starts near the octave
  // A two-bar motif that repeats with variation keeps the melody singable instead of random.
  const motif: (number | null)[] = Array.from({ length: 16 }, () => (r() < t.density ? Math.floor(r() * 5) - 2 : null));
  for (let b = 0; b < t.bars; b++) {
    const chord = t.chords[b % t.chords.length]!, t0 = b * bar;
    const fadeBar = b === t.bars - 1 ? 0.6 : 1;
    for (const k of [0, 2, 4]) notes.push({ start: t0, dur: bar, hz: degreeHz(t, chord + k) / 2, amp: 0.010 * fadeBar, kind: "pad" });
    // Bass: chord root two octaves down.
    const bassHz = degreeHz(t, chord) / 4;
    const hits = t.bass === "half" ? [0, 2] : t.bass === "eighth" ? [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5] : [0, 0.75, 1, 2, 2.75, 3];
    for (const h of hits) notes.push({ start: t0 + h * beat, dur: t.bass === "half" ? beat * 1.8 : beat * 0.45, hz: bassHz * (t.heavy && h % 1 === 0.75 ? 1.5 : 1), amp: (t.heavy ? 0.06 : 0.045) * fadeBar, kind: "bass" });
    // Lead: motif steps around chord tones, every fourth bar answers a step higher, the first two bars stay quiet.
    if (b >= 2 && b < t.bars - 1) {
      for (let s = 0; s < 8; s++) {
        const m = motif[(b % 2) * 8 + s];
        if (m === null || m === undefined || (b % 8 === 7 && s > 3)) continue;
        const target = chord + 7 + m + (b % 4 === 3 ? 1 : 0);
        prevDeg = Math.round((prevDeg + target) / 2 + (r() < 0.2 ? (r() < 0.5 ? -1 : 1) : 0));
        notes.push({ start: t0 + s * beat * 0.5, dur: beat * (r() < 0.25 ? 1 : 0.5), hz: degreeHz(t, prevDeg), amp: 0.032, kind: "lead" });
      }
    }
    // Drums.
    if (t.drums > 0 && b > 0) {
      for (let q = 0; q < 4; q++) {
        const at = t0 + q * beat;
        if (q === 0 || q === 2 || (t.drums > 0.85 && r() < 0.35)) notes.push({ start: at, dur: 0.3, hz: 0, amp: 0.11 * t.drums, kind: "kick" });
        if (t.drums >= 0.5 && (q === 1 || q === 3)) notes.push({ start: at, dur: 0.2, hz: 0, amp: 0.05 * t.drums, kind: "snare" });
        if (t.heavy) notes.push({ start: at + beat * 0.5, dur: 0.35, hz: q % 2 ? 98 : 82, amp: 0.07, kind: "tom" });
      }
      if (t.drums >= 0.3) for (let e = 0; e < 8; e++) notes.push({ start: t0 + e * beat * 0.5, dur: 0.05, hz: 0, amp: (e % 2 ? 0.012 : 0.008) * t.drums, kind: "hat" });
    }
  }
  if (t.heavy) notes.push({ start: 0, dur: 1.6, hz: 41.2, amp: 0.2, kind: "tom" }); // the transformation boom that opens a beast track
  return notes;
}

/** Renders `t` into `out` (mono, `rate` Hz). Output stays inside [-1, 1]. Writes at most out.length samples. */
export function renderTrack(t: TrackSpec, rate: number, out: Float32Array): void {
  const r = trackRenderer(t, rate, out);
  while (!r.step(Infinity)) { /* render everything now */ }
}

/** Resumable renderer: each `step(budgetMs)` does roughly that much work and returns true once `out` is complete. */
export interface TrackRenderer { step(budgetMs: number): boolean }

export function trackRenderer(t: TrackSpec, rate: number, out: Float32Array, now: () => number = () => performance.now()): TrackRenderer {
  out.fill(0);
  const noise = rng(t.seed + 7), notes = composeTrack(t);
  let ni = 0, fi = 0;
  const finishFrom = (from: number, until: number): void => {
    const edge = Math.min(out.length / 4, Math.floor(rate * 0.8)), inEdge = t.heavy ? Math.max(1, Math.floor(rate * 0.01)) : edge; // a beast track opens on its boom
    for (let i = from; i < until; i++) {
      let g = 1;
      if (i < inEdge) g = i / inEdge;
      else if (i > out.length - edge) g = (out.length - i) / edge;
      out[i] = Math.tanh(out[i]! * 1.2) * g;
    }
  };
  return {
    step(budgetMs: number): boolean {
      const end = now() + budgetMs;
      while (ni < notes.length) { addNote(notes[ni++]!); if (now() >= end) return false; }
      while (fi < out.length) { const to = Math.min(out.length, fi + 16384); finishFrom(fi, to); fi = to; if (now() >= end && fi < out.length) return false; }
      return true;
    },
  };
  function addNote(n: Note): void {
    const i0 = Math.floor(n.start * rate), len = Math.floor(n.dur * rate);
    for (let j = 0; j < len; j++) {
      const i = i0 + j;
      if (i >= out.length) break;
      const x = j / rate, p = j / len;
      let v = 0;
      switch (n.kind) {
        case "pad": { const env = Math.min(1, x / 0.4) * Math.min(1, (len - j) / rate / 0.4); v = env * (Math.sin(TAU * n.hz * x) + 0.5 * Math.sin(TAU * n.hz * 1.003 * x)); break; }
        case "bass": { const env = Math.exp(-x * (t.bass === "half" ? 2.2 : 7)) * Math.min(1, x / 0.005); const s = Math.sin(TAU * n.hz * x) + 0.4 * Math.sin(TAU * 2 * n.hz * x); v = env * (t.heavy ? Math.tanh(s * 2.2) : s); break; }
        case "lead": {
          const atk = Math.min(1, x / (t.lead === "soft" ? 0.06 : 0.004));
          if (t.lead === "bell") v = atk * Math.exp(-x * 3.2) * (Math.sin(TAU * n.hz * x) + 0.35 * Math.sin(TAU * 2.76 * n.hz * x) * Math.exp(-x * 6));
          else if (t.lead === "pluck") v = atk * Math.exp(-x * 7) * (Math.sin(TAU * n.hz * x) + 0.5 * Math.sin(TAU * 2 * n.hz * x) + 0.25 * Math.sin(TAU * 3 * n.hz * x));
          else if (t.lead === "soft") v = atk * (1 - p) * Math.sin(TAU * n.hz * x + 0.8 * Math.sin(TAU * 4.5 * x));
          else v = atk * Math.min(1, (len - j) / rate / 0.05) * Math.tanh(1.6 * (Math.sin(TAU * n.hz * x) + 0.6 * Math.sin(TAU * 2 * n.hz * x) + 0.3 * Math.sin(TAU * 3 * n.hz * x))) * 0.8;
          break;
        }
        case "kick": { const f = 45 + 75 * Math.exp(-x * 30); v = Math.exp(-x * 9) * Math.sin(TAU * f * x); break; }
        case "tom": { const f = n.hz * (1 + 0.6 * Math.exp(-x * 18)); v = Math.exp(-x * (n.dur > 1 ? 2.5 : 8)) * Math.sin(TAU * f * x); break; }
        case "snare": v = Math.exp(-x * 22) * ((noise() * 2 - 1) * 0.8 + 0.4 * Math.sin(TAU * 190 * x)); break;
        case "hat": v = Math.exp(-x * 90) * (noise() * 2 - 1); break;
      }
      out[i] = out[i]! + n.amp * v;
    }
  }
}
