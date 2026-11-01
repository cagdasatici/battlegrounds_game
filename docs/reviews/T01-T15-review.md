# T01 to T15 architecture and implementation review

Reviewed: 2026-11-01, at commit `f0c1ac9` (branch `claude/busy-faraday-hqbvp3`, T01 to T15 complete).
Reviewer role: staff engineer, architect and product owner. Read against `docs/spec.md` (the PDF text) and `AGENTS.md`.
Execution plan (supersedes the packet list here): `docs/implementation-plan.md`. T18 split: `docs/decisions/0001-split-t18.md`.

## 1. Verdict

The server core is sound and close to the contract. The fixed 60 Hz tick, integer deadlines, generation-token
cancellation, serial hit resolution, single-owner capture registry and strict zod validation are all present and
well tested (456 tests). No client damage path exists. No `setTimeout` or `setInterval` drives combat.

It is **not yet a safe base for T16 to T18**. Four defects will corrupt later kits, one breaks the fresh-checkout
build gate, and the replicated state and wire tests are thinner than the spec requires. Fix R01 to R06 before T16.

## 2. Gate results on a clean checkout (executed, not copied from reports)

`git clean -fdx`, `pnpm install --frozen-lockfile`, Node 22.23.4, pnpm 10.28.0:

| Command | Result |
|---|---|
| `pnpm typecheck` | **FAIL, exit 2** (TS6305). See R01 |
| `pnpm lint` | pass (`boundaries ok`; import boundaries only, no ESLint) |
| `pnpm test` | pass, 23 files, 456 tests |
| `pnpm build` | pass |
| `pnpm content:validate` | pass, 12 abilities |
| Node 24.22.2 (pinned in `.node-version`) | NOT RUN anywhere |
| Playwright / browser tests | none exist |
| Physical iPad | NOT RUN (correctly recorded) |

Acceptance IDs with a test today: A01 to A09, A14, A16, A17, A20. Not yet covered: A10 to A13, A15, A18, A19
(A10, A11, A12, A19 belong to P1; A13, A18 to T17; **A15 is in reach now and missing**).

## 3. What is right (keep it)

- `ActionMachine`: orthogonal action/form fields, exclusive deadlines, `generation` bump on every cancel.
- `HitResolver`: deterministic sort (toi, attacker, cast counter, hit index), serial apply, invulnerability before
  counter before guard, damage clamped in hundredths, one KO per life.
- `CaptureRegistry` plus `invariantViolations()` and the 4000-tick fuzz: no orphan captures.
- `AbilityRunner`: named handlers, strict `AbilityDef` schema, registry validator, cast state per instance.
- Stillpoint Reversal uses its own `lethalCounterUntil` field, so it survives base actions as the spec requires.
- Meter: actual damage only, nothing while Awakened, blocked and overkill excluded.
- Reports record limitations and NOT RUN honestly.

## 4. Process findings

1. **Parallel worktrees without integration gates.** T12 and T13 were built in sibling worktrees and merged by hand
   (`feef664`). The T12 report also shows a test flake caused by a shared machine. Rule from now on: one task per
   session, sequential on one branch, full gate run after every merge.
2. **Ledger does not follow AGENTS.md.** Commits are "see git log" instead of hashes. Statuses such as
   "DONE (Ember Orb reflect acceptance pending T19)" are not valid values. Fix in R15.
3. **`main` is at T04.** Eleven tasks live only on a `claude/*` branch. Merge to `main` after R01 passes; this is
   the owner's decision.
4. **Every report claims `pnpm typecheck` passes**, but it only passes after deleting tracked build output locally
   (T11 and T12 say so). A gate that only passes on the agent's machine is not a gate.

## 5. Fix packets

Moved to `docs/implementation-plan.md` section 4 (R01 to R18), with code-level detail and execution order.

## 6. Spec conflicts to record as decision records (`docs/decisions/`)

Do not silently change code for these; write the record, then follow it.

1. Default capture and third-party damage: §12 says "only where the capture handler permits", §13 says default
   captures allow ordinary third-party damage. The T09 choice (allow) is correct; R02 makes the abilities follow it.
2. Interrupted activation keeps the meter (T14 choice). The spec is silent. Record it as D.
3. M1 chain gap measured from the end of recovery (T10). §11 says only "Gap >54 ticks". Record it as D.
4. Downslam ragdoll 72 ticks (T10, not listed in §11). Record it as D.

## 9. Quality assessment (score out of 100)

Scored at `f0c1ac9` against the spec's own definition of done. Each line comes from evidence in this review.

| Dimension | Weight | Score | Evidence |
|---|---|---|---|
| Architecture and authority model | 20 | 17 | Fixed tick, generation tokens, serial resolver, capture registry, pure shared modules, no client damage path. Minus: kit stored in three places (R10); `ArenaRoom.stepTick` is becoming the place where every system is wired in by hand. |
| Spec fidelity of implemented scope | 25 | 18 | 12 moves match their tables. Minus: captured-victim eligibility (R02), two buffers (R03), shape anchors and Ocean Surge through walls (R05), forward-dash hit missing (R06), turnRate (R07), missing replicated fields (R08). |
| Test rigor | 20 | 14 | 456 deterministic tests, exact tick boundaries, damage sums asserted, fuzz with invariants. Minus: 7 of 12 moves have no two-client test, A15 missing, no browser tests, one "third party" test bypasses the path it claims to test. |
| Verification honesty and process | 15 | 10 | NOT RUN items recorded honestly, limitations listed. Minus: every report claims a typecheck that fails on a fresh clone, ledger lacks hashes and uses invalid statuses, parallel worktrees merged by hand. |
| Build and repo hygiene | 10 | 4 | Exact pins and lockfile present. Minus: fresh-clone typecheck fails, build output committed, lint is not a linter, pinned Node 24 never run, `main` 11 tasks behind. |
| Delivery progress toward a playable P0 | 10 | 5 | 15 of 18 P0 tasks done in about 2 hours. Minus: nothing renders and nobody can play yet; T18 as written is too large (R16). |
| **Total** | **100** | **68** | |

How to read 68: the foundation is good, and it is better than typical agent output on the hard part (authoritative
combat). The score is held down by fixable defects and gaps in verification evidence, not by architecture. After R01
to R06 and R15, the expected score is about 78. After R08, R12 to R14 and a split T18 that renders a playable
build, about 85. Above 90 needs the physical iPad checks, which no agent can run.
