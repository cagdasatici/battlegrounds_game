# FB02 Easy bot much easier and error-prone

Owner report 2026-11-04: "Easy bot is not easy, it is hard to beat. Make it much slower and much easier to beat, make sure it makes lots of mistakes." This overrides earlier easy difficulty values. Medium and hard are unchanged. All values are D local design choices (`BOT_PARAMS.easy` in `apps/server/src/sim/SparringBrain.ts`).

| Parameter | Old | New |
|---|---|---|
| Move intent magnitude (`moveScale`, server-side, physics untouched) | 1.0 | 0.55 |
| Decision interval / reaction to a new target | 30 ticks / 30 | 30 ticks / 30 extra idle ticks on target acquisition |
| Swing spacing | held M1 chain; slot 1 every 3rd sample | one single-tick swing per 90 ticks, next decision backs off (no combo) |
| Whiff rate (off-angle swing 60-180 deg) | 0 | 0.40 |
| Aim error | 0 | +-25 deg |
| Block when attacked in range | 0 (easy never blocked) | 0 (owner: easier; never blocks); no dash/evade/awaken |
| Skill use | slot 1 every 3rd sample | slot 1 at 0.08 of in-reach swing decisions |
| Pursuit | unlimited | give up after 180 ticks of engagement, wander |
| Wander / idle | none | segments of 60, 90 or 120 ticks, 0.25 chance per segment, half idle and half random-heading walk |

Randomness is a pure hash of (bot entity id, life spawn tick, decision index, salt): deterministic, no `Math.random`, no timers. Ability damage and cooldowns are unchanged.
