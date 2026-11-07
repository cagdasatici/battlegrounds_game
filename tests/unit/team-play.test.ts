import { describe, expect, it } from "vitest";
import { TEAM_PLAY, teamBotCount } from "../../packages/shared/src/config/teamPlay.js";
import { SparringDirectory } from "../../apps/server/src/auth/SparringDirectory.js";

describe("team play", () => {
  it("starts at 2 bots, ramps one per interval, never exceeds 5", () => {
    expect(teamBotCount(0)).toBe(2);
    expect(teamBotCount(TEAM_PLAY.rampIntervalTicks - 1)).toBe(2);
    expect(teamBotCount(TEAM_PLAY.rampIntervalTicks)).toBe(3);
    expect(teamBotCount(TEAM_PLAY.rampIntervalTicks * 2)).toBe(4);
    expect(teamBotCount(TEAM_PLAY.rampIntervalTicks * 3)).toBe(5);
    expect(teamBotCount(TEAM_PLAY.rampIntervalTicks * 50)).toBe(5);
    expect(teamBotCount(-5)).toBe(2);
  });
  it("directory seeds two easy bots and allows two humans", () => {
    const d = new SparringDirectory(() => true);
    const { roomCode } = d.create({ kind: "host", id: "h" }, { bots: [], teamPlay: true });
    expect(d.describe(roomCode)).toMatchObject({ teamPlay: true, bots: ["easy", "easy"] });
  });
});

import { decideBot } from "../../apps/server/src/sim/SparringBrain.js";
describe("team play bots never wander", () => {
  it("easy bot with noWander always keeps its target and never takes a random-heading walk", () => {
    const enemy = { id: 9, x: 10, y: 0, z: 0, yaw: 0, alive: true, connected: true, ready: true, attacking: false, los: true, facingSelf: false };
    let prev = decideBot("easy", { tick: 0, spawnTick: 0, selfId: 1, self: { x: 0, z: 0 }, slotsReady: [false, false, false, false], meterFull: false, enemies: [enemy] }, undefined as never);
    for (let t = 30; t < 30 * 200; t += 30) {
      prev = decideBot("easy", { noWander: true, tick: t, spawnTick: 0, selfId: 1, self: { x: 0, z: 0 }, slotsReady: [false, false, false, false], meterFull: false, enemies: [enemy] }, prev);
      expect(prev.targetId).toBe(9);
    }
  });
});

import { nextTier } from "../../packages/shared/src/config/teamPlay.js";
describe("team play adaptive tier", () => {
  it("steps up when dominating, down when struggling, holds when balanced, stays in range", () => {
    expect(nextTier(0, 0, 3)).toBe(1);
    expect(nextTier(2, 0, 5)).toBe(2);
    expect(nextTier(1, 3, 1)).toBe(0);
    expect(nextTier(0, 4, 0)).toBe(0);
    expect(nextTier(1, 1, 1)).toBe(1);
    expect(nextTier(1, 2, 2)).toBe(1);
  });
});
