# Current contract index

This index lists the rules in force today and which document owns each. It does not replace or erase the original specification (`docs/spec.md`), which stays as the historical record. Rules here are local design choices (D), not verified facts about any reference game. Authority order is in `AGENTS.md`.

## Amendments

| Topic | Decision | Code / config | Tests |
|---|---|---|---|
| Faster movement | `docs/decisions/0020-faster-movement.md` | `packages/shared/src/movement.ts` | `tests/unit` movement suites |
| Hit-stun disabled behind `HIT_STUN` flag | `docs/decisions/0049-hit-stun-disabled.md` | `packages/shared/src/config/combat.ts` | `tests/unit/hit-stun-flag.test.ts` |
| Quick Use | `docs/decisions/0047-owner-experience-revision.md` | see decision | see decision |
| Double jump | `docs/decisions/0051-double-jump.md` | `packages/shared/src/movement.ts`, `config/combat.ts` | `tests/unit/double-jump.test.ts`, `tests/integration/double-jump.test.ts` |
| Open join | `docs/decisions/0050-open-join-and-cloudflare-access.md`, `0053-open-join-survives-ip-change.md` | see decisions | see decisions |
| Visual budget (300,000 triangles) | `docs/decisions/0048-triangle-budget-300k.md`, `0052-visual-overhaul.md` | see decisions | see decisions |
| Optional first-to-N rounds | `docs/decisions/0054-optional-first-to-n-rounds.md` | see decision | see decision |
| Compact HUD and portrait input gate | `docs/decisions/rp-RP01.md` | `apps/client/src/ui/Hud.ts`, `apps/client/src/ui/BeastBar.ts`, `apps/client/src/main.ts` | `docs/test-results/RP01.md` |

## GR decisions

Decision files: `docs/decisions/gr-GR01.md` to `gr-GR05.md`, `gr-GR08.md`, `gr-GR09.md`, `gr-GR15a.md` to `gr-GR15c.md`. Each task's evidence report is `docs/test-results/GRxx.md`; the status ledger is `docs/tasks.md`. Where a GR task has no decision file, its report is the record.

## Not covered

Physical iPad acceptance is not established by this index. See `docs/test-results/GR15d.md` (NOT RUN). This index does not authorize deployment.
