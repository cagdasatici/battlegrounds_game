# 0007 Owner-only fields need the view() decorator (R08)

- Plan: mark `PlayerSchema.owner` with `view: true` inside `defineTypes`.
- Installed: @colyseus/schema with Colyseus 5.0.43 ignores `view: true` in `defineTypes`; the owner record leaked to other clients.
- Rule: apply `view()(PlayerSchema.prototype, "owner")` after `defineTypes`.
- Evidence: tests/integration/r08-owner-state.test.ts (two real clients; B never receives A's owner record, including after reconnect).
- Affected: R08, T18b.
