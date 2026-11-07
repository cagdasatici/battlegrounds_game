# BEAST01: the sparring beast and the larger arena

Status: accepted by the owner request of 2026-11-07. Every number is D (a local design choice); none is a verified original-game fact (C and X are not facts either). The beast is original: primitive shapes, no borrowed artwork, audio or animation.

## Scope reading
AGENTS.md forbids expanding the three fighter scope without a new specification. The beast is not a selectable fighter, has no kit, no awakening and no roster or scoreboard row. It is a hosted-sparring enemy entity, specified here. If that reading is wrong, stop and write a specification before merging.

## Arena (conflict recorded)
The map had to grow for a 5.5x body. Main island 48 x 40 to 72 x 60 m; the four satellites and their bridges moved out with it (bridge length unchanged), and the four outer spawn anchors moved with their satellites. The central props (pillars, walls, urn anchors, the four inner spawns) were deliberately left where they were so combat tuned around them is unchanged; the new ring of open ground is where the beast fights. This changed `islands.v1` and its content hash for every mode (arena, practice and sparring share one map). Bot navigation bounds grew to 113 x 101 cells and `maxExpansions` to 4096.

## Beast rules
- Appears only in hosted sparring, after a random 45 to 90 s the first time and 90 to 150 s after each previous beast is gone. Needs at least one living human. A 3 s warning (ground marker and banner) precedes it. It leaves on its own after 3 minutes.
- HP 360 / 500 / 600 for 1 / 2 / 3 humans (a fighter has 100). It is armoured, so ordinary reactions do not interrupt it, but 40 damage inside 3 s staggers it for 2 s. Defeat heals every living human 50 HP.
- Walks at about 3.6 m/s (any human outruns it), turns slowly, rests 1.5 s between attacks.
  - Swipe: 0.7 s telegraph, forward cone, 12 damage, a throw. Blockable (chip 1), counterable, dodgeable by leaving the cone.
  - Slam: 1.1 s telegraph, circle, 9 damage, a small throw. Only hits fighters on the ground, so a jump dodges it.
- Never lethal while `BEAST.lethal` is false: it leaves a human on at least 1 HP.
- Edge safety is enforced on the server in two places. Its own body: it only steps where a 2.4 m ring around its next position is over walkable ground. Its throws: horizontal speed is cut, or the throw turns toward the arena centre, until the whole flight plus a landing slide stays over ground (`beastLaunch` uses `safeTravelDistance`). Kit launches and drags cannot move it (velocity is cleared each tick, captures against it are discarded, and a snap-back covers anything unexpected).

## Integration (one pipeline, no second scheduler)
The beast is a combat fighter (so the existing M1 and ability queries can hit it; M1 uses a 5.5x hurtbox), a pseudo seat (so the movement system walks it) and its attacks are `HitCandidate`s resolved by the ordinary `HitResolver` (protection, guard, counter, duplicate hit, interruption and death all apply). It is not in `state.players`; `state.beast` replicates it. Entity id 254 is reserved. All timers are integer ticks.

## Known limits
- Only M1 and the forward dash use the large hurtbox; ability area checks still measure from the beast's centre with the normal capsule, so they connect when the area reaches the centre.
- Fighters can walk through the beast (no body collision between fighters exists in this game).
- It never enters bridges or satellites (its body ring does not fit), so it will not follow a human there.
- Numbers are untested by real players; physical iPad checks are NOT RUN.
