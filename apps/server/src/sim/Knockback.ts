/**
 * Knockback direction (spec 21): "Knockback replaces velocity components using the hit origin's horizontal
 * direction; if zero distance, use attacker forward." One shared function for M1, abilities and capture releases.
 * Direction = normalize(target.xz - origin.xz); below 1e-6 m the attacker forward (from `attackerYaw`) is used.
 */
export function launchVector(ox: number, oz: number, tx: number, tz: number, attackerYaw: number,
  forward: number, up: number): { vx: number; vy: number; vz: number } {
  let dx = tx - ox, dz = tz - oz;
  const len = Math.hypot(dx, dz);
  if (len < 1e-6) { dx = -Math.sin(attackerYaw); dz = -Math.cos(attackerYaw); } else { dx /= len; dz /= len; }
  return { vx: dx * forward, vy: up, vz: dz * forward };
}
