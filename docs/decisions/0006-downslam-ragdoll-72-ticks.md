# 0006 The downslam ragdoll lasts 72 ticks

Status: accepted (R15). Date: 2026-11-01.

Numbering: the plan calls this one of 0002-0005, but 0002 is already the R01 ESLint record, so R15 uses 0003-0006.

- Old value: not listed in §11.
- New value: 72 integer ticks (1.2 s at 60 Hz).
- Reason: the simulation needs a value; chosen as a D value, not a verified original fact.
- Affected IDs: downslam ability, R12.
- Test impact: tests assert the ragdoll ends exactly at tick 72 and that death and expiry clear it.
