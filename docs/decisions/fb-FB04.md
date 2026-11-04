# FB04 Awaken fills 2.5x and survives death

Owner report 2026-11-04: "Increase the filling speed of Awaken a lot, like 2-3x. Also dying shouldn't reset Awaken load." This owner request overrides the earlier meter decisions: spec sections 11 and 15 (death resets the meter) and the 1x damage gain of spec 15/26. Decision 0004 (interrupted activation keeps meter) is unchanged.

| Rule | Old | New |
|---|---|---|
| Gain per resolved damaging hit (the only gain source: deal damage; block, counter, self, practice, overkill, awakened moves, posthumous or detached-past-life hits still give nothing) | damage100 | floor(damage100 x 5 / 2), `COMBAT.meter.gainNum/gainDen` in `packages/shared/src/config/combat.ts` |
| Thresholds | sv 20000, others 35000 | unchanged |
| KO | meter 0, form Base | form ends (Base), meter keeps its value |
| Respawn | meter 0 | meter kept |
| Kit change (applied while idle, or at respawn when a pending kit differs) | meter 0 | unchanged, still resets (threshold differs per kit) |
| Leaving the room | entity removed | unchanged |

Mid-Awakening KO: the meter is already 0 after activation completion and no gain happens while Awakened, so it stays at the value held after the form's normal consumption. Bots and practice use the same code (practice still has meter disabled by spec 7). GR02 posthumous-KO no-meter rule holds (tests unchanged and green). No wire field changed, so no PROTOCOL_VERSION change.
