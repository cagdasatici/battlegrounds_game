# Reference observations (T31, spec section 2 and D10)

Status: no observation has been made. Every row is NOT RUN. No number below is a measurement; the layout values in
`docs/control-calibration.json` are D (local design values from spec section 7), the touch mapping is C [R01 R02],
and the original default iPad layout is U. Never mark exact parity without measurements (D10).

## Session metadata (fill per device before any row can be DONE)
| Field | Value |
|-------|-------|
| iPad model | NOT RUN |
| iPadOS | NOT RUN |
| Viewport (CSS px) | NOT RUN |
| Browser chrome | NOT RUN |
| Roblox build observation date | NOT RUN |
| Original game control settings | NOT RUN |

## Observation ledger
A row may become DONE only with: device, date, trial count (20 per input, 10 per move), median, range, video frame rate.
Add a decision record before changing any default because of a row. Record conflicting results without deleting old ones.

| ID | Observation | Tag | Evidence | Status | Device | Date | Trials | Median | Range | Fps |
|----|-------------|-----|----------|--------|--------|------|--------|--------|-------|-----|
| O01 | Default layout placement (screenshot, permission required) | U | R01 R02 | NOT RUN | | | | | | |
| O02 | One customized layout (with permission) | U | R02 | NOT RUN | | | | | | |
| O03 | Hold behavior (Quick Use, auto run; closes V04) | U | R10 | NOT RUN | | | | | | |
| O04 | Charge release | U | R03 | NOT RUN | | | | | | |
| O05 | Evasive reuse | U | R03 | NOT RUN | | | | | | |
| O06 | Fourth punch variants | U | R03 | NOT RUN | | | | | | |
| O07 | Touch rectangle sizes (closes V03) | U | R02 | NOT RUN | | | | | | |
| O08 | Input latency, 20 trials per input | U | R01 | NOT RUN | | | | | | |

## Procedure
Spec section 2 "Required fidelity check": on each iPad record model, iPadOS, viewport, chrome, Roblox build date and
the original settings; capture the default layout and one customized layout with permission; in a private reference
session measure 20 trials per input and 10 per move; compare placement, hold behavior, charge release, evasive reuse
and fourth punch variants. Normalized rectangles go to `docs/control-calibration.json` (`observed`).
