# 0008 Duelist finisher passive and T17 respawn rules

Status: accepted (T17). Evidence: spec section 15 (Duelist card: "Finisher passive heals caster once per victim life: b1 35, b2 30, b3 20, b4 40, a1/a2/a3 50, a4 zero"), section 10 (spawns and falls), section 6 (session rules), section 13 and the invariants list (one passive reward per victim life). The numbers below marked D are local design choices.

Conflict recorded: the ledger had no task for the finisher passive (docs/implementation-plan.md section 5, T17 note) while acceptance A13 requires "one passive reward". Chosen: implement it in T17, where the KO pipeline lives, for the Duelist kit (`td`) only, keyed by the lethal move id. M1, dash and unlisted moves pay zero. The heal is clamped to 100 HP, needs a living killer, and is claimed once per victim life (`RespawnSystem.claimReward`). A ring-out has no lethal hit and pays nothing.

Other rules fixed here:
- Same tick attribution ties follow resolver order (first recorded wins) for a ring-out credit.
- Window: entries up to and including 480 ticks old count; older entries are trimmed. Assist needs 2000 hundredths of actual HP removed, summed over the window, from someone other than the scorer.
- D: an anchor is in an "active hostile hit region" when it is within 2 m of the impact origin of any hit candidate produced this tick by another fighter. Candidate origins are the only region data the server exposes today.
- D: spawn distances are compared at 1 cm resolution so float noise cannot break the lowest-id tie rule.
- A queued kit change applies out of combat only to a living, Idle, Base form fighter; otherwise it stays queued until respawn. An awakened form is never cleared for a kit change.
