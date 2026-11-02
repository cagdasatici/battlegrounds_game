import { describe, expect, test } from "vitest";
import { AudioBus, type AudioContextLike } from "../../apps/client/src/audio/AudioBus.js";
import { attenuation, castKind, LOOPS, loopKindFor, RECIPES } from "../../apps/client/src/audio/synth.js";
import { priorityFor, scanSustainAudio, soundFor } from "../../apps/client/src/fx/Sfx.js";
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
    expect(castKind("sv.a1")).toBe("castStone");
    expect(castKind("td.b2")).toBe("castWater");
    expect(castKind("ea.a3")).toBe("castHeat");
    
    expect(Object.keys(LOOPS).length).toBe(3);
  });
  test("priority: local hit, nearby major, else", () => {
    expect(priorityFor(ev({ targetId: "me" }), "me", 30)).toBe(0);
    expect(priorityFor(ev({ kind: "cast", moveId: "sv.a1" }), "me", 10)).toBe(1);
    expect(priorityFor(ev({ kind: "cast", moveId: "sv.a1" }), "me", 30)).toBe(2);
    expect(priorityFor(ev({ kind: "cast", moveId: "m1.1" }), "me", 1)).toBe(2);
  });
});

describe("Strike, special and awakening sounds", () => {
  test("m1 presses swing, the fourth is a finisher, skills keep their cast", () => {
    expect(soundFor(ev({ kind: "cast", moveId: "m1.1" }))).toBe("swing");
    expect(soundFor(ev({ kind: "cast", moveId: "m1.3" }))).toBe("swing");
    expect(soundFor(ev({ kind: "cast", moveId: "m1.4.finisher" }))).toBe("swingFinisher");
    expect(soundFor(ev({ kind: "cast", moveId: "sv.a1" }))).toBe("castStone");
    expect(soundFor(ev({ kind: "cast", moveId: "td.b2" }))).toBe("castWater");
  });
  test("awakening has its own sound per element", () => {
    expect(soundFor(ev({ kind: "cast", moveId: "sv.activate" }))).toBe("awakenStone");
    expect(soundFor(ev({ kind: "cast", moveId: "td.activate" }))).toBe("awakenWater");
    expect(soundFor(ev({ kind: "cast", moveId: "ea.activate" }))).toBe("awakenHeat");
  });
  test("a skill impact carries its element; a plain punch does not", () => {
    expect(soundFor(ev({ kind: "hit", moveId: "sv.a2", hitClass: "heavy" }))).toBe("hitSpecialStone");
    expect(soundFor(ev({ kind: "hit", moveId: "td.a1" }))).toBe("hitSpecialWater");
    expect(soundFor(ev({ kind: "hit", moveId: "ea.b3" }))).toBe("hitSpecialHeat");
    expect(soundFor(ev({ kind: "hit", moveId: "m1.2" }))).toBe("hitLight");
    expect(soundFor(ev({ kind: "hit", moveId: "m1.4.finisher", hitClass: "heavy" }))).toBe("hitHeavy");
  });
  test("grab, release and respawn are heard; every mapped kind has a recipe", () => {
    expect(soundFor(ev({ kind: "capture" }))).toBe("capture");
    expect(soundFor(ev({ kind: "release" }))).toBe("release");
    expect(soundFor(ev({ kind: "respawn" }))).toBe("respawn");
    const moves = ["m1.1", "m1.4.finisher", "sv.a1", "td.b2", "ea.a3", "sv.activate", "td.activate", "ea.activate"];
    for (const kind of ["cast", "hit"] as const) for (const moveId of moves) {
      const k = soundFor(ev({ kind, moveId }));
      expect(k && RECIPES[k]).toBeTruthy();
    }
  });
  test("awakening is the longest and every identity sound is distinct", () => {
    const dur = (k: keyof typeof RECIPES) => RECIPES[k].dur;
    for (const a of ["awakenStone", "awakenWater", "awakenHeat"] as const) expect(dur(a)).toBeGreaterThan(dur("castHeat"));
    const kinds = ["swing", "swingFinisher", "awakenStone", "awakenWater", "awakenHeat", "hitSpecialStone", "hitSpecialWater", "hitSpecialHeat", "capture", "release", "respawn", "hitLight", "hitHeavy"] as const;
    expect(new Set(kinds.map((k) => JSON.stringify(RECIPES[k].layers))).size).toBe(kinds.length);
  });
  test("the real bus plays the new sounds once unlocked", () => {
    const t = mk(); t.bus.unlock();
    for (const k of ["swing", "swingFinisher", "awakenStone", "hitSpecialHeat", "capture"] as const) expect(t.bus.play(k, 1, 0)).toBe(true);
  });
});

describe("QS01 element identity", () => {
  const sig = (k: keyof typeof RECIPES) => JSON.stringify(RECIPES[k].layers);
  test("element casts and defensive sounds are all distinct recipes", () => {
    const kinds = ["castStone", "castWater", "castHeat", "block", "counter", "ko"] as const;
    expect(new Set(kinds.map(sig)).size).toBe(kinds.length);
  });
  test("stone has falling chip ticks, tide descends, ember rises then ignites", () => {
    const chips = RECIPES.castStone.layers.filter((l) => l.src === "noise" && (l.delay ?? 0) > 0);
    expect(chips.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < chips.length; i++) expect(chips[i]!.f0).toBeLessThan(chips[i - 1]!.f0);
    const tone = RECIPES.castWater.layers.find((l) => l.src === "osc")!;
    expect(tone.f1).toBeLessThan(tone.f0);
    const charge = RECIPES.castHeat.layers.find((l) => l.src === "osc")!;
    expect(charge.f1).toBeGreaterThan(charge.f0);
    const ignite = RECIPES.castHeat.layers.filter((l) => l.src === "noise");
    for (const l of ignite) expect(l.delay ?? 0).toBeGreaterThanOrEqual(charge.dur - 0.05);
  });
  test("loopKindFor: kits only, never m1 or dash", () => {
    expect(loopKindFor("sv.a3")).toBe("loopStone");
    expect(loopKindFor("td.a3")).toBe("loopWater");
    expect(loopKindFor("ea.a4")).toBe("loopHeat");
    expect(loopKindFor("m1.1")).toBeNull();
    expect(loopKindFor("dash.forward")).toBeNull();
    expect(loopKindFor(undefined)).toBeNull();
  });
});

describe("QS01 sustained loops", () => {
  test("loop starts once, counts as a voice, stops on stopLoop and never expires by time", () => {
    const t = mk(); t.bus.unlock();
    expect(t.bus.startLoop("a", "loopHeat", 1, 2)).toBe(true);
    expect(t.bus.startLoop("a", "loopHeat", 1, 2)).toBe(true);
    expect(t.bus.loopCount).toBe(1);
    t.state.time = 600;
    expect(t.bus.activeVoices).toBe(1);
    t.bus.stopLoop("a");
    expect(t.bus.activeVoices).toBe(0);
    expect(t.state.stopped).toBeGreaterThan(0);
  });
  test("loops obey the 16 voice cap and attenuation", () => {
    const t = mk(); t.bus.unlock();
    for (let i = 0; i < 20; i++) t.bus.startLoop(`k${i}`, "loopStone", 2, 1);
    expect(t.bus.activeVoices).toBe(16);
    expect(t.bus.startLoop("far", "loopStone", 0, 45)).toBe(false);
    expect(t.bus.startLoop("near", "loopStone", 0, 1)).toBe(true);
    expect(t.bus.activeVoices).toBe(16);
    t.bus.setLoopDistance("near", 60);
    expect(t.bus.hasLoop("near")).toBe(false);
  });
  test("stolen loop is forgotten so it can restart", () => {
    const t = mk(); t.bus.unlock();
    for (let i = 0; i < 16; i++) t.bus.startLoop(`k${i}`, "loopStone", 2, 1);
    t.bus.play("hitLight", 0, 1);
    expect(t.bus.loopCount).toBe(15);
  });
  test("suspend stops loops, refuses new voices until resume; dispose clears", () => {
    const t = mk(); t.bus.unlock();
    t.bus.startLoop("a", "loopWater", 1, 2);
    t.bus.suspend();
    expect(t.bus.loopCount).toBe(0);
    expect(t.bus.startLoop("a", "loopWater", 1, 2)).toBe(false);
    expect(t.bus.play("hitLight", 0, 0)).toBe(false);
    t.bus.resume();
    expect(t.bus.startLoop("a", "loopWater", 1, 2)).toBe(true);
    t.bus.dispose();
    expect(t.bus.activeVoices).toBe(0);
  });
  test("device interruption (statechange to interrupted) stops loops and blocks restart", () => {
    const f = fakeCtx() as ReturnType<typeof fakeCtx> & { ctx: { state?: string; onstatechange?: (() => void) | null } };
    f.ctx.state = "running";
    const bus = new AudioBus(() => f.ctx);
    bus.unlock();
    bus.startLoop("a", "loopHeat", 1, 2);
    f.ctx.state = "interrupted";
    f.ctx.onstatechange?.();
    expect(bus.loopCount).toBe(0);
    expect(bus.startLoop("a", "loopHeat", 1, 2)).toBe(false);
    f.ctx.state = "running";
    expect(bus.startLoop("a", "loopHeat", 1, 2)).toBe(true);
  });
});

describe("QS01 sustain scan follows replicated state", () => {
  const P = (over: Record<string, unknown>) => ({ x: 0, z: 0, action: "Active", moveId: "ea.a3", actionStartTick: 100, actionEndTick: 400, ...over });
  const run = (players: Map<string, unknown>, tick: number | undefined, bus: AudioBus, live: Set<string>) => scanSustainAudio(bus, players, tick, "me", live);
  test("starts on active, stops on active end, interruption, death and leave; short actives and m1 stay silent", () => {
    const t = mk(); t.bus.unlock();
    const live = new Set<string>();
    const players = new Map<string, unknown>([["me", P({})], ["foe", P({ moveId: "m1.1" })], ["short", P({ actionEndTick: 110 })]]);
    run(players, 150, t.bus, live);
    expect(t.bus.loopCount).toBe(1);
    run(players, 150, t.bus, live);
    expect(t.bus.loopCount).toBe(1);
    run(players, undefined, t.bus, live);
    expect(t.bus.loopCount).toBe(0);
    run(players, 150, t.bus, live);
    run(players, 400, t.bus, live); // confirmed phase end
    expect(t.bus.loopCount).toBe(0);
    run(players, 150, t.bus, live);
    players.set("me", P({ action: "Stunned" })); // interruption
    run(players, 160, t.bus, live);
    expect(t.bus.loopCount).toBe(0);
    players.set("me", P({})); run(players, 170, t.bus, live);
    players.set("me", P({ action: "Dead" })); // death
    run(players, 171, t.bus, live);
    expect(t.bus.loopCount).toBe(0);
    players.set("me", P({})); run(players, 172, t.bus, live);
    players.delete("me"); // leave
    run(players, 173, t.bus, live);
    expect(t.bus.loopCount).toBe(0);
    expect(live.size).toBe(0);
  });
});

test("music: independent voice, mute stops it, suspension and disposal clean it up, total cap retained", () => {
  const t = mk(); t.bus.setMusicVolume(1); expect(t.bus.musicPlaying).toBe(false);
  t.bus.unlock(); t.bus.setEffectsVolume(0); t.bus.setMusicVolume(.5);
  expect(t.bus.musicPlaying).toBe(true); expect(t.bus.activeVoices).toBe(1);
  t.bus.setMusicVolume(0); expect(t.bus.musicPlaying).toBe(false); expect(t.state.stopped).toBe(1);
  t.bus.setMusicVolume(.5); t.bus.suspend(); expect(t.bus.musicPlaying).toBe(false);
  t.bus.resume(); t.bus.setMusicVolume(.5);
  for (let i = 0; i < 30; i++) t.bus.play("block", 0, 0);
  expect(t.bus.activeVoices).toBe(16);
  t.bus.dispose(); expect(t.bus.musicPlaying).toBe(false); expect(t.state.closed).toBe(true);
});
