# 0003 Default captures allow ordinary third-party damage

Status: accepted (R15). Date: 2026-11-01.

Numbering: the plan calls this one of 0002-0005, but 0002 is already the R01 ESLint record, so R15 uses 0003-0006.

- Old value: spec §12 reads as if a captured victim is not hittable by others.
- New value: spec §13 wins: a default capture makes the victim immune to third-party capture but not ordinary third-party damage.
- Reason: §13 is the specific local rule; the authority order prefers it.
- Affected IDs: R02, T16.
- Test impact: R02 tests assert a third party can damage a captured victim and cannot capture them.
