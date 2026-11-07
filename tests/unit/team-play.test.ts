import { describe, expect, it } from "vitest";
import { TEAM_PLAY, teamBotCount } from "../../packages/shared/src/config/teamPlay.js";
import { SparringDirectory } from "../../apps/server/src/auth/SparringDirectory.js";

describe("team play", () => {
  it("starts at 2 bots, ramps one per interval, never exceeds 4", () => {
    expect(teamBotCount(0)).toBe(2);
    expect(teamBotCount(TEAM_PLAY.rampIntervalTicks - 1)).toBe(2);
    expect(teamBotCount(TEAM_PLAY.rampIntervalTicks)).toBe(3);
    expect(teamBotCount(TEAM_PLAY.rampIntervalTicks * 2)).toBe(4);
    expect(teamBotCount(TEAM_PLAY.rampIntervalTicks * 50)).toBe(4);
    expect(teamBotCount(-5)).toBe(2);
  });
  it("directory seeds two easy bots and allows two humans", () => {
    const d = new SparringDirectory(() => true);
    const { roomCode } = d.create({ kind: "host", id: "h" }, { bots: [], teamPlay: true });
    expect(d.describe(roomCode)).toMatchObject({ teamPlay: true, bots: ["easy", "easy"] });
  });
});
