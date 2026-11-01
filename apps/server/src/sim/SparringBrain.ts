import type { BotDecision, BotObservation, Difficulty } from "@eb/shared/sparring";

const INTERVAL: Record<Difficulty, number> = { easy: 30, medium: 15, hard: 6 };
const neutral = (): BotDecision => ({
  targetId: null, attackHeld: false, blockHeld: false,
  approach: false, castSlot1: false, yaw: 0,
});

/** Pure, spawn-relative decisions. The room owns movement safety and skill input IDs. */
export function decideBot(
  difficulty: Difficulty, observation: BotObservation, previousDecision: BotDecision,
): BotDecision {
  const age = observation.tick - observation.spawnTick;
  const interval = INTERVAL[difficulty];
  // Discard held input from the previous life throughout the initial reaction delay.
  if (age < interval) return neutral();
  const eligible = observation.enemies.filter(enemy =>
    enemy.id !== observation.selfId && enemy.alive && enemy.connected && enemy.ready);
  if (age % interval !== 0) {
    return eligible.some(enemy => enemy.id === previousDecision.targetId)
      ? { ...previousDecision, castSlot1: false }
      : neutral();
  }

  let target: (typeof eligible)[number] | undefined;
  let distanceSquared = Infinity;
  for (const enemy of eligible) {
    const distance = (enemy.x - observation.self.x) ** 2 + (enemy.z - observation.self.z) ** 2;
    if (distance < distanceSquared || (distance === distanceSquared && target && enemy.id < target.id)) {
      target = enemy;
      distanceSquared = distance;
    }
  }
  if (!target) return neutral();
  const blockHeld = difficulty !== "easy" && target.attacking && distanceSquared <= 9;
  const inReach = distanceSquared <= 4;
  const castSlot1 = difficulty === "hard" && inReach && !blockHeld && observation.slot1Ready;
  const dx = target.x - observation.self.x;
  const dz = target.z - observation.self.z;
  return {
    targetId: target.id,
    attackHeld: inReach && !blockHeld && !castSlot1,
    blockHeld,
    approach: !inReach && !blockHeld,
    castSlot1,
    // Existing movement convention: yaw zero faces -Z. Coincident poses face zero.
    yaw: dx === 0 && dz === 0 ? 0 : Math.atan2(-dx, -dz),
  };
}
