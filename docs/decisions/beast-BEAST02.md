# BEAST02: Beast Awaken

All numbers are D. Same approach as BEAST01: the beast form is a temporary state of an existing fighter, not a fourth fighter.

- Meter: banks two bars (`meterCap100`). One bar is an ordinary awaken. Two banked bars turn the same Awaken press (same activation, same grounded and unprotected rules) into Beast Awaken. Rooms can switch it off with `AwakeningSystem.beastEnabled`.
- Form: underneath it is the ordinary Awakened form, so the four awakened specials, cooldowns and once-per-form bits are unchanged; `Fighter.beast` is an extra flag (replicated as `PlayerSchema.beast`, end tick in `formEndTick`). It lasts exactly 600 ticks, heals to full, is armoured, ends on death, and an awakened special no longer consumes the form while it is on.
- Beast stats: 0.5x walk and no running; takes half damage; M1 and dash deal 1.5x with a 2.5x M1 box; hurtbox is the wild beast's; the four awakened specials deal 2x (applied once in `CombatSystem.resolve` for every source, so a projectile whose owner already reverted loses the bonus: known limit).
- Wild beast ignores transformed humans.
- Craters (sparring only): server timed and replicated (`state.craters`), placed when a transformed fighter casts an awakened special (3.5 m ahead, radius 3.75 to 6 m by slot) and where it transforms (6 m), healed after 1200 ticks, at most 12 live. Decision: presentation plus timing only, no collision change. Making them real holes would desync client prediction (the client collides against the static map) and could strand fighters; that needs a separate, replicated terrain model and is left as follow-up.
