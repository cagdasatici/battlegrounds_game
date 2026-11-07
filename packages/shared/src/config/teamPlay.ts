/** Team play (decision 0060, D value): humans form one team against a bot team that ramps up over time. All timers are integer ticks. */
export const TEAM_PLAY = {
  maxHumans: 3,
  /** Out-of-combat regen: starts after 2 s without damage, then 2.5 HP every 30 ticks (5 HP/s). */
  regenDelayTicks: 120,
  regenIntervalTicks: 30,
  regenAmount100: 250,
  startBots: 2,
  maxBots: 4,
  startDifficulty: "easy",
  /** One extra bot every 60 s at 60 Hz until maxBots (full strength about 2 minutes in). */
  rampIntervalTicks: 3600,
} as const;

/** Bots present after `ticksElapsed` ticks of team play; never above maxBots. */
export function teamBotCount(ticksElapsed: number): number {
  const extra = Math.floor(Math.max(0, ticksElapsed) / TEAM_PLAY.rampIntervalTicks);
  return Math.min(TEAM_PLAY.maxBots, TEAM_PLAY.startBots + extra);
}
