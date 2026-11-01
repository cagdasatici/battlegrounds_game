# 0004 An interrupted activation keeps the meter

Status: accepted (R15). Date: 2026-11-01.

Numbering: the plan calls this one of 0002-0005, but 0002 is already the R01 ESLint record, so R15 uses 0003-0006.

- Old value: none (the spec is silent).
- New value: if an awakening activation is interrupted, the meter is kept, not spent.
- Reason: silence in the spec; keeping the meter avoids punishing the victim of an interrupt. D choice, not a verified fact.
- Affected IDs: T16.
- Test impact: the T16 interruption test asserts the meter is unchanged after an interrupt.
