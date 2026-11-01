# 0005 The M1 chain gap is measured from the end of recovery

Status: accepted (R15). Date: 2026-11-01.

Numbering: the plan calls this one of 0002-0005, but 0002 is already the R01 ESLint record, so R15 uses 0003-0006.

- Old value: §11 says only "Gap >54 ticks", with no reference point.
- New value: the gap counter starts at the end of recovery of the previous M1; the chain resets when the gap exceeds 54 ticks.
- Reason: measuring from the hit or start would make chain length depend on startup and recovery. D choice.
- Affected IDs: M1 chain code and tests, R12.
- Test impact: chain tests cover a gap of 54 (continues) and 55 (resets) ticks counted from the end of recovery.
