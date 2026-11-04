# GR08 decision: durable round state

- PROTOCOL_VERSION 2 -> 3 (GR04 had moved 1 -> 2). Client and server share the one constant; runtime input envelope `v:1` is unchanged.
- Room state gains `roundTarget:uint8`, `roundNumber:uint32` (starts 1), `roundEndsAtTick:uint32` (0 while playing) and `roundStandings` (entityId, displayName, kills, deaths, assists). Standings are written in the same tick as `phase="roundOver"` and cleared, with the deadline reset and `roundNumber` incremented, at `roundOverUntil` (+600 ticks).
- The `roundOver` message is a transient cue only; the client draws the card from state and no longer subscribes to it.
- Client: input gate reason `round` follows `phase==="roundOver"` (GR05), the KO respawn card is suppressed during results, the objective strip (`First to N · You K · Leader L`, y=68, 14 px, max 360 px) shows only for active optional rounds. Admin form: Endless/First to 5/First to 10, nonzero disabled at 0 bots, submitted as 0.
