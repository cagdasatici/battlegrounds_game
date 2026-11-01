import { describe, expect, test } from "vitest";
import { AudioBus, type AudioContextLike } from "../../apps/client/src/audio/AudioBus.js";
import { attenuation, castKind, RECIPES } from "../../apps/client/src/audio/synth.js";
import { priorityFor, soundFor } from "../../apps/client/src/fx/Sfx.js";
import type { CombatEvent } from "../../packages/shared/src/protocol.js";

function fakeCtx() {
  const state = { time: 0, started: 0, stopped: 0, created: 0, outGains: [] as number[], compressors: 0, closed: false };
  const param = () => ({ value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} });
  const node = () => ({ connect() {}, disconnect() {} });
  const ctx: AudioContextLike = {
    get currentTime() { return state.time; },
    sampleRate: 8000, destination: {},
    resume: async () => {}, close: async () => { state.closed = true; },
    createOscillator: () => ({ ...node(), type: "", frequency: param(), start() { state.started++; }, stop() { state.stopped++; } }),
    createBufferSource: () => ({ ...node(), buffer: null, loop: false, start() { state.started++; }, stop() { state.stopped++; } }),
    createBuffer: () => ({ getChannelData: () => new Float32Array(4000) }),
    createBiquadFilter: () => ({ ...node(), type: "", frequency: param(), Q: param() }),
    createGain: () => { state.created++; const g = { ...node(), gain: param() }; state.outGains.push(0); return g; },
    createDynamicsCompressor: () => { state.compressors++; return { ...node(), threshold: param(), knee: param(), ratio: param(), attack: param(), release: param() }; },
  };
  return { ctx, state };
}
const mk = () => { const f = fakeCtx(); const bus = new AudioBus(() => f.ctx); return { ...f, bus }; };
const ev = (over: Partial<CombatEvent>): CombatEvent => ({ eventId: "e", tick: 1, kind: "hit", actorId: "1", targetId: "2", lifeId: 1, ...over });

describe("AudioBus", () => {
  test("no sound before unlock", () => {
    const t = mk();
    expect(t.bus.play("hitLight", 0, 0)).toBe(false);
    expect(t.state.started).toBe(0);
    t.bus.unlock();
    expect(t.bus.play("hitLight", 0, 0)).toBe(true);
    expect(t.state.compressors).toBe(1);
  });
  test("attenuation at 0, 22.5 and 45 m", () => {
    expect(attenuation(0)).toBe(1);
    expect(attenuation(22.5)).toBe(0.5);
    expect(attenuation(45)).toBe(0);
    expect(attenuation(80)).toBe(0);
    const t = mk(); t.bus.unlock();
    expect(t.bus.play("hitLight", 0, 45)).toBe(false);
    expect(t.bus.play("hitLight", 0, 22.5)).toBe(true);
  });
  test("voice cap of 16", () => {
    const t = mk(); t.bus.unlock();
    for (let i = 0; i < 40; i++) t.bus.play("ko", 2, 1);
    expect(t.bus.activeVoices).toBe(16);
  });
  test("full cap: higher priority steals, lower or equal-rank outranked is dropped", () => {
    const t = mk(); t.bus.unlock();
    for (let i = 0; i < 16; i++) t.bus.play("ko", 1, 1);
    expect(t.bus.play("hitLight", 2, 1)).toBe(false);
    expect(t.bus.play("hitLight", 0, 1)).toBe(true);
    expect(t.bus.activeVoices).toBe(16);
    const stopsBefore = t.state.stopped;
    expect(t.bus.play("hitLight", 1, 1)).toBe(true);
    expect(t.state.stopped).toBeGreaterThan(stopsBefore);
  });
  test("steals lowest priority first", () => {
    const t = mk(); t.bus.unlock();
    for (let i = 0; i < 15; i++) t.bus.play("block", 0, 1);
    t.bus.play("block", 2, 1);
    expect(t.bus.play("block", 1, 1)).toBe(true);
    expect(t.bus.activeVoices).toBe(16);
  });
  test("voices expire with time", () => {
    const t = mk(); t.bus.unlock();
    t.bus.play("ko", 0, 1);
    t.state.time = 5;
    expect(t.bus.activeVoices).toBe(0);
  });
  test("dispose closes the context and silences", () => {
    const t = mk(); t.bus.unlock();
    t.bus.dispose();
    expect(t.state.closed).toBe(true);
    expect(t.bus.play("hitLight", 0, 0)).toBe(false);
  });
});

describe("Sfx mapping", () => {
  test("kinds map to distinct recipes", () => {
    expect(soundFor(ev({ kind: "hit", hitClass: "heavy" }))).toBe("hitHeavy");
    expect(soundFor(ev({ kind: "hit" }))).toBe("hitLight");
    expect(soundFor(ev({ kind: "respawn" }))).toBeNull();
    expect(castKind("sv.a1")).toBe("castStone");
    expect(castKind("td.b2")).toBe("castWater");
    expect(castKind("ea.a3")).toBe("castHeat");
    expect(Object.keys(RECIPES).length).toBe(10);
  });
  test("priority: local hit, nearby major, else", () => {
    expect(priorityFor(ev({ targetId: "me" }), "me", 30)).toBe(0);
    expect(priorityFor(ev({ kind: "cast", moveId: "sv.a1" }), "me", 10)).toBe(1);
    expect(priorityFor(ev({ kind: "cast", moveId: "sv.a1" }), "me", 30)).toBe(2);
    expect(priorityFor(ev({ kind: "cast", moveId: "m1.1" }), "me", 1)).toBe(2);
  });
});
