import { attenuation, MAX_VOICES, RECIPES, type Priority, type SoundKind } from "./synth.js";

/** Structural subset of the WebAudio API used here, so tests can pass a fake context. */
export interface ParamLike {
  value: number;
  setValueAtTime(v: number, t: number): unknown;
  linearRampToValueAtTime(v: number, t: number): unknown;
  exponentialRampToValueAtTime(v: number, t: number): unknown;
}
export interface NodeLike { connect(n: unknown): unknown; disconnect(): void }
export interface SourceLike extends NodeLike { start(t?: number): void; stop(t?: number): void }
export interface OscLike extends SourceLike { type: string; frequency: ParamLike }
export interface NoiseLike extends SourceLike { buffer: unknown; loop: boolean }
export interface FilterLike extends NodeLike { type: string; frequency: ParamLike; Q: ParamLike }
export interface GainLike extends NodeLike { gain: ParamLike }
export interface CompressorLike extends NodeLike {
  threshold: ParamLike; knee: ParamLike; ratio: ParamLike; attack: ParamLike; release: ParamLike;
}
export interface BufferLike { getChannelData(c: number): Float32Array }
export interface AudioContextLike {
  readonly currentTime: number;
  readonly sampleRate: number;
  readonly destination: unknown;
  resume(): Promise<void>;
  close(): Promise<void>;
  createOscillator(): OscLike;
  createBufferSource(): NoiseLike;
  createBuffer(ch: number, len: number, rate: number): BufferLike;
  createBiquadFilter(): FilterLike;
  createGain(): GainLike;
  createDynamicsCompressor(): CompressorLike;
}

interface Voice { priority: Priority; start: number; end: number; stop: () => void }

/**
 * Master bus: one compressor, effects gain from settings, a 16 voice cap with priority stealing and linear
 * distance attenuation. Silent until unlock() succeeds. Presentation only.
 */
export class AudioBus {
  private ctx: AudioContextLike | null = null;
  private master: GainLike | null = null;
  private noise: BufferLike | null = null;
  private voices: Voice[] = [];
  private unlocked = false;
  private effects = 1;

  constructor(private readonly make: () => AudioContextLike) {}

  get isUnlocked(): boolean { return this.unlocked; }
  get activeVoices(): number { this.prune(); return this.voices.length; }

  /** Must be called from a user gesture (the Play press). Idempotent. */
  unlock(): void {
    if (this.unlocked) return;
    try {
      const ctx = this.make();
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -18; comp.knee.value = 24; comp.ratio.value = 6; comp.attack.value = 0.003; comp.release.value = 0.25;
      const master = ctx.createGain();
      master.gain.value = this.effects;
      master.connect(comp);
      comp.connect(ctx.destination);
      const len = Math.floor(ctx.sampleRate * 0.5);
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      let s = 12345; // deterministic xorshift noise
      for (let i = 0; i < len; i++) { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; d[i] = ((s >>> 0) / 0xffffffff) * 2 - 1; }
      this.ctx = ctx; this.master = master; this.noise = buf; this.unlocked = true;
      void ctx.resume().catch(() => {});
    } catch { this.unlocked = false; }
  }

  /** Effects slider, 0..1. */
  setEffectsVolume(v: number): void {
    this.effects = Math.min(1, Math.max(0, v));
    if (this.master) this.master.gain.value = this.effects;
  }

  /** Returns true when a voice was started. distM is listener-to-source distance in metres. */
  play(kind: SoundKind, priority: Priority, distM: number): boolean {
    const ctx = this.ctx, master = this.master;
    if (!this.unlocked || !ctx || !master) return false;
    const att = attenuation(distM);
    if (att <= 0) return false;
    this.prune();
    if (this.voices.length >= MAX_VOICES) {
      // Steal the lowest priority (largest number), oldest voice, unless everything outranks the newcomer.
      let victim = this.voices[0]!;
      for (const v of this.voices) if (v.priority > victim.priority || (v.priority === victim.priority && v.start < victim.start)) victim = v;
      if (victim.priority < priority) return false;
      victim.stop();
      this.voices = this.voices.filter((v) => v !== victim);
    }
    const recipe = RECIPES[kind];
    const t0 = ctx.currentTime;
    const out = ctx.createGain();
    out.gain.value = att;
    out.connect(master);
    const srcs: SourceLike[] = [];
    for (const l of recipe.layers) {
      const at = t0 + (l.delay ?? 0), end = at + l.dur;
      const env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, at);
      env.gain.linearRampToValueAtTime(l.gain, at + l.attack);
      env.gain.exponentialRampToValueAtTime(0.0001, end);
      let head: NodeLike;
      let src: SourceLike;
      if (l.src === "osc") {
        const o = ctx.createOscillator();
        o.type = l.wave ?? "sine";
        o.frequency.setValueAtTime(l.f0, at);
        o.frequency.exponentialRampToValueAtTime(l.f1, end);
        src = o; head = o;
      } else {
        const n = ctx.createBufferSource();
        n.buffer = this.noise; n.loop = true;
        const f = ctx.createBiquadFilter();
        f.type = l.filter ?? "lowpass";
        f.frequency.setValueAtTime(l.f0, at);
        f.frequency.exponentialRampToValueAtTime(l.f1, end);
        f.Q.value = 1;
        n.connect(f);
        src = n; head = f;
      }
      head.connect(env);
      if (l.crackleHz !== undefined) {
        const lfo = ctx.createOscillator();
        lfo.type = "square";
        lfo.frequency.setValueAtTime(l.crackleHz, at);
        const depth = ctx.createGain();
        depth.gain.value = l.gain * 0.5;
        lfo.connect(depth); depth.connect(env.gain);
        lfo.start(at); lfo.stop(end + 0.02); srcs.push(lfo);
      }
      env.connect(out);
      src.start(at); src.stop(end + 0.02);
      srcs.push(src);
    }
    this.voices.push({
      priority, start: t0, end: t0 + recipe.dur + 0.02,
      stop: () => { for (const s of srcs) { try { s.stop(); s.disconnect(); } catch { /* already stopped */ } } out.disconnect(); },
    });
    return true;
  }

  private prune(): void {
    const now = this.ctx?.currentTime ?? 0;
    this.voices = this.voices.filter((v) => v.end > now);
  }

  dispose(): void {
    for (const v of this.voices) v.stop();
    this.voices = [];
    this.master?.disconnect();
    const c = this.ctx;
    this.ctx = null; this.master = null; this.unlocked = false;
    void c?.close().catch(() => {});
  }
}
