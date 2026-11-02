# 0039 QV08 Artificer coverage (delegated design calls)

Owner delegated design decisions to the orchestrator (decision 0033). Ratings are capture-based assessments, delegated, not a human sign-off.

1. Heat language per move: ember bursts, blast rings, streaks and rising plumes in orange, gold and red; the Solar Vent beam is pale gold with an amber sheath. All pooled particles; no geometry. Every recipe stays under the 100 particle low cap.
2. Ea.a3 Furnace Ray and the Ember Orb projectile (ORB2) are untouched. ea.b3 adds only a release muzzle flare and a splash ring on a confirmed hit; the charge keeps the existing windup glow plus the persistent orb.
3. Unreplicated endpoints (QV02): ea.b2, ea.b4, ea.a1 and ea.a2 have no replicated end position, so no telegraph was added and none is invented. Their travel is drawn from the caster along its replicated aim over the definition's travel length (8, 7.2 and 16 m, speed times life never exceeds it), and blasts are drawn only where a confirmed `hit` reports a position. A drop (b4) or a missed probe (a1) that hits nothing shows the descent or streak only. Replicating endpoints stays a possible server change, not done here.
4. Damage tiers choose the layer, from the ability definitions: b1 under or at least 1000 (finisher); b2 at least 1500 front blast else rear; b3 at least 2500 full charge; a1 0 or 1500 capture, 1300 small interrupted blast, 2000 missed-probe blast, 2500 release; a2 0 lock, at least 3000 slam, else splash. Client input never supplies damage.
5. Capture events: the server reports a capture as kind `capture`; `EaFx` maps it to the move's cue as a 0 damage hit (a1 wrap, a2 lock), like `TdFx`.
6. Solar Vent (a4) uses the QV05 sustain hook like the Furnace Ray: emitted every 4 ticks along the aim, clipped at cover via the client cover query, one flare per scheduled pulse (10, offsets from the definition), stops at active end or when the replicated action leaves Active. Wider and paler than the Ray so the two read apart.
7. `ea.activate` (Awakening 90 ticks, pulses +0, +72): once a rising furnace column, ground ring and glow; each pulse hit scorches its victim (10 particles).
8. Evidence is a synthetic fixture (server phase plus broadcast events). Real-input miss, block and interruption stay with existing server integration tests.
