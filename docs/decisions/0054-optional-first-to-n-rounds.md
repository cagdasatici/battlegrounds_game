# 0054 Optional first-to-N KO rounds

Date: 2026-11-03. Status: accepted (owner approval in chat, 2026-11-03: "Approve amendment: opt-in 'first to N KOs' rounds (0/5/10, 0 = endless) for hosted sparring and bot rooms; open FFA stays endless by default.").

## Decision
- Amends the spec FFA rule "no timed round" (section on FFA during a session) only for hosted sparring rooms and admin-created rooms that contain at least one bot. Open FFA rooms are unchanged: endless, `roundTarget` is always 0.
- Room option `roundTarget: 0 | 5 | 10` (default 0, 0 = endless). It is part of the strict sparring create request and the strict admin room create request. `JoinOptionsSchema` is unchanged and still strict, so a join carrying `roundTarget` is refused.
- When any player's `kills` reaches the target, the server sets `state.phase = "roundOver"` in that tick, broadcasts `roundOver` (standings sorted by kills, then fewest deaths, then entity id) and holds the phase for 600 ticks (integer ticks of the fixed 60 Hz clock, no timers).
- During `roundOver` the simulation is frozen: inputs are drained and dropped, no hit resolution runs, so no damage events are produced.
- At the end of the 600 ticks the server resets `kills/deaths/assists`, respawns every ready fighter on a fresh life (full HP, cooldowns, meter and form reset, standard spawn protection), sets `phase = "playing"` and starts the next round.
- Client shows a results card with a Rematch countdown driven by the `roundOver` message.

## Limits
- The admin UI has no round-target selector yet; the admin API accepts it. Practice rooms have no rounds.
- Rounds have no timer and no winner persistence. Ties on the target tick resolve by fewest deaths then entity id for display only.
