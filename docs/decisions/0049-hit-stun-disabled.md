# 0049 On-hit freeze disabled behind HIT_STUN flag

Status: accepted (interim), explicit owner requirement ("when a fighter gets hit it freezes; disable that completely for now, keep the logic").

- Flag: `HIT_STUN.enabled` in packages/shared/src/config/combat.ts, default `false`. Server authoritative; the client reads the same shared value.
- Gated (generic on-hit freeze):
  - M1 hits 1-3 `Stunned` reaction (apps/server/src/sim/M1.ts `reactionOf`); disabled yields `{kind:"none"}`, so damage applies, the victim keeps acting and its own cast is not interrupted.
  - Forward dash attack `Stunned` reaction (apps/server/src/sim/DashAttack.ts).
  - Client hit-stop animation pause on both fighters (apps/client/src/fx/HitFx.ts `playHit`). Flash, sparks and shake stay.
- Not gated (deliberate): ability-specific `stunTicks` in kit defs (sv, ea, td), split tide, thrown-player stun, all ragdoll/launch reactions, capture, blockstun. These are per-ability overrides, not the generic hit freeze. Revisit if the owner wants them off too.
- The flag is a mutable object only so tests can run legacy behavior; m1, dash-attack and hitfx unit tests now enable it. New tests: tests/unit/hit-stun-flag.test.ts and a flag-off case in hitfx.test.ts.
