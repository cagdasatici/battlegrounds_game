import { attenuation, LOOPS, MAX_VOICES, RECIPES, type LoopKind, type Priority, type Recipe, type SoundKind } from "./synth.js";

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
  /** QS01: optional so fakes stay small. Real contexts report "running", "suspended", "closed" or (Safari) "interrupted". */
  readonly state?: string;
  suspend?(): Promise<void>;
  onstatechange?: (() => void) | null;
}

interface Voice { priority: Priority; start: number; end: number; stop: () => void; loopKey?: string; out?: GainLike }

/**
 * Master bus: one compressor, effects gain from settings, a 16 voice cap with priority stealing and linear
 * distance attenuation. Silent until unlock() succeeds. Presentation only.
 */
export class AudioBus {
  private ctx: AudioContextLike | null = null;
  private master: GainLike | null = null;
  private mix: NodeLike | null = null;
  private music: GainLike | null = null;
  private musicBuffer: BufferLike | null = null;
  private noise: BufferLike | null = null;
  private voices: Voice[] = [];
  private unlocked = false;
  private suspended = false;
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
      this.mix = comp;
      this.ctx = ctx; this.master = master; this.noise = buf; this.unlocked = true;
      void ctx.resume().catch(() => {});
      ctx.onstatechange = () => { if (ctx.state !== undefined && ctx.state !== "running") this.stopAllLoops(); };
    } catch { this.unlocked = false; }
  }

  /** Effects slider, 0..1. */
  setEffectsVolume(v: number): void {
    this.effects = Math.min(1, Math.max(0, v));
    if (this.master) this.master.gain.value = this.effects;
  }

  /** Original eight-second ambient melody, one low-priority voice independent of effects volume. */
  setMusicVolume(value: number): void {
    const v = Math.min(1, Math.max(0, value)), ctx = this.ctx;
    if (v === 0) { this.stopLoop("__music"); return; }
    if (!ctx || !this.mix || this.isSuspended) return;
    if (this.music) this.music.gain.value = v;
    this.prune();
    if (this.hasLoop("__music") || this.voices.length >= MAX_VOICES) return;
    if (!this.musicBuffer) {
      const rate = 16000, duration = 8;
      this.musicBuffer = ctx.createBuffer(1, rate * duration, rate);
      const samples = this.musicBuffer.getChannelData(0);
      const notes = [220, 261.625565, 329.627557, 391.995436, 329.627557, 261.625565, 293.664768, 246.941651];
      for (let i = 0; i < samples.length; i++) {
        const t = i / rate, local = t % 1, f = notes[Math.floor(t)]!;
        const envelope = Math.sin(Math.PI * local) ** 2;
        const pad = (Math.sin(2 * Math.PI * 110 * t) + Math.sin(2 * Math.PI * 165 * t)) * Math.sin(Math.PI * t / duration) ** 2;
        samples[i] = 0.035 * envelope * Math.sin(2 * Math.PI * f * t) + 0.012 * pad;
      }
    }
    const out = ctx.createGain(); out.gain.value = v; out.connect(this.mix); this.music = out;
    const source = ctx.createBufferSource(); source.buffer = this.musicBuffer; source.loop = true; source.connect(out); source.start();
    this.voices.push({ priority: 2, start: ctx.currentTime, end: Infinity, loopKey: "__music", out,
      stop: () => { try { source.stop(); } catch { /* already stopped */ } source.disconnect(); out.disconnect(); if (this.music === out) this.music = null; } });
  }

  get musicPlaying(): boolean { return this.hasLoop("__music"); }

  /** Returns true when a voice was started. distM is listener-to-source distance in metres. */
  play(kind: SoundKind, priority: Priority, distM: number): boolean {
    const ctx = this.ctx, master = this.master;
    if (!this.unlocked || !ctx || !master || this.isSuspended) return false;
    const att = attenuation(distM);
    if (att <= 0) return false;
    this.prune();
    if (this.voices.length >= MAX_VOICES && !this.steal(priority)) return false;
    const recipe = RECIPES[kind];
    const t0 = ctx.currentTime;
    const { stop } = this.build(ctx, master, recipe, att, false);
    this.voices.push({ priority, start: t0, end: t0 + recipe.dur + 0.02, stop });
    return true;
  }

  /** QS01: start (or keep) a sustained bed under `key`. Counts as a voice. Returns false when silent or dropped. */
  startLoop(key: string, kind: LoopKind, priority: Priority, distM: number): boolean {
    const ctx = this.ctx, master = this.master;
    if (!this.unlocked || !ctx || !master || this.suspended || (ctx.state !== undefined && ctx.state !== "running")) return false;
    if (this.voices.some((v) => v.loopKey === key)) return this.setLoopDistance(key, distM);
    const att = attenuation(distM);
    if (att <= 0) return false;
    this.prune();
    if (this.voices.length >= MAX_VOICES && !this.steal(priority)) return false;
    const { out, stop } = this.build(ctx, master, LOOPS[kind], att, true);
    this.voices.push({ priority, start: ctx.currentTime, end: Infinity, stop, loopKey: key, out });
    return true;
  }

  /** Re-apply distance attenuation to a live loop; stops it when out of range. */
  setLoopDistance(key: string, distM: number): boolean {
    const v = this.voices.find((x) => x.loopKey === key);
    if (!v) return false;
    const att = attenuation(distM);
    if (att <= 0) { this.stopLoop(key); return false; }
    if (v.out) v.out.gain.value = att;
    return true;
  }

  stopLoop(key: string): void {
    const v = this.voices.find((x) => x.loopKey === key);
    if (!v) return;
    v.stop();
    this.voices = this.voices.filter((x) => x !== v);
  }

  hasLoop(key: string): boolean { return this.voices.some((v) => v.loopKey === key); }
  get loopCount(): number { return this.voices.filter((v) => v.loopKey !== undefined).length; }

  stopAllLoops(): void {
    for (const v of this.voices) if (v.loopKey !== undefined) v.stop();
    this.voices = this.voices.filter((v) => v.loopKey === undefined);
  }

  /** Page hidden or device interruption: silence every loop and refuse new ones until resume(). One-shots finish on their own. */
  suspend(): void {
    this.suspended = true;
    this.stopAllLoops();
    void this.ctx?.suspend?.().catch(() => {});
  }

  resume(): void {
    this.suspended = false;
    void this.ctx?.resume().catch(() => {});
  }

  /** Safari can leave a context suspended after creation; call on each gesture until it runs. True once running. */
  ensureRunning(): boolean {
    const ctx = this.ctx;
    if (!this.unlocked || !ctx) return false;
    if (ctx.state === undefined || ctx.state === "running") return true;
    if (!this.suspended) void ctx.resume().catch(() => {});
    return false;
  }

  get isSuspended(): boolean { return this.suspended || (this.ctx?.state !== undefined && this.ctx.state !== "running"); }

  /** Free a voice slot for a newcomer of `priority`; false when everything outranks it. */
  private steal(priority: Priority): boolean {
    let victim = this.voices[0]!;
    for (const v of this.voices) if (v.priority > victim.priority || (v.priority === victim.priority && v.start < victim.start)) victim = v;
    if (victim.priority < priority) return false;
    victim.stop();
    this.voices = this.voices.filter((v) => v !== victim);
    return true;
  }

  private build(ctx: AudioContextLike, master: GainLike, recipe: Recipe, att: number, loop: boolean): { out: GainLike; stop: () => void } {
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
      if (!loop) env.gain.exponentialRampToValueAtTime(0.0001, end);
      let head: NodeLike;
      let src: SourceLike;
      if (l.src === "osc") {
        const o = ctx.createOscillator();
        o.type = l.wave ?? "sine";
        o.frequency.setValueAtTime(l.f0, at);
        if (!loop) o.frequency.exponentialRampToValueAtTime(l.f1, end);
        src = o; head = o;
      } else {
        const n = ctx.createBufferSource();
        n.buffer = this.noise; n.loop = true;
        const f = ctx.createBiquadFilter();
        f.type = l.filter ?? "lowpass";
        f.frequency.setValueAtTime(l.f0, at);
        if (!loop) f.frequency.exponentialRampToValueAtTime(l.f1, end);
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
        lfo.start(at); if (!loop) lfo.stop(end + 0.02); srcs.push(lfo);
      }
      env.connect(out);
      src.start(at); if (!loop) src.stop(end + 0.02);
      srcs.push(src);
    }
    return { out, stop: () => { for (const s of srcs) { try { s.stop(); s.disconnect(); } catch { /* already stopped */ } } out.disconnect(); } };
  }

  private prune(): void {
    const now = this.ctx?.currentTime ?? 0;
    this.voices = this.voices.filter((v) => v.end > now);
  }

  dispose(): void {
    for (const v of this.voices) v.stop();
    this.voices = [];
    this.master?.disconnect(); this.mix?.disconnect();
    this.mix = null; this.music = null; this.musicBuffer = null;
    const c = this.ctx;
    if (c) c.onstatechange = null;
    this.ctx = null; this.master = null; this.unlocked = false;
    void c?.close().catch(() => {});
  }
}
