# DEV1 — iPad device session (owner-run)

Status: NOT RUN. This needs both physical iPads in Safari and a reachable host for the remote checks.
No result below has been measured; nothing here may be filled in from emulation.

Record per device: model, iPadOS version, Safari or home-screen mode, build id, date.

| Device | Model | iPadOS | Mode | Build id | Date |
|---|---|---|---|---|---|
| Arel's iPad | | | | | |
| Nora's iPad | | | | | |

## Spec section 26 (D01 to D10)

| ID | Scenario | Arel | Nora | Notes |
|---|---|---|---|---|
| D01 | Landscape 1024x768, 1180x820, actual safe viewport | NOT RUN | NOT RUN | |
| D02 | Move + camera + held M1 + Jump, 30 s; fourth hit variant | NOT RUN | NOT RUN | |
| D03 | Charge skill while moving camera, release outside button | NOT RUN | NOT RUN | |
| D04 | Block, app switcher, return | NOT RUN | NOT RUN | |
| D05 | Rotate, resize chrome, split view | NOT RUN | NOT RUN | |
| D06 | Drag layout, save, reload, reset | NOT RUN | NOT RUN | |
| D07 | Music and effects, background, return | NOT RUN | NOT RUN | |
| D08 | Die during a cinematic; open Settings | NOT RUN | NOT RUN | |
| D09 | Ten minute match, then ten lobby/game cycles | NOT RUN | NOT RUN | |
| D10 | Reference layout comparison (private session) | NOT RUN | NOT RUN | |

## Reference observations

O01 to O08 are recorded in docs/reference-observations.md (all NOT RUN).

## Features added after the original checklist

| Check | Arel | Nora | Notes |
|---|---|---|---|
| How to play guide: open, switch Touch/Keyboard, Try practice | NOT RUN | NOT RUN | HELP1, HELP2 |
| Host sparring solo with Easy, Medium and Hard bots (touch controls) | NOT RUN | NOT RUN | BOT3, BOT4C |
| Four-fighter room: 3 bots + host, frame time on low and medium | NOT RUN | NOT RUN | T30 budget p95 <= 33.3 ms |
| Guest link: copy, open on the other iPad, join, fight, host ends | NOT RUN | NOT RUN | BOT4, BOT5 |
| Remote invite / QR from a reachable host | NOT RUN | NOT RUN | |
| T30: median FPS, p95 frame time, 10 min; heap over 10 joins | NOT RUN | NOT RUN | |

When finished, move every IMPLEMENTED (DEVICE CHECK PENDING) row in docs/tasks.md to DONE only for checks that passed.
